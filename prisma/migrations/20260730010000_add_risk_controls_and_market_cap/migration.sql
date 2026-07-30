ALTER TABLE "copy_settings"
ADD COLUMN "daily_loss_limit_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "daily_loss_limit_usd" DECIMAL(20,6) NOT NULL DEFAULT 3,
ADD COLUMN "daily_loss_include_unrealized" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "paper_positions"
ADD COLUMN "entry_market_cap_usd" DECIMAL(30,6),
ADD COLUMN "exit_market_cap_usd" DECIMAL(30,6);

ALTER TABLE "skipped_trades"
ADD COLUMN "execution_mode" "ExecutionMode";

-- Live positions created by earlier versions are identifiable by their on-chain
-- purchase signature. Do not infer LIVE for records that cannot be identified.
UPDATE "paper_positions"
SET "execution_mode" = 'LIVE'
WHERE "buy_signature" IS NOT NULL;
