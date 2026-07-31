/**
 * resolve-failed-migrations.mjs
 *
 * Runs before `prisma migrate deploy` during the production build.
 * Migrations that are stuck in a "failed" state (applied_steps_count=0,
 * no finished_at, no rolled_back_at) block every subsequent deploy.
 *
 * --applied  : schema was already applied outside Prisma; just record it.
 * --rolled-back: nothing was applied; let deploy re-apply from scratch.
 *
 * Both commands are idempotent: if the migration is already in a success
 * state, Prisma exits non-zero and we silently continue.
 */

import { execSync } from "node:child_process";

const RESOLVE = [
  // First run partially applied the initial schema (types already existed).
  // We recorded it as applied so subsequent deploys skip it.
  { name: "20260724000000_initial", flag: "--applied" },

  // Failed with 0 applied steps — safe to roll back and re-apply.
  // SQL uses IF NOT EXISTS / IF EXISTS so it is idempotent.
  { name: "20260728000000_update_copy_settings_controls", flag: "--rolled-back" },
];

for (const { name, flag } of RESOLVE) {
  try {
    execSync(`prisma migrate resolve ${flag} "${name}"`, { stdio: "pipe" });
    console.log(`[pre-migrate] Resolved (${flag}): ${name}`);
  } catch {
    console.log(`[pre-migrate] Already resolved or not stuck, skipping: ${name}`);
  }
}
