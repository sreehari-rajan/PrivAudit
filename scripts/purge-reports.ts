import { purgeReports } from "../src/lib/reports.ts";
import { database } from "../src/lib/database.ts";

try {
  const count = await purgeReports();
  console.log(`Deleted ${count} expired reports and cleared expired quota counters.`);
} catch {
  console.error("Purge failed. Check DATABASE_URL, migrations, and database availability.");
  process.exitCode = 1;
} finally {
  if (process.env.DATABASE_URL) await database().$disconnect();
}