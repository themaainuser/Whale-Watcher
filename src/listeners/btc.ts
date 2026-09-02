import type { NormalizedTransfer } from "../types.js";

const BLOCKSTREAM_BASE = "https://blockstream.info/api";
const FAST_INTERVAL_MS = 20000;
const SLOW_INTERVAL_MS = 60000;
const MIN_LARGEST_OUTPUT_SATS = 10 * 100000000;
const SESSION_OVERLAP_START_MIN = 13 * 60;
const SESSION_OVERLAP_END_MIN = 17 * 60;

interface BtcPrevout {
  scriptpubkey_address?: string;
}

interface BtcVin {
  is_coinbase?: boolean;
  prevout?: BtcPrevout | null;
}

interface BtcVout {
  value?: number;
  scriptpubkey_address?: string;
}

interface BtcTx {
  txid?: string;
  vin?: BtcVin[];
  vout?: BtcVout[];
}

interface BtcBlock {
  id?: string;
  timestamp?: number;
}

export function startBtcListener(onTransfer: (t: NormalizedTransfer) => Promise<void>): void {
  let lastHeight: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentIntervalMs = -1;
  let polling = false;

  const inSessionOverlap = (): boolean => {
    const now = new Date();
    const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    return (
      minuteOfDay >= SESSION_OVERLAP_START_MIN && minuteOfDay <= SESSION_OVERLAP_END_MIN
    );
  };

  const tick = async (): Promise<void> => {
    if (!polling) {
      polling = true;
      try {
        await pollOnce();
      } catch (error) {
        console.error("[btc] poll failed:", error);
      } finally {
        polling = false;
      }
    }
    applySchedule();
  };

  const applySchedule = (): void => {
    const desired = inSessionOverlap() ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
    if (currentIntervalMs === desired) return;
    if (timer !== null) clearInterval(timer);
    currentIntervalMs = desired;
    timer = setInterval(() => {
      void tick();
    }, desired);
  };

  const pollOnce = async (): Promise<void> => {
    const tip = await fetchTipHeight();
    // Reorg guard: only trust a tip that is at least as deep as what we have
    // already processed; a shorter chain means the last block(s) were dropped.
    if (lastHeight === null) {
      lastHeight = tip;
      return;
    }
    for (let height = lastHeight + 1; height <= tip; height += 1) {
      try {
        await processBlock(height, onTransfer);
        lastHeight = height;
      } catch (error) {
        console.error(`[btc] failed to process block ${height}:`, error);
        return;
      }
    }
  };

  console.log("[btc] listening");
  applySchedule();
}

async function fetchTipHeight(): Promise<number> {
  const res = await fetch(`${BLOCKSTREAM_BASE}/blocks/tip/height`);
  if (!res.ok) throw new Error(`blocks/tip/height responded ${res.status}`);
  const tip = Number.parseInt((await res.text()).trim(), 10);
  if (!Number.isFinite(tip)) throw new Error("invalid tip height");
  return tip;
}

async function processBlock(
  height: number,
  onTransfer: (t: NormalizedTransfer) => Promise<void>
): Promise<void> {
  const hashRes = await fetch(`${BLOCKSTREAM_BASE}/block-height/${height}`);
  if (!hashRes.ok) throw new Error(`block-height/${height} responded ${hashRes.status}`);
  const hash = (await hashRes.text()).trim();

  const blockRes = await fetch(`${BLOCKSTREAM_BASE}/block/${hash}`);
  if (!blockRes.ok) throw new Error(`block/${hash} responded ${blockRes.status}`);
  const block = (await blockRes.json()) as BtcBlock;
  const blockTimeSeconds =
    typeof block.timestamp === "number" ? block.timestamp : Math.floor(Date.now() / 1000);

  // The txs endpoint pages 25 at a time (verified live: block 800000 has
  // 3721 txs; /txs returns exactly 25). Follow the /txs/:start_index
  // continuation until a short page ends the block, otherwise 99% of every
  // block — including nearly all whale txs — is never scanned.
  const PAGE = 25;
  let start = 0;
  for (;;) {
    const txsRes = await fetch(`${BLOCKSTREAM_BASE}/block/${hash}/txs/${start}`);
    if (!txsRes.ok) throw new Error(`block/${hash}/txs/${start} responded ${txsRes.status}`);
    const txs = (await txsRes.json()) as BtcTx[];
    if (!Array.isArray(txs) || txs.length === 0) break;

    for (const tx of txs) {
      try {
        await maybeEmitWhale(tx, height, blockTimeSeconds, onTransfer);
      } catch (error) {
        console.error(`[btc] failed to process tx in block ${height}:`, error);
      }
    }

    if (txs.length < PAGE) break;
    start += PAGE;
  }
}

/**
 * Whale heuristic, change-aware: the largest output is only counted when it
 * goes to an address that does NOT also receive in this tx — otherwise the
 * biggest output is usually change going back to the spender and the real
 * payment is smaller.
 */
function pickPaymentOutput(vouts: BtcVout[], inputAddresses: Set<string>): BtcVout | null {
  let largestExternal: BtcVout | null = null;
  let largestAny: BtcVout | null = null;
  for (const vout of vouts) {
    if (typeof vout?.value !== "number") continue;
    if (largestAny === null || vout.value > (largestAny.value ?? -1)) largestAny = vout;
    const addr = typeof vout.scriptpubkey_address === "string" ? vout.scriptpubkey_address : null;
    if (addr !== null && inputAddresses.has(addr)) continue;
    if (largestExternal === null || vout.value > (largestExternal.value ?? -1)) {
      largestExternal = vout;
    }
  }
  return largestExternal ?? largestAny;
}

async function maybeEmitWhale(
  tx: BtcTx,
  height: number,
  blockTimeSeconds: number,
  onTransfer: (t: NormalizedTransfer) => Promise<void>
): Promise<void> {
  if (!tx || typeof tx.txid !== "string") return;
  const vins = Array.isArray(tx.vin) ? tx.vin : [];
  if (vins.length === 0) return;
  if (vins[0]?.is_coinbase === true) return;

  // The /block/:hash/txs listing already includes full prevout data —
  // no per-tx follow-up request needed (the old code fetched /tx/:id again).
  const inputAddresses = new Set<string>();
  for (const vin of vins) {
    const addr = vin.prevout?.scriptpubkey_address;
    if (typeof addr === "string") inputAddresses.add(addr);
  }

  const vouts = Array.isArray(tx.vout) ? tx.vout : [];
  const largest = pickPaymentOutput(vouts, inputAddresses);
  if (largest === null || typeof largest.value !== "number") return;
  if (largest.value < MIN_LARGEST_OUTPUT_SATS) return;

  const to =
    typeof largest.scriptpubkey_address === "string"
      ? largest.scriptpubkey_address
      : undefined;
  const from = [...inputAddresses][0];
  if (from === undefined || to === undefined) return;

  try {
    await onTransfer({
      chain: "bitcoin",
      asset: "BTC",
      txHash: tx.txid,
      blockHeight: height,
      from,
      to,
      amount: largest.value / 1e8,
      occurredAt: new Date(blockTimeSeconds * 1000),
    });
  } catch (error) {
    console.error("[btc] onTransfer handler failed:", error);
  }
}
