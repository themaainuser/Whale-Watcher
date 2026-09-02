import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { upsertLabels } from "../db.js";
import type { Category, LabelUpsert } from "../types.js";

const DEFAULT_CSV_URL =
  "https://raw.githubusercontent.com/dawsbot/eth-labels/v1/data/csv/accounts.csv";
const BATCH_SIZE = 500;

const VENUE_WORDS = [
  "binance",
  "coinbase",
  "kraken",
  "bitfinex",
  "bitstamp",
  "gemini",
  "kucoin",
  "huobi",
  "htx",
  "okex",
  "okx",
  "okcoin",
  "bybit",
  // "gate" alone false-positives on "gateway"/"gateio"-adjacent projects; the
  // venue is always branded with io: gate.io / Gate.io.
  "gate.io",
  "gateio",
  "crypto.com",
  "poloniex",
  "upbit",
  "bithumb",
  "bitmex",
  "deribit",
  "bitget",
  "mexc",
  "whitebit",
  "lbank",
];

interface EthLabelRow {
  address?: string;
  chainId?: string;
  label?: string;
  nameTag?: string;
}

function inferCategory(text: string): Category {
  const t = text.toLowerCase();
  // Word-boundary match: "dep" as a bare token only (avoids matching
  // "deployment", "dependable", etc. that the old /dep\b/… mix allowed).
  if (/\bdeposit/.test(t)) return "exchange_deposit";
  if (/\bhot\b/.test(t)) return "exchange_hot";
  if (/\bcold\b|\breserves?\b/.test(t)) return "exchange_cold_reserve";
  if (t.includes("tether treasury") || /\bmultisig\b/.test(t)) return "issuer_treasury";
  if (/\bbridge\b|\bcctp\b/.test(t)) return "bridge";
  if (/\bwintermute\b|\bgalaxy digital\b|\bjump trading\b|\bdwf\b/.test(t)) {
    return "market_maker";
  }
  if (/\bbitgo\b|\bfireblocks\b|\bcustod/i.test(t)) return "custodian";
  const trimmed = text.trim();
  const numberedOps = /^(\D+?)\s*\d*$/.exec(trimmed);
  if (numberedOps) {
    const base = numberedOps[1].trim().toLowerCase();
    if (VENUE_WORDS.some((word) => base.startsWith(word))) return "exchange_hot";
  }
  return "unknown";
}

function venueName(raw: string): string {
  // Strip a trailing deposit suffix only when it starts at a word boundary,
  // e.g. "Kraken Deposit 12" -> "Kraken"; never mid-word.
  let v = raw.replace(/\s+\bdep(osit)?\w*.*$/i, "");
  v = v.replace(/[\s._\-]*\d+[\s._\-]*$/, "").trim();
  return v.length > 0 ? v : raw.trim();
}

async function flush(batch: LabelUpsert[], batchNo: number): Promise<number> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await upsertLabels(batch);
      console.log(`eth-labels: imported ${batch.length} rows (batch ${batchNo})`);
      return batch.length;
    } catch (error) {
      if (attempt === maxAttempts) {
        console.error(
          `eth-labels: batch ${batchNo} failed after ${maxAttempts} attempts, ` +
            `${batch.length} rows SKIPPED:`,
          error,
        );
        return 0;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  return 0; // unreachable
}

export async function importEthLabels(): Promise<number> {
  const source = process.env.ETH_LABELS_CSV;
  const text = source
    ? /^https?:\/\//i.test(source)
      ? await (await fetch(source)).text()
      : readFileSync(source, "utf8")
    : await (await fetch(DEFAULT_CSV_URL)).text();
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as EthLabelRow[];
  let imported = 0;
  let batchNo = 0;
  let batch: LabelUpsert[] = [];
  for (const record of records) {
    const address = record.address?.trim().toLowerCase();
    const labelText = (record.label ?? "").trim();
    const nameTagText = (record.nameTag ?? "").trim();
    if (!address || (!labelText && !nameTagText)) continue;
    if ((record.chainId ?? "").trim() !== "1") continue;
    batch.push({
      chain: "ethereum",
      address,
      category: inferCategory(`${labelText} ${nameTagText}`.trim()),
      label: venueName(nameTagText || labelText),
      source: "eth-labels",
      confidence: "community",
    });
    if (batch.length >= BATCH_SIZE) {
      batchNo += 1;
      imported += await flush(batch, batchNo);
      batch = [];
    }
  }
  if (batch.length > 0) {
    batchNo += 1;
    imported += await flush(batch, batchNo);
  }
  return imported;
}
