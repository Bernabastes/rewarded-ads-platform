-- CreateEnum
CREATE TYPE "AgeVerificationStatus" AS ENUM ('pending', 'verified_adult', 'rejected');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'banned');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('am', 'en', 'om', 'ti');

-- CreateEnum
CREATE TYPE "AdvertiserVerificationStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'pending_review', 'active', 'paused', 'completed', 'rejected');

-- CreateEnum
CREATE TYPE "TargetActionType" AS ENUM ('video_view', 'survey', 'app_install');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('video', 'image');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "WatchSessionStatus" AS ENUM ('active', 'completed', 'rejected', 'abandoned', 'expired');

-- CreateEnum
CREATE TYPE "CompletionStatus" AS ENUM ('valid', 'flagged', 'rejected');

-- CreateEnum
CREATE TYPE "LedgerSourceType" AS ENUM ('ad_view', 'survey', 'app_install', 'withdrawal', 'withdrawal_reversal', 'admin_adjustment', 'reconciliation');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('telebirr', 'bank', 'cbe_birr');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'flagged_for_review', 'rejected');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('approved', 'rejected');

-- CreateEnum
CREATE TYPE "FraudSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "FraudResolution" AS ENUM ('dismissed', 'escalated', 'confirmed');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('super_admin', 'ad_reviewer', 'support', 'finance');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('admin', 'system', 'user', 'advertiser');

-- CreateEnum
CREATE TYPE "AuthSubjectType" AS ENUM ('user', 'advertiser', 'admin');

-- CreateEnum
CREATE TYPE "CoinAdjustmentStatus" AS ENUM ('pending_approval', 'executed', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "AdvertiserLedgerEntryType" AS ENUM ('topup', 'campaign_budget_reservation', 'campaign_budget_refund', 'adjustment');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('issued', 'paid', 'void');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('reward_confirmed', 'reward_flagged', 'withdrawal_status', 'new_offer', 'account_status', 'system');

-- CreateEnum
CREATE TYPE "PushStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('android', 'ios', 'web');

-- CreateEnum
CREATE TYPE "AdReportReason" AS ENUM ('inappropriate', 'misleading', 'broken_media', 'offensive', 'banned_topic', 'other');

-- CreateEnum
CREATE TYPE "AdReportStatus" AS ENUM ('open', 'reviewed', 'dismissed');

-- CreateEnum
CREATE TYPE "OfferCompletionStatus" AS ENUM ('pending_verification', 'valid', 'flagged', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone_number" TEXT NOT NULL,
    "phone_verified_at" TIMESTAMP(3),
    "full_name" TEXT,
    "date_of_birth" DATE,
    "age_verification_status" "AgeVerificationStatus" NOT NULL DEFAULT 'pending',
    "device_id" TEXT,
    "password_hash" TEXT,
    "language_preference" "Language" NOT NULL DEFAULT 'am',
    "coin_balance" INTEGER NOT NULL DEFAULT 0,
    "trust_score" INTEGER NOT NULL DEFAULT 50,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "status_reason" TEXT,
    "notification_prefs" JSONB NOT NULL DEFAULT '{"rewards":true,"withdrawals":true,"offers":true}',
    "last_login_at" TIMESTAMP(3),
    "last_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "phone_number" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "subject_type" "AuthSubjectType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" UUID,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertisers" (
    "id" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "business_registration_number" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "verification_status" "AdvertiserVerificationStatus" NOT NULL DEFAULT 'pending',
    "verification_note" TEXT,
    "verified_by" UUID,
    "verified_at" TIMESTAMP(3),
    "wallet_balance_etb" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertisers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertiser_wallet_ledger" (
    "id" UUID NOT NULL,
    "advertiser_id" UUID NOT NULL,
    "amount_etb" DECIMAL(12,2) NOT NULL,
    "balance_after_etb" DECIMAL(12,2) NOT NULL,
    "entry_type" "AdvertiserLedgerEntryType" NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "idempotency_key" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advertiser_wallet_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertiser_payments" (
    "id" UUID NOT NULL,
    "advertiser_id" UUID NOT NULL,
    "amount_etb" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ETB',
    "gateway" TEXT NOT NULL DEFAULT 'chapa',
    "tx_ref" TEXT NOT NULL,
    "gateway_reference" TEXT,
    "checkout_url" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "mock" BOOLEAN NOT NULL DEFAULT false,
    "raw_webhook" JSONB,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertiser_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "advertiser_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'issued',
    "subtotal_etb" DECIMAL(12,2) NOT NULL,
    "vat_etb" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_etb" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ETB',
    "line_items" JSONB NOT NULL,
    "payment_id" UUID,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "advertiser_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "budget_etb" DECIMAL(12,2) NOT NULL,
    "spent_etb" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "start_date" DATE,
    "end_date" DATE,
    "target_action_type" "TargetActionType" NOT NULL,
    "cost_per_action_etb" DECIMAL(12,2) NOT NULL,
    "reward_per_action_etb" DECIMAL(12,2) NOT NULL,
    "take_rate_snapshot" DECIMAL(5,4) NOT NULL,
    "attention_check_enabled" BOOLEAN NOT NULL DEFAULT true,
    "submitted_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" UUID,
    "rejection_reason" TEXT,
    "paused_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "budget_reserved_etb" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "media_url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "storage_key" TEXT,
    "media_type" "MediaType" NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "review_note" TEXT,
    "banned_topics_checklist" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attention_questions" (
    "id" UUID NOT NULL,
    "ad_id" UUID NOT NULL,
    "prompt" TEXT NOT NULL,
    "prompt_am" TEXT,
    "options" JSONB NOT NULL,
    "correct_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attention_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_watch_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ad_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_heartbeat_at" TIMESTAMP(3),
    "heartbeat_count" INTEGER NOT NULL DEFAULT 0,
    "expected_duration_seconds" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "device_fingerprint" TEXT NOT NULL,
    "device_id" TEXT,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT,
    "status" "WatchSessionStatus" NOT NULL DEFAULT 'active',
    "attention_question_id" UUID,
    "completed_at" TIMESTAMP(3),
    "rejection_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_watch_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_completions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ad_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "watch_session_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "watch_duration_seconds" INTEGER NOT NULL,
    "server_verified" BOOLEAN NOT NULL DEFAULT true,
    "device_fingerprint" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "fraud_flags" JSONB NOT NULL DEFAULT '[]',
    "fraud_score" INTEGER NOT NULL DEFAULT 0,
    "attention_answer_correct" BOOLEAN,
    "coin_reward_amount" INTEGER NOT NULL DEFAULT 0,
    "reward_etb" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cost_etb" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "CompletionStatus" NOT NULL,
    "rejection_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "source_type" "LedgerSourceType" NOT NULL,
    "source_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "description" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coin_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_adjustment_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "status" "CoinAdjustmentStatus" NOT NULL DEFAULT 'pending_approval',
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "rejected_by" UUID,
    "decision_note" TEXT,
    "ledger_entry_id" UUID,
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coin_adjustment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_reconciliation_runs" (
    "id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "users_checked" INTEGER NOT NULL DEFAULT 0,
    "drift_count" INTEGER NOT NULL DEFAULT 0,
    "drifts" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,

    CONSTRAINT "ledger_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount_etb" DECIMAL(12,2) NOT NULL,
    "coin_amount" INTEGER NOT NULL,
    "payout_method" "PayoutMethod" NOT NULL,
    "payout_destination" TEXT NOT NULL,
    "destination_name" TEXT,
    "bank_code" TEXT,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'pending',
    "review_reasons" JSONB NOT NULL DEFAULT '[]',
    "is_first_withdrawal" BOOLEAN NOT NULL DEFAULT false,
    "requires_dual_approval" BOOLEAN NOT NULL DEFAULT false,
    "review_note" TEXT,
    "failure_reason" TEXT,
    "provider_name" TEXT,
    "provider_payout_id" TEXT,
    "provider_status_raw" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ledger_hold_entry_id" UUID,
    "ledger_reversal_entry_id" UUID,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "processed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_approvals" (
    "id" UUID NOT NULL,
    "withdrawal_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surveys" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "details" JSONB NOT NULL,
    "reward_etb" DECIMAL(12,2) NOT NULL,
    "estimated_minutes" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "max_responses" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "coin_reward" INTEGER NOT NULL DEFAULT 0,
    "status" "OfferCompletionStatus" NOT NULL DEFAULT 'valid',
    "ip_address" TEXT,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_install_offers" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "app_name" TEXT NOT NULL,
    "package_name" TEXT,
    "store_url" TEXT NOT NULL,
    "icon_url" TEXT,
    "details" JSONB NOT NULL,
    "reward_etb" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_install_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_install_completions" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_fingerprint" TEXT NOT NULL,
    "proof" TEXT,
    "status" "OfferCompletionStatus" NOT NULL DEFAULT 'pending_verification',
    "coin_reward" INTEGER NOT NULL DEFAULT 0,
    "verified_by" UUID,
    "verified_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_install_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_flags" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "related_entity_type" TEXT NOT NULL,
    "related_entity_id" UUID,
    "flag_type" TEXT NOT NULL,
    "severity" "FraudSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "trust_score_delta" INTEGER NOT NULL DEFAULT 0,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolution" "FraudResolution",
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "before_state" JSONB,
    "after_state" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "read_at" TIMESTAMP(3),
    "push_status" "PushStatus" NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_push_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "device_id" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_reports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ad_id" UUID NOT NULL,
    "reason" "AdReportReason" NOT NULL,
    "details" TEXT,
    "status" "AdReportStatus" NOT NULL DEFAULT 'open',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_device_id_idx" ON "users"("device_id");

-- CreateIndex
CREATE INDEX "users_trust_score_idx" ON "users"("trust_score");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "otp_codes_phone_number_created_at_idx" ON "otp_codes"("phone_number", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_subject_type_subject_id_idx" ON "refresh_tokens"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "advertisers_business_registration_number_key" ON "advertisers"("business_registration_number");

-- CreateIndex
CREATE UNIQUE INDEX "advertisers_contact_email_key" ON "advertisers"("contact_email");

-- CreateIndex
CREATE INDEX "advertisers_verification_status_idx" ON "advertisers"("verification_status");

-- CreateIndex
CREATE UNIQUE INDEX "advertiser_wallet_ledger_idempotency_key_key" ON "advertiser_wallet_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "advertiser_wallet_ledger_advertiser_id_created_at_idx" ON "advertiser_wallet_ledger"("advertiser_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "advertiser_payments_tx_ref_key" ON "advertiser_payments"("tx_ref");

-- CreateIndex
CREATE INDEX "advertiser_payments_advertiser_id_created_at_idx" ON "advertiser_payments"("advertiser_id", "created_at");

-- CreateIndex
CREATE INDEX "advertiser_payments_status_idx" ON "advertiser_payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_payment_id_key" ON "invoices"("payment_id");

-- CreateIndex
CREATE INDEX "invoices_advertiser_id_issued_at_idx" ON "invoices"("advertiser_id", "issued_at");

-- CreateIndex
CREATE INDEX "campaigns_advertiser_id_idx" ON "campaigns"("advertiser_id");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_target_action_type_status_idx" ON "campaigns"("target_action_type", "status");

-- CreateIndex
CREATE INDEX "ads_campaign_id_idx" ON "ads"("campaign_id");

-- CreateIndex
CREATE INDEX "ads_review_status_idx" ON "ads"("review_status");

-- CreateIndex
CREATE INDEX "attention_questions_ad_id_idx" ON "attention_questions"("ad_id");

-- CreateIndex
CREATE INDEX "ad_watch_sessions_user_id_ad_id_started_at_idx" ON "ad_watch_sessions"("user_id", "ad_id", "started_at");

-- CreateIndex
CREATE INDEX "ad_watch_sessions_device_fingerprint_idx" ON "ad_watch_sessions"("device_fingerprint");

-- CreateIndex
CREATE INDEX "ad_watch_sessions_ip_address_started_at_idx" ON "ad_watch_sessions"("ip_address", "started_at");

-- CreateIndex
CREATE INDEX "ad_watch_sessions_status_expires_at_idx" ON "ad_watch_sessions"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "ad_completions_watch_session_id_key" ON "ad_completions"("watch_session_id");

-- CreateIndex
CREATE INDEX "ad_completions_user_id_ad_id_idx" ON "ad_completions"("user_id", "ad_id");

-- CreateIndex
CREATE INDEX "ad_completions_user_id_completed_at_idx" ON "ad_completions"("user_id", "completed_at");

-- CreateIndex
CREATE INDEX "ad_completions_campaign_id_completed_at_idx" ON "ad_completions"("campaign_id", "completed_at");

-- CreateIndex
CREATE INDEX "ad_completions_campaign_id_status_idx" ON "ad_completions"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "ad_completions_device_fingerprint_idx" ON "ad_completions"("device_fingerprint");

-- CreateIndex
CREATE INDEX "ad_completions_ip_address_completed_at_idx" ON "ad_completions"("ip_address", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "coin_ledger_idempotency_key_key" ON "coin_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "coin_ledger_user_id_created_at_idx" ON "coin_ledger"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "coin_ledger_source_type_source_id_idx" ON "coin_ledger"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "coin_adjustment_requests_ledger_entry_id_key" ON "coin_adjustment_requests"("ledger_entry_id");

-- CreateIndex
CREATE INDEX "coin_adjustment_requests_status_created_at_idx" ON "coin_adjustment_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "coin_adjustment_requests_user_id_idx" ON "coin_adjustment_requests"("user_id");

-- CreateIndex
CREATE INDEX "ledger_reconciliation_runs_started_at_idx" ON "ledger_reconciliation_runs"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_ledger_hold_entry_id_key" ON "withdrawals"("ledger_hold_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_ledger_reversal_entry_id_key" ON "withdrawals"("ledger_reversal_entry_id");

-- CreateIndex
CREATE INDEX "withdrawals_user_id_requested_at_idx" ON "withdrawals"("user_id", "requested_at");

-- CreateIndex
CREATE INDEX "withdrawals_status_requested_at_idx" ON "withdrawals"("status", "requested_at");

-- CreateIndex
CREATE INDEX "withdrawals_provider_payout_id_idx" ON "withdrawals"("provider_payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_approvals_withdrawal_id_admin_id_key" ON "withdrawal_approvals"("withdrawal_id", "admin_id");

-- CreateIndex
CREATE INDEX "surveys_campaign_id_idx" ON "surveys"("campaign_id");

-- CreateIndex
CREATE INDEX "surveys_active_idx" ON "surveys"("active");

-- CreateIndex
CREATE INDEX "survey_responses_user_id_completed_at_idx" ON "survey_responses"("user_id", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "survey_responses_survey_id_user_id_key" ON "survey_responses"("survey_id", "user_id");

-- CreateIndex
CREATE INDEX "app_install_offers_campaign_id_idx" ON "app_install_offers"("campaign_id");

-- CreateIndex
CREATE INDEX "app_install_offers_active_idx" ON "app_install_offers"("active");

-- CreateIndex
CREATE INDEX "app_install_completions_status_idx" ON "app_install_completions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "app_install_completions_offer_id_user_id_key" ON "app_install_completions"("offer_id", "user_id");

-- CreateIndex
CREATE INDEX "fraud_flags_user_id_created_at_idx" ON "fraud_flags"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_flags_resolved_severity_idx" ON "fraud_flags"("resolved", "severity");

-- CreateIndex
CREATE INDEX "fraud_flags_flag_type_idx" ON "fraud_flags"("flag_type");

-- CreateIndex
CREATE INDEX "fraud_flags_related_entity_type_related_entity_id_idx" ON "fraud_flags"("related_entity_type", "related_entity_id");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_push_tokens_token_key" ON "device_push_tokens"("token");

-- CreateIndex
CREATE INDEX "device_push_tokens_user_id_idx" ON "device_push_tokens"("user_id");

-- CreateIndex
CREATE INDEX "ad_reports_status_created_at_idx" ON "ad_reports"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ad_reports_user_id_ad_id_key" ON "ad_reports"("user_id", "ad_id");

-- AddForeignKey
ALTER TABLE "advertiser_wallet_ledger" ADD CONSTRAINT "advertiser_wallet_ledger_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "advertisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertiser_payments" ADD CONSTRAINT "advertiser_payments_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "advertisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "advertisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "advertiser_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "advertisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attention_questions" ADD CONSTRAINT "attention_questions_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_watch_sessions" ADD CONSTRAINT "ad_watch_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_watch_sessions" ADD CONSTRAINT "ad_watch_sessions_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "ads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_watch_sessions" ADD CONSTRAINT "ad_watch_sessions_attention_question_id_fkey" FOREIGN KEY ("attention_question_id") REFERENCES "attention_questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_completions" ADD CONSTRAINT "ad_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_completions" ADD CONSTRAINT "ad_completions_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "ads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_completions" ADD CONSTRAINT "ad_completions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_completions" ADD CONSTRAINT "ad_completions_watch_session_id_fkey" FOREIGN KEY ("watch_session_id") REFERENCES "ad_watch_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_adjustment_requests" ADD CONSTRAINT "coin_adjustment_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_adjustment_requests" ADD CONSTRAINT "coin_adjustment_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_adjustment_requests" ADD CONSTRAINT "coin_adjustment_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_approvals" ADD CONSTRAINT "withdrawal_approvals_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_approvals" ADD CONSTRAINT "withdrawal_approvals_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "surveys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_install_offers" ADD CONSTRAINT "app_install_offers_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_install_completions" ADD CONSTRAINT "app_install_completions_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "app_install_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_install_completions" ADD CONSTRAINT "app_install_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_reports" ADD CONSTRAINT "ad_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_reports" ADD CONSTRAINT "ad_reports_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "ads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
