ALTER TABLE "users"
ADD COLUMN "login_name" TEXT;

CREATE UNIQUE INDEX "users_login_name_key"
ON "users"("login_name");

ALTER TABLE "tracked_wallets"
ADD COLUMN "network" TEXT NOT NULL DEFAULT 'SOLANA',
ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "last_observed_signature" TEXT,
ADD COLUMN "last_checked_at" TIMESTAMP(3);

ALTER TABLE "tracked_wallets"
DROP CONSTRAINT IF EXISTS "tracked_wallets_address_key";

CREATE UNIQUE INDEX "tracked_wallets_network_address_key"
ON "tracked_wallets"("network", "address");

CREATE INDEX "tracked_wallets_network_is_copy_enabled_is_blocked_idx"
ON "tracked_wallets"("network", "is_copy_enabled", "is_blocked");

ALTER TABLE "paper_positions"
ADD COLUMN "source_signature" TEXT;

CREATE UNIQUE INDEX "paper_positions_source_wallet_id_source_signature_token_mint_key"
ON "paper_positions"("source_wallet_id", "source_signature", "token_mint");

ALTER TABLE "skipped_trades"
ADD COLUMN "source_signature" TEXT;

CREATE UNIQUE INDEX "skipped_trades_source_wallet_id_source_signature_token_mint_key"
ON "skipped_trades"("source_wallet_id", "source_signature", "token_mint");
