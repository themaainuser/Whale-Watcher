-- 003_outbox_sent_at_fix: align alerts.sent_at with the outbox pattern.
-- The 2026-08-26 outbox design inserts alerts without sent_at and drains
-- rows WHERE sent_at IS NULL, but 001 declared
--   sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
-- so every alert was born 'sent' and the drain never had work. Both
-- statements are idempotent (no-ops if already relaxed).
-- Rows predating this fix with sent_at set are indistinguishable from
-- delivered ones; left as-is (forward-looking fix).

ALTER TABLE alerts ALTER COLUMN sent_at DROP NOT NULL;
ALTER TABLE alerts ALTER COLUMN sent_at DROP DEFAULT;
