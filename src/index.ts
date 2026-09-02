import "dotenv/config";
import type { NormalizedTransfer } from "./types.js";
import { markAlertSent, pendingAlerts, pool } from "./db.js";
import { processTransfer } from "./enrich.js";
import { sendTelegramMessage } from "./telegram.js";
import { ETHERSCAN_API_KEY } from "./etherscan.js";
import { startBtcListener } from "./listeners/btc.js";
import { startEthWebhook } from "./listeners/eth.js";
import { startXrplListener } from "./listeners/xrpl.js";

type TransferHandler = (t: NormalizedTransfer) => Promise<void>;

const SHUTDOWN_GRACE_MS = 15_000;

/** Fail fast with an actionable message instead of a raw pg connection error. */
async function ensureDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set — copy .env.example to .env and point it at your Postgres.",
    );
    process.exit(1);
  }
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    console.error("Could not reach the database at the DATABASE_URL in .env.", error);
    process.exit(1);
  }
}

/**
 * One-glance answer to "is it actually configured?": the setup checklist is
 * spread across .env variables, so a startup summary surfaces dry-run mode,
 * the disabled ETH webhook, and missing optional keys before alerts flow.
 */
function logStartupStatus(): void {
  const telegramLive =
    Boolean(process.env.TELEGRAM_BOT_TOKEN) && Boolean(process.env.TELEGRAM_CHAT_ID);
  console.log(
    "[status] telegram:",
    telegramLive
      ? "live"
      : "dry-run — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to send real alerts",
  );
  console.log(
    "[status] ethereum webhook:",
    process.env.ALCHEMY_SIGNING_KEY
      ? `listening on :${process.env.PORT ?? 8080}`
      : "disabled — ALCHEMY_SIGNING_KEY not set (see Alchemy dashboard, Signature section)",
  );
  console.log(
    "[status] etherscan block times:",
    ETHERSCAN_API_KEY
      ? "enabled"
      : "disabled — set ETHERSCAN_API_KEY for accurate ETH timestamps",
  );
  console.log("[status] bitcoin: polling, xrpl: streaming");
}

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
  await ensureDatabase();
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
  await ensureDatabase();
  const inFlight = new Set<Promise<void>>();
  const handler = makeHandler(inFlight);
  startXrplListener(handler);
  startBtcListener(handler);
  startEthWebhook(handler);
  void drainOutbox(); // flush anything pending from a previous run
  logStartupStatus();
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
