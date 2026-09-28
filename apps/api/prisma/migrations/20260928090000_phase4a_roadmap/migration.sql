-- CreateEnum
CREATE TYPE "KycTier" AS ENUM ('phone_only', 'id_verified');

-- CreateEnum
CREATE TYPE "KycIdType" AS ENUM ('fayda', 'national_id', 'passport');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "LegalDocumentKind" AS ENUM ('terms', 'privacy');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'qualified', 'paid', 'rejected');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('processing', 'ready', 'duration_corrected', 'failed');

-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "DeletionRequestStatus" AS ENUM ('pending', 'executed', 'cancelled');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('login', 'destination_change');

-- AlterEnum
ALTER TYPE "LedgerSourceType" ADD VALUE 'referral';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'kyc_status';
ALTER TYPE "NotificationType" ADD VALUE 'referral';
ALTER TYPE "NotificationType" ADD VALUE 'data_export';
ALTER TYPE "NotificationType" ADD VALUE 'account_deletion';

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'deleted';

-- AlterTable
ALTER TABLE "ads" ADD COLUMN     "duration_declared_seconds" INTEGER,
ADD COLUMN     "duration_probed_seconds" INTEGER,
ADD COLUMN     "media_error" TEXT,
ADD COLUMN     "media_probe" JSONB,
ADD COLUMN     "media_processed_at" TIMESTAMP(3),
ADD COLUMN     "media_status" "MediaStatus" NOT NULL DEFAULT 'ready',
ADD COLUMN     "original_media_url" TEXT,
ADD COLUMN     "transcoded_storage_key" TEXT;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "frequency_cap_per_user_per_day" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "otp_codes" ADD COLUMN     "purpose" "OtpPurpose" NOT NULL DEFAULT 'login';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "anonymized_at" TIMESTAMP(3),
ADD COLUMN     "kyc_tier" "KycTier" NOT NULL DEFAULT 'phone_only',
ADD COLUMN     "referral_code" TEXT,
ADD COLUMN     "signup_device_fingerprint" TEXT,
ADD COLUMN     "signup_ip" TEXT;

-- AlterTable
ALTER TABLE "withdrawals" ADD COLUMN     "destination_account_name" TEXT,
ADD COLUMN     "destination_verified_at" TIMESTAMP(3),
ADD COLUMN     "payout_destination_id" UUID;

-- CreateTable
CREATE TABLE "payout_destinations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "payout_method" "PayoutMethod" NOT NULL,
    "destination" TEXT NOT NULL,
    "bank_code" TEXT,
    "account_name" TEXT,
    "provider_name" TEXT,
    "provider_mock" BOOLEAN NOT NULL DEFAULT true,
    "verified_at" TIMESTAMP(3),
    "otp_verified_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "actor_type" "AuthSubjectType" NOT NULL,
    "actor_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL DEFAULT 0,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_submissions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "id_type" "KycIdType" NOT NULL,
    "id_number_hash" TEXT NOT NULL,
    "id_number_last4" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "document_front_key" TEXT NOT NULL,
    "document_back_key" TEXT,
    "selfie_key" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'pending',
    "provider_name" TEXT,
    "provider_result" JSONB,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" UUID NOT NULL,
    "kind" "LegalDocumentKind" NOT NULL,
    "version" TEXT NOT NULL,
    "locale" "Language" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "content_markdown" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "LegalDocumentKind" NOT NULL,
    "version" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "device_id" TEXT,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertiser_consents" (
    "id" UUID NOT NULL,
    "advertiser_id" UUID NOT NULL,
    "kind" "LegalDocumentKind" NOT NULL,
    "version" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,

    CONSTRAINT "advertiser_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_alerts" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupe_key" TEXT,
    "deliveries" JSONB,
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "referrer_id" UUID NOT NULL,
    "referee_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "referrer_bonus_coins" INTEGER NOT NULL DEFAULT 0,
    "referee_bonus_coins" INTEGER NOT NULL DEFAULT 0,
    "qualifying_completion_id" UUID,
    "qualified_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "signup_ip" TEXT,
    "signup_device_fingerprint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_export_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'pending',
    "storage_key" TEXT,
    "size_bytes" INTEGER,
    "error" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_deletion_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "DeletionRequestStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "executed_at" TIMESTAMP(3),
    "executed_by" UUID,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" UUID,
    "note" TEXT,
    "ip_address" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_destinations_user_id_last_used_at_idx" ON "payout_destinations"("user_id", "last_used_at");

-- CreateIndex
CREATE UNIQUE INDEX "payout_destinations_user_id_payout_method_destination_key" ON "payout_destinations"("user_id", "payout_method", "destination");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_actor_type_actor_id_key_key" ON "idempotency_keys"("actor_type", "actor_id", "key");

-- CreateIndex
CREATE INDEX "kyc_submissions_user_id_created_at_idx" ON "kyc_submissions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "kyc_submissions_status_created_at_idx" ON "kyc_submissions"("status", "created_at");

-- CreateIndex
CREATE INDEX "kyc_submissions_id_number_hash_idx" ON "kyc_submissions"("id_number_hash");

-- CreateIndex
CREATE INDEX "legal_documents_kind_published_at_idx" ON "legal_documents"("kind", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_kind_version_locale_key" ON "legal_documents"("kind", "version", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "user_consents_user_id_kind_version_key" ON "user_consents"("user_id", "kind", "version");

-- CreateIndex
CREATE UNIQUE INDEX "advertiser_consents_advertiser_id_kind_version_key" ON "advertiser_consents"("advertiser_id", "kind", "version");

-- CreateIndex
CREATE INDEX "platform_alerts_created_at_idx" ON "platform_alerts"("created_at");

-- CreateIndex
CREATE INDEX "platform_alerts_type_created_at_idx" ON "platform_alerts"("type", "created_at");

-- CreateIndex
CREATE INDEX "platform_alerts_acknowledged_at_idx" ON "platform_alerts"("acknowledged_at");

-- CreateIndex
CREATE INDEX "platform_alerts_dedupe_key_created_at_idx" ON "platform_alerts"("dedupe_key", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referee_id_key" ON "referrals"("referee_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_created_at_idx" ON "referrals"("referrer_id", "created_at");

-- CreateIndex
CREATE INDEX "referrals_status_created_at_idx" ON "referrals"("status", "created_at");

-- CreateIndex
CREATE INDEX "data_export_requests_user_id_requested_at_idx" ON "data_export_requests"("user_id", "requested_at");

-- CreateIndex
CREATE INDEX "data_export_requests_status_idx" ON "data_export_requests"("status");

-- CreateIndex
CREATE INDEX "account_deletion_requests_status_scheduled_for_idx" ON "account_deletion_requests"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "account_deletion_requests_user_id_requested_at_idx" ON "account_deletion_requests"("user_id", "requested_at");

-- CreateIndex
CREATE INDEX "ads_media_status_idx" ON "ads"("media_status");

-- CreateIndex
CREATE INDEX "otp_codes_ip_address_created_at_idx" ON "otp_codes"("ip_address", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE INDEX "users_signup_device_fingerprint_created_at_idx" ON "users"("signup_device_fingerprint", "created_at");

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_payout_destination_id_fkey" FOREIGN KEY ("payout_destination_id") REFERENCES "payout_destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertiser_consents" ADD CONSTRAINT "advertiser_consents_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "advertisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_fkey" FOREIGN KEY ("referee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written guards (Prisma cannot express partial unique indexes / CHECKs)
-- ---------------------------------------------------------------------------
-- One pending KYC submission per user; one pending deletion request per user.
CREATE UNIQUE INDEX "kyc_submissions_one_pending_per_user"
  ON "kyc_submissions" ("user_id") WHERE status = 'pending';
CREATE UNIQUE INDEX "account_deletion_requests_one_pending_per_user"
  ON "account_deletion_requests" ("user_id") WHERE status = 'pending';
-- Advertiser-editable frequency cap must stay within the product range (1-5 per user per day).
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_frequency_cap_range"
  CHECK ("frequency_cap_per_user_per_day" BETWEEN 1 AND 5);
-- Referral bonuses are never negative.
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_bonus_non_negative"
  CHECK ("referrer_bonus_coins" >= 0 AND "referee_bonus_coins" >= 0);
