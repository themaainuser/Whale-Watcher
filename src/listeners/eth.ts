import http from "node:http";
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ETHERSCAN_API_KEY, fetchEtherscanBlockTime } from "../etherscan.js";
import type { NormalizedTransfer } from "../types.js";

/** Alchemy signs the raw request body with HMAC-SHA256 under this header. */
const SIGNATURE_HEADER = "x-alchemy-signature";
const MAX_BODY_BYTES = 1_000_000; // 1 MB — Alchemy payloads are far smaller

interface AlchemyActivity {
  fromAddress?: string;
  toAddress?: string;
  /** Human-unit transfer value per Alchemy docs (converted asset value). */
  value?: number | string;
  asset?: string;
  hash?: string;
  blockNum?: string;
  logId?: string;
  erc721TokenId?: string;
  category?: string;
  rawContract?: {
    rawValue?: unknown;
    address?: unknown;
    decimals?: unknown;
  };
}

interface AlchemyWebhookBody {
  event?: { activity?: AlchemyActivity[] };
}

export function startEthWebhook(onTransfer: (t: NormalizedTransfer) => Promise<void>): http.Server | null {
  const port = Number(process.env.PORT ?? 8080);
  const signingKey = process.env.ALCHEMY_SIGNING_KEY;

  if (!signingKey) {
    // Fail closed: without the key we cannot authenticate deliveries, so we do not listen.
    console.warn(
      "[eth] ALCHEMY_SIGNING_KEY not set — Ethereum webhook disabled " +
        "(set it in .env from the Alchemy dashboard, Signature section)",
    );
    return null;
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res, onTransfer, signingKey).catch((error) => {
      console.error("[eth] request handling failed:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      try {
        res.end(JSON.stringify({ ok: false }));
      } catch {
        // response already finished — nothing to do
      }
    });
  });

  server.on("error", (error) => {
    console.error("[eth] webhook server error:", error);
  });

  server.listen(port, () => {
    console.log(`[eth] webhook listening on :${port}`);
  });
  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  onTransfer: (t: NormalizedTransfer) => Promise<void>,
  signingKey: string
): Promise<void> {
  if (req.method !== "POST" || req.url?.split("?")[0] !== "/alchemy-webhook") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const body = await readBody(req);
  if (body === null) {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "payload too large" }));
    return;
  }

  if (!verifySignature(signingKey, req, body)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid signature" }));
    return;
  }

  let parsed: AlchemyWebhookBody;
  try {
    parsed = JSON.parse(body) as AlchemyWebhookBody;
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unparseable body" }));
    return;
  }

  const activities = parsed?.event?.activity;
  if (!Array.isArray(activities)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "missing event.activity" }));
    return;
  }

  for (const activity of activities) {
    try {
      const transfer = toNormalizedTransfer(activity);
      if (transfer === null) {
        // Observable instead of a silent 200: a payload-shape mismatch (new
        // field layout, unknown contract, NFT noise) shows up here.
        console.warn(
          "[eth] activity dropped:",
          JSON.stringify({
            hash: typeof activity?.hash === "string" ? activity.hash : "?",
            asset: activity?.asset ?? "?",
            category: activity?.category ?? "?",
          }),
        );
        continue;
      }
      if (transfer.blockHeight !== undefined) {
        const blockTime = await fetchEtherscanBlockTime(transfer.blockHeight);
        if (blockTime) transfer.occurredAt = blockTime;
      }
      await onTransfer(transfer);
    } catch (error) {
      console.error("[eth] failed to process activity:", error);
    }
  }

  if (res.writableEnded) return;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

/**
 * Constant-time HMAC-SHA256 check of x-alchemy-signature over the raw body.
 */
function verifySignature(secret: string, req: IncomingMessage, body: string): boolean {
  const provided = req.headers[SIGNATURE_HEADER];
  if (typeof provided !== "string" || provided.length === 0) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("hex");
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Convert a base-unit string (wei / token smallest unit) to human units using
 * BigInt so wei-scale magnitudes never lose precision.
 */
export function parseBaseUnits(raw: string | undefined, decimals: number): number | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return null;
  if (decimals <= 0) return null;
  const scaled = 10n ** BigInt(decimals);
  const whole = BigInt(negative ? `-${digits}` : digits);
  // Truncate to 8 decimal places in fixed point, then convert — BigInt math
  // keeps wei-scale magnitudes exact up to the final Number conversion.
  const fixed8 = (whole * 100_000_000n) / scaled;
  return Number(fixed8) / 1e8;
}

/**
 * Canonical mainnet contracts we accept ERC-20 activity for. Keyed by
 * lowercase contract ADDRESS, not symbol — any contract can declare
 * symbol() == "USDC", and counterfeit spam tokens airdropped to exchange
 * wallets are routine. An unknown contract is rejected (fail-closed) rather
 * than guessed at from its symbol.
 */
const CONTRACTS: Record<string, { asset: string; decimals: number }> = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { asset: "USDC", decimals: 6 },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { asset: "USDT", decimals: 6 },
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { asset: "WETH", decimals: 18 },
};

interface RawContract {
  rawValue?: unknown;
  address?: unknown;
  decimals?: unknown;
}

export function toNormalizedTransfer(activity: AlchemyActivity): NormalizedTransfer | null {
  if (typeof activity?.hash !== "string" || typeof activity.fromAddress !== "string") {
    return null;
  }
  // NFT activities carry no fungible amount — skip them explicitly.
  if (typeof activity.erc721TokenId === "string") return null;

  const rawContract = activity.rawContract as RawContract | undefined;
  const contractAddress =
    typeof rawContract?.address === "string" ? rawContract.address.toLowerCase() : null;

  let asset: string | null = null;
  let amount: number | null = null;

  if (contractAddress === null) {
    // Native ETH transfer: no contract involved. `value` is the human-unit
    // ETH amount per Alchemy's Address-Activity docs.
    if (typeof activity.value === "number" && Number.isFinite(activity.value)) {
      asset = "ETH";
      amount = activity.value;
    } else if (typeof activity.value === "string" && /^\d+(\.\d+)?$/.test(activity.value)) {
      asset = "ETH";
      amount = Number(activity.value);
    }
  } else {
    // ERC-20 transfer: identity comes from the contract address allowlist.
    const known = CONTRACTS[contractAddress];
    if (!known) return null; // unknown contract — reject even if symbol looks familiar

    // Preferred source: rawContract.rawValue (hex base units) scaled by the
    // on-chain decimals from rawContract.decimals (fallback to the allowlist).
    let decimals = known.decimals;
    if (typeof rawContract?.decimals === "number" && rawContract.decimals >= 0) {
      decimals = rawContract.decimals;
    }
    if (typeof rawContract?.rawValue === "string" && /^0x[0-9a-fA-F]+$/.test(rawContract.rawValue)) {
      amount = parseBaseUnits(BigInt(rawContract.rawValue).toString(), decimals);
    } else if (typeof activity.value === "number" && Number.isFinite(activity.value)) {
      // Docs: `value` is already human units (raw / 10^decimals).
      amount = activity.value;
    }
    if (amount !== null) asset = known.asset;
  }

  if (asset === null || amount === null || !Number.isFinite(amount)) return null;

  const blockHeight = deriveBlockHeight(activity.blockNum);

  return {
    chain: "ethereum",
    asset,
    txHash: activity.hash.toLowerCase(),
    logIndex: deriveLogIndex(activity.logId),
    blockHeight,
    from: activity.fromAddress,
    to: typeof activity.toAddress === "string" ? activity.toAddress : undefined,
    destinationTag: undefined,
    amount,
    occurredAt: new Date(),
  };
}

/**
 * Alchemy logId format is "<txHash>_<logIndexHex>"; native transfers have no
 * log entry, so they get -1 to keep them out of collision with real logs at
 * index 0 under the (chain, tx_hash, log_index) uniqueness constraint.
 *
 * The suffix is hex per Alchemy docs; if it ever arrives as plain decimal the
 * parsed values stay small and distinct enough that dedup still works.
 */
function deriveLogIndex(logId: string | undefined): number | undefined {
  if (typeof logId !== "string" || logId.length === 0) return undefined;
  const separatorIndex = logId.lastIndexOf("_");
  const suffix = separatorIndex >= 0 ? logId.slice(separatorIndex + 1) : logId;
  const parsed = Number.parseInt(suffix, 16);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function deriveBlockHeight(blockNum: string | undefined): number | undefined {
  if (typeof blockNum !== "string" || !/^0x[0-9a-fA-F]+$/.test(blockNum)) return undefined;
  const parsed = Number.parseInt(blockNum, 16);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!done) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", () => {
      if (!done) {
        done = true;
        resolve(null);
      }
    });
  });
}
