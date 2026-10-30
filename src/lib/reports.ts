import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { database } from "./database.ts";
import { AnalysisError } from "./fetch-policy.ts";
import type { Report } from "./schema.ts";

export function removalHash(value: string) { return createHash("sha256").update(value).digest("hex"); }

export async function publishReport(report: Report) {
  if (!process.env.DATABASE_URL) throw new AnalysisError("Publishing needs a PostgreSQL connection. Configure DATABASE_URL first.", 503);
  if (report.sample) throw new AnalysisError("Fictional sample reports cannot be published.");
  if (new Date(report.expiresAt).getTime() <= Date.now()) throw new AnalysisError("This report has expired.", 410);
  const serialized = JSON.stringify(report);
  if (/(?:sk-ant-|\b(?:password|access_token|api_key)\s*[:=])|\b\d{3}-\d{2}-\d{4}\b/i.test(serialized)) throw new AnalysisError("Potentially sensitive content was detected. This report cannot be published automatically.", 422);
  const db = database();
  if (await db.publicReport.findUnique({ where: { id: report.id } })) throw new AnalysisError("This report is already published. Use its original removal credential.", 409);
  const credential = randomBytes(32).toString("hex");
  await db.publicReport.create({ data: {
    id: report.id,
    organization: report.organization,
    domain: new URL(report.finalUrl).hostname,
    report: report as unknown as Prisma.InputJsonValue,
    expiresAt: new Date(report.expiresAt),
    removalHash: removalHash(credential),
  } });
  return { id: report.id, removalCredential: credential, expiresAt: report.expiresAt };
}

export async function searchReports(query: string) {
  if (!process.env.DATABASE_URL) return { reports: [], configured: false };
  const reports = await database().publicReport.findMany({
    where: { expiresAt: { gt: new Date() }, ...(query ? { OR: [{ organization: { contains: query, mode: "insensitive" as const } }, { domain: { contains: query, mode: "insensitive" as const } }] } : {}) },
    orderBy: { createdAt: "desc" }, take: 30, select: { report: true },
  });
  return { reports: reports.map(({ report }) => report as unknown as Report), configured: true };
}

export async function readReport(id: string) {
  const result = await database().publicReport.findFirst({ where: { id, expiresAt: { gt: new Date() } }, select: { report: true } });
  if (!result) throw new AnalysisError("This public report has expired, was removed, or does not exist.", 404);
  return result.report as unknown as Report;
}

export async function removeReport(id: string, credential: string) {
  const result = await database().publicReport.deleteMany({ where: { id, removalHash: removalHash(credential) } });
  if (!result.count) throw new AnalysisError("The report ID or removal credential is incorrect.", 404);
}

export async function purgeReports() {
  const db = database();
  const now = new Date();
  const reports = await db.publicReport.deleteMany({ where: { expiresAt: { lte: now } } });
  await db.quotaBucket.deleteMany({ where: { expiresAt: { lte: now } } });
  return reports.count;
}