import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  nextTradePrisma?: PrismaClient;
};

export function databaseEnabled() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export const prisma = databaseEnabled()
  ? (globalForPrisma.nextTradePrisma ?? new PrismaClient())
  : null;

if (process.env.NODE_ENV !== "production" && prisma) {
  globalForPrisma.nextTradePrisma = prisma;
}
