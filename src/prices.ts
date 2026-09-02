import { getCachedPrice, upsertPrice } from "./db.js";

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  XRP: "ripple",
  USDT: "tether",
  USDC: "usd-coin",
};

const TTL_MS = 5 * 60 * 1000;
/** Beyond this age a cached price is treated as unusable for USD gating. */
const MAX_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * In-flight fetch dedupe: when the cache expires, N concurrent callers
 * produce exactly one CoinGecko request instead of N.
 */
const inflight = new Map<string, Promise<number | null>>();

export async function getUsdPrice(asset: string): Promise<number | null> {
  const key = asset.toUpperCase();
  if (!(key in COINGECKO_IDS)) return null;
  const existing = inflight.get(key);
  if (existing) return existing;

  const task = fetchWithCache(key).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, task);
  return task;
}

async function fetchWithCache(key: string): Promise<number | null> {
  try {
    const cached = await getCachedPrice(key);
    if (
      cached &&
      Date.now() - cached.fetchedAt.getTime() < TTL_MS
    ) {
      return cached.usdPrice;
    }
    const id = COINGECKO_IDS[key];
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`coingecko request failed with status ${res.status}`);
    const body = (await res.json()) as Record<string, { usd?: number }>;
    const usd = body[id]?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd)) {
      throw new Error("coingecko response missing usd price");
    }
    await upsertPrice(key, usd);
    return usd;
  } catch (err) {
    console.error(`price fetch failed for ${key}`, err);
    // Stale-but-bounded fallback beats dropping the transfer entirely; log
    // loudly so a dead CoinGecko integration is visible.
    try {
      const stale = await getCachedPrice(key);
      if (stale && Date.now() - stale.fetchedAt.getTime() < MAX_STALE_MS) {
        console.warn(`using stale cached price for ${key}`);
        return stale.usdPrice;
      }
    } catch {
      // fall through to null
    }
    return null;
  }
}
