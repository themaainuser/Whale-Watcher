CREATE TABLE IF NOT EXISTS accounts (
  id              BIGSERIAL PRIMARY KEY,
  chain           TEXT NOT NULL,
  address         TEXT NOT NULL,
  cluster_id      TEXT,
  destination_tag INT,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, address)
);

CREATE INDEX IF NOT EXISTS idx_accounts_cluster
  ON accounts (chain, cluster_id) WHERE cluster_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS label_assignments (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN (
    'exchange_hot', 'exchange_cold_reserve', 'exchange_deposit', 'issuer_treasury',
    'bridge', 'custodian', 'market_maker', 'etf_prime_vehicle', 'protocol_infra', 'unknown'
  )),
  label      TEXT NOT NULL,
  source     TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('verified', 'heuristic', 'community')),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, category, label, source)
);

CREATE INDEX IF NOT EXISTS idx_assignments_account ON label_assignments (account_id);

CREATE TABLE IF NOT EXISTS asset_thresholds (
  chain      TEXT NOT NULL,
  asset      TEXT NOT NULL,
  min_amount NUMERIC(38, 8),
  min_usd    NUMERIC(38, 2),
  PRIMARY KEY (chain, asset),
  CHECK (min_amount IS NOT NULL OR min_usd IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS transfers (
  id           BIGSERIAL PRIMARY KEY,
  chain        TEXT NOT NULL,
  asset        TEXT NOT NULL,
  tx_hash      TEXT NOT NULL,
  log_index    INT NOT NULL DEFAULT 0,
  block_height BIGINT,
  from_address TEXT NOT NULL,
  to_address   TEXT,
  amount       NUMERIC(38, 18) NOT NULL,
  usd_value    NUMERIC(38, 2),
  direction    TEXT NOT NULL CHECK (direction IN (
    'to_exchange', 'from_exchange', 'exchange_to_exchange', 'wallet_to_wallet'
  )),
  occurred_at  TIMESTAMPTZ NOT NULL,
  seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_transfers_time ON transfers (occurred_at);
CREATE INDEX IF NOT EXISTS idx_transfers_direction ON transfers (chain, direction, occurred_at);

CREATE TABLE IF NOT EXISTS alerts (
  id          BIGSERIAL PRIMARY KEY,
  transfer_id BIGINT NOT NULL REFERENCES transfers(id),
  channel     TEXT NOT NULL DEFAULT 'telegram',
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, channel)
);

CREATE TABLE IF NOT EXISTS price_cache (
  asset      TEXT PRIMARY KEY,
  usd_price  NUMERIC(38, 12) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL
);

INSERT INTO asset_thresholds (chain, asset, min_amount, min_usd) VALUES
  ('bitcoin',  'BTC',  100,     NULL),
  ('ethereum', 'ETH',  1000,    NULL),
  ('xrpl',     'XRP',  5000000, NULL),
  ('ethereum', 'USDT', NULL,    1000000),
  ('ethereum', 'USDC', NULL,    1000000)
ON CONFLICT DO NOTHING;
