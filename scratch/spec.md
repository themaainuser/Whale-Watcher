1	# Exchange-Account Catalog — Whale-Watcher v1
2	
3	Assembled 2026-08-21 from the resolved tickets and research files of this effort (research fetched same date unless noted). Reads standalone: someone who has never seen the map can act on it.
4	
5	## 1. Purpose & scope
6	
7	A catalog of every type of exchange-related account Whale-Watcher can meet on its three chains — Bitcoin, Ethereum (+ ERC-20 USDT/USDC), XRPL — covering what each type is, how to detect it, which free label datasets cover it, and what the address-book schema must hold so the enrich/filter stage can tag transfer direction correctly.
8	
9	Out of scope: Tron/Solana and any chain without a v1 listener; implementation code; paid-data procurement (documented as upgrades in §6).
10	
11	## 2. Category taxonomy
12	
13	Ten fixed categories (definitions verbatim from repo-root `CONTEXT.md`):
14	
15	| Category | Meaning |
16	|---|---|
17	| `exchange_hot` | Venue-operated address holding spendable funds for day-to-day withdrawals |
18	| `exchange_cold_reserve` | Venue-operated address holding bulk treasury funds moved rarely |
19	| `exchange_deposit` | Address designated to receive user deposits — per-user or shared |
20	| `issuer_treasury` | Stablecoin issuer's mint/treasury-controlled address (Tether, Circle) |
21	| `bridge` | Address or contract moving assets between chains |
22	| `custodian` | Professional key-holding service acting for clients (Fireblocks, BitGo) |
23	| `market_maker` | Firm rotating inventory across venues (Wintermute…) |
24	| `etf_prime_vehicle` | ETF or prime-brokerage wallet holding fund reserves |
25	| `protocol_infra` | Chain-native protocol addresses emitting large but non-market flows (Ripple escrow releases, RLUSD operations, CCTP mint/burn rails) |
26	| `unknown` | Unlabeled |
27	
28	Standing rules (decided in the taxonomy ticket):
29	
30	1. **Category sets are multi-valued** — an account may hold several categories at once.
31	2. **Direction endpoints**: only categories beginning `exchange_` participate in direction classification (`to_exchange`, `from_exchange`, `exchange_to_exchange`); flows touching only other categories fall back to `wallet_to_wallet`, category recorded informationally.
32	3. `protocol_infra` exists specifically because scheduled supply events — Ripple escrow releasing up to 1B XRP monthly, Circle mint/burn — would otherwise fire false whale alerts.
33	
34	## 3. Chain sections
35	
36	### 3.1 Bitcoin
37	
38	**Structural reality:** exchanges derive per-user deposit addresses from HD wallets (BIP32) and sweep them into consolidation wallets. Static lists therefore catch the **consolidation layer** (hot/cold/sweep targets) and miss fresh per-user deposit addresses. No rigorous public figure quantifies the miss; plan qualitatively, don't assume a number.
39	
40	| Category | Detection | Free sources |
41	|---|---|---|
42	| `exchange_hot`, `exchange_cold_reserve` | Curated reserve lists; behavioral verification of top venues | **GraphSense TagPacks** (github.com/graphsense/graphsense-tagpacks, MIT): YAML packs, every tag carries source URL + confidence + `lastmod`; ~490k label rows across 35 BTC packs; filter `category: exchange` + `is_cluster_definer: true`. **BitMEX Proof of Reserves** (bitmex.com/app/porl): publishes ALL BitMEX BTC wallet addresses, refreshed twice weekly — the only major venue that does. **Arkham free tier**: lookup-only verification, no bulk export. **WalletExplorer/OXT**: interactive co-spend labeling for manual curation. |
43	| `exchange_deposit` | Not enumerable in advance (HD churn). Hindsight heuristic: fan-in/fan-out sweeps, near-zero resting balance, 10:1+ receive/send ratio. Bounded 1–2 hop explorer traces around a large tx can score "likely exchange deposit (probabilistic)" | mempool.space / blockstream.info Esplora APIs for bounded traces |
44	| `bridge`, `custodian`, `market_maker`, `etf_prime_vehicle` | Sparse; TagPacks include some entities; treat mostly unlabeled | TagPacks; manual curation |
45	
46	Open heuristics (all runnable on free node/explorer data): co-spending clustering (broken by CoinJoin — detect and exclude first), change-address detection (Möser & Narayanan FC22: individual heuristics 10–30% TPR, random-forest AUC 0.976, ground truth at github.com/maltemoeser/address-clustering-data), peeling-chain traversal. Whole-chain clustering needs BlockSci/GraphSense-class infrastructure — out of proportion for v1. **Clustering ≠ attribution**: naming a cluster "Binance" requires off-chain tags.
47	
48	Proof-of-reserves pages are mostly a dead end: post-FTX PoR is Merkle/zk proofs without raw address lists (Binance, OKX, Kraken, Bybit, Bitget, Coinbase filings). BitMEX is the exception.
49	
50	Known gaps: no free hot/cold classification anywhere (behavioral inference required); static lists' inflow coverage unquantified publicly.
51	
52	### 3.2 Ethereum (+ ERC-20 USDT/USDC)
53	
54	**Primary source: [`dawsbot/eth-labels`](https://github.com/dawsbot/eth-labels)** — MIT, mirrors the Etherscan label cloud. Measured 2026-08-21: 144,378 account rows (113,194 mainnet), plus ~54k token entries. Import via `data/csv/accounts.csv` (+ `tokens.csv`, `db.sqlite3`) or the free API (eth-labels.com/swagger).
55	
56	Venue coverage measured from the dataset (mainnet):
57	
58	- **Binance**: 5,102 labels, of which ~5,014 are literally `Binance Dep*` — **per-user deposit addresses**. Roll up by label prefix or every user cash-in reads as separate inflow.
59	- **Deribit** (~6,081) and **Bitget** (~19,068): similarly massive per-user sets.
60	- Numbered operational wallets: Coinbase 1..23+, Kraken ×13, OKX ×12, Bitfinex ×60, HTX ×76, Gemini ×24, MEXC ×20, Upbit ×15, Gate ×765.
61	- **Bybit** nearly invisible post-hack (labels dominated by exploiter addresses).
62	- Coinbase/Kraken/OKX/Bybit run shared/rotating deposit systems whose per-user addresses are **largely unlabeled** — biggest practical false-positive source for ETH inflow alerts.
63	
64	Hot-vs-cold: **no free dataset classifies it** — the numbered series mix both; infer behaviorally from outflow frequency after import.
65	
66	Stablecoin infrastructure:
67	
68	- Canonical token contracts: Tether's supported-protocols page (USDT per chain), Circle developer docs (USDC + CCTP `TokenMessenger`/`MessageTransmitter` V2, Gateway). Both also appear in eth-labels `tokens.csv`.
69	- `issuer_treasury`: eth-labels carries `Tether: Treasury` (`0x5754284f345afc66a98fbb0a0afe71e0f007b949`) and `Tether: Multisig`. Tether publishes no machine-readable treasury list — prefer event-based detection (monitor `Issuance` events on the USDT contract).
70	- Circle mint/burn has **no static address**; detect via contract events (`Mint`, CCTP `BurnMessage`). Relevant primitives already labeled: `Circle: Deployer 1`, `Circle CCTP: Token Messenger V2`, `Circle CCTP: Message Transmitter V2`, `Circle: USDC Blacklister`.
71	
72	Non-exchange entities present in eth-labels (avoid false signals): Wormhole ×53, Polygon Bridge ×6, Arbitrum-related ×231, Optimism ×79, Wintermute ×8, Galaxy Digital ×17, Jump Trading ×3, DWF Labs ×3, BitGo ×8. Supplement with **OLI** (openlabelsinitiative.org — EF-funded EAS attestation pool, daily Parquet exports via growthepie / public BigQuery); apply your own attester allowlist before trusting.
73	
74	Known gaps: unlabeled per-user deposits at Coinbase/Kraken/OKX/Bybit; zero free ETF/Coinbase Custody/Fireblocks listings (Fireblocks returned 0 hits); Etherscan bulk export is Enterprise-paywalled; eth-labels depends on one maintainer's scraper.
75	
76	### 3.3 XRPL
77	
78	**Structural reality:** one funded XRPL account costs an immortal ~1 XRP reserve, so venues dominate via **shared omnibus deposit address + per-user destination tag**. Confirmed model per venue (fetched 2026-08-21): Binance, Bitstamp, Coinbase (tag required), Kraken, Bitget — shared address + tag. Exceptions: **Uphold** now issues unique per-user XRP addresses (tag still routes); **GateHub** gives each user their own on-ledger wallet (no tag needed).
79	
80	A few dozen labeled addresses capture the large majority of CEX XRP flow (sweeps concentrate customer funds into hot/cold wallets topping the rich list).
81	
82	Free sources:
83	
84	- **XRPSCAN well-known names API** — `GET https://api.xrpscan.com/api/v1/names/well-known`: curated exchange/bridge/issuer labels, free 10k req/day. Redistribution license undocumented — fine internally, ask before republishing.
85	- **Bithomp API v2** — free non-commercial per-address enrichment (10 req/min, 2K/day) returning service name/domain/parent. Its bulk catalog (~475 services, ~1,832 addresses) is Premium-paywalled (€250/mo). `services/lastUpdate` supports staleness checks.
86	- **xrp-ledger.toml** — venues self-publish official accounts on their own domains; primary when available.
87	- No canonical GitHub address list exists; third-party tooling only.
88	
89	Destination tags: pure off-ledger 32-bit bookkeeping. Address-level (venue) attribution works without them; user-level attribution inside a venue is impossible by design. With `RequireDest` enabled an untagged payment bounces on-ledger; otherwise it lands uncredited pending manual recovery. Treat presence/absence of a tag on exchange-bound payments as a hosted-account signal, nothing more.
90	
91	`protocol_infra` on XRPL: Ripple's 20 escrow wallets (full list published at ripple.com/.well-known/xrp-ledger.toml and reproduced in `research/xrpl-label-sources.md` §"Ripple's own addresses") release up to 1B XRP monthly — scheduled supply events, not whale behavior; tag all 20 plus the RLUSD issuer `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`. ODL/Ripple Payments corridors have no fixed address registry — they ride partner-exchange hot wallets (Bitstamp USD leg, Bitso MXN leg), already covered by venue labels.
92	
93	Known gaps: no free bulk catalog (Bithomp premium is the upgrade path); hot-wallet rotations unannounced — periodic re-checks against `services/lastUpdate` required.
94	
95	## 4. Address-book schema requirements
96	
97	Decided in the schema ticket; sufficient for direct DDL:
98	
99	1. **Identity — one row per chain address.** EVM addresses normalize lowercase. XRPL identity is the classic address alone; destination tags ride along as informational attributes (address-only identity — no composite keys). BTC addresses are plain rows carrying an optional `cluster_id` attribute for TagPacks-style cluster membership; no first-class cluster entity.
100	2. **Multi-valued category sets** drawn from the ten-category vocabulary; effective set derives from live assignments.
101	3. **Per-assignment provenance**: every label assignment carries `source`, `confidence` enum (`verified` / `heuristic` / `community`), and `last_seen`. Consumers ignore assignments outside the configured freshness window. (Mirrors TagPack semantics — provenance makes staleness queryable.)
102	4. **Conflicts coexist**: disagreeing sources produce separate assignments on the same account; nothing overwrites.
103	5. **Direction mapping** inherited from §2: `exchange_*` presence ⇔ exchange endpoint.
104	
105	## 5. v1 posture recommendations
106	
107	| Chain | Posture |
108	|---|---|
109	| Bitcoin | Amount-threshold whale alerts, attribution-free. Small curated reserve table seeded from TagPacks (filtered, `is_cluster_definer: true`) + BitMEX list, manually verified for the top ~10 venues; carry source/confidence/lastmod. Optional bounded 1–2 hop fan-in/fan-out scoring → probabilistic "likely exchange deposit", labeled probabilistic in alerts. No whole-chain clustering. |
110	| Ethereum | Bulk-import eth-labels mainnet slice; normalize `Venue N` / `Venue Dep*` nameTags into (venue, role) tuples so per-user deposit floods roll up to one entity. Hardcode canonical USDT/USDC + CCTP contracts; detect issuer activity by events. Tag bridges/MMs/custodians from eth-labels + OLI (allowlisted attesters). |
111	| XRPL | Pull XRPSCAN well-known once; fill gaps with Bithomp free-tier per-address lookups; hand-curate top ~50 exchange wallets from the rich list. Venue-level attribution only. Tag the 20 Ripple escrow wallets + RLUSD issuer as `protocol_infra`. |
112	
113	## 6. Paid upgrade appendix (future only)
114	
115	| Vendor | Product | Price signal |
116	|---|---|---|
117	| Chainalysis | KYT / Reactor | quote-only; ~$25.7k–$297k/yr (avg ~$174.7k, Vendr Feb 2026) |
118	| Elliptic | Lens / Investigator | est. $40k–$100k+/yr |
119	| TRM Labs | Forensics / Tactical API | median ~$40k/yr ($20k–$48k band; CostBench median $112k) |
120	| Arkham | Entity Intelligence API | free credit-based tier (~5 req/s/key, community-reported); partner pricing unpublished |
121	| Nansen | Pro | $49/mo (annual) – $69/mo (monthly); API credits $10/1k |
122	| Bithomp | API Premium | €250/mo — bulk services dump (~475 services / ~1.8k addresses) + change detection |
123	| XRPSCAN | PAYG / Enterprise | 0.0001 XRP/req beyond free 10k/day; $4,999/mo Enterprise |
124	| XRPLAnalytics | API | $0 / $9 / $29 per month tiers |
125	| Etherscan | `exportaddresstags` bulk export | Enterprise-tier PRO only (third-party lists up to $899/mo) |
126	
127	Paid vendors sell exactly what free data lacks: maintained deposit-address ranges and named-cluster attribution at scale.
128	
129	## 7. Open questions handed to build sessions
130	
131	1. Behavioral hot/cold inference for ETH numbered wallets and BTC reserves (outflow-frequency heuristics) — no free source splits them.
132	2. Mitigating unlabeled per-user deposits at Coinbase/Kraken/OKX/Bybit on ETH (label-prefix roll-up only works for Binance/Deribit/Bitget).
133	3. Event-based issuer detection wiring: USDT `Issuance` events, CCTP `BurnMessage`/`Mint` — versus address-list matching.
134	4. OLI attester allowlist selection before trusting community labels.
135	5. Label-refresh cadence and monitoring per source (BitMEX ~twice weekly, eth-labels commit watch, Bithomp `services/lastUpdate`, XRPSCAN re-pull).
136	6. Threshold + alert presentation for BTC's probabilistic "likely exchange deposit" scores.
137	7. Confirm XRPSCAN names licensing if labels are ever republished (internal alerting assumed safe).
138	