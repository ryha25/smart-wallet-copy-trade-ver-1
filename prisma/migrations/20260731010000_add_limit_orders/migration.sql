-- CreateEnum
CREATE TYPE "LimitOrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "LimitOrderStatus" AS ENUM ('PENDING', 'TRIGGERED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "limit_orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_mint" TEXT NOT NULL,
    "token_symbol" TEXT NOT NULL,
    "side" "LimitOrderSide" NOT NULL,
    "target_price_usd" DECIMAL(20,8) NOT NULL,
    "amount_usd" DECIMAL(20,6),
    "sell_percent" DECIMAL(5,2),
    "position_id" TEXT,
    "status" "LimitOrderStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggered_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "error_message" TEXT,

    CONSTRAINT "limit_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "limit_orders_user_id_status_idx" ON "limit_orders"("user_id", "status");

-- AddForeignKey
ALTER TABLE "limit_orders" ADD CONSTRAINT "limit_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
