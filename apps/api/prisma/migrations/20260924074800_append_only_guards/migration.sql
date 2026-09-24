-- Append-only enforcement at the database level (spec §4: coin_ledger is append-only).
-- Application code never updates or deletes these rows; this trigger makes that a hard guarantee even for
-- direct database access, ORMs, or future bugs. Deliberate, minimal vendor-specific SQL (documented in ARCHITECTURE.md).

CREATE OR REPLACE FUNCTION rap_prevent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not allowed (row id %)', TG_TABLE_NAME, TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- coin_ledger: the source of truth for user balances.
DROP TRIGGER IF EXISTS coin_ledger_append_only ON "coin_ledger";
CREATE TRIGGER coin_ledger_append_only
  BEFORE UPDATE OR DELETE ON "coin_ledger"
  FOR EACH ROW EXECUTE FUNCTION rap_prevent_mutation();

-- advertiser_wallet_ledger: the source of truth for advertiser prepaid balances.
DROP TRIGGER IF EXISTS advertiser_wallet_ledger_append_only ON "advertiser_wallet_ledger";
CREATE TRIGGER advertiser_wallet_ledger_append_only
  BEFORE UPDATE OR DELETE ON "advertiser_wallet_ledger"
  FOR EACH ROW EXECUTE FUNCTION rap_prevent_mutation();

-- audit_log: immutable trail of admin and money-relevant system actions.
DROP TRIGGER IF EXISTS audit_log_append_only ON "audit_log";
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION rap_prevent_mutation();

-- Defensive checks: cached balances and ledger running balances can never go negative.
ALTER TABLE "users" ADD CONSTRAINT users_coin_balance_non_negative CHECK (coin_balance >= 0);
ALTER TABLE "advertisers" ADD CONSTRAINT advertisers_wallet_balance_non_negative CHECK (wallet_balance_etb >= 0);
ALTER TABLE "coin_ledger" ADD CONSTRAINT coin_ledger_balance_after_non_negative CHECK (balance_after >= 0);
