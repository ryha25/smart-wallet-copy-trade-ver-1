# NEXT-TRADE

A smart wallet copy-trading dashboard for Solana and EVM chains — monitors top wallets, tracks positions, and automates copy trades in paper or live mode.

## Run & Operate

- Workflows `artifacts/nexus: web` and `artifacts/api-server: API Server` are managed by Replit — use the workflow pane to start/stop them.
- `pnpm --filter @workspace/api-server run build` — rebuild the API server bundle
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- Prisma: `cd artifacts/api-server && ./node_modules/.bin/prisma db push --schema=./prisma/schema.prisma` — push schema changes

## Required Secrets

Set these in Replit Secrets before logging in:

- `APP_USERNAME` — login username
- `APP_PASSCODE` — 6-character login passcode
- `SESSION_SECRET` — already set; used to sign session cookies

Optional (for live trading/APIs):

- `DATABASE_URL` — auto-provided by Replit PostgreSQL
- `HELIUS_API_KEY`, `BIRDEYE_API_KEY`, `JUPITER_API_KEY`, `MORALIS_API_KEY`, `ALCHEMY_API_KEY`
- `SOLANA_RPC_URL` / `NEXT_PUBLIC_SOLANA_RPC_URL` → `VITE_SOLANA_RPC_URL`
- `TRADING_WALLET_PUBLIC_KEY`, `TRADING_WALLET_SECRET_KEY` (live mode only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 18 + Vite + Tailwind CSS v4 + shadcn/ui (artifacts/nexus)
- API: Express 5 (artifacts/api-server, port 8080)
- DB: PostgreSQL via Prisma ORM (schema at artifacts/api-server/prisma/schema.prisma)
- Solana: @solana/web3.js, wallet-adapter-react; EVM via Moralis/Alchemy
- External APIs: Jupiter (quotes/swaps), DexScreener (prices), Helius (wallet activity)

## Where things live

- `artifacts/nexus/src/components/trading-app.tsx` — main app shell
- `artifacts/nexus/src/components/login-gate.tsx` — auth gate
- `artifacts/api-server/src/routes/live.ts` — all trading/wallet API routes
- `artifacts/api-server/src/routes/auth.ts` — session auth routes
- `artifacts/api-server/src/services/` — wallet scan, copy monitor, live trading
- `artifacts/api-server/prisma/schema.prisma` — full DB schema

## Architecture decisions

- Auth is a custom HMAC-signed session cookie (no OAuth); credentials come from env vars APP_USERNAME/APP_PASSCODE
- Prisma gracefully degrades when DATABASE_URL is missing (paper trading still works)
- All live API routes require auth middleware; health check is public
- Frontend proxies `/api` to port 8080 during dev; in production both go through the shared Replit proxy

## User preferences

_Populate as you build._
