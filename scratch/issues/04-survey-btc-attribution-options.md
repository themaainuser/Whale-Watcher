1	# Survey BTC attribution options
2	
3	Type: research
4	Status: resolved
5	Blocked by:
6	
7	## Question
8	
9	What can free data achieve for Bitcoin exchange tagging? Establish: publicly known exchange reserve/hot-wallet address lists (proof-of-reserve pages, academic/work papers, Arkham free tier) and their reliability; how far open heuristics (co-spending clustering, change-address detection, peeling-chain analysis) go using full-node or explorer data without paid APIs; and what paid APIs (Chainalysis, Elliptic, Arkham) charge for cluster attribution — recorded as future upgrades only. Recommend a realistic v1 posture consistent with treating most BTC whale detection as "large single transfer".
10	
11	Findings file: `research/btc-attribution.md`. The answer separates "usable free today" from "requires paid" with evidence.
12	
13	## Answer
14	
15	Full evidence and sources in `research/btc-attribution.md` (researched 2026-08-21).
16	
17	### Usable free today
18	- **Small curated reserve list**: GraphSense Public TagPacks (MIT, ~490k label rows across ~35 BTC packs, provenance + confidence + lastmod per tag) + BitMEX's twice-weekly published full BTC wallet list (bitmex.com/app/porl) + manual verification via Arkham free tier / WalletExplorer. Most exchange PoR pages (Kraken, Binance, OKX, Coinbase) are Merkle/zk/attestation-based and do NOT publish address lists — dead end except BitMEX.
19	- **Heuristics on full-node data**: co-spend clustering, change-address detection, peeling-chain analysis all run on chain data only. Ground truth + models are open (Möser & Narayanan FC22: individual change heuristics 10–30% TPR, RF combo AUC 0.976, ~50% of txs get change identified at p≥0.99; BlockSci; ECNU BitcoinAddressClustering GPL-3.0). Whole-chain clustering needs BlockSci/GraphSense-class infra — overkill for v1. Clustering ≠ attribution: naming clusters still needs off-chain tags.
20	- **Structural limit**: exchanges derive unique per-user deposit addresses from HD wallets, so static lists catch the consolidation layer (hot/cold/sweep wallets) but miss fresh deposit addresses; commercial vendors sell continuously-updated "deposit address ranges" precisely because free lists can't cover this. No rigorous public % quantification found — plan qualitatively.
21	
22	### Requires paid (upgrade path only)
23	- Chainalysis KYT/Reactor: quote-only, est. $25K–$300K+/yr.
24	- Elliptic: quote-only, est. $40K–$100K+/yr.
25	- TRM Labs: quote-only, median contract ~$40K–$112K/yr depending on source.
26	- Arkham Entity API: cheapest programmatic step up — free credit tier (~5 req/s), partner pricing unpublished.
27	
28	### Recommended v1 posture
29	Alert on large single transfers attribution-free (amount thresholds); ship a small curated reserve-address table seeded from TagPacks + BitMEX with source/confidence/lastmod columns; add bounded 1–2 hop fan-in/fan-out sweep-pattern scoring for "likely exchange deposit (probabilistic)" labels; skip whole-chain clustering; buy attribution later only if it becomes a product requirement.
30	