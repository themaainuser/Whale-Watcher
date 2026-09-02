1	# Survey XRPL exchange-address sources
2	
3	Type: research
4	Status: resolved
5	Blocked by:
6	
7	## Question
8	
9	Which free sources identify XRPL exchange accounts (Bithomp, XRPSCAN, exchange help-center docs)? For the major venues (Binance, Bitstamp, Uphold, Gatehub…): how are deposits structured — shared address + destination tag versus per-user addresses — and does any canonical public list exist? Are Ripple escrow/ODL addresses worth tagging as a separate category? Note paid options with prices as future upgrades only.
10	
11	Findings file: `research/xrpl-label-sources.md`. The answer names usable free sources and describes deposit-address mechanics per major venue.
12	
13	## Answer
14	
15	Researched 2026-08-21; full detail in `research/xrpl-label-sources.md`.
16	
17	**Free label sources**
18	- **XRPSCAN** `GET https://api.xrpscan.com/api/v1/names/well-known` — public curated list of exchange/bridge/issuer accounts (name, domain, twitter, verified). Free API tier 10k req/day; PAYG 0.0001 XRP/req; Enterprise $4,999/mo. Redistribution license undocumented.
19	- **Bithomp API v2** — per-address enrichment free (non-commercial: 10 req/min, 2K/day) via `/v2/address/{addr}?username=true&service=true&parent=true`. The bulk services catalog (~475 services / ~1.8k addresses, `/v2/services*`) is **Premium-only €250/mo**.
20	- **XRPL.org** source-and-destination-tags doc — canonical hosted-account/RequireDest/X-address explanation.
21	- **xrp-ledger.toml files** — primary self-published account lists (Ripple's includes all 20 escrow wallets + RLUSD issuer).
22	- **No canonical GitHub list exists** — only codec/tooling repos; third-party dashboards (xrpldashboard, xrp-insights, xrplanalytics) all derive from XRPSCAN/Bithomp/TOML.
23	
24	**Deposit models**: shared address + destination tag is the norm — confirmed for Binance, Bitstamp, Coinbase, Kraken, Bitget. Exceptions: **GateHub** gives each user their own on-ledger wallet (no tag needed); **Uphold** moved to unique per-user XRP addresses (tag still routes to card; old pool address phasing out). A few dozen labeled hot/cold wallets capture most CEX flow (they dominate the rich-list top). Missing tag at shared venues → not auto-credited, manual support recovery; RequireDest venues bounce it on-ledger. Tags are off-ledger bookkeeping only — venue-level attribution works without them.
25	
26	**Ripple category**: yes, tag separately. 20 escrow wallets in ripple.com TOML release ≤1B XRP on the 1st monthly (~32.3B still locked) — scheduled supply events, not whale behavior. ODL has no fixed addresses; flows ride partner-exchange hot wallets (Bitstamp USD / Bitso MXN).
27	
28	**Paid appendix**: Bithomp Premium €250/mo (bulk catalog); XRPSCAN Enterprise $4,999/mo + Console (contact); XRPLAnalytics $9–29/mo.
29	