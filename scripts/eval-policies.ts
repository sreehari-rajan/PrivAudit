import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { assessPolicy } from "../src/lib/analyze.ts";
import { downloadPolicyPage, extractPolicyText } from "../src/lib/fetch-policy.ts";
import { geminiConfig } from "../src/lib/gemini.ts";
import { categories } from "../src/lib/rubric.ts";
import { sourceMatcher, type Extraction } from "../src/lib/schema.ts";

type Policy = { name: string; url: string; requiredHeadings: string[]; requiredPhrases: string[]; forbiddenPhrases: string[] };
type Check = { name: string; pass: boolean; detail?: unknown };

const stages = ["download", "extract", "ai"] as const;
const args = process.argv.slice(2);
const stage = (args[args.indexOf("--stage") + 1] ?? "ai") as (typeof stages)[number];
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
if (!stages.includes(stage)) throw new Error(`--stage must be one of ${stages.join(", ")}`);
const runUntil = stages.indexOf(stage);

const fixture = JSON.parse(readFileSync(new URL("../evals/policies.json", import.meta.url), "utf8")) as { policies: Policy[] };
const policies = fixture.policies.filter(({ name }) => !only || only.includes(name));

// Matching tolerates typographic quotes, whitespace and case so anchors test content, not formatting.
const normalize = (value: string) => value.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, "\"").replace(/\s+/g, " ").trim().toLowerCase();

async function evaluate(policy: Policy) {
  const checks: Check[] = [];
  const result: Record<string, unknown> = { name: policy.name, url: policy.url, checks };
  const fail = (name: string, error: unknown) => { checks.push({ name, pass: false, detail: error instanceof Error ? { message: error.message, cause: error.cause } : String(error) }); return result; };

  let started = Date.now();
  let page: Awaited<ReturnType<typeof downloadPolicyPage>>;
  try { page = await downloadPolicyPage(policy.url, AbortSignal.timeout(15000)); } catch (error) { return fail("download", error); }
  const downloadMs = Date.now() - started;
  result.download = { finalUrl: page.finalUrl, redirects: page.redirects, htmlBytes: Buffer.byteLength(page.html), ms: downloadMs };
  checks.push({ name: "download: same site", pass: new URL(page.finalUrl).hostname.endsWith(new URL(policy.url).hostname.replace(/^www\./, "")) });
  checks.push({ name: "download: html received", pass: /<body[\s>]/i.test(page.html) && /<\/body>/i.test(page.html), detail: "document must include the complete body" });
  checks.push({ name: "download: under 15s", pass: downloadMs < 15000, detail: downloadMs });
  if (runUntil < 1) return result;

  let text: string;
  try { text = extractPolicyText(page.html); } catch (error) { return fail("extract", error); }
  const normalized = normalize(text);
  const missingHeadings = policy.requiredHeadings.filter((value) => !normalized.includes(normalize(value)));
  const missingPhrases = policy.requiredPhrases.filter((value) => !normalized.includes(normalize(value)));
  const boilerplate = policy.forbiddenPhrases.filter((value) => normalized.includes(normalize(value)));
  result.extract = { chars: text.length, bytes: Buffer.byteLength(text) };
  checks.push({ name: "extract: required headings", pass: !missingHeadings.length, detail: missingHeadings });
  checks.push({ name: "extract: anchor phrases", pass: !missingPhrases.length, detail: missingPhrases });
  checks.push({ name: "extract: boilerplate removed", pass: !boilerplate.length, detail: boilerplate });
  if (runUntil < 2) return result;

  started = Date.now();
  let assessment: Awaited<ReturnType<typeof assessPolicy>>;
  const source = { url: page.url, finalUrl: page.finalUrl, text, hash: "eval" };
  try { assessment = await assessPolicy(source, geminiConfig(), AbortSignal.timeout(120000)); } catch (error) { return fail("ai", error); }
  const aiMs = Date.now() - started;
  const { report } = assessment;
  const match = sourceMatcher(text);
  const quotesOf = (extraction: Extraction) => [...extraction.findings, ...extraction.legal].map(({ quote }) => quote).filter((quote): quote is string => Boolean(quote));
  const initialQuotes = quotesOf(assessment.initial);
  const quotes = quotesOf(assessment.repaired);
  const exact = quotes.filter((quote) => match(quote));
  const unsupportedCritical = categories.filter(({ critical, id }) => critical && !report.findings.find((finding) => finding.id === id)?.quote).map(({ id }) => id);
  const quoteRate = quotes.length ? exact.length / quotes.length : 0;
  result.ai = {
    ms: aiMs, overall: report.score.overall, coverage: report.score.coverage,
    initialQuotes: initialQuotes.length, initialVerbatim: initialQuotes.filter((quote) => match(quote)).length,
    repairsAttempted: assessment.repairsAttempted, repairsSucceeded: assessment.repairsSucceeded,
    quotes: quotes.length, exactQuotes: exact.length,
    inexactQuotes: quotes.filter((quote) => !match(quote)).map((quote) => quote.slice(0, 160)),
    findings: report.findings.map(({ id, state, quote }) => ({ id, state, quote: quote?.slice(0, 200) ?? null })),
    legal: report.legal.map(({ region, topic, status }) => ({ region, topic, status })),
  };
  checks.push({ name: "ai: verbatim quotes >= 90%", pass: quoteRate >= 0.9, detail: `${exact.length}/${quotes.length} final; ${(result.ai as { initialVerbatim: number }).initialVerbatim}/${initialQuotes.length} before repair` });
  checks.push({ name: "ai: critical categories supported", pass: !unsupportedCritical.length, detail: unsupportedCritical });
  checks.push({ name: "ai: overall score produced", pass: report.score.overall !== null, detail: { overall: report.score.overall, coverage: report.score.coverage } });
  checks.push({ name: "ai: under 120s", pass: aiMs < 120000, detail: aiMs });
  return result;
}

const results = [];
for (const policy of policies) {
  const result = await evaluate(policy);
  const checks = result.checks as Check[];
  const pass = checks.every((check) => check.pass);
  results.push({ ...result, pass });
  console.log(`\n${pass ? "PASS" : "FAIL"}  ${policy.name}`);
  for (const check of checks) console.log(`  ${check.pass ? "ok  " : "FAIL"} ${check.name}${check.pass ? "" : `  ${JSON.stringify(check.detail)}`}`);
}
mkdirSync(new URL("../evals/results/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../evals/results/${stage}.json`, import.meta.url), JSON.stringify(results, null, 2));
const passed = results.filter(({ pass }) => pass).length;
console.log(`\n${stage} stage: ${passed}/${results.length} policies passed`);
process.exitCode = passed === results.length ? 0 : 1;
