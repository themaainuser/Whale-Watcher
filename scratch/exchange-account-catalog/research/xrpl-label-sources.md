# XRPL exchange-address sources — survey findings

*Researched 2026-08-21. (File reconstructed 2026-08-31 from the resolved ticket answer and `spec.md` §3.3 after the original was lost. The Ripple escrow list below was re-fetched live from ripple.com/.well-known/xrp-ledger.toml on 2026-08-31 — addresses verified current.)*

## Question

Which free sources identify XRPL exchange accounts? For the major venues: how are deposits structured — shared address + destination tag versus per-user addresses — and does any canonical public list exist? Are Ripple escrow/ODL addresses worth a separate category?

## Structural reality first

One funded XRPL account costs an immortal ~1 XRP base reserve, so venues dominate via **one shared omnibus deposit address + a per-user destination tag**. Consequence: a handful of labeled addresses captures most exchange XRP flow — sweeps concentrate customer funds into hot/cold wallets that top the rich list.

### Deposit model per major venue (confirmed 2026-08-21)

| Venue | Deposit model |
|---|---|
| Binance | shared address + destination tag |
| Bitstamp | shared address + destination tag |
| Coinbase | shared address + tag (required) |
| Kraken | shared address + destination tag |
| Bitget | shared address + destination tag |
| **Uphold** | **unique per-user XRP addresses** (tag still routes internally; old shared pool address phasing out) |
| **GateHub** | **each user gets their own on-ledger wallet** (no tag needed) |

## Free label sources

### 1. XRPSCAN well-known names API — the bulk loader

- `GET https://api.xrpscan.com/api/v1/names/well-known`
- Public curated list of exchange / bridge / issuer accounts (name, domain, twitter, verified flag).
- Free tier: **10,000 requests/day** — enough to pull the whole list.
- Redistribution license **undocumented** — fine for internal alerting, ask before republishing.
- Pricing beyond free: PAYG 0.0001 XRP/req; Enterprise $4,999/mo.

### 2. Bithomp API v2 — per-address enrichment

- Free (non-commercial): **10 req/min, 2K/day** — `GET /v2/address/{addr}?username=true&service=true&parent=true` returns service name/domain/parent.
- The **bulk services catalog (~475 services / ~1,832 addresses, `/v2/services*`) is Premium-only, €250/mo** — the "someday" upgrade if the curated lists ever prove too thin.
- `services/lastUpdate` field supports staleness checks for periodic re-pulls.

### 3. xrp-ledger.toml files — self-published official accounts

Venues publish their official accounts in a `/.well-known/xrp-ledger.toml` file on their own domains (the XRPL convention). Primary source when available — it's the venue speaking for itself. Ripple's own file includes all 20 escrow wallets plus the RLUSD issuer (full list below).

### 4. What doesn't exist

**No canonical GitHub address list exists** — only codec/tooling repos. Third-party dashboards (xrpldashboard, xrp-insights, xrplanalytics) all derive from XRPSCAN/Bithomp/TOML. There is no independent dataset to cross-check against.

## Destination tags — mechanics

- Pure **off-ledger 32-bit bookkeeping**: the ledger knows the address, the venue's internal DB maps tag → user.
- **Address-level (venue) attribution works without them**; user-level attribution inside a venue is impossible by design.
- With `RequireDest` enabled, an untagged payment **bounces on-ledger**; without it, the payment lands but sits **uncredited pending manual support recovery**.
- Treat presence/absence of a tag on exchange-bound payments as a hosted-account signal, nothing more.

## Ripple's own addresses — the `protocol_infra` case

**Yes, tag separately.** Ripple's 20 escrow wallets (full list published at `ripple.com/.well-known/xrp-ledger.toml`) release **up to 1B XRP monthly** (~32.3B still locked) — scheduled supply events that would otherwise fire false whale alerts on the 1st of every month. ODL/Ripple Payments corridors have no fixed address registry — flows ride partner-exchange hot wallets (Bitstamp USD leg, Bitso MXN leg), already covered by venue labels.

The 20 escrow wallets (re-fetched from the live TOML 2026-08-31):

```
r9NpyVfLfUG8hatuCCHKzosyDtKnBdsEN3   #01
r9UUEXn3cx2seufBkDa8F86usfjWM6HiYp   #02
rB3WNZc45gxzW31zxfXdkx8HusAhoqscPn   #03
rDdXiA3M4mYTQ4cFpWkVXfc2UaAXCFWeCK   #04
rKDvgGUsNPZxsgmoemfrgXPS2Not4co2op   #05
rKwJaGmB5Hz24Qs2iyCaTdUuL1WsEXUWy5   #06
rN8pqRwLYuuvY7pUHurybPC8P6rLqVsu6o   #07
rNASJdZjY9dToHnNURi3HAUku3duPwbtD1   #08
rU9qmGM4Y6WWDhiNzkwVKBwwatcoE7YL1T   #09
rfWPPQBYqYmoFMdVnjzXCagJbz5uajSBXL   #10
rh2EsAe2xVE71ZBjx7oEL2zpD4zmSs3sY9   #11
rhEwsCWDCVxDiKxGJAKM6VuXC8EFtJP5gQ   #12
rncKvRcdDq9hVJpdLdTcKoxsS3NSkXsvfM   #13
rp6aTJmW3nq1aKt3Jmuz4DPRxksT5PBjpH   #14
rsjFB8mPWqiZgPUaVh8XYqdfa59PE2d5LG   #15
rw2hzLZgiQ9q62KCuaTWuFHWfiX7JWg3wY   #16
rDqGA2GfveHypDguQ1KXrJzYymFZmKxEsF   #17
rGKHDyj4L6pc7DzRB6LWCR4YfZfzXj2Bdh   #18
rHGfmgv54kpc3QCZGRXEQKUhLPndbasbQr   #19
rMhkqz3DeU7GUUJKGZofusbrTwZe6bDyb1   #20
```

Plus the RLUSD issuer: `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` (also `protocol_infra` — RLUSD operations, not market flow).

All 21 are already imported with `protocol_infra` tags by the Ripple TOML importer (20 escrow + RLUSD issuer — the 20-label count from build day).

## Known gaps

1. No free bulk catalog — Bithomp Premium (€250/mo) is the upgrade path.
2. Hot-wallet rotations happen unannounced — periodic re-checks against Bithomp `services/lastUpdate` required.
3. XRPSCAN redistribution license undocumented (internal use assumed safe; confirm before republishing).

## Paid appendix (future upgrades only)

| Vendor | Product | Price |
|---|---|---|
| Bithomp | API Premium | €250/mo — bulk services dump (~475 services / ~1.8k addresses) + change detection |
| XRPSCAN | PAYG / Enterprise | 0.0001 XRP/req beyond free 10k/day; Enterprise $4,999/mo (Console: contact) |
| XRPLAnalytics | API | $0 / $9 / $29 per month tiers |

## Answer (recorded on ticket 03)

Usable free sources: **XRPSCAN well-known names API** (curated, 10k req/day free), **Bithomp API v2** (free per-address enrichment; bulk catalog Premium), **xrp-ledger.toml** self-published venue files (Ripple's includes all 20 escrow wallets + RLUSD issuer). No canonical GitHub list exists.

Deposit model: shared omnibus address + per-user destination tag is the norm — confirmed for Binance, Bitstamp, Coinbase, Kraken, Bitget. Exceptions: GateHub (per-user wallets, no tag), Uphold (unique per-user addresses). Missing tag at shared venues → lands uncredited, manual recovery; `RequireDest` venues bounce on-ledger. Tags are off-ledger bookkeeping — venue attribution works without them.

Ripple category: **yes** — 20 escrow wallets release ≤1B XRP monthly (scheduled supply events, not whale behavior); tag all 20 + RLUSD issuer as `protocol_infra`. ODL has no fixed addresses; flows ride partner-exchange hot wallets.
