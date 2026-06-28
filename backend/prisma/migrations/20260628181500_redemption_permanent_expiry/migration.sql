ALTER TABLE "redemption_batches" ALTER COLUMN "expires_at" DROP NOT NULL;
ALTER TABLE "redemption_codes" ALTER COLUMN "expires_at" DROP NOT NULL;

