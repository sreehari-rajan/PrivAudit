import { AnalysisError, fetchPolicy } from "./fetch-policy.ts";
import { extractAssessment, geminiConfig, repairQuotes } from "./gemini.ts";
import { buildReport, verifyEvidence } from "./schema.ts";

export async function assessPolicy(source: { url: string; finalUrl: string; text: string; hash: string }, config: ReturnType<typeof geminiConfig>, signal: AbortSignal) {
  const initial = await extractAssessment(source, config, signal);
  const repair = await repairQuotes(initial, source, config, signal);
  const report = buildReport(verifyEvidence(repair.extraction, source.text), source, config.model);
  return { report, initial, repaired: repair.extraction, repairsAttempted: repair.attempted, repairsSucceeded: repair.repaired };
}

export async function analyzePolicy(url: string, signal: AbortSignal) {
  const config = geminiConfig();
  if (process.env.NODE_ENV === "production" && process.env.PUBLIC_LAUNCH_APPROVED !== "true") throw new AnalysisError("Public analysis is disabled until the deployment security checklist is completed.", 503);
  const source = await fetchPolicy(url, signal);
  return (await assessPolicy(source, config, signal)).report;
}