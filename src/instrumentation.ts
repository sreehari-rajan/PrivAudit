export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.DATABASE_URL) return;
    const { purgeReports } = await import("./lib/reports");
    const shared = globalThis as typeof globalThis & { privacyPurgeTimer?: ReturnType<typeof setInterval> };
    if (shared.privacyPurgeTimer) return;
    const purge = async () => {
      try { await purgeReports(); }
      catch { console.error("PrivAudit retention cleanup failed. Check database availability and migrations."); }
    };
    await purge();
    shared.privacyPurgeTimer = setInterval(() => { void purge(); }, 3600000);
    shared.privacyPurgeTimer.unref();
  }
}