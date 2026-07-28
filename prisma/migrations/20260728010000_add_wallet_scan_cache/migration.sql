CREATE TYPE "WalletScanRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "wallet_scan_runs" (
  "id" TEXT NOT NULL,
  "status" "WalletScanRunStatus" NOT NULL DEFAULT 'RUNNING',
  "phase" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "discovered_candidates" INTEGER NOT NULL DEFAULT 0,
  "target_candidates" INTEGER NOT NULL DEFAULT 0,
  "analyzed_candidates" INTEGER NOT NULL DEFAULT 0,
  "successful_analyses" INTEGER NOT NULL DEFAULT 0,
  "result" JSONB,
  "error" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_scan_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_analysis_cache" (
  "address" TEXT NOT NULL,
  "score" JSONB NOT NULL,
  "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "ranking_eligible" BOOLEAN NOT NULL DEFAULT false,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_analyzed_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_analysis_cache_pkey" PRIMARY KEY ("address")
);

CREATE INDEX "wallet_scan_runs_status_started_at_idx"
  ON "wallet_scan_runs"("status", "started_at");

CREATE INDEX "wallet_scan_runs_completed_at_idx"
  ON "wallet_scan_runs"("completed_at");

CREATE INDEX "wallet_analysis_cache_last_analyzed_at_idx"
  ON "wallet_analysis_cache"("last_analyzed_at");
