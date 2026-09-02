import type { AlertPayload, Category, Chain, Direction, NormalizedTransfer } from "./types.js";
import {
  findThreshold,
  getLiveCategorySet,
  getThresholds,
  insertTransferWithAlert,
} from "./db.js";
import { getUsdPrice } from "./prices.js";

const EXCHANGE_PREFIX = "exchange_";

function isEndpoint(categories: Set<Category>): boolean {
  for (const c of categories) {
    if (c.startsWith(EXCHANGE_PREFIX)) return true;
  }
  return false;
}

function classifyDirection(fromSet: Set<Category>, toSet: Set<Category>): Direction {
  const fromEndpoint = isEndpoint(fromSet);
  const toEndpoint = isEndpoint(toSet);
  if (fromEndpoint && toEndpoint) return "exchange_to_exchange";
  if (toEndpoint) return "to_exchange";
  if (fromEndpoint) return "from_exchange";
  return "wallet_to_wallet";
}

function short(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

function explorerUrl(chain: Chain, txHash: string): string {
  switch (chain) {
    case "ethereum":
      return `https://etherscan.io/tx/${txHash}`;
    case "bitcoin":
      return `https://mempool.space/tx/${txHash}`;
    case "xrpl":
      return `https://livenet.xrpl.org/transactions/${txHash}`;
  }
}

export async function processTransfer(
  t: NormalizedTransfer,
  opts: { dryRun?: boolean } = {},
): Promise<AlertPayload | null> {
  const asset = t.asset.toUpperCase();

  // Gate on thresholds BEFORE touching prices — the XRPL firehose must not
  // burn CoinGecko quota or price_cache queries on assets with no rule.
  const thresholds = await getThresholds();
  const threshold = findThreshold(thresholds, t.chain, asset);
  if (!threshold) return null;

  const amountPasses =
    threshold.minAmount !== null && t.amount >= Number(threshold.minAmount);

  // Price only when the USD gate must decide an outcome; amount-passing
  // transfers skip pricing here entirely.
  let usd: number | null = null;
  if (!amountPasses && threshold.minUsd !== null) {
    const price = await getUsdPrice(asset);
    if (price !== null) usd = t.amount * price;
  }

  const passes =
    amountPasses ||
    (threshold.minUsd !== null && usd !== null && usd >= Number(threshold.minUsd));
  if (!passes) {
    return null;
  }

  // Passed transfers get priced for display (cache + single-flight make
  // this at most one CoinGecko call per TTL window). Amount-only gating
  // means a CoinGecko outage can no longer drop stablecoin events, and
  // vice versa.
  if (usd === null) {
    const price = await getUsdPrice(asset);
    if (price !== null) usd = t.amount * price;
  }

  const freshnessDays = parsePositiveInt(process.env.FRESHNESS_DAYS, 30);
  const [fromSet, toSet] = await Promise.all([
    getLiveCategorySet(t.chain, t.from, freshnessDays),
    t.to
      ? getLiveCategorySet(t.chain, t.to, freshnessDays)
      : Promise.resolve(new Set<Category>()),
  ]);
  const direction = classifyDirection(fromSet, toSet);

  const amountFmt = new Intl.NumberFormat("en-US");
  const usdFmt = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const usdPart = usd === null ? "" : ` (~$${usdFmt.format(usd)})`;
  const line1 = `🐋 ${amountFmt.format(t.amount)} ${asset}${usdPart}`;
  const line2 = t.to
    ? `${short(t.from)} → ${short(t.to)}${tagPart(t)} [${direction}]`
    : `${short(t.from)} [${direction}]`;
  const line3 = explorerUrl(t.chain, t.txHash);
  const message = `${line1}\n${line2}\n${line3}`;

  // One transaction: the transfer row and its pending alert commit together,
  // so a crash between them can never orphan an unalerted transfer.
  if (opts.dryRun) {
    // Smoke/self-test: exercise the full gate → enrich → render path without
    // writing a phantom transfer (or alert) into the real database.
    return { transferId: -1, message };
  }
  const transferId = await insertTransferWithAlert(t, usd, direction, message);
  if (transferId === null) return null; // duplicate — already recorded

  return { transferId, message };
}

function tagPart(t: NormalizedTransfer): string {
  return t.destinationTag === undefined ? "" : ` 🏷️:${t.destinationTag}`;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
