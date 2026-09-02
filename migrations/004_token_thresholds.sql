-- 004_token_thresholds: USD-only whale thresholds for the ERC-20s added to
-- the webhook allowlist (see src/listeners/eth.ts CONTRACTS). Sized to fire
-- at roughly >= $1M of value; SHIB/PEPE use higher USD bars because their
-- unit prices are tiny and $1M moves are routine.
-- Idempotent (ON CONFLICT DO NOTHING).

INSERT INTO asset_thresholds (chain, asset, min_amount, min_usd) VALUES
  ('ethereum', 'DAI',    NULL, 1000000),
  ('ethereum', 'WBTC',   50,   NULL),
  ('ethereum', 'LINK',   NULL, 1000000),
  ('ethereum', 'UNI',    NULL, 1000000),
  ('ethereum', 'AAVE',   NULL, 1000000),
  ('ethereum', 'CRV',    NULL, 1000000),
  ('ethereum', 'LDO',    NULL, 1000000),
  ('ethereum', 'MKR',    NULL, 1000000),
  ('ethereum', 'SHIB',   NULL, 3000000),
  ('ethereum', 'PEPE',   NULL, 3000000),
  ('ethereum', 'POL',    NULL, 1000000),
  ('ethereum', 'EIGEN',  NULL, 1000000),
  ('ethereum', 'ENA',    NULL, 1000000),
  ('ethereum', 'PEOPLE', NULL, 1000000),
  ('ethereum', 'PROVE',  NULL, 1000000)
ON CONFLICT (chain, asset) DO NOTHING;
