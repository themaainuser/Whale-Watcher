import { Client } from "xrpl";
import type { NormalizedTransfer } from "../types.js";

const XRPL_WS_URL = "wss://xrplcluster.com";
const SUBSCRIPTION_ID = "whale-watcher-sub";
const RIPPLE_EPOCH_OFFSET_MS = 946684800000;
const RETRY_DELAY_MS = 5000;
/** Cap the processing queue so a burst doesn't grow without bound. */
const MAX_QUEUE_DEPTH = 5_000;

interface IssuedAmount {
  currency?: unknown;
  issuer?: unknown;
  value?: unknown;
}

interface StreamPaymentTx {
  Account?: unknown;
  Destination?: unknown;
  DestinationTag?: unknown;
  Amount?: unknown;
  DeliverMax?: unknown;
  TransactionType?: unknown;
  Transaction?: unknown;
  hash?: unknown;
  ledger_index?: unknown;
  date?: unknown;
  /** Present on v1-style nested transaction objects. */
  meta?: { DeliveredAmount?: unknown; delivered_amount?: unknown };
}

/**
 * Shape of a transactions-stream message under rippled API v2 (which xrpl.js
 * 4.6.0 injects by default): the transaction lives in `tx_json`, while hash,
 * meta, and engine_result are TOP-LEVEL message fields — not inside the
 * transaction. Verified live against wss://xrplcluster.com on 2026-08-31.
 */
interface StreamMessage {
  type?: unknown;
  tx_json?: StreamPaymentTx;
  /** Legacy v1 location — accepted for forward-compat if api_version changes. */
  transaction?: StreamPaymentTx & { meta?: { DeliveredAmount?: unknown; delivered_amount?: unknown } };
  hash?: unknown;
  ledger_index?: unknown;
  engine_result?: unknown;
  meta?: { TransactionResult?: unknown; DeliveredAmount?: unknown; delivered_amount?: unknown };
}

export function startXrplListener(onTransfer: (t: NormalizedTransfer) => Promise<void>): void {
  void connectLoop(onTransfer);
}

async function connectLoop(onTransfer: (t: NormalizedTransfer) => Promise<void>): Promise<void> {
  const client = new Client(XRPL_WS_URL);
  let retryScheduled = false;

  const scheduleRetry = (reason: unknown): void => {
    if (retryScheduled) return;
    retryScheduled = true;
    console.error("[xrpl] connection problem, reconnecting in 5s:", reason);
    // Deferred teardown: during the synchronous emit of 'disconnected',
    // xrpl.js's Connection has already nulled `ws` but has NOT yet run
    // intentionalDisconnect() — calling disconnect() right now is a no-op and
    // the library schedules its own internal reconnect ~100ms later, leaking
    // an immortal, unsubscribed zombie socket. Deferring lets this call land
    // after intentionalDisconnect() has set reconnectTimeoutID, which
    // disconnect() then clears.
    setTimeout(() => {
      void client.disconnect().catch(() => {});
    }, 0);
    setTimeout(() => {
      void connectLoop(onTransfer);
    }, RETRY_DELAY_MS);
  };

  client.on("error", scheduleRetry);
  client.on("disconnected", scheduleRetry);

  // Serial queue: handlers run one at a time in arrival order, so a burst of
  // stream events cannot stack unbounded concurrent DB/price work.
  const queue: Array<() => Promise<void>> = [];
  let draining = false;
  const enqueue = (task: () => Promise<void>): void => {
    if (queue.length >= MAX_QUEUE_DEPTH) {
      console.error("[xrpl] queue overflow, dropping oldest event");
      queue.shift();
    }
    queue.push(task);
    if (!draining) void drain();
  };
  const drain = async (): Promise<void> => {
    draining = true;
    try {
      while (queue.length > 0) {
        const task = queue.shift();
        if (task === undefined) break;
        try {
          await task();
        } catch (error) {
          console.error("[xrpl] handler failed:", error);
        }
      }
    } finally {
      draining = false;
    }
  };

  try {
    await client.connect();
    await client.request({
      id: SUBSCRIPTION_ID,
      command: "subscribe",
      streams: ["transactions"],
    });
    client.on("transaction", (event: unknown) => {
      handleStreamEvent(event, onTransfer, enqueue);
    });
    console.log("[xrpl] listening");
  } catch (error) {
    scheduleRetry(error);
  }
}

function handleStreamEvent(
  event: unknown,
  onTransfer: (t: NormalizedTransfer) => Promise<void>,
  enqueue: (task: () => Promise<void>) => void
): void {
  let transfer: NormalizedTransfer | null = null;
  try {
    const message = event as StreamMessage;
    if (message?.type !== "transaction") return;

    // API v2 puts the transaction in tx_json; fall back to v1's transaction.
    const tx = message.tx_json ?? message.transaction;
    if (!tx) return;

    const txTypeName = tx.TransactionType ?? tx.Transaction;
    if (txTypeName !== "Payment") return;

    // Failed payments (tec*) are applied to the ledger but moved nothing —
    // never alert on them.
    const engineResult =
      typeof message.engine_result === "string"
        ? message.engine_result
        : typeof message.meta?.TransactionResult === "string"
          ? message.meta.TransactionResult
          : null;
    if (engineResult !== null && !engineResult.startsWith("tes")) return;

    // Partial payments report DeliveredAmount in meta (top-level under v2);
    // Amount is only the minimum authorized. Prefer delivered when present.
    const rawAmount = firstDefined(
      message.meta?.DeliveredAmount,
      message.meta?.delivered_amount,
      tx.meta?.DeliveredAmount,
      tx.meta?.delivered_amount,
      tx.Amount,
      tx.DeliverMax,
    );
    let asset: string;
    let amount: number;
    if (typeof rawAmount === "string") {
      // XRP amounts are integer drop strings; BigInt-parse then scale to 8dp
      // so amounts beyond 2^53 drops stay exact to the type's precision.
      if (!/^\d+$/.test(rawAmount)) return;
      asset = "XRP";
      amount = Number((BigInt(rawAmount) * 100_000_000n) / 1_000_000n) / 1e8;
    } else if (
      typeof rawAmount === "object" &&
      rawAmount !== null &&
      typeof (rawAmount as IssuedAmount).currency === "string" &&
      typeof (rawAmount as IssuedAmount).value === "string"
    ) {
      const issued = rawAmount as IssuedAmount;
      asset = decodeCurrencyCode(issued.currency as string) ?? (issued.currency as string);
      amount = Number(issued.value);
    } else {
      return;
    }
    if (!Number.isFinite(amount)) return;

    // The tx hash is a top-level message field under v2 (tx_json.hash is
    // absent on stream messages).
    const txHash = typeof message.hash === "string"
      ? message.hash
      : typeof tx.hash === "string"
        ? tx.hash
        : undefined;
    if (!txHash || typeof tx.Account !== "string") return;

    const occurredAt =
      typeof tx.date === "number"
        ? new Date(tx.date * 1000 + RIPPLE_EPOCH_OFFSET_MS)
        : new Date();
    const blockHeight =
      typeof tx.ledger_index === "number"
        ? tx.ledger_index
        : typeof message.ledger_index === "number"
          ? message.ledger_index
          : undefined;
    const destinationTag =
      typeof tx.DestinationTag === "number"
        ? tx.DestinationTag
        : undefined;

    transfer = {
      chain: "xrpl",
      asset,
      txHash,
      blockHeight,
      from: tx.Account,
      to: typeof tx.Destination === "string" ? tx.Destination : undefined,
      destinationTag,
      amount,
      occurredAt,
    };
  } catch (error) {
    console.error("[xrpl] failed to process stream event:", error);
    return;
  }

  enqueue(() => onTransfer(transfer!));
}

/**
 * Decode XRPL currency codes. 3-char ASCII stays as-is. 40-char hex comes in
 * TWO real-world conventions and both must decode:
 *  - the STANDARD layout per ripple-binary-codec
 *    (/^0{24}[\x00-\x7F]{6}0{10}$/): 12 zero bytes, a 3-char ISO code at
 *    bytes 12-14, 5 trailing zero bytes;
 *  - ASCII-first non-standard (dominant in practice for longer names:
 *    RLUSD, SOLO, CSC, XPM): printable-ASCII prefix, zero-padded to 20
 *    bytes.
 * Anything else (LP tokens 0x03…, demurrage 0x01…) falls back to a compact
 * hex: label.
 *
 * Note: ASCII-first "USD\0…" decodes to "USD", colliding with 3-char "USD"
 * from other issuers — acceptable for threshold matching, since operators
 * key thresholds on the readable symbol.
 */
export function decodeCurrencyCode(raw: string): string | undefined {
  if (/^[A-Za-z0-9?!@#$%^&*(){}\[\]|]{3}$/.test(raw)) return raw;
  if (/^[0-9a-fA-F]{40}$/.test(raw)) {
    // Standard layout first: 24 hex zeros, 3 ASCII bytes, 10 hex zeros.
    if (/^0{24}[\x20-\x7e]{6}0{10}$/.test(raw)) {
      const iso = Buffer.from(raw.slice(24, 30), "hex").toString("ascii");
      // Length-3 alone isn't enough: an all-zero code decodes to NUL bytes.
      if (iso.length === 3 && /^[\x20-\x7e]+$/.test(iso) && iso !== "XRP") {
        return iso;
      }
    }

    const buf = Buffer.from(raw, "hex");
    // ASCII-first non-standard: printable-ASCII prefix, zero-padded.
    let end = buf.indexOf(0);
    if (end === -1) end = 20;
    if (end > 0 && buf.subarray(end).every((b) => b === 0)) {
      const ascii = buf.subarray(0, end).toString("ascii");
      if (/^[\x20-\x7e]+$/.test(ascii)) return ascii;
    }

    return `hex:${raw.slice(0, 8)}…`;
  }
  return raw;
}

function firstDefined<T>(...values: Array<T | undefined | null>): T | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}
