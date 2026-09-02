import "dotenv/config";

const BASE_URL = "https://api.etherscan.io/v2/api";

export const ETHERSCAN_API_KEY: string | undefined =
  process.env.ETHERSCAN_API_KEY ?? process.env.ETHER_SCAN_API;

const blockCache = new Map<number, number>(); // blockHeight -> unix seconds
const MAX_CACHE_ENTRIES = 5_000;

/**
 * Block timestamp for occurred_at, so analytics use chain time rather than
 * arrival time. Cached per block; failures degrade to Date.now() upstream.
 */
export async function fetchEtherscanBlockTime(blockHeight: number): Promise<Date | null> {
  if (!ETHERSCAN_API_KEY) return null;
  const cached = blockCache.get(blockHeight);
  if (cached !== undefined) return new Date(cached * 1000);

  const url =
    `${BASE_URL}?chainid=1&module=block&action=getblockreward&blockno=${blockHeight}` +
    `&apikey=${ETHERSCAN_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      status?: string;
      result?: { timeStamp?: string } | string;
    };
    if (body.status !== "1" || typeof body.result === "string" || !body.result?.timeStamp) {
      throw new Error(`etherscan getblockreward rejected block ${blockHeight}`);
    }
    const seconds = Number.parseInt(body.result.timeStamp, 10);
    if (!Number.isFinite(seconds)) throw new Error("invalid timestamp");
    if (blockCache.size >= MAX_CACHE_ENTRIES) {
      // Drop the oldest ~quarter instead of growing unbounded.
      const cutoff = Math.floor(MAX_CACHE_ENTRIES / 4);
      let dropped = 0;
      for (const key of blockCache.keys()) {
        if (dropped++ >= cutoff) break;
        blockCache.delete(key);
      }
    }
    blockCache.set(blockHeight, seconds);
    return new Date(seconds * 1000);
  } catch (err) {
    console.error("[etherscan] block time fetch failed:", err);
    return null;
  }
}
