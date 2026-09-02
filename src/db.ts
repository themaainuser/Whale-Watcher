import { Pool } from "pg";
import type {
  Chain,
  Category,
  Direction,
  LabelUpsert,
  NormalizedTransfer,
  Threshold,
} from "./types.js";

export const pool: Pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export function normalizeAddress(chain: Chain, address: string): string {
  return chain === "ethereum" ? address.toLowerCase() : address;
}

export async function getLiveCategorySet(
  chain: Chain,
  address: string,
  freshnessDays: number,
): Promise<Set<Category>> {
  const result = await pool.query<{ category: Category }>(
    `SELECT DISTINCT la.category
     FROM accounts a
     JOIN label_assignments la ON la.account_id = a.id
     WHERE a.chain = $1
       AND a.address = $2
       AND la.last_seen > now() - ($3 || ' days')::interval`,
    [chain, normalizeAddress(chain, address), String(freshnessDays)],
  );
  return new Set(result.rows.map((row) => row.category));
}

let thresholdsCache: Threshold[] | null = null;
let thresholdsCachedAt = 0;
const THRESHOLDS_TTL_MS = 60_000;

export async function getThresholds(): Promise<Threshold[]> {
  if (thresholdsCache && Date.now() - thresholdsCachedAt < THRESHOLDS_TTL_MS) {
    return thresholdsCache;
  }
  const result = await pool.query<Threshold>(
    `SELECT chain, asset, min_amount AS "minAmount", min_usd AS "minUsd"
     FROM asset_thresholds`,
  );
  thresholdsCache = result.rows;
  thresholdsCachedAt = Date.now();
  return thresholdsCache;
}

export function findThreshold(
  thresholds: Threshold[],
  chain: Chain,
  asset: string,
): Threshold | undefined {
  const assetKey = asset.toUpperCase();
  // Exact (chain, asset) match only — an XRPL IOU coded "ETH" must never
  // inherit the mainnet ethereum/ETH threshold.
  return thresholds.find(
    (th) => th.chain === chain && th.asset === assetKey,
  );
}

/**
 * Atomically persist a transfer and its pending alert. Separate inserts here
 * are a loss window: if the process dies (or the DB blips) between them, the
 * transfer is committed, every redelivery hits the dedup conflict, and the
 * alert is never created — the outbox has nothing to send. One transaction
 * closes it.
 */
export async function insertTransferWithAlert(
  t: NormalizedTransfer,
  usdValue: number | null,
  direction: Direction,
  message: string,
  channel = "telegram",
): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string }>(
      `INSERT INTO transfers (
         chain, asset, tx_hash, log_index, block_height,
         from_address, to_address, destination_tag, amount, usd_value, direction, occurred_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (chain, tx_hash, log_index) DO NOTHING
       RETURNING id`,
      [
        t.chain,
        t.asset.toUpperCase(),
        t.txHash,
        t.logIndex ?? 0,
        t.blockHeight ?? null,
        normalizeAddress(t.chain, t.from),
        t.to === undefined ? null : normalizeAddress(t.chain, t.to),
        t.destinationTag ?? null,
        String(t.amount),
        usdValue === null ? null : usdValue.toFixed(2),
        direction,
        t.occurredAt.toISOString(),
      ],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null; // duplicate — already recorded
    }
    const transferId = Number(row.id);
    await client.query(
      `INSERT INTO alerts (transfer_id, channel, message)
       VALUES ($1, $2, $3)
       ON CONFLICT (transfer_id, channel) DO NOTHING`,
      [transferId, channel, message],
    );
    await client.query("COMMIT");
    return transferId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function insertTransfer(
  t: NormalizedTransfer,
  usdValue: number | null,
  direction: Direction,
): Promise<number | null> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO transfers (
       chain, asset, tx_hash, log_index, block_height,
       from_address, to_address, destination_tag, amount, usd_value, direction, occurred_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (chain, tx_hash, log_index) DO NOTHING
     RETURNING id`,
    [
      t.chain,
      t.asset.toUpperCase(),
      t.txHash,
      t.logIndex ?? 0,
      t.blockHeight ?? null,
      normalizeAddress(t.chain, t.from),
      t.to === undefined ? null : normalizeAddress(t.chain, t.to),
      t.destinationTag ?? null,
      String(t.amount),
      usdValue === null ? null : usdValue.toFixed(2),
      direction,
      t.occurredAt.toISOString(),
    ],
  );
  const row = result.rows[0];
  return row ? Number(row.id) : null;
}

/**
 * Alert outbox. `sent_at` stays NULL until Telegram confirms delivery; a
 * periodic drain re-sends anything still pending. The rendered message is
 * persisted at creation so retries don't depend on process memory.
 */
export async function insertPendingAlert(
  transferId: number,
  message: string,
  channel = "telegram",
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO alerts (transfer_id, channel, message)
     VALUES ($1, $2, $3)
     ON CONFLICT (transfer_id, channel) DO NOTHING
     RETURNING id`,
    [transferId, channel, message],
  );
  return result.rowCount === 1;
}

export async function pendingAlerts(
  limit = 100,
): Promise<Array<{ transferId: number; message: string }>> {
  // The SQL alias is camelCase, so the row key is "transferId" — reading a
  // snake_case key here would silently yield NaN (TS generics can't check
  // alias/key agreement, which is exactly how the original bug slipped in).
  const result = await pool.query<{
    transferId: string;
    message: string;
  }>(
    `SELECT transfer_id AS "transferId", message
     FROM alerts
     WHERE sent_at IS NULL AND message IS NOT NULL
     ORDER BY id
     LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    transferId: Number(row.transferId),
    message: row.message,
  }));
}

export async function markAlertSent(
  transferId: number,
  channel = "telegram",
): Promise<void> {
  await pool.query(
    `UPDATE alerts SET sent_at = now()
     WHERE transfer_id = $1 AND channel = $2`,
    [transferId, channel],
  );
}

export async function getCachedPrice(
  asset: string,
): Promise<{ usdPrice: number; fetchedAt: Date } | null> {
  const result = await pool.query<{
    usd_price: string;
    fetched_at: Date;
  }>(
    `SELECT usd_price, fetched_at
     FROM price_cache
     WHERE asset = $1`,
    [asset],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { usdPrice: Number(row.usd_price), fetchedAt: row.fetched_at };
}

export async function upsertPrice(
  asset: string,
  usdPrice: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO price_cache (asset, usd_price, fetched_at)
     VALUES ($1, $2, now())
     ON CONFLICT (asset) DO UPDATE
       SET usd_price = EXCLUDED.usd_price,
           fetched_at = now()`,
    [asset, usdPrice],
  );
}

/**
 * Bulk upsert of label rows via unnest — one round-trip per batch instead of
 * two per row. Rows within a batch must not repeat (chain, address) or the
 * ON CONFLICT ... RETURNING join would double-count them.
 */
export async function upsertLabels(items: LabelUpsert[]): Promise<number> {
  if (items.length === 0) return 0;

  // Dedupe within the batch; later entries win (same precedence as the old
  // sequential loop).
  const byAddress = new Map<string, LabelUpsert>();
  for (const item of items) {
    byAddress.set(`${item.chain}:${normalizeAddress(item.chain, item.address)}`, item);
  }
  const unique = [...byAddress.values()];
  const n = unique.length;

  const chains: string[] = [];
  const addresses: string[] = [];
  const clusterIds: Array<string | null> = [];
  const destTags: Array<number | null> = [];
  const categories: string[] = [];
  const labels: string[] = [];
  const sources: string[] = [];
  const confidences: string[] = [];

  for (const item of unique) {
    chains.push(item.chain);
    addresses.push(normalizeAddress(item.chain, item.address));
    clusterIds.push(item.clusterId ?? null);
    destTags.push(item.destinationTag ?? null);
    categories.push(item.category);
    labels.push(item.label);
    sources.push(item.source);
    confidences.push(item.confidence);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const accountResult = await client.query<{ id: string; address: string }>(
      `WITH incoming(chain, address, cluster_id, destination_tag) AS (
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[])
       ), updated AS (
         INSERT INTO accounts (chain, address, cluster_id, destination_tag)
         SELECT chain, address, cluster_id, destination_tag FROM incoming
         ON CONFLICT (chain, address) DO UPDATE
           SET cluster_id = COALESCE(EXCLUDED.cluster_id, accounts.cluster_id),
               destination_tag = COALESCE(EXCLUDED.destination_tag, accounts.destination_tag)
         RETURNING id, chain, address
       )
       SELECT u.id, i.address
       FROM updated u
       JOIN incoming i ON i.chain = u.chain AND i.address = u.address`,
      [chains, addresses, clusterIds, destTags],
    );
    const idByAddress = new Map<string, number>();
    for (const row of accountResult.rows) {
      idByAddress.set(row.address, Number(row.id));
    }

    const accountIds: number[] = [];
    for (const item of unique) {
      const id = idByAddress.get(normalizeAddress(item.chain, item.address));
      if (id === undefined) {
        throw new Error(`upsertLabels: no account id resolved for ${item.chain}:${item.address}`);
      }
      accountIds.push(id);
    }

    await client.query(
      `INSERT INTO label_assignments (account_id, category, label, source, confidence, last_seen)
       SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[])
       CROSS JOIN LATERAL now() AS last_seen
       ON CONFLICT (account_id, category, label, source) DO UPDATE
         SET confidence = EXCLUDED.confidence,
             last_seen = now()`,
      [accountIds, categories, labels, sources, confidences],
    );

    await client.query("COMMIT");
    return n;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
