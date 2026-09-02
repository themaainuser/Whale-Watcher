1	# Specify the address-book schema requirements
2	
3	Type: grilling
4	Status: resolved
5	Blocked by: 01, 02, 03, 04
6	
7	## Question
8	
9	Given the fixed taxonomy and the surveyed per-chain realities, specify what the address book must hold so a build session can write DDL without further decisions:
10	
11	1. Identity quirks per chain — XRPL address + destination-tag pairs, BTC address sets/derivation clusters versus single addresses, EVM case-normalization.
12	2. Whether an address carries multiple labels/categories and how conflicts resolve.
13	3. Source attribution and confidence fields.
14	4. Validity windows for rotting labels.
15	5. The mapping from each category to direction-tagging behavior under the current four-direction vocabulary.
16	
17	Output: schema requirements precise enough to implement directly, recorded as the ticket's Answer.
18	
19	## Answer
20	
21	Resolved 2026-08-21 by grilling with Kartik:
22	
23	1. **Identity** — one row per chain address. EVM addresses normalize to lowercase. XRPL identity is the classic address alone; destination tags ride along as informational attributes. BTC addresses are plain rows with an optional `cluster_id` attribute (TagPacks-style membership) — no first-class cluster entity.
24	2. **Category sets** — an account carries a multi-valued set of categories from the ten-category vocabulary fixed in the taxonomy ticket; direction logic tests set membership for any `exchange_*`.
25	3. **Per-assignment provenance** — each label assignment carries source name, confidence enum (`verified` / `heuristic` / `community`), and `last_seen`. Consumers ignore assignments outside the configured freshness window.
26	4. **Conflict handling** — disagreeing sources coexist as separate assignments on the same account; nothing overwrites. The effective category set derives from live assignments.
27	5. **Direction mapping** — inherited unchanged from [Fix the account-category taxonomy](01-fix-account-category-taxonomy.md): only `exchange_*` categories create exchange endpoints.
28	
29	Sufficient for a build session to write DDL without further decisions.
30	