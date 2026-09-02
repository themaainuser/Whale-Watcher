import { upsertLabels } from "../db.js";
import type { LabelUpsert } from "../types.js";

const TOML_URL = "https://ripple.com/.well-known/xrp-ledger.toml";
const BATCH_SIZE = 500;

interface TomlAccount {
  address?: string;
  name?: string;
  desc?: string;
}

/**
 * Minimal TOML reader for the [[ACCOUNTS]] sections of xrp-ledger.toml.
 * Handles: single/double-quoted values with escapes, inline comments,
 * literal strings ('...'), and multiline arrays. Good enough for the
 * well-known file's flat key = "value" shape.
 */
function parseAccounts(text: string): TomlAccount[] {
  const accounts: TomlAccount[] = [];
  let current: TomlAccount | null = null;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const doubleHeader = /^\[\[(.+)\]\]$/.exec(trimmed);
    if (doubleHeader) {
      current = doubleHeader[1].trim().toLowerCase() === "accounts" ? {} : null;
      if (current) accounts.push(current);
      continue;
    }
    const singleHeader = /^\[(.+)\]$/.exec(trimmed);
    if (singleHeader) {
      current = null;
      continue;
    }
    if (!current) continue;

    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(trimmed);
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    let rawValue = pair[2].trim();

    // Multiline array continuation: gather lines until brackets balance.
    let quote: string | null = null;
    const countQuotes = (s: string): number => {
      let n = 0;
      for (let c = 0; c < s.length; c++) {
        const ch = s[c];
        if (ch === "\\") { c++; continue; } // escaped char inside string
        if ((ch === '"' || ch === "'") && (quote === null || quote === ch)) {
          quote = quote === null ? ch : null;
          n++;
        }
      }
      return n;
    };
    let pending = rawValue;
    while (countQuotes(pending) % 2 === 1 && i + 1 < lines.length) {
      pending += "\n" + lines[++i];
    }

    // Strip inline comment outside of quotes.
    let inString: string | null = null;
    let commentStart = -1;
    for (let c = 0; c < pending.length; c++) {
      const ch = pending[c];
      if (inString !== null) {
        if (ch === "\\") c++; // skip escaped char
        else if (ch === inString) inString = null;
      } else if (ch === '"' || ch === "'") {
        inString = ch;
      } else if (ch === "#") {
        commentStart = c;
        break;
      }
    }
    if (commentStart >= 0) pending = pending.slice(0, commentStart).trim();

    const value = parseTomlValue(pending);
    if (value === undefined) continue;
    if (key === "address" && typeof value === "string") current.address = value;
    else if (key === "name" && typeof value === "string") current.name = value;
    else if (key === "desc" && typeof value === "string") current.desc = value;
  }
  return accounts.filter((account) => account.address !== undefined);
}

function parseTomlValue(raw: string): string | undefined {
  const s = raw.trim();
  if (s.length === 0) return undefined;
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    const inner = s.slice(1, -1);
    if (s.startsWith('"')) {
      return inner.replace(/\\(["\\nt])/g, (_, esc: string) =>
        esc === "n" ? "\n" : esc === "t" ? "\t" : esc,
      );
    }
    return inner; // literal string — no escape processing
  }
  // Unquoted scalar (number/bool/date) — keep as text only when harmless.
  if (/^[^"#'\s]+$/.test(s)) return s;
  return undefined;
}

export async function importRippleToml(): Promise<number> {
  const response = await fetch(TOML_URL);
  if (!response.ok) throw new Error(`ripple-toml: HTTP ${response.status}`);
  const text = await response.text();
  const items: LabelUpsert[] = [];
  for (const account of parseAccounts(text)) {
    if (!account.address) continue;
    const name = account.name?.trim() ? account.name.trim() : "Ripple";
    items.push({
      chain: "xrpl",
      address: account.address.trim(),
      category: "protocol_infra",
      label: name,
      source: "ripple-toml",
      confidence: "verified",
    });
  }
  let imported = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      await upsertLabels(batch);
      imported += batch.length;
      console.log(
        `ripple-toml: imported ${batch.length} rows (${imported}/${items.length})`,
      );
    } catch (error) {
      console.error(`ripple-toml: batch at offset ${i} failed (${batch.length} rows SKIPPED):`, error);
    }
  }
  return imported;
}
