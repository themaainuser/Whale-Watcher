# Whale-Watcher 🐋

Real-time whale-watch pipeline: ingests large on-chain transfers across **Bitcoin**, **Ethereum**, and the **XRP Ledger**, classifies them against a labeled address book (exchanges, bridges, custodians, market makers…), and pushes a formatted alert to Telegram.

```
🐋 1,500 ETH (~$3.7M)
0x0000…0001 → 0x0000…0002 [wallet_to_wallet]
https://etherscan.io/tx/0x…
```

## How it works

```
 XRPL websocket ──┐
 BTC block poller ─┼──▶ NormalizedTransfer ──▶ enrich ──▶ alert outbox ──▶ Telegram
 ETH webhook ──────┘        (per chain)        │  thresholds first       │
                                               │  USD pricing            │ sent_at confirmed,
                                               │  direction via labels   │ drain retries failures
                                               ▼
                                          Postgres (transfers, alerts, label book, price cache)
```

- **Listeners** (`src/listeners/`)
  - **XRPL** — websocket stream (`wss://xrplcluster.com`), serial event queue with backpressure, reads `DeliveredAmount` for partial payments, decodes destination tags and non-standard currency codes, auto-reconnects.
  - **Bitcoin** — polls Blockstream's Esplora API; faster cadence during the 13:00–17:00 UTC London–New York overlap; change-aware whale heuristic (largest output that isn't change).
  - **Ethereum** — receives [Alchemy Address Activity](https://www.alchemy.com/docs/reference/address-activity-webhook) webhooks. **Security posture:** HMAC-SHA256 signature verification (constant-time) over the raw body, fails closed if `ALCHEMY_SIGNING_KEY` is unset, 1 MB body cap. Base-unit amounts are parsed with BigInt and per-asset decimals; ERC-20 activity is accepted only from a canonical mainnet contract list, so counterfeit spam tokens can't fake a whale event.
- **Enrichment** (`src/enrich.ts`) — thresholds are checked *before* any price lookup (the XRPL firehose never burns CoinGecko quota); USD pricing is single-flight with a 24 h stale-cache fallback so a price outage degrades alert text but never deletes events. Direction (`to_exchange` / `from_exchange` / `exchange_to_exchange` / `wallet_to_wallet`) comes from fresh label sets on both endpoints.
- **Alert outbox** (`db.ts` + `index.ts`) — transfer and its pending alert commit in **one transaction**; `sent_at` is set only after Telegram accepts. A drain loop (startup + every 60 s) retries unsent rows — at-least-once delivery.
- **Label book** (`src/importers/`) — four sources feed `accounts` + `label_assignments`:
  | Importer | Source | Notes |
  |---|---|---|
  | `eth-labels` | [dawsbot/eth-labels](https://github.com/dawsbot/eth-labels) CSV | ~113k mainnet labels; word-boundary category inference |
  | `xrpscan` | XRPSCAN well-known names API | exchanges, issuers, bridges |
  | `ripple-toml` | `ripple.com/.well-known/xrp-ledger.toml` | Ripple escrow/ops addresses |
  | `tagpacks` | [GraphSense TagPacks](https://github.com/graphsense/graphsense-tagPacks) | curated exchange hot/cold wallets, provenance kept |

  Labels have a freshness window (`FRESHNESS_DAYS`), so stale intel stops influencing direction classification.

## Setup

### 1. Requirements

- Node 20+ (developed on 22/24)
- PostgreSQL (any recent version) — the dev setup uses a Docker container:

  ```bash
  docker run -d --name whale-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=whale_watcher -p 5433:5432 postgres:17
  ```

### 2. Install, migrate, import

```bash
npm install
cp .env.example .env      # then fill in secrets (table below)
npm run migrate           # applies migrations in order, tracked in schema_migrations
npm run import all        # load all four label datasets (~10 min, mostly the eth-labels CSV)
```

### 3. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `TELEGRAM_BOT_TOKEN` | for alerts | From [@BotFather](https://t.me/BotFather) (`/newbot` or `/revoke`); unset = dry-run mode, messages log to console |
| `TELEGRAM_CHAT_ID` | for alerts | Your chat/group id |
| `ALCHEMY_SIGNING_KEY` | for ETH | From the Alchemy dashboard → your webhook → **Signature**. The ETH listener **refuses to start** without it (fail-closed) |
| `PORT` | | Webhook HTTP port (default 8080) |
| `FRESHNESS_DAYS` | | Label freshness window (default 30) |
| `ETHERSCAN_API_KEY` | | Enables real block timestamps for ETH transfers (else arrival time) |
| `ETH_LABELS_CSV` | | Override: path or URL to a custom CSV (default: upstream repo) |
| `TAGPACKS_DIR` | | Override: local dir of TagPack YAML files (default: fetched from GitHub) |

### 4. Point Alchemy at your machine

1. Create an **Address Activity** webhook in the [Alchemy dashboard](https://dashboard.alchemy.com) covering the addresses/assets you care about.
2. Expose your local `:8080` publicly — e.g. `cloudflared tunnel --url http://localhost:8080` or ngrok — and set the webhook URL to `https://<your-host>/alchemy-webhook`.
3. Copy the webhook's **Signing key** into `ALCHEMY_SIGNING_KEY`.
4. Use the dashboard's *Test delivery*; the server logs accepted/dropped activities.

### 5. Run

```bash
npm run start          # all three listeners + outbox drain
npm run start smoke    # end-to-end self-test: gate → price → render, no DB writes
npm test               # unit + integration tests (see below)
```

## Testing

The suite covers the historically buggy surfaces on purpose:

- **Unit** — base-unit → human parsing (BigInt, per-asset decimals, truncation edges), webhook signature verification, XRPL currency-code decoding, category inference word-boundary cases.
- **Integration** (needs `DATABASE_URL`) — transactional transfer+alert insert, outbox pending/sent lifecycle, duplicate-delivery dedup, bulk label upserts; each test cleans up after itself.

```bash
npm test               # runs everything; DB tests are skipped if DATABASE_URL is unset
```

## Project layout

```
src/
├── index.ts            # entrypoint: wires listeners, outbox drain, shutdown
├── enrich.ts           # threshold gate → pricing → direction → alert render
├── db.ts               # pool, outbox, bulk label upserts, price cache
├── prices.ts           # CoinGecko single-flight + stale fallback
├── telegram.ts         # send with dry-run fallback
├── etherscan.ts        # block timestamps (occurred_at)
├── migrate.ts          # tracked, ordered migration runner
├── listeners/          # btc.ts · eth.ts · xrpl.ts
└── importers/          # eth-labels · xrpscan · ripple-toml · tagpacks
migrations/             # 001 schema · 002 outbox+tags · 003 sent_at relax
scratch/                # planning artifacts (catalog spec, research, tickets)
CONTEXT.md              # domain language — read this before touching enrich/
```

## Roadmap

- [ ] Behavioral hot/cold wallet splitting within venues
- [ ] Probabilistic BTC deposit-address scoring (bounded)
- [ ] OLI attester allowlisting for community labels
- [ ] Paid data-source upgrades

## Notes

- Domain vocabulary (endpoint, category set, session overlap…) is defined in [`CONTEXT.md`](CONTEXT.md); session progress logs live in `progress*.md`.
- Label data comes from community sources — treat `confidence` levels accordingly and don't act on a single label alone.
