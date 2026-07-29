ALTER TABLE "copy_settings"
  ADD COLUMN IF NOT EXISTS "stop_loss_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "take_profit_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "max_price_rise_enabled" BOOLEAN NOT NULL DEFAULT true,
  DROP COLUMN IF EXISTS "min_liquidity_usd",
  DROP COLUMN IF EXISTS "min_market_cap_usd";
