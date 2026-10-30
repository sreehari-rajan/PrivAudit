import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { database } from "../../src/lib/database.ts";
import { takeQuota } from "../../src/lib/limits.ts";
import { publishReport, purgeReports, readReport, removalHash, removeReport, searchReports } from "../../src/lib/reports.ts";
import { sampleReports } from "../../src/lib/sample.ts";

test("PostgreSQL publication, removal, retention and shared quotas", { skip: !process.env.DATABASE_URL }, async () => {
  const db = database();
  const report = { ...sampleReports()[0], sample: false, organization: `Integration ${randomUUID()}`, model: "test-fixture-not-a-live-assessment" };
  const expiredId = randomUUID();
  const quotaKey = `integration:${randomUUID()}`;
  try {
    await assert.rejects(publishReport(sampleReports()[0]), /Fictional sample/);
    const publication = await publishReport(report);
    assert.equal(publication.removalCredential.length, 64);
    const stored = await db.publicReport.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(stored.removalHash, removalHash(publication.removalCredential));
    assert.notEqual(stored.removalHash, publication.removalCredential);
    assert.deepEqual(await readReport(report.id), report);
    assert.equal((await searchReports(report.organization.toUpperCase())).reports[0].id, report.id);
    await assert.rejects(publishReport(report), /already published/);
    await assert.rejects(removeReport(report.id, "invalid"), /incorrect/);
    assert.equal((await readReport(report.id)).id, report.id);
    await removeReport(report.id, publication.removalCredential);
    await assert.rejects(readReport(report.id), /expired, was removed/);

    await publishReport({ ...report, id: expiredId });
    await db.publicReport.update({ where: { id: expiredId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await assert.rejects(readReport(expiredId), /expired, was removed/);
    assert.equal((await searchReports(report.organization)).reports.length, 0);

    const reservations = await Promise.allSettled(Array.from({ length: 4 }, () => takeQuota(quotaKey, 3, 1, Date.now() + 60000)));
    assert.equal(reservations.filter((result) => result.status === "fulfilled").length, 3);
    assert.equal(reservations.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await db.quotaBucket.findUniqueOrThrow({ where: { key: quotaKey } })).used, 3);
    await db.quotaBucket.update({ where: { key: quotaKey }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.ok(await purgeReports() >= 1);
    assert.equal(await db.publicReport.findUnique({ where: { id: expiredId } }), null);
    assert.equal(await db.quotaBucket.findUnique({ where: { key: quotaKey } }), null);
  } finally {
    await db.publicReport.deleteMany({ where: { id: { in: [report.id, expiredId] } } });
    await db.quotaBucket.deleteMany({ where: { key: quotaKey } });
    await db.$disconnect();
  }
});