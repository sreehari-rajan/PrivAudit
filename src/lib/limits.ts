import { database } from "./database.ts";
import { AnalysisError } from "./fetch-policy.ts";

const shared = globalThis as typeof globalThis & { privacyQuotas?: Map<string, { used: number; expires: number }> };
shared.privacyQuotas ??= new Map();

export async function takeQuota(key: string, limit: number, amount: number, expires: number) {
  if (process.env.DATABASE_URL) {
    const db = database();
    await db.quotaBucket.upsert({ where: { key }, create: { key, used: 0, expiresAt: new Date(expires) }, update: {} });
    const result = await db.quotaBucket.updateMany({ where: { key, used: { lte: limit - amount } }, data: { used: { increment: amount } } });
    if (!result.count) throw new AnalysisError("The analysis budget or request limit has been reached. Please try again later.", 429);
    return;
  }
  if (process.env.NODE_ENV === "production") throw new AnalysisError("Database-backed limits must be configured before production use.", 503);
  const quotas = shared.privacyQuotas!;
  for (const [entry, value] of quotas) if (value.expires <= Date.now()) quotas.delete(entry);
  const existing = quotas.get(key) ?? { used: 0, expires };
  if (existing.used + amount > limit) throw new AnalysisError("The local analysis budget has been reached. Please try again later.", 429);
  quotas.set(key, { ...existing, used: existing.used + amount });
}
