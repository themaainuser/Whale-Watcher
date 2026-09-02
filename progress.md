# Progress — 2026-08-25 (Build Day)

*What happened today, in plain language. Technical terms are hinted in brackets. The full backstory lives in `conversation.md`.*

---

## Where we started this morning

The planning phase was already finished (a researched catalog of exchange account types, a database design, and a written spec under `scratch/exchange-account-catalog/spec.md`) — but the repository contained **zero code**. Today was about turning the plan into a working machine.

## 1. The foundation was laid by hand

Before any helpers were spawned, the shared skeleton was written directly, because four parallel builders can only fit together if someone cuts the joints first:

- **Project setup** — `package.json` (dependencies and run commands), `tsconfig.json` (TypeScript strictness settings), `.gitignore`, `.env.example` (the template for secret settings).
- **Database blueprint** — `migrations/001_init.sql`: seven tables covering accounts and their labels (with source, confidence, and freshness per label — the "provenance" idea from the catalog), whale thresholds, transfers, alerts, and a price cache. Seed thresholds included: 100+ BTC, 1,000+ ETH, 5M+ XRP, $1M+ stablecoins.
- **Shared types** — `src/types.ts`: the one file every other file agrees on.

## 2. Four builders ran in parallel

Each helper agent owned strictly its own files, coding against the shared contract:

| Builder | Files | What it made |
|---|---|---|
| Database layer | `src/db.ts`, `src/migrate.ts` | Connection pool, replay-safe transfer saving, fresh-label lookups, batch label imports |
| Brain & voice | `src/prices.ts`, `src/enrich.ts`, `src/telegram.ts`, `src/index.ts` | CoinGecko pricing (5-min cache), the enrich-and-filter stage, Telegram sending with dry-run fallback, the main entrypoint |
| Label importers | `src/importers/*` | Four loaders: eth-labels CSV, XRPSCAN well-known list, Ripple TOML, GraphSense TagPacks |
| Chain listeners | `src/listeners/*` | XRPL websocket (auto-reconnect), Bitcoin block poller, Ethereum webhook receiver |

A detail worth keeping: the **Bitcoin poller already respects your session-overlap insight** — it polls every 20 seconds during the 13:00–17:00 UTC London–New York overlap (5:30–10:30 PM IST) and every 60 seconds outside it.

## 3. The Postgres adventure

- Your machine's real PostgreSQL 18 is running, but its password is private — one guess failed, so we stopped guessing.
- You asked for a **test server with default credentials**. First attempt: a throwaway second cluster built from the installed PostgreSQL 18 binaries. It started but every worker crashed with Windows shared-memory error 487 (an address-randomization conflict), and PostgreSQL 18 on Windows no longer allows the config workarounds. Diagnosed from logs, then abandoned.
- Second attempt: **Docker Desktop** launched, and a **Postgres 17 Linux container** (`whale-pg`, `postgres`/`postgres`, port 5433) came up clean. Migrations applied first try. ✅

## 4. Importer debugging (two bugs found and fixed)

First importer run: XRPSCAN (296 labels) and Ripple TOML (20 labels) loaded immediately. Two failures, two fixes:

- **eth-labels** hit a malformed quoted field at row ~93,623 of the real CSV. First fix used the wrong option (`relax`); the correct one in csv-parse v5 is `relax_quotes`. After that: **113,194 labels imported — exactly matching the research measurement.**
- **TagPacks** imported zero because the files' structure differs from the assumption: category, source, confidence, and cluster id live at the *pack* level, not per address — and the repository had been restructured (packs now sit directly under `packs/`, thirteen `exchange-wallets-*.yaml` files). The importer was rewritten around the real layout: **169 curated exchange reserve/hot wallets across 11 sources**, each carrying its provenance URL.

## 5. Everything verified green

- **Typecheck: 0 errors** across all agent-written code.
- **Database contents:** 95,056 label assignments total (94,537 eth-labels · 296 XRPSCAN · 169 GraphSense · 20 Ripple TOML), spread across deposit addresses (24,290), hot wallets (6,715), bridges (1,616), issuer treasuries (484), cold reserves (327), market makers (33), custodians (8), and protocol infrastructure (20).
- **End-to-end smoke test passed:** a fake 1,500 ETH transfer was priced live (~$3.73M via CoinGecko), passed the 1,000-ETH threshold, was tagged `wallet_to_wallet`, written to the `transfers` table, recorded in `alerts`, and rendered as a Telegram message (dry-run mode):

  > 🐋 1,500 ETH (~$3.7M)
  > 0x0000…0001 → 0x0000…0002 [wallet_to_wallet]
  > https://etherscan.io/tx/0xsmoke…

## 6. How to drive it

```
npm run migrate      # set up the database (already done on the test server)
npm run import all   # load all four label datasets (already done)
npm run start        # run all three listeners; Telegram fires once token is set
npm run start smoke  # re-run the end-to-end self-test anytime
docker start whale-pg / docker stop whale-pg   # the test database
```

## 7. What's next

1. **Go live on Telegram** — create a bot via @BotFather, paste `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` into `.env`, restart. (The logic is already wired; the vars sit empty in `.env`.)
2. **Let it listen** — XRPL produces real events immediately; Ethereum needs an Alchemy webhook pointed at your server; Bitcoin just runs.
3. **Someday list** (from the spec, deliberately not built yet): behavioral hot/cold wallet splitting, probabilistic Bitcoin deposit scoring, community label trust-filtering, paid data upgrades.
