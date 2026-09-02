1	# Exchange-account catalog
2	
3	Label: wayfinder:map
4	
5	## Destination
6	
7	A written catalog spec at `.scratch/exchange-account-catalog/spec.md`: every type of exchange-related account on Bitcoin, Ethereum (+ ERC-20 USDT/USDC), and XRPL — what each type is, how to detect it, which free label datasets cover it, and what the Whale-Watcher address-book schema must therefore hold. The spec hands off to build sessions; no implementation lives in this map.
8	
9	## Notes
10	
11	- Domain: Whale-Watcher v1 — three chain listeners (BTC block polling, ETH Alchemy Address Activity webhook, XRPL native websocket) feed one enrich-and-filter stage (USD price → threshold → direction tag) writing to Postgres and firing Telegram alerts. See `whale_tracker_architecture.png`.
12	- Stack context: single Node/TypeScript process. Prior informal drafts assumed `address_labels(chain, address, label, category)` and directions `to_exchange / from_exchange / exchange_to_exchange / wallet_to_wallet`; this map re-decides the address book.
13	- Source appetite: free/open data first; paid vendors (Arkham, Nansen, Chainalysis, Elliptic…) recorded with prices as future upgrades only — no procurement decisions here.
14	- Taxonomy is fixed up front: the category vocabulary is pinned before research findings are organized under it.
15	- Skills: HITL tickets run `/grilling` + `/domain-modeling` (one question at a time; capture resolved terms in `CONTEXT.md`). Research tickets are AFK `/research`-style subagent work; findings live under `research/`.
16	- Tracker ops (local markdown): claim = set `Status: claimed` before work; resolve = append `## Answer`, set `Status: resolved`, then add one pointer line to Decisions so far below. Blocking = `Blocked by:` line listing ticket numbers; a ticket is takeable when all listed tickets are `resolved`.
17	
18	## Decisions so far
19	
20	- [Fix the account-category taxonomy](issues/01-fix-account-category-taxonomy.md) — ten fixed categories; only `exchange_*` are direction endpoints; categories are a multi-valued set per address
21	- [Survey ETH + stablecoin label sources](issues/02-survey-eth-stablecoin-label-sources.md) — `dawsbot/eth-labels` (MIT, ~144k rows) is the primary source; gaps: unlabeled Coinbase/Kraken/OKX per-user deposits, no free ETF/custody lists, Circle mint/burn detectable only via contract events
22	- [Survey XRPL exchange-address sources](issues/03-survey-xrpl-exchange-address-sources.md) — XRPSCAN well-known names API + Bithomp free tier; shared-address + destination-tag confirmed at major venues; Ripple escrow needs `protocol_infra` tags to avoid false alerts
23	- [Survey BTC attribution options](issues/04-survey-btc-attribution-options.md) — free = GraphSense TagPacks + BitMEX PoR list + bounded heuristics; v1 posture stays amount-threshold detection + small curated reserve list
24	- [Specify the address-book schema requirements](issues/05-specify-address-book-schema.md) — one row per address (BTC adds `cluster_id`, XRPL tags are attributes); multi-valued category sets; per-assignment source/confidence/last_seen provenance with freshness window; conflicts coexist
25	- [Assemble the catalog spec](issues/06-assemble-catalog-spec.md) — destination reached: `spec.md` written standalone (taxonomy, per-chain detection + sources, schema requirements, v1 postures, paid appendix, open questions)
26	
27	## Not yet specified
28	
29	_(clear — remaining dim areas live as open questions in `spec.md` §7; no tickets remain.)_
30	
31	## Out of scope
32	
33	- Tron, Solana, and every chain without a v1 listener.
34	- All implementation: importing datasets, tagging logic, listener/enrich code, alert routing.
35	- Paid-data procurement decisions (documented as upgrades, not chosen).
36	- True per-user BTC attribution via paid clustering APIs — upgrade path only.
37	