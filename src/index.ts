import "dotenv/config";
import type { NormalizedTransfer } from "./types.js";
import { markAlertSent, pendingAlerts, pool } from "./db.js";
import { processTransfer } from "./enrich.js";
import { sendTelegramMessage } from "./telegram.js";
import { startBtcListener } from "./listeners/btc.js";
import { startEthWebhook } from "./listeners/eth.js";
import { startXrplListener } from "./listeners/xrpl.js";

type TransferHandler = (t: NormalizedTransfer) => Promise<void>;

const SHUTDOWN_GRACE_MS = 15_000;

function makeHandler(inFlight: Set<Promise<void>>): TransferHandler {
  return async (t: NormalizedTransfer): Promise<void> => {
    const task = (async () => {
      try {
        const alert = await processTransfer(t);
        if (alert) {
          // Optimistic immediate send; the outbox drain covers failures.
          const ok = await sendTelegramMessage(alert.message);
          if (ok) await markAlertSent(alert.transferId);
        }
      } catch (err) {
        console.error("failed to process transfer", t.txHash, err);
      }
    })();
    inFlight.add(task);
    try {
      await task;
    } finally {
      inFlight.delete(task);
    }
  };
}

/**
 * Drain the alert outbox: anything recorded but never confirmed sent gets
 * retried on startup and periodically. Covers Telegram outages that outlive
 * a single handler. Rows whose send keeps failing stay pending for the next
 * tick — at-least-once delivery, duplicates are acceptable for alerts.
 */
export async function drainOutbox(): Promise<void> {
  let pending: Array<{ transferId: number; message: string }>;
  try {
    pending = await pendingAlerts(100);
  } catch (err) {
    console.error("outbox drain failed to list", err);
    return;
  }
  for (const p of pending) {
    try {
      const ok = await sendTelegramMessage(p.message);
      if (ok) await markAlertSent(p.transferId);
    } catch (err) {
      console.error(`outbox drain failed for transfer ${p.transferId}`, err);
      break; // Telegram likely down; wait for the next tick
    }
  }
}

async function smoke(): Promise<void> {
  const fake: NormalizedTransfer = {
    chain: "ethereum",
    asset: "ETH",
    txHash: `0xsmoke${Date.now()}`,
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: 1500,
    occurredAt: new Date(),
  };
  try {
    // dryRun: full gate/enrich/render exercise, zero DB writes — smoke must
    // never plant a phantom transfer in whatever DATABASE_URL points at.
    const alert = await processTransfer(fake, { dryRun: true });
    console.log(alert ? alert.message : "no alert (below threshold/duplicate)");
  } catch (err) {
    console.error("smoke run failed", err);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  await pool.query("SELECT 1");
  const inFlight = new Set<Promise<void>>();
  const handler = makeHandler(inFlight);
  startXrplListener(handler);
  startBtcListener(handler);
  startEthWebhook(handler);
  void drainOutbox(); // flush anything pending from a previous run
  console.log("whale-watcher running");

  const outboxTimer = setInterval(() => void drainOutbox(), 60_000);

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(outboxTimer);
    // XRPL stream events cannot be replayed, so give in-flight handlers a
    // grace period to finish while the pool is still alive; the pool ends
    // only after they settle (or the grace expires).
    const grace = new Promise<void>((resolve) => {
      const started = Date.now();
      const check = (): void => {
        if (inFlight.size === 0 || Date.now() - started > SHUTDOWN_GRACE_MS) resolve();
        else setTimeout(check, 200);
      };
      check();
    });
    void grace
      .then(() => pool.end())
      .catch((err) => console.error("pool shutdown error", err))
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[2] === "smoke") {
  void smoke();
} else {
  void main();
}
