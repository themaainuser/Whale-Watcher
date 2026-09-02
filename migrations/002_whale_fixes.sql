-- 002_whale_fixes: alert outbox + XRPL destination tags
-- Safe to re-run; every statement is idempotent.

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS message TEXT;

ALTER TABLE transfers ADD COLUMN IF NOT EXISTS destination_tag INT;
