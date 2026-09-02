# Whale-Watcher — The Full Story of Our Working Sessions

*Written 2026-08-25. This is the elaborated record of everything we did together: the idea, the planning detour, the research trips, the decisions, the build day, the database troubles, and the moment everything finally turned green. Technical words are kept to a minimum and explained in brackets the first time they matter.*

---

## Chapter 1 — The idea on the table

The session opened with a summary of an earlier design conversation and a single diagram (`whale_tracker_architecture.png`). The dream, in plain words:

> Build a little machine that watches three blockchains day and night. Whenever a *huge* amount of money moves, it should figure out what the move probably means, save a record of it, and send you a Telegram message so you can see it the moment it happens.

Why three chains need three separate "listeners" (the parts that watch each blockchain): every chain speaks a completely different language and offers different ways to eavesdrop.

- **Bitcoin** has no easy push-notification service, so we have to *poll* (repeatedly ask) a public block explorer — a website that exposes raw blockchain data — for every new block, and dig through its transactions.
- **Ethereum** is friendliest: a company called Alchemy offers *webhooks* (automatic HTTP pings sent to us the instant something happens) for both plain ETH moves and for transfers of the big stablecoins USDT and USDC.
- **The XRP Ledger (XRPL)** is the easiest of all: its public servers let anyone connect directly and subscribe to a live firehose of every transaction, no middleman needed.

"What counts as huge?" — instead of hardcoding numbers, we agreed on a small settings table in the database: 100+ Bitcoin, 1,000+ ETH, 5 million+ XRP, and $1 million+ for stablecoins. Change the table, change the behavior — no code edits.

The cleverest part is the *direction* question. Knowing that 5,000 ETH moved is noise; knowing it went **into** an exchange hints people are about to sell, **out of** an exchange hints someone is accumulating, and **between two exchanges** is usually just housekeeping. For that, the machine needs an *address book*: a database of known addresses labeled with who owns them. The prior conversation had already flagged the hard truth per chain: Ethereum has generous public label datasets, XRPL needs only a few dozen addresses because exchanges there reuse one shared deposit address per user (sorted by a number called a *destination tag*), and Bitcoin rotates deposit addresses constantly — so Bitcoin would start as "big transfer spotted, owner unknown."

## Chapter 2 — Choosing where to begin

Two quick questions, two answers:

1. **What should be built first?** → The database schema (the blueprint of stored data) plus the *enrich-and-filter* stage — the shared brain that prices a transfer in dollars, checks it against the thresholds, and tags its direction. All three listeners feed into this one brain, so building it first means every future listener instantly becomes useful.
2. **Which language?** → **Node.js with TypeScript** (JavaScript's runtime with types added for safety). One language for the websocket listeners, the webhook receiver, and the database code.

## Chapter 3 — The fog and the map

Then you gave the directive that reshaped everything: *"look for all types of exchange accounts."* That's a research jungle — dozens of data sources, three chains with different realities, and no shared vocabulary for what an "exchange account" even is. Too big and foggy for one working session.

So we used the **wayfinder** approach: before building, draw a *map* of the decisions that must be made, one small question per ticket (a ticket is just a tracked to-do with a question on it), stored right in the repo as plain markdown files under `scratch/exchange-account-catalog/`. There was no fancy issue tracker and no git repository, so files on disk played that role — a ticket claims itself by flipping a `Status:` line, and a ticket is "blocked" when it lists other tickets it depends on.

Four interview questions shaped the map, one at a time, each with my recommendation and your call:

| Question | Your call | What it means in practice |
|---|---|---|
| What exists when this effort is done? | **A written catalog spec** — not code | The end product is a document describing every kind of exchange account, how to detect each, which free data sources cover them, and what the database must store. Building comes after, outside this map. |
| Which chains? | **Only the three v1 chains** — Bitcoin, Ethereum (+ its USDT/USDC), XRPL | Tron (where a lot of USDT actually lives) and Solana stay out; one honest line in the "out of scope" list rather than a half-survey. |
| How do we decide the account-type vocabulary? | **Fix the categories first** | Pin the shared list of labels up front, so all research gets sorted into the same drawers. |
| Are paid data sources allowed? | **Free-first, note paid** | Build on open datasets; record what Chainalysis/Nansen/Arkham cost as "someday upgrades," never buy anything. |

## Chapter 4 — Drawing the map

The map file (`map.md`) went down first: destination at the top, standing preferences, an empty "decisions so far" index, a fog list ("not yet specified" — things we could smell but not yet name), and an out-of-scope list. Then six tickets:

1. **Fix the account-category taxonomy** — agree the label vocabulary (a human conversation, since it's a judgment call).
2. **Survey ETH + stablecoin label sources** — send a research agent to find the datasets.
3. **Survey XRPL exchange-address sources** — same for XRP.
4. **Survey BTC attribution options** — same for Bitcoin, plus the honest question of what's achievable without paid forensics.
5. **Specify the address-book schema** — turn everything learned into database requirements (blocked until 1–4 finish).
6. **Assemble the catalog spec** — the final document (blocked on 5).

One honest hiccup: the first batch of file writes silently dropped tickets 1 and 3 — they simply never landed on disk. We caught it when you said "spawn the agents," and I recreated them before anything ran. A good reminder that "wrote successfully" deserves a spot check.

## Chapter 5 — Sending out the scouts

*"Now spawn as many sub agents needed and start working."* So I did — **subagents** are independent helper sessions I can launch in parallel; each got one ticket, strict instructions to claim it first (so no double work), do the research, write a findings file, and record the answer on the ticket without touching anything else.

**The XRPL scout came back with the friendliest news.** XRPSCAN (a block explorer) exposes a free curated list of well-known accounts — exchanges, issuers, bridges — good for 10,000 lookups a day. Bithomp, another explorer, enriches any single address for free (its bulk catalog of ~1,800 addresses is paywalled at €250/month — noted for the "someday" appendix). Exchanges publish their own official addresses in a little file on their websites (the `xrp-ledger.toml` convention). And the deposit model was confirmed: Binance, Bitstamp, Coinbase, Kraken, and Bitget all use **one shared deposit address + a per-user destination tag**; a handful of addresses therefore captures most exchange flow. Two gems: Ripple's own 20 escrow wallets release up to a billion XRP on the first of each month — scheduled supply events that would look like whale moves unless tagged separately — and GateHub/Uphold are the odd ones out, giving each user a real personal address instead of a shared one.

**The Bitcoin scout returned the most sober, most valuable report.** What free data honestly achieves: a *small* reliable list of exchange reserve wallets — from GraphSense "TagPacks" (community-curated files where every label carries its source, a confidence level, and a last-updated date — exactly the provenance habits we wanted anyway), plus BitMEX, uniquely, publishing its complete wallet list twice a week for proof-of-reserves. Everything else mostly proves solvency with cryptography instead of publishing addresses. The open clustering tricks (guessing that addresses spending together share an owner, change-address detection, "peeling chain" patterns) work on free data but need heavy infrastructure for whole-chain analysis — and even then, clustering tells you *these addresses belong together*, not *this is Binance*; naming requires outside evidence. The scout's recommendation, which we adopted: keep Bitcoin whale detection attribution-free (big transfer = alert, owner unknown), maintain a small curated reserve list, optionally do a bounded 1–2 hop trace around suspicious transfers and call the result "probably an exchange deposit" — labeled as a guess.

**The Ethereum scout had a rough trip.** The first agent claimed its ticket, went silent, and produced nothing — a ghost claim. The retry (told to take over the dead claim) delivered fully: the star dataset is **`dawsbot/eth-labels`**, an MIT-licensed mirror of Etherscan's label cloud, measured at **144,378 rows** (113,194 on Ethereum mainnet). The quirks it surfaced matter a lot: Binance's labels include ~5,000 *per-user deposit addresses* (so one customer's deposit shouldn't read as five thousand separate whales — we roll them up by venue), Deribit and Bitget are similar, while Coinbase/Kraken/OKX run small numbered wallet families and leave their per-user deposits unlabeled (our biggest future false-alarm source). No free source splits hot wallets from cold reserves — that takes behavioral inference. And Circle's USDC mint/burn has *no single address at all* — it happens inside smart contracts, so it must be detected by watching contract events, not by a label list.

## Chapter 6 — Naming things: the ten categories

With research in hand, the taxonomy conversation ran as three one-at-a-time questions:

1. **The skeleton.** You accepted the proposed **ten categories**: `exchange_hot` (the venue's spending wallet), `exchange_cold_reserve` (the vault), `exchange_deposit` (where users send money), `issuer_treasury` (Tether/Circle's mint machinery), `bridge` (chains-to-chains movers), `custodian` (professional key-holders like Fireblocks), `market_maker` (trading firms like Wintermute), `etf_prime_vehicle` (fund reserve wallets), `protocol_infra` (chain-native machinery like Ripple's escrow — added precisely because the XRPL scout showed these fire false whale alerts every month), and `unknown`.
2. **Who counts as "an exchange" for direction tagging?** Only the three `exchange_*` categories. Everything else is recorded for information but never turns a transfer into "to exchange" or "from exchange" — a Tether mint shouldn't masquerade as sell pressure.
3. **One label or many per address?** Your first answer to this got lost in a messy tool exchange on my side (a concurrent research task swallowed the reply) — I re-asked, and you chose **multi-valued**: an address can wear several hats at once, and the direction logic just checks whether *any* exchange-ish label is present.

Every resolved term went straight into a plain-English glossary at the repo root (`CONTEXT.md`), because shared vocabulary is only real once it's written down.

## Chapter 7 — Designing the address book

Ticket 5 turned findings into database requirements through three more forks:

- **Bitcoin's cluster reality** → flat rows: one row per address, with an optional `cluster_id` column (a group identifier borrowed from TagPacks) riding along. No fancy separate "cluster" tables — simplest thing that keeps the data.
- **XRPL's shared-address world** → the address alone is the identity. Destination tags are details *about* an address, not part of its name. This matches how the venues actually work and avoids thousands of near-duplicate rows.
- **Trust and staleness** → every label assignment carries its **source**, a **confidence level** (`verified` / `heuristic` / `community`), and a **last-seen** timestamp; anything older than the freshness window is ignored. When two sources disagree, both assignments coexist — nothing gets overwritten, and the effective label set is derived from whatever is still fresh.

## Chapter 8 — The catalog spec

The final ticket was assembly. Its subagent stalled *twice* (once silently, once announcing "now writing the spec" and then quitting). Rather than roll the dice a third time, I read all three research files in full and wrote the destination document myself: **`scratch/exchange-account-catalog/spec.md`** — seven sections covering purpose and scope, the taxonomy, per-chain detection guidance with sources and licenses, the database requirements, per-chain "v1 posture" recommendations, the paid-upgrade appendix with prices (Chainalysis ~$25k–$300k/yr, Bithomp €250/mo, Nansen $49–69/mo…), and seven open questions handed to future build sessions. With that, every ticket was closed, the fog list was empty, and the map was done.

## Chapter 9 — From plan to machine (build day)

*"Tell me what's pending, and if all is sorted, start implementing with as many subagents as you can spawn."* Planning was done; nothing was built. Time to build.

To let four agents work **in parallel without trampling each other**, I first wrote the shared skeleton myself: `package.json` and `tsconfig.json` (project config), `.env.example` (the settings template), the full database blueprint (`migrations/001_init.sql` — accounts, label assignments with provenance, thresholds, transfers, alerts, price cache), and `src/types.ts` (the shared TypeScript shapes every other file imports). With the contracts pinned, exact API signatures could go into every agent's instructions, so they'd fit together like pre-cut joinery.

Then four builders ran simultaneously, each owning strictly its own files:

- **Builder 1 — the database layer** (`src/db.ts`, `src/migrate.ts`): the pool of database connections, saving transfers so replays can't duplicate them, reading fresh labels, batch-upserting imported labels inside a transaction.
- **Builder 2 — the brain and the voice** (`src/prices.ts`, `src/enrich.ts`, `src/telegram.ts`, `src/index.ts`): dollar pricing via CoinGecko with a 5-minute cache, the enrich-and-filter logic exactly as decided (threshold pass → direction via label sets → save → alert), Telegram sending with a safe dry-run mode when no token is configured, and the main entrypoint that wires the three listeners to the brain.
- **Builder 3 — the label importers** (`src/importers/*`): four loaders that pour the free datasets into our address book — the eth-labels CSV (with venue-name cleanup so "Binance Dep-123" becomes venue "Binance"), the XRPSCAN well-known list, Ripple's TOML file (escrow wallets tagged `protocol_infra`), and the GraphSense TagPacks.
- **Builder 4 — the listeners** (`src/listeners/*`): the XRPL websocket with auto-reconnect, the Bitcoin block poller — which checks the clock and polls every 20 seconds during the 13:00–17:00 UTC **London–New York session overlap** (your peak-liquidity window, 5:30–10:30 PM IST) and every 60 seconds otherwise — and the Ethereum webhook receiver with an optional shared-secret check.

## Chapter 10 — The Postgres adventure

Verification needed a real database. Your machine has **PostgreSQL 18 running** — but its password is yours alone, and I wasn't going to guess further after one failed try. You said: *create a test server with default credentials.*

Attempt one: build a second, throwaway cluster from the installed PostgreSQL 18 binaries in a temp folder. It initialized fine, started fine, accepted connections… and then every worker crashed the moment it touched data with "could not reserve shared memory region — error 487." That's a known Windows memory-address conflict (the system's address-randomization security feature lands PostgreSQL's memory where it can't map it). The classic fix — disabling dynamic shared memory — turned out to be *removed* in PostgreSQL 18 on Windows ("available values: windows"), and the mmap alternative was rejected the same way. Dead end, cleanly diagnosed from the logs.

Attempt two worked first try: **Docker** (a container runner) wasn't awake, so I launched Docker Desktop, the engine came up in seconds, and a tiny **Postgres 17 Linux container** (`whale-pg`, user `postgres`, password `postgres`, port 5433) pulled and started. Migrations applied on the first run. Problem solved — and it cost your real database nothing.

## Chapter 11 — Teaching the machine about exchanges (importer debugging)

The first importer run: XRPSCAN loaded 296 labels and Ripple's TOML 20 on the first try, but two importers stumbled.

- **eth-labels** choked mid-file: a malformed quoted field around row 93,623 of the real-world CSV. The first patch (`relax`) was the wrong knob — csv-parse v5 split this behavior into a separate option — so the fix became `relax_quotes` (tolerate imperfect quoting). After that it sailed through: **113,194 labels imported — matching the research measurement to the digit.**
- **TagPacks** imported zero, which meant my assumptions about its file layout were wrong, not the network. Fetching a real pack revealed the truth: category, source, confidence, and the cluster id live at the **pack level** (the top of each file), not on each address line — and the repository had also been restructured (the exchange packs sit directly under `packs/`, thirteen files named `exchange-wallets-*`). The importer was rewritten around the real shape, mapping the packs' own confidence words (`service_data` → verified, public sources → heuristic) and even splitting reserve-sounding packs into `exchange_cold_reserve`. Result: **169 curated exchange wallets across 11 sources**, each with its provenance URL and cluster id.

## Chapter 12 — The green board

Final state, all verified live:

- **Typecheck: zero errors** across every file the four builders wrote.
- **Address book:** 95,056 label assignments in the database — 94,537 from eth-labels, 296 XRPSCAN, 169 GraphSense (with source URLs like Binance's own transparency post as provenance), 20 Ripple escrow/RLUSD. By category: 24,290 deposit addresses, 6,715 hot wallets, 327 cold reserves, 1,616 bridges, 484 issuer treasuries, 33 market makers, 8 custodians, 20 protocol-infrastructure addresses.
- **The end-to-end smoke test passed**: a fake transfer of 1,500 ETH entered the brain, the live CoinGecko price made it ~$3.73M, it cleared the 1,000-ETH threshold, got tagged `wallet_to_wallet` (its addresses are deliberately unlabeled nobodies), was written to `transfers`, an alert row was recorded, and the Telegram message rendered exactly as designed:
  > 🐋 1,500 ETH (~$3.7M)
  > 0x0000…0001 → 0x0000…0002 [wallet_to_wallet]
  > https://etherscan.io/tx/0xsmoke…

**How to drive it:** `npm run migrate` → `npm run import all` → `npm run start` (all three listeners; Telegram messages fire once your token is in `.env`). The test database is the Docker container: `docker start whale-pg` / `docker stop whale-pg`.

## Chapter 13 — What's next

1. Make Telegram real: create the bot with @BotFather, paste the token and your chat id into `.env`, restart.
2. Let it run — the XRPL listener will produce real whale events immediately; the Ethereum webhook wants an Alchemy account; Bitcoin needs nothing but patience.
3. Someday list (deliberately not built): behavioral hot/cold splitting, probabilistic Bitcoin deposit scoring, OLI community labels with trust filtering, and the paid-data upgrades cataloged in the spec's appendix.
