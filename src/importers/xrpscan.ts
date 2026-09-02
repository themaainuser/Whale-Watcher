import { upsertLabels } from "../db.js";
import type { Category, LabelUpsert } from "../types.js";

const WELL_KNOWN_URL = "https://api.xrpscan.com/api/v1/names/well-known";
const BATCH_SIZE = 500;

interface XrpscanEntry {
  name?: string;
  desc?: string;
  account?: string;
}

function inferCategory(entry: XrpscanEntry): Category | null {
  const text = `${entry.name ?? ""} ${entry.desc ?? ""}`.toLowerCase();
  if (text.includes("exchange")) return "exchange_hot";
  if (text.includes("issuer") || /rlusd|usdt|usdc/.test(text)) return "issuer_treasury";
  if (text.includes("bridge")) return "bridge";
  return null;
}

export async function importXrpscan(): Promise<number> {
  const response = await fetch(WELL_KNOWN_URL);
  if (!response.ok) throw new Error(`xrpscan: HTTP ${response.status}`);
  const entries = (await response.json()) as XrpscanEntry[];
  const items: LabelUpsert[] = [];
  for (const entry of entries) {
    const account = entry.account?.trim();
    const name = entry.name?.trim();
    if (!account || !name) continue;
    const category = inferCategory(entry);
    if (!category) continue;
    const label = (entry.desc?.trim() ? `${name} (${entry.desc.trim()})` : name).trim();
    items.push({
      chain: "xrpl",
      address: account,
      category,
      label,
      source: "xrpscan",
      confidence: "community",
    });
  }
  let imported = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      await upsertLabels(batch);
      imported += batch.length;
      console.log(`xrpscan: imported ${batch.length} rows (${imported}/${items.length})`);
    } catch (error) {
      console.error("xrpscan: batch failed:", error);
    }
  }
  return imported;
}
