1	# Survey ETH + stablecoin label sources
2	
3	Type: research
4	Status: resolved
5	Blocked by:
6	
7	## Question
8	
9	Which free/open sources label Ethereum exchange accounts and stablecoin infrastructure? For each source: coverage of hot/cold/deposit wallets across major venues (Binance, Coinbase, Kraken, OKX, Bybit…), treatment of Tether/Circle treasury and mint addresses, bridges and other non-exchange entities; data format, license, freshness, and import path. Candidates to verify and go beyond: `dawsbot/eth-labels`, Etherscan label exports, other public GitHub label repos. Note paid alternatives (Arkham, Nansen, Chainalysis) with list prices as future upgrades only.
10	
11	Findings file: `research/eth-label-sources.md`. The answer names the top source(s) per account type and the coverage gaps.
12	
13	## Answer
14	
15	Top free sources per account type (full detail in `research/eth-label-sources.md`, verified 2026-08-21):
16	- **Everything exchange-related:** `dawsbot/eth-labels` (MIT, 144k rows / 113k mainnet, CSV + sqlite + free API at eth-labels.com/swagger; mirrors Etherscan label cloud). Measured coverage: Binance 5,102 (~5,014 are per-user "Binance Dep*" deposit addresses), Bitget 19k, Deribit 6k, Coinbase ~63+numbered cold wallets, Kraken 13+, OKX 12+, Bybit thin.
17	- **Hot/cold wallets:** same numbered-wallet series (`Coinbase 1..23`, `Kraken N`); no free source classifies hot vs cold — infer behaviorally.
18	- **Stablecoin infra:** canonical token/CCTP contracts from official docs (tether.to/en/supported-protocols/, developers.circle.com/stablecoins/usdc-contract-addresses); eth-labels carries `Tether: Treasury` (0x5754...949), Circle CCTP/Gateway/Deployer labels. Mint/burn detection should be event-based (USDT Issuance / CCTP BurnMessage), not address lists — no static mint addresses exist for Circle.
19	- **Bridges/MM/custodians:** eth-labels has Wormhole ×53, Wintermute ×8, Galaxy ×17, Jump ×3, BitGo ×8; OLI (openlabelsinitiative.org, EF-funded) adds an EAS-attested community pool with daily growthepie Parquet exports + BigQuery.
20	
21	Biggest gaps: per-user deposit addresses unlabeled for Coinbase/Kraken/OKX/Bybit; zero free ETF/Fireblocks custody lists; Etherscan bulk export is Enterprise-paywalled; OLI trust layer immature. Paid escape hatches: Arkham (free core), Nansen Pro ($49–69/mo), Chainalysis (enterprise, ~$175k/yr avg).
22	