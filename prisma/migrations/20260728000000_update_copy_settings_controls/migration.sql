ALTER TABLE "copy_settings"
  ADD COLUMN "stop_loss_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "take_profit_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "max_price_rise_enabled" BOOLEAN NOT NULL DEFAULT true,
  DROP COLUMN "min_liquidity_usd",
  DROP COLUMN "min_market_cap_usd";
