/**
 * resolve-failed-migrations.mjs
 *
 * Runs before `prisma migrate deploy` during the production build.
 * Migrations that are stuck in a "failed" state (applied_steps_count=0,
 * no finished_at, no rolled_back_at) block every subsequent deploy.
 *
 * --applied   : schema was already applied outside Prisma; just record it.
 * --rolled-back: nothing was applied; let deploy re-apply from scratch.
 *
 * Both commands are idempotent: if the migration is already in a success
 * state, Prisma exits non-zero and we silently continue.
 *
 * HISTORY: All migrations through 20260730010000 were applied directly to
 * the production DB (outside Prisma), so they are marked --applied here.
 * Any future migrations that are genuinely un-applied should NOT be added
 * to this list; prisma migrate deploy will handle them normally.
 */

import { execSync } from "node:child_process";

const RESOLVE = [
  // First run partially applied the initial schema (types already existed).
  // Recorded as applied so subsequent deploys skip it.
  { name: "20260724000000_initial", flag: "--applied" },

  // Failed with 0 applied steps on first attempt; re-applied successfully
  // in the next build run (applied_steps_count=1 in _prisma_migrations).
  // Mark any lingering rolled-back record so deploy does not re-attempt.
  { name: "20260728000000_update_copy_settings_controls", flag: "--rolled-back" },

  // Schema applied directly to production DB outside Prisma.
  // Tables/types/columns confirmed present; mark as applied to skip.
  { name: "20260728010000_add_wallet_scan_cache", flag: "--applied" },
  { name: "20260728020000_add_scan_networks", flag: "--applied" },
  { name: "20260729000000_persist_copy_monitor", flag: "--applied" },
  { name: "20260729010000_live_trading", flag: "--applied" },
  { name: "20260730010000_add_risk_controls_and_market_cap", flag: "--applied" },
];

for (const { name, flag } of RESOLVE) {
  try {
    execSync(`prisma migrate resolve ${flag} "${name}"`, { stdio: "pipe" });
    console.log(`[pre-migrate] Resolved (${flag}): ${name}`);
  } catch {
    console.log(`[pre-migrate] Already resolved or not stuck, skipping: ${name}`);
  }
}
