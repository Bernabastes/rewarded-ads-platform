-- Phase 5: security remediation (audit findings #1, #5, #7, #12, pentest A3a)

-- #1 campaign budget reservation replay: every submit gets a new sequence number that keys the wallet entries.
ALTER TABLE "campaigns" ADD COLUMN "submission_seq" INTEGER NOT NULL DEFAULT 0;

-- #7 payout ambiguity: provider outcome unknown -> coins stay held until finance confirms.
ALTER TYPE "WithdrawalStatus" ADD VALUE 'needs_manual_review';

-- #5 admin MFA + credential management.
ALTER TABLE "admin_users"
  ADD COLUMN "mfa_secret" TEXT,
  ADD COLUMN "mfa_enabled_at" TIMESTAMP(3),
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "password_changed_at" TIMESTAMP(3),
  ADD COLUMN "created_by" UUID;

-- A3a attention-check guessing: per-session option shuffle.
ALTER TABLE "ad_watch_sessions" ADD COLUMN "attention_option_order" JSONB;
