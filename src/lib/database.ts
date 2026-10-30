import { PrismaClient } from "@prisma/client";

const shared = globalThis as typeof globalThis & { privacyDb?: PrismaClient };
export function database() {
  if (!process.env.DATABASE_URL) throw new Error("Database not configured");
  shared.privacyDb ??= new PrismaClient({ log: [] });
  return shared.privacyDb;
}