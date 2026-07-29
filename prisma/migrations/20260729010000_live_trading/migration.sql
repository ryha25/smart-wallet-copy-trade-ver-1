CREATE TYPE "ExecutionMode" AS ENUM ('PAPER', 'LIVE');
CREATE TYPE "ExecutionStatus" AS ENUM ('EXECUTING', 'SUCCESS', 'FAILED');

ALTER TABLE "copy_settings"
ADD COLUMN "live_trading_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "paper_positions"
ADD COLUMN "execution_mode" "ExecutionMode" NOT NULL DEFAULT 'PAPER',
ADD COLUMN "raw_token_amount" TEXT,
ADD COLUMN "token_decimals" INTEGER,
ADD COLUMN "buy_signature" TEXT,
ADD COLUMN "sell_signature" TEXT;

CREATE TABLE "live_trade_executions" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "source_wallet_id" TEXT NOT NULL,
  "paper_position_id" TEXT,
  "side" "TradeSide" NOT NULL,
  "status" "ExecutionStatus" NOT NULL DEFAULT 'EXECUTING',
  "input_mint" TEXT NOT NULL,
  "output_mint" TEXT NOT NULL,
  "input_amount" TEXT NOT NULL,
  "output_amount" TEXT,
  "request_id" TEXT,
  "signature" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "live_trade_executions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "live_trade_executions_idempotency_key_key"
ON "live_trade_executions"("idempotency_key");
CREATE INDEX "live_trade_executions_user_id_status_created_at_idx"
ON "live_trade_executions"("user_id", "status", "created_at");
CREATE INDEX "live_trade_executions_paper_position_id_idx"
ON "live_trade_executions"("paper_position_id");

ALTER TABLE "live_trade_executions"
ADD CONSTRAINT "live_trade_executions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_trade_executions"
ADD CONSTRAINT "live_trade_executions_source_wallet_id_fkey"
FOREIGN KEY ("source_wallet_id") REFERENCES "tracked_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
