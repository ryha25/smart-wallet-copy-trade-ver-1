---
name: NEXT-TRADE port fixes
description: Non-obvious issues found during the Vercel→Replit port of NEXT-TRADE; apply if touching these areas again.
---

## Key fixes applied during port

**Why:** Several type mismatches existed between the Prisma schema and the local TypeScript CopySettings type, server-side services were accidentally included in the frontend artifact, and getTokenQuotes had a signature mismatch.

**How to apply:** If the api-server or nexus typecheck fails after future changes, check these areas first.

1. `CopySettings` type (`artifacts/api-server/src/lib/types.ts`) must include `dailyLossLimitEnabled`, `dailyLossLimit`, `dailyLossIncludeUnrealized` — these fields exist in the Prisma schema but were missing from the TS type.

2. `evaluatePositionExit` lives in `artifacts/api-server/src/lib/paper-trading.ts` — it was missing from the scaffold and had to be added from the original source.

3. `getTokenQuotes` in `artifacts/api-server/src/services/solana-live.ts` only accepts 1 argument (the mints array). The backup source had call sites passing a second `{ verbose: false }` options arg — those must be stripped.

4. `artifacts/nexus/src/services/copy-monitor.ts` is a SERVER-SIDE file — it must NOT exist in the frontend artifact. The cp from migration-backup accidentally copies it; always delete it after the copy step.

5. Vite config must NOT throw on missing PORT/BASE_PATH — use fallback defaults (`process.env.PORT ?? 18245`, `process.env.BASE_PATH ?? '/'`) so production builds work.

6. Prisma needs explicit generation: `cd artifacts/api-server && ./node_modules/.bin/prisma generate --schema=./prisma/schema.prisma`. Then push schema: `prisma db push --schema=./prisma/schema.prisma`.

7. `prisma` CLI must be in api-server devDependencies (`"prisma": "^6.12.0"`) — it's not hoisted to root.
