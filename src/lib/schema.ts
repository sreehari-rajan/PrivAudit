import { z } from "zod";
import { categories, RUBRIC_VERSION, scoreReport } from "./rubric.ts";

export const categoryIds = categories.map(({ id }) => id) as [typeof categories[number]["id"], ...typeof categories[number]["id"][]];
export const findingStates = ["strong", "mixed", "weak", "unknown", "not_applicable"] as const;
export const legalStatuses = ["evidence_found", "potential_gap", "unclear", "not_applicable"] as const;
// A fixed checklist keeps regional checks comparable across policies and lets the provider schema require every check.
export const legalChecks = [
  { key: "gdpr_rights", region: "GDPR", topic: "Data subject rights (access, deletion, objection, portability)" },
  { key: "gdpr_lawful_basis", region: "GDPR", topic: "Purposes and lawful basis" },
  { key: "gdpr_retention", region: "GDPR", topic: "Retention periods" },
  { key: "gdpr_transfers", region: "GDPR", topic: "International transfers and safeguards" },
  { key: "ccpa_rights", region: "CCPA/CPRA", topic: "Rights to know, delete and correct" },
  { key: "ccpa_sale_sharing", region: "CCPA/CPRA", topic: "Sale or sharing and opt-out" },
  { key: "ccpa_sensitive", region: "CCPA/CPRA", topic: "Sensitive personal information limits" },
  { key: "ccpa_gpc", region: "CCPA/CPRA", topic: "Global Privacy Control and opt-out preference signals" },
] as const;
export const evidenceFields = {
  explanation: z.string().min(12).max(900),
  quote: z.string().min(12).max(600).nullable(),
  section: z.string().max(120).nullable(),
};
export const extractionSchema = z.object({
  organization: z.string().min(1).max(100),
  isEnglishPrivacyPolicy: z.boolean(),
  findings: z.array(z.object({
    id: z.enum(categoryIds),
    state: z.enum(findingStates),
    ...evidenceFields,
  })).length(10).refine((findings) => new Set(findings.map(({ id }) => id)).size === 10, "Each category must appear once"),
  legal: z.array(z.object({
    region: z.enum(["GDPR", "CCPA/CPRA"]),
    topic: z.string().min(3).max(100),
    status: z.enum(legalStatuses),
    ...evidenceFields,
  })).min(4).max(20),
});

export type Extraction = z.infer<typeof extractionSchema>;
export type Report = Extraction & {
  id: string;
  url: string;
  finalUrl: string;
  analyzedAt: string;
  expiresAt: string;
  sourceHash: string;
  model: string;
  rubricVersion: string;
  promptVersion: string;
  sample: boolean;
  score: ReturnType<typeof scoreReport>;
};

const QUOTE_MARKS: Record<string, string> = { "\u2018": "'", "\u2019": "'", "\u201c": "\"", "\u201d": "\"" };

// Locates quotations in the source while ignoring only whitespace and quote-mark typography,
// and returns the exact source excerpt so reports never display the model's rewritten text.
export function sourceMatcher(text: string) {
  const chars: string[] = [];
  const origins: number[] = [];
  let pendingSpace = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (/\s/.test(char)) { pendingSpace = chars.length > 0; continue; }
    if (pendingSpace) { chars.push(" "); origins.push(index - 1); pendingSpace = false; }
    chars.push(QUOTE_MARKS[char] ?? char);
    origins.push(index);
  }
  const normalized = chars.join("");
  return (quote: string) => {
    const needle = quote.replace(/[\u2018\u2019\u201c\u201d]/g, (char) => QUOTE_MARKS[char]).replace(/\s+/g, " ").trim();
    const start = needle ? normalized.indexOf(needle) : -1;
    if (start < 0) return null;
    return text.slice(origins[start], origins[start + needle.length - 1] + 1);
  };
}

export function findSourceSpan(text: string, quote: string) {
  return sourceMatcher(text)(quote);
}

export function verifyEvidence(extraction: Extraction, text: string): Extraction {
  const match = sourceMatcher(text);
  return {
    ...extraction,
    findings: extraction.findings.map((finding) => {
      const quote = finding.quote && match(finding.quote);
      if (quote) return { ...finding, quote };
      return { ...finding, state: "unknown", quote: null, section: null, explanation: "No exact supporting excerpt could be verified in this policy. This is not proof of harmful practice." };
    }),
    legal: extraction.legal.map((finding) => {
      const quote = finding.quote && match(finding.quote);
      if (quote) return { ...finding, quote };
      return { ...finding, status: "unclear", quote: null, section: null, explanation: "No exact supporting excerpt was verified. Legal applicability and compliance are not established." };
    }),
  };
}

export function buildReport(extraction: Extraction, source: { url: string; finalUrl: string; hash: string }, model: string, sample = false): Report {
  const now = new Date();
  return {
    ...extraction,
    id: crypto.randomUUID(),
    url: source.url,
    finalUrl: source.finalUrl,
    sourceHash: source.hash,
    analyzedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    rubricVersion: RUBRIC_VERSION,
    promptVersion: "1.1.0",
    model,
    sample,
    score: scoreReport(extraction.findings),
  };
}