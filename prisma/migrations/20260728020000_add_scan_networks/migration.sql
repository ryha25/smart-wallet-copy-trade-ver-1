ALTER TABLE "wallet_scan_runs"
ADD COLUMN "network" TEXT NOT NULL DEFAULT 'SOLANA';

DROP INDEX IF EXISTS "wallet_scan_runs_status_started_at_idx";
CREATE INDEX "wallet_scan_runs_network_status_started_at_idx"
ON "wallet_scan_runs"("network", "status", "started_at");

ALTER TABLE "wallet_analysis_cache"
DROP CONSTRAINT "wallet_analysis_cache_pkey";

ALTER TABLE "wallet_analysis_cache"
ADD COLUMN "id" TEXT;

UPDATE "wallet_analysis_cache"
SET "id" = 'solana:' || "address"
WHERE "id" IS NULL;

ALTER TABLE "wallet_analysis_cache"
ALTER COLUMN "id" SET NOT NULL,
ADD COLUMN "network" TEXT NOT NULL DEFAULT 'SOLANA',
ADD CONSTRAINT "wallet_analysis_cache_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX "wallet_analysis_cache_network_address_key"
ON "wallet_analysis_cache"("network", "address");

CREATE INDEX "wallet_analysis_cache_network_ranking_eligible_last_analyzed_at_idx"
ON "wallet_analysis_cache"("network", "ranking_eligible", "last_analyzed_at");
