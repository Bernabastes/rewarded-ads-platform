-- AlterTable
ALTER TABLE "advertiser_payments" ADD COLUMN     "return_url" TEXT;

-- AlterTable
ALTER TABLE "advertisers" ADD COLUMN     "notification_prefs" JSONB NOT NULL DEFAULT '{"campaignReviews":true,"billing":true,"weeklyReport":true}';
