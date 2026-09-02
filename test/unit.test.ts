/**
 * Unit tests for pure functions — no DB, no network.
 * Run: npm run test:unit  (or npm test for the full suite)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseBaseUnits, toNormalizedTransfer } from "../src/listeners/eth.js";
import { decodeCurrencyCode } from "../src/listeners/xrpl.js";
import { inferCategory, venueName } from "../src/importers/eth-labels.js";
import { parseAccounts } from "../src/importers/ripple-toml.js";

// ---------------------------------------------------------------------------
// parseBaseUnits — the wei/token parser (C1: unit correctness)
// ---------------------------------------------------------------------------
describe("parseBaseUnits", () => {
  const wei = (whole: bigint, frac: bigint = 0n) =>
    (whole * 10n ** 18n + frac).toString();

  it("converts 1 ETH in wei", () => {
    assert.equal(parseBaseUnits(wei(1n), 18), 1);
  });
  it("converts 0.5 ETH", () => {
    assert.equal(parseBaseUnits((5n * 10n ** 17n).toString(), 18), 0.5);
  });
  it("converts USDT/USDC 6-decimal amounts", () => {
    assert.equal(parseBaseUnits((1500n * 10n ** 6n).toString(), 6), 1500);
    assert.equal(parseBaseUnits((1n * 10n ** 6n).toString(), 6), 1);
  });
  it("handles 23-digit wei values beyond double precision", () => {
    // 100 ETH + 420666666666666666 wei = 100.42066666 after 8dp truncation
    assert.equal(parseBaseUnits(wei(100n, 420666666666666666n), 18), 100.42066666);
  });
  it("truncates sub-1e-8 dust", () => {
    assert.equal(parseBaseUnits(wei(100n, 42n), 18), 100);
  });
  it("keeps 4.2e-8 (one final digit)", () => {
    assert.equal(parseBaseUnits(wei(100n, 42066666666n), 18), 100.00000004);
  });
  it("rejects invalid input", () => {
    assert.equal(parseBaseUnits("abc", 18), null);
    assert.equal(parseBaseUnits("", 18), null);
    assert.equal(parseBaseUnits("12.5", 18), null); // decimals in base units
    assert.equal(parseBaseUnits(undefined, 18), null);
    assert.equal(parseBaseUnits("100", 0), null); // no-decimal assets unsupported
  });
});

// ---------------------------------------------------------------------------
// toNormalizedTransfer — Alchemy activity → NormalizedTransfer
// ---------------------------------------------------------------------------
describe("toNormalizedTransfer", () => {
  const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // canonical mainnet USDC
  const base = {
    hash: "0x" + "ab".repeat(32),
    fromAddress: "0xAAA1",
    toAddress: "0xBBB2",
    value: "1500", // native ETH: human units per Alchemy Address-Activity docs
    asset: "ETH",
    blockNum: "0x1234abc",
  };

  it("normalizes a native ETH activity (human-unit value)", () => {
    const t = toNormalizedTransfer(base);
    assert.ok(t);
    assert.equal(t.asset, "ETH");
    assert.equal(t.amount, 1500);
    assert.equal(t.chain, "ethereum");
    assert.equal(t.blockHeight, 0x1234abc);
    assert.equal(t.txHash, base.hash.toLowerCase());
  });
  it("accepts numeric value form", () => {
    const t = toNormalizedTransfer({ ...base, value: 2500.5 });
    assert.ok(t);
    assert.equal(t.amount, 2500.5);
  });
  it("accepts allowlisted ERC-20 via rawContract hex base units", () => {
    const rawValue = "0x" + (1500n * 10n ** 6n).toString(16); // 1500 USDC
    const t = toNormalizedTransfer({
      ...base,
      asset: "USDC",
      value: "1500",
      rawContract: { rawValue, address: USDC, decimals: 6 },
    });
    assert.ok(t);
    assert.equal(t.asset, "USDC");
    assert.equal(t.amount, 1500);
  });
  it("uses log.logIndex from a real Address Activity payload (regression 2026-09-02)", () => {
    // Exact field shape from a live Alchemy delivery: no logId, log.logIndex hex.
    const t = toNormalizedTransfer({
      ...base,
      asset: "USDC",
      value: 293.092129,
      category: "token",
      log: {
        logIndex: "0x6e",
        transactionHash: base.hash,
      },
      rawContract: {
        rawValue: "0x0000000000000000000000000000000000000000000000000000000011783b21",
        address: USDC,
        decimals: 6,
      },
    });
    assert.ok(t);
    assert.equal(t.asset, "USDC");
    assert.equal(t.amount, 293.092129);
    assert.equal(t.logIndex, 0x6e);
  });
  it("rejects ERC-20 activity from unknown contracts (spam-token defense)", () => {
    const t = toNormalizedTransfer({
      ...base,
      asset: "USDC",
      value: "999999",
      rawContract: {
        rawValue: "0x1",
        address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        decimals: 6,
      },
    });
    assert.equal(t, null);
  });
  it("derives logIndex from logId suffix (hex)", () => {
    const t = toNormalizedTransfer({ ...base, logId: `${base.hash}_2a` });
    assert.ok(t);
    assert.equal(t.logIndex, 42);
  });
  it("rejects NFT activities (erc721TokenId present)", () => {
    assert.equal(
      toNormalizedTransfer({ ...base, erc721TokenId: "0x1234" }),
      null,
    );
  });
  it("rejects activities missing hash or from", () => {
    assert.equal(toNormalizedTransfer({ ...base, hash: undefined }), null);
    assert.equal(toNormalizedTransfer({ ...base, fromAddress: undefined }), null);
  });
});

// ---------------------------------------------------------------------------
// decodeCurrencyCode — XRPL 3-char vs 40-hex codes
// ---------------------------------------------------------------------------
describe("decodeCurrencyCode", () => {
  it("passes through 3-char ASCII codes", () => {
    assert.equal(decodeCurrencyCode("USD"), "USD");
    assert.equal(decodeCurrencyCode("EUR"), "EUR");
  });
  it("decodes non-standard 40-hex codes with ASCII payload", () => {
    // Real non-standard convention: ASCII first, zero-padded to 20 bytes
    // (e.g. GateHub's SOLO = 534F4C4F followed by 16 zero bytes).
    const hex = Buffer.from("SOLO", "ascii").toString("hex").padEnd(40, "0");
    assert.equal(decodeCurrencyCode(hex), "SOLO");
  });
  it("compacts undecodable hex codes", () => {
    const out = decodeCurrencyCode("0".repeat(40));
    assert.match(out ?? "", /^hex:/);
  });
  it("passes through unexpected shapes untouched", () => {
    assert.equal(decodeCurrencyCode("RLUSD"), "RLUSD"); // 5-char falls through
  });
});

// ---------------------------------------------------------------------------
// inferCategory / venueName — label taxonomy (M9: false positives)
// ---------------------------------------------------------------------------
describe("inferCategory", () => {
  it("classifies deposits, hot, cold", () => {
    assert.equal(inferCategory("Binance Deposit 12"), "exchange_deposit");
    assert.equal(inferCategory("Binance Hot Wallet"), "exchange_hot");
    assert.equal(inferCategory("Bitfinex Cold Reserve"), "exchange_cold_reserve");
  });
  it("does not match mid-word 'dep' or 'gate' prefix (regression M9)", () => {
    assert.equal(inferCategory("Deployment Contract"), "unknown");
    assert.equal(inferCategory("GatewayDAO Token"), "unknown");
  });
  it("classifies venue-numbered wallets", () => {
    assert.equal(inferCategory("Kraken 12"), "exchange_hot");
    assert.equal(inferCategory("gate.io 3"), "exchange_hot");
  });
  it("classifies bridges, custodians, market makers, treasuries", () => {
    assert.equal(inferCategory("Polygon Bridge"), "bridge");
    assert.equal(inferCategory("BitGo Custody"), "custodian");
    assert.equal(inferCategory("Wintermute Trading"), "market_maker");
    assert.equal(inferCategory("Tether Treasury"), "issuer_treasury");
  });
});

describe("venueName", () => {
  it("strips deposit suffixes and trailing numbers", () => {
    assert.equal(venueName("Kraken Deposit 12"), "Kraken");
    assert.equal(venueName("Binance 7"), "Binance");
  });
  it("does not strip mid-word dep (regression M9)", () => {
    assert.equal(venueName("DeepStack Token"), "DeepStack Token");
  });
});

// ---------------------------------------------------------------------------
// parseAccounts — ripple TOML reader (hardened parser)
// ---------------------------------------------------------------------------
describe("parseAccounts", () => {
  it("reads [[ACCOUNTS]] sections with quoted values", () => {
    const toml = `
[[ACCOUNTS]]
address = "rN7n7otQDd6FczFgLdSgtcsn4EDu1BUysA"
name = "Ripple Operations"
desc = "Primary ops" # comment outside quotes is stripped
desc2 = "hash # inside quotes stays"
`;
    const accounts = parseAccounts(toml);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].address, "rN7n7otQDd6FczFgLdSgtcsn4EDu1BUysA");
    assert.equal(accounts[0].name, "Ripple Operations");
    // inline comment (outside quotes) stripped
    assert.equal(accounts[0].desc, "Primary ops");
  });
  it("ignores other sections and single headers", () => {
    const toml = `
[METADATA]
name = "not an account"

[[SERVERS]]
address = "wss://s1.ripple.com"

[[ACCOUNTS]]
address = "rWallet1"
`;
    const accounts = parseAccounts(toml);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].address, "rWallet1");
  });
  it("skips accounts without address", () => {
    const toml = `
[[ACCOUNTS]]
name = "no address here"
`;
    assert.equal(parseAccounts(toml).length, 0);
  });

  it("keeps '#' inside quoted strings (TOML semantics)", () => {
    const toml = `
[[ACCOUNTS]]
address = "rHash1"
desc = "hash # inside quotes stays"
`;
    const accounts = parseAccounts(toml);
    assert.equal(accounts[0].desc, "hash # inside quotes stays");
  });
});
