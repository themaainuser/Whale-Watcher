/**
 * DB integration tests — run against a real Postgres (DATABASE_URL).
 * Each test cleans up after itself; the suite is skipped entirely when
 * DATABASE_URL is unset, so `npm run test:unit` works with zero infra.
 *
 * Found a real bug on its first run (pendingAlerts alias/key mismatch →
 * NaN → drain would re-send forever), which is exactly why it exists.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

if (!process.env.DATABASE_URL) {
  console.log("[db.test] DATABASE_URL not set — skipping DB integration tests");
  process.exit(0);
}

import "dotenv/config";
import {
  getCachedPrice,
  insertTransferWithAlert,
  markAlertSent,
  pendingAlerts,
  pool,
  upsertLabels,
  upsertPrice,
} from "../src/db.js";

const runTx = `0xtest-tx-${Date.now()}-a`;
const runTx2 = `0xtest-tx-${Date.now()}-b`;
const marker = `test-${Date.now()}`;

async function cleanup() {
  await pool.query(
    `DELETE FROM alerts WHERE transfer_id IN (
       SELECT id FROM transfers WHERE tx_hash LIKE '0xtest-tx-%'
     )`,
  );
  await pool.query(`DELETE FROM transfers WHERE tx_hash LIKE '0xtest-tx-%'`);
  await pool.query(`DELETE FROM label_assignments WHERE source = $1`, [marker]);
  await pool.query(
    `DELETE FROM accounts WHERE chain = 'ethereum' AND address LIKE '0xtest%'`,
  );
  await pool.query(`DELETE FROM price_cache WHERE asset = 'TESTASSET'`);
}

const transfer = (txHash: string) => ({
  chain: "ethereum" as const,
  asset: "ETH",
  txHash,
  from: "0x0000000000000000000000000000000000000001",
  to: "0x0000000000000000000000000000000000000002",
  amount: 1500,
  occurredAt: new Date(),
});

describe("db integration", () => {
  before(async () => {
    await pool.query("SELECT 1");
    await cleanup();
  });
  after(async () => {
    await cleanup();
    await pool.end();
  });

  describe("transfer + alert transaction (outbox)", () => {
    it("inserts both rows and returns the transfer id", async () => {
      const id = await insertTransferWithAlert(
        transfer(runTx),
        3_700_000.0,
        "wallet_to_wallet",
        "test 🐋 message",
      );
      assert.ok(id !== null);
    });

    it("alert is born pending (003 applied: sent_at has no default)", async () => {
      const pending = await pendingAlerts(100);
      const ours = pending.find((p) => p.message === "test 🐋 message");
      assert.ok(ours, "fresh alert should appear in pendingAlerts");
      assert.ok(Number.isFinite(ours.transferId), "transferId must be a number (alias bug regression)");
    });

    it("duplicate delivery is a no-op returning null", async () => {
      const dup = await insertTransferWithAlert(
        transfer(runTx),
        3_700_000.0,
        "wallet_to_wallet",
        "test 🐋 message",
      );
      assert.equal(dup, null);
    });

    it("markAlertSent clears the queue for that alert", async () => {
      const pendingBefore = await pendingAlerts(100);
      const ours = pendingBefore.find((p) => p.message === "test 🐋 message");
      assert.ok(ours);
      await markAlertSent(ours.transferId);
      const pendingAfter = await pendingAlerts(100);
      assert.ok(!pendingAfter.some((p) => p.message === "test 🐋 message"));
    });
  });

  describe("bulk label upserts", () => {
    it("upserts a batch and resolves account ids", async () => {
      const items = [
        {
          chain: "ethereum" as const,
          address: "0xTestAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          category: "exchange_hot" as const,
          label: "Test Venue 1",
          source: marker,
          confidence: "heuristic" as const,
        },
        {
          chain: "ethereum" as const,
          address: "0xTestBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          category: "exchange_deposit" as const,
          label: "Test Venue Deposit",
          source: marker,
          confidence: "community" as const,
        },
      ];
      const n = await upsertLabels(items);
      assert.equal(n, 2);

      const rows = await pool.query<{ address: string; category: string }>(
        `SELECT a.address, la.category
         FROM accounts a
         JOIN label_assignments la ON la.account_id = a.id
         WHERE la.source = $1`,
        [marker],
      );
      assert.equal(rows.rows.length, 2);
    });

    it("re-running with updated fields updates last_seen/confidence", async () => {
      const items = [
        {
          chain: "ethereum" as const,
          address: "0xTestAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          category: "exchange_hot" as const,
          label: "Test Venue 1",
          source: marker,
          confidence: "verified" as const,
        },
      ];
      await upsertLabels(items);
      const rows = await pool.query<{ confidence: string }>(
        `SELECT la.confidence
         FROM accounts a
         JOIN label_assignments la ON la.account_id = a.id
         WHERE la.source = $1 AND a.address = '0xtestaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'`,
        [marker],
      );
      assert.equal(rows.rows[0]?.confidence, "verified");
    });
  });

  describe("price cache", () => {
    it("round-trips a price upsert", async () => {
      await upsertPrice("TESTASSET", 123.456);
      const got = await getCachedPrice("TESTASSET");
      assert.ok(got);
      assert.equal(got.usdPrice, 123.456);
    });
  });
});
