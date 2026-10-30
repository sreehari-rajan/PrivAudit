import { database } from "../src/lib/database.ts";

const id = process.argv[2];
try {
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Report ID required");
  const result = await database().publicReport.deleteMany({ where: { id } });
  console.log(`Removed ${result.count} report(s).`);
} catch {
  console.error("Usage: npm run reports:remove -- <report-id>. Requires private operator database access.");
  process.exitCode = 1;
} finally {
  if (process.env.DATABASE_URL) await database().$disconnect();
}