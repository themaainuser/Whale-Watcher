# ETH + stablecoin label sources — survey findings

*Researched 2026-08-21. (File reconstructed 2026-08-31 from the resolved ticket answer and `spec.md` §3.2 after the original was lost — all figures below are the measured numbers recorded on 2026-08-21.)*

## Question

Which free/open sources label Ethereum exchange accounts and stablecoin infrastructure? For each source: coverage of hot/cold/deposit wallets across major venues, treatment of Tether/Circle treasury and mint addresses, bridges and other non-exchange entities; data format, license, freshness, and import path.

## The primary source: `dawsbot/eth-labels`

**The star dataset** — https://github.com/dawsbot/eth-labels (MIT license). Mirrors the Etherscan label cloud, kept current by the maintainer's scraper.

- **Measured 2026-08-21: 144,378 account rows** (113,194 on Ethereum mainnet), plus ~54k token entries. (The 113,194 mainnet figure was later confirmed to the digit by the live import on build day.)
- Formats/import paths: `data/csv/accounts.csv` (primary), `tokens.csv`, `db.sqlite3`, or the free API at `eth-labels.com/swagger`.
- License: MIT — redistribution fine.

### Venue coverage measured from the dataset (mainnet)

| Venue | Labels | Notes |
|---|---|---|
| Binance | 5,102 | ~5,014 are literally `Binance Dep*` — **per-user deposit addresses**. Roll up by label prefix or every customer cash-in reads as a separate whale inflow. |
| Bitget | ~19,068 | similarly massive per-user deposit sets |
| Deribit | ~6,081 | same pattern |
| Gate | ×765 | |
| HTX | ×76 | numbered wallets |
| Bitfinex | ×60 | numbered wallets |
| Coinbase | 1..23+ | small numbered wallet family (~63 total incl. variants) |
| Gemini | ×24 | |
| MEXC | ×20 | |
| Kraken | ×13 | |
| Upbit | ×15 | |
| OKX | ×12 | |
| Bybit | thin | nearly invisible post-hack — labels dominated by exploiter addresses |

**The big asymmetry:** Binance/Deribit/Bitget publish thousands of per-user deposit labels; Coinbase/Kraken/OKX/Bybit run small numbered wallet families and leave their per-user deposit addresses **largely unlabeled** — the biggest practical false-positive source for ETH inflow alerts (their deposit systems are shared/rotating and unlabeled).

### Hot vs cold

**No free source classifies hot vs cold.** The numbered series (`Coinbase 1..23`, `Kraken N`) mix both roles. Infer behaviorally from outflow frequency after import — flagged as an open question for build sessions.

## Stablecoin infrastructure

- **Canonical token contracts** (hardcode, don't scrape): Tether's supported-protocols page (`tether.to/en/supported-protocols/`) for USDT per chain; Circle developer docs (`developers.circle.com/stablecoins/usdc-contract-addresses`) for USDC + CCTP `TokenMessenger`/`MessageTransmitter` V2 + Gateway. Both also appear in eth-labels `tokens.csv`.
- **`issuer_treasury` addresses:** eth-labels carries `Tether: Treasury` (`0x5754284f345afc66a98fbb0a0afe71e0f007b949`) and `Tether: Multisig`. Tether publishes no machine-readable treasury list — prefer **event-based detection** (monitor `Issuance` events on the USDT contract).
- **Circle mint/burn has no single address at all** — it happens inside smart contracts. Detect via contract events (`Mint`, CCTP `BurnMessage`), not address lists. Relevant primitives already labeled in eth-labels: `Circle: Deployer 1`, `Circle CCTP: Token Messenger V2`, `Circle CCTP: Message Transmitter V2`, `Circle: USDC Blacklister`.

## Non-exchange entities (avoid false signals)

Present in eth-labels, useful for the `bridge` / `market_maker` / `custodian` categories: Wormhole ×53, Polygon Bridge ×6, Arbitrum-related ×231, Optimism ×79, Wintermute ×8, Galaxy Digital ×17, Jump Trading ×3, DWF Labs ×3, BitGo ×8.

**Supplement: OLI** — Open Labels Initiative (openlabelsinitiative.org, EF-funded): EAS-attested community label pool with daily Parquet exports via growthepie and a public BigQuery dataset. Trust layer still immature — apply your own attester allowlist before trusting community labels.

## Other candidates checked

- **Etherscan label exports:** the bulk export (`exportaddresstags`) is **Enterprise-tier PRO paywalled** (third-party lists resell up to $899/mo). The label *cloud* website is what eth-labels mirrors — go to eth-labels instead.
- **Other public GitHub label repos:** nothing approaches eth-labels' coverage; several are stale forks of it.

## Known gaps

1. Unlabeled per-user deposit addresses at Coinbase/Kraken/OKX/Bybit (label-prefix roll-up only works for Binance/Deribit/Bitget).
2. Zero free ETF / custody listings — no ETF reserve wallets, **Fireblocks returned 0 hits**.
3. Etherscan bulk export Enterprise-paywalled.
4. eth-labels depends on one maintainer's scraper — watch the repo for staleness.

## Paid alternatives (future upgrades only)

| Vendor | Product | Price signal |
|---|---|---|
| Arkham | Entity Intelligence API | free core / credit-based tier (~5 req/s/key, community-reported); partner pricing unpublished |
| Nansen | Pro | $49/mo (annual) – $69/mo (monthly); API credits $10/1k |
| Chainalysis | KYT / Reactor | quote-only; ~$25.7k–$297k/yr (avg ~$174.7k, Vendr Feb 2026) |
| Etherscan | `exportaddresstags` | Enterprise PRO only (third-party lists up to $899/mo) |

Paid vendors sell exactly what free data lacks: maintained deposit-address ranges and named-cluster attribution at scale.

## Answer (recorded on ticket 02)

Top free source per account type:
- **Everything exchange-related:** `dawsbot/eth-labels` (MIT, 144k rows / 113k mainnet, CSV + sqlite + free API; mirrors Etherscan label cloud).
- **Hot/cold wallets:** same numbered-wallet series; no free source classifies hot vs cold — infer behaviorally.
- **Stablecoin infra:** canonical token/CCTP contracts from official docs; eth-labels carries `Tether: Treasury` and Circle CCTP/Gateway/Deployer labels. Mint/burn detection should be event-based (USDT `Issuance` / CCTP `BurnMessage`), not address lists.
- **Bridges/MM/custodians:** eth-labels entity labels + OLI community pool (attester allowlist required).

Biggest gaps: unlabeled per-user deposits at Coinbase/Kraken/OKX/Bybit; zero free ETF/Fireblocks custody lists; Etherscan bulk export Enterprise-paywalled; OLI trust layer immature.
