import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import { upsertLabels } from "../db.js";
import type { Category, Chain, Confidence, LabelUpsert } from "../types.js";

const LISTING_URL =
  "https://api.github.com/repos/graphsense/graphsense-tagpacks/contents/packs";
const MAX_REMOTE_FILES = 20;
const BATCH_SIZE = 500;

interface PackTag {
  address?: unknown;
  currency?: unknown;
  label?: unknown;
}

interface PackDoc {
  title?: unknown;
  actor?: unknown;
  category?: unknown;
  source?: unknown;
  confidence?: unknown;
  tags?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function mapPackConfidence(value: unknown): Confidence {
  const v = (asString(value) ?? "").toLowerCase();
  if (v === "service_data") return "verified";
  if (v === "public_source" || v === "data_source") return "heuristic";
  return "community";
}

function chainFromCurrency(value: unknown): Chain | undefined {
  const v = (asString(value) ?? "").toUpperCase();
  if (v === "BTC") return "bitcoin";
  if (v === "ETH") return "ethereum";
  if (v === "XRP") return "xrpl";
  return undefined;
}

function categoryFromPack(title: string): Category {
  return /reserve|cold/i.test(title) ? "exchange_cold_reserve" : "exchange_hot";
}

function labelsFromYaml(text: string): LabelUpsert[] {
  const out: LabelUpsert[] = [];
  for (const doc of parseAllDocuments(text).map((d) => d.toJSON())) {
    if (doc === null || typeof doc !== "object") continue;
    const pack = doc as PackDoc;
    const categoryRaw = (asString(pack.category) ?? "").toLowerCase();
    if (!categoryRaw.includes("exchange")) continue;
    if (!Array.isArray(pack.tags)) continue;
    const title = asString(pack.title) ?? "exchange";
    const source = `graphsense:${asString(pack.source) ?? "tagpacks"}`;
    const confidence = mapPackConfidence(pack.confidence);
    const category = categoryFromPack(title);
    const clusterId = asString(pack.actor) ?? title;
    for (const tag of pack.tags as PackTag[]) {
      const address = asString(tag.address);
      if (!address) continue;
      const chain = chainFromCurrency(tag.currency);
      if (!chain) continue;
      const item: LabelUpsert = {
        chain,
        address,
        category,
        label: asString(tag.label) ?? title,
        source,
        confidence,
        clusterId,
      };
      out.push(item);
    }
  }
  return out;
}

async function loadPackTexts(): Promise<string[]> {
  const dir = process.env.TAGPACKS_DIR;
  if (dir) {
    return readdirSync(dir)
      .filter((file) => /\.ya?ml$/i.test(file))
      .map((file) => readFileSync(join(dir, file), "utf8"));
  }
  const listResponse = await fetch(LISTING_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!listResponse.ok) {
    throw new Error(`tagpacks: listing HTTP ${listResponse.status}`);
  }
  const listing = (await listResponse.json()) as Array<{
    name?: string;
    download_url?: string;
  }>;
  const urls = listing
    .filter(
      (entry) =>
        typeof entry.download_url === "string" &&
        /^exchange-wallets-.*\.yaml$/i.test(entry.name ?? ""),
    )
    .map((entry) => entry.download_url as string);
  if (urls.length > MAX_REMOTE_FILES) {
    console.warn(
      `tagpacks: ${urls.length} pack files found, importing first ${MAX_REMOTE_FILES} ` +
        `(raise MAX_REMOTE_FILES to import the rest)`,
    );
  }
  const selected = urls.slice(0, MAX_REMOTE_FILES);
  const texts: string[] = [];
  for (const url of selected) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`tagpacks: fetch failed for ${url}: HTTP ${response.status}`);
        continue;
      }
      texts.push(await response.text());
    } catch (error) {
      console.error(`tagpacks: fetch failed for ${url}:`, error);
    }
  }
  return texts;
}

export async function importTagpacks(): Promise<number> {
  const texts = await loadPackTexts();
  const items: LabelUpsert[] = [];
  for (const text of texts) items.push(...labelsFromYaml(text));
  let imported = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      await upsertLabels(batch);
      imported += batch.length;
      console.log(
        `tagpacks: imported ${batch.length} rows (${imported}/${items.length})`,
      );
    } catch (error) {
      console.error("tagpacks: batch failed:", error);
    }
  }
  return imported;
}
