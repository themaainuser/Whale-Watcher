# BTC attribution options — survey findings

*Researched 2026-08-21. (File reconstructed 2026-08-31 from the resolved ticket answer and `spec.md` §3.1 after the original was lost.)*

## Question

What can free data achieve for Bitcoin exchange tagging? Establish: publicly known exchange reserve/hot-wallet address lists and their reliability; how far open heuristics (co-spending clustering, change-address detection, peeling-chain analysis) go on free data; what paid APIs charge for cluster attribution (recorded, not chosen). Recommend a realistic v1 posture.

## The structural limit — read this first

Exchanges derive unique per-user deposit addresses from **HD wallets** (BIP32) and sweep them into consolidation wallets. Static lists therefore catch the **consolidation layer** (hot/cold/sweep wallets) but **miss fresh per-user deposit addresses** by construction. Commercial vendors sell continuously-updated "deposit address ranges" precisely because free lists can't cover this. No rigorous public figure quantifies the miss — plan qualitatively, don't assume a number.

## Proof-of-reserves pages: mostly a dead end

Post-FTX proof-of-reserves is overwhelmingly Merkle/zk/attestation-based — venues prove solvency cryptographically **without publishing raw address lists**: Binance, OKX, Kraken, Bybit, Bitget, Coinbase (SEC filings) all do this.

**The one exception: BitMEX** — publishes its complete BTC wallet address list at `bitmex.com/app/porl`, refreshed **twice weekly**. The only major venue that does.

## Usable free today

### 1. GraphSense Public TagPacks — the backbone

- https://github.com/graphsense/graphsense-tagpacks (MIT license)
- YAML packs; **every tag carries its source URL, a confidence level, and a `lastmod` date** — exactly the provenance habits the schema ticket later adopted.
- Measured: ~490k label rows across ~35 BTC packs.
- Filter for: `category: exchange` + `is_cluster_definer: true` to get the consolidation-layer wallets.
- Pack-level structure note (learned the hard way on build day): category, source, confidence, and cluster id live **at the pack level**, not on each address line — and packs sit directly under `packs/` as `exchange-wallets-*.yaml`.

### 2. BitMEX proof-of-reserves list

Full wallet list, twice weekly, self-published — merge into the curated table and re-pull on the same cadence.

### 3. Manual verification tools (lookup-only, no bulk export)

- **Arkham free tier** — verify individual addresses against entity attributions.
- **WalletExplorer / OXT** — interactive co-spend exploration for hand-curation of top venues.

### 4. Open heuristics (all runnable on free node/explorer data)

- **Co-spending clustering** (inputs of a tx share an owner) — broken by CoinJoin; **detect and exclude CoinJoins first**.
- **Change-address detection** — Möser & Narayanan, *Investigating Classification of Bitcoin Addressing Behavior* (Financial Cryptography 2022): individual heuristics reach only 10–30% TPR; random-forest combination reaches **AUC 0.976**; ~50% of txs get change identified at p≥0.99. Ground truth dataset: `github.com/maltemoeser/address-clustering-data`.
- **Peeling-chain traversal** — fan-out patterns typical of exchange withdrawals.
- Tooling: **BlockSci** and **GraphSense** for whole-chain analysis; **ECNU BitcoinAddressClustering** (GPL-3.0) as an open clustering implementation.
- **Boundary:** whole-chain clustering needs BlockSci/GraphSense-class infrastructure — out of proportion for v1. And **clustering ≠ attribution**: clustering tells you *these addresses belong together*; naming the cluster "Binance" still requires off-chain tags.

### 5. Bounded traces for "likely exchange deposit"

For a specific large tx: a bounded 1–2 hop fan-in/fan-out sweep around it via **mempool.space / blockstream.info Esplora APIs** can score "likely exchange deposit (probabilistic)" — sweep pattern, near-zero resting balance, 10:1+ receive/send ratio. Label it probabilistic in the alert; never present as fact.

## Requires paid (upgrade path only — recorded, not chosen)

| Vendor | Product | Price signal |
|---|---|---|
| Chainalysis | KYT / Reactor | quote-only; est. **$25K–$300K+/yr** |
| Elliptic | Lens / Investigator | quote-only; est. **$40K–$100K+/yr** |
| TRM Labs | Forensics / Tactical API | quote-only; median contract ~$40K–$112K/yr depending on source |
| Arkham | Entity API | cheapest programmatic step up — free credit tier (~5 req/s/key, community-reported); partner pricing unpublished |

## Recommended v1 posture (adopted into `spec.md` §5)

1. **Alert on large single transfers attribution-free** — amount thresholds are the v1 product; "big transfer, owner unknown" is honest.
2. **Small curated reserve-address table** seeded from TagPacks (filtered, `is_cluster_definer: true`) + BitMEX list, manually verified for the top ~10 venues; every row carries source / confidence / lastmod.
3. **Optional bounded 1–2 hop sweep-pattern scoring** → "likely exchange deposit (probabilistic)" labels, marked probabilistic in alerts.
4. **Skip whole-chain clustering** — infrastructure cost out of proportion for v1.
5. **Buy attribution later** only if it becomes a product requirement.

## Known gaps

1. No free hot/cold classification anywhere — behavioral inference required (same gap as ETH numbered wallets).
2. Static lists' inflow coverage unquantified publicly — plan qualitatively.
3. Per-user deposit addresses structurally uncoverable without paid "deposit address range" feeds.

## Answer (recorded on ticket 04)

**Usable free today:** small curated reserve list from GraphSense TagPacks (MIT, provenance per tag) + BitMEX's twice-weekly published wallet list + manual verification via Arkham free tier / WalletExplorer. Most exchange PoR pages are Merkle/zk-based and publish NO addresses — dead end except BitMEX. Open heuristics (co-spend, change detection, peeling chains) run on free data but whole-chain clustering needs BlockSci-class infra; clustering ≠ attribution either way.

**Requires paid:** Chainalysis ($25k–$300k/yr), Elliptic ($40k–$100k+/yr), TRM (~$40k–$112k/yr), Arkham Entity API (free credit tier, cheapest programmatic step up).

**v1 posture:** amount-threshold alerts attribution-free; curated reserve table with provenance; optional bounded probabilistic deposit scoring; no whole-chain clustering; buy attribution later only if the product demands it.
