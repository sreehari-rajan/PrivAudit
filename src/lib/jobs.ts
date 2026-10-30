import { randomUUID } from "node:crypto";
import { analyzePolicy } from "./analyze.ts";
import { AnalysisError } from "./fetch-policy.ts";
import type { Report } from "./schema.ts";

type Job = { id: string; session: string; status: "queued" | "analyzing" | "complete" | "failed" | "cancelled"; report?: Report; error?: string; url: string; created: number; controller: AbortController };
const shared = globalThis as typeof globalThis & { privacyJobs?: Map<string, Job>; privacyActive?: number };
shared.privacyJobs ??= new Map();
shared.privacyActive ??= 0;
const TTL = 20 * 60 * 1000;

export function cleanJobs() {
  for (const [id, job] of shared.privacyJobs!) {
    if (job.created + TTL <= Date.now()) {
      job.controller.abort();
      shared.privacyJobs!.delete(id);
    }
  }
}
const cleanup = setInterval(cleanJobs, 60000);
cleanup.unref();

export function createJob(url: string, session: string) {
  cleanJobs();
  if (shared.privacyJobs!.size >= 100 || [...shared.privacyJobs!.values()].filter((job) => job.session === session && ["queued", "analyzing"].includes(job.status)).length >= 3) throw new AnalysisError("The analysis queue is full. Wait for current reports or cancel them.", 429);
  const job: Job = { id: randomUUID(), session, status: "queued", url, created: Date.now(), controller: new AbortController() };
  shared.privacyJobs!.set(job.id, job);
  drain();
  return job.id;
}

function drain() {
  for (const job of shared.privacyJobs!.values()) {
    if (shared.privacyActive! >= 2) break;
    if (job.status !== "queued") continue;
    shared.privacyActive!++;
    job.status = "analyzing";
    const deadline = setTimeout(() => job.controller.abort(), 120000);
    void analyzePolicy(job.url, job.controller.signal).then((report) => {
      if (job.controller.signal.aborted) return;
      job.report = report;
      job.status = "complete";
    }).catch((error: unknown) => {
      if (job.status === "cancelled") return;
      job.status = "failed";
      job.error = job.controller.signal.aborted ? "Analysis timed out. No incomplete score was produced." : error instanceof AnalysisError ? error.message : "Analysis could not be completed. Check the URL and provider configuration, then try again.";
    }).finally(() => {
      clearTimeout(deadline);
      shared.privacyActive!--;
      drain();
    });
  }
}

export function getJob(id: string, session: string) {
  cleanJobs();
  const job = shared.privacyJobs!.get(id);
  if (!job || job.session !== session) throw new AnalysisError("This private report has expired or belongs to another session.", 404);
  return job;
}

export function cancelJob(id: string, session: string) {
  const job = getJob(id, session);
  job.status = "cancelled";
  job.controller.abort();
  shared.privacyJobs!.delete(id);
}