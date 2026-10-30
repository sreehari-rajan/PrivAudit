import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { extractAssessment, geminiConfig, repairQuotes } from "./gemini.ts";
import { AnalysisError } from "./fetch-policy.ts";
import { categories } from "./rubric.ts";
import { sampleReports } from "./sample.ts";
import { buildReport, legalChecks, verifyEvidence } from "./schema.ts";

const config = { apiKey: "test-key-not-a-real-credential", model: "gemini-3.5-flash-lite" };
const source = { finalUrl: "https://example.com/privacy", text: "Public policy text for a mocked assessment." };
const options = { retryDelayMs: 0 };
const signal = () => new AbortController().signal;

function providerPayload(report = sampleReports()[0]) {
  return {
    organization: report.organization,
    isEnglishPrivacyPolicy: report.isEnglishPrivacyPolicy,
    findings: Object.fromEntries(report.findings.map(({ id, ...finding }) => [id, finding])),
    legal: Object.fromEntries(legalChecks.map(({ key }, index) => {
      const { status, explanation, quote, section } = report.legal[index % report.legal.length];
      return [key, { status, explanation, quote, section }];
    })),
  };
}
function envelope(text = JSON.stringify(providerPayload()), finishReason = "STOP") {
  return { candidates: [{ finishReason, content: { parts: [{ text }] } }] };
}
function respond(payload: unknown, status = 200) {
  return mock.method(globalThis, "fetch", async () => Response.json(payload, { status }));
}

describe("Gemini structured assessment", () => {
  afterEach(() => mock.restoreAll());

  it("uses a server-side key, a named-field schema, bounded output and no tools", async () => {
    let request: RequestInit | undefined;
    mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      assert.equal(input, `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`);
      assert.ok(!String(input).includes(config.apiKey));
      request = init;
      return Response.json(envelope());
    });
    await extractAssessment(source, config, signal(), options);
    assert.equal(request?.method, "POST");
    assert.equal(request?.cache, "no-store");
    assert.equal(new Headers(request?.headers).get("x-goog-api-key"), config.apiKey);
    assert.ok(request?.signal instanceof AbortSignal);
    const body = JSON.parse(String(request?.body));
    const schema = body.generationConfig.responseJsonSchema;
    assert.equal(body.generationConfig.maxOutputTokens, 8000);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(schema.properties.findings.required, categories.map(({ id }) => id));
    assert.deepEqual(schema.properties.legal.required, legalChecks.map(({ key }) => key));
    assert.doesNotMatch(JSON.stringify(schema), /minItems|maxItems|\$schema/);
    assert.equal(body.tools, undefined);
    assert.match(body.systemInstruction.parts[0].text, /UNTRUSTED DATA/);
    assert.match(body.systemInstruction.parts[0].text, /filling every category and every regional check/);
    assert.match(body.contents[0].parts[0].text, /<untrusted_policy>\nPublic policy text/);
  });

  it("converts named fields into ordered categories and the fixed regional checklist", async () => {
    respond(envelope());
    const extraction = await extractAssessment(source, config, signal(), options);
    assert.equal(extraction.organization, "Willow Notes");
    assert.deepEqual(extraction.findings.map(({ id }) => id), categories.map(({ id }) => id));
    assert.deepEqual(extraction.legal.map(({ region, topic }) => ({ region, topic })), legalChecks.map(({ region, topic }) => ({ region, topic })));
  });

  it("keeps evidence verification and model provenance in reports", async () => {
    respond(envelope());
    const extraction = await extractAssessment(source, config, signal(), options);
    const report = buildReport(verifyEvidence(extraction, source.text), { ...source, url: source.finalUrl, hash: "test-hash" }, config.model);
    assert.equal(report.model, config.model);
    assert.equal(report.sample, false);
    assert.equal(report.score.overall, null);
    assert.ok(report.findings.every((finding) => finding.state === "unknown"));
  });

  it("joins output parts but ignores internal thought parts", async () => {
    const text = JSON.stringify(providerPayload());
    respond({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not JSON", thought: true }, { text: text.slice(0, 100) }, { text: text.slice(100) }] } }] });
    assert.equal((await extractAssessment(source, config, signal(), options)).organization, "Willow Notes");
  });

  for (const [status, message] of [
    [429, /quota or rate limit/],
    [401, /API key or access/],
    [403, /API key or access/],
    [400, /assessment request/],
    [404, /model is unavailable/],
  ] as const) {
    it(`shows a safe error for HTTP ${status} without retrying`, async () => {
      const fetch = respond({ error: { message: "private provider details" } }, status);
      await assert.rejects(extractAssessment(source, config, signal(), options), (error: unknown) =>
        error instanceof AnalysisError && message.test(error.message) && !error.message.includes("private provider details") && error.status === (status === 429 ? 429 : 503) && String(error.cause).startsWith(`HTTP ${status}`));
      assert.equal(fetch.mock.callCount(), 1);
    });
  }

  for (const status of [500, 502, 503, 504]) {
    it(`retries transient HTTP ${status} three times, then fails safely`, async () => {
      const fetch = respond({ error: { message: "overloaded" } }, status);
      await assert.rejects(extractAssessment(source, config, signal(), options), (error: unknown) =>
        error instanceof AnalysisError && /temporarily unavailable/.test(error.message) && String(error.cause).startsWith(`HTTP ${status}`));
      assert.equal(fetch.mock.callCount(), 3);
    });
  }

  it("recovers when a transient error is followed by success", async () => {
    let calls = 0;
    mock.method(globalThis, "fetch", async () => ++calls === 1 ? Response.json({}, { status: 503 }) : Response.json(envelope()));
    assert.equal((await extractAssessment(source, config, signal(), options)).organization, "Willow Notes");
    assert.equal(calls, 2);
  });

  it("retries network failures without exposing request details", async () => {
    const fetch = mock.method(globalThis, "fetch", async () => { throw new TypeError("private request details"); });
    await assert.rejects(extractAssessment(source, config, signal(), options), (error: unknown) =>
      error instanceof AnalysisError && /Could not reach Gemini/.test(error.message) && !error.message.includes("private request details"));
    assert.equal(fetch.mock.callCount(), 3);
  });

  for (const [name, payload, message] of [
    ["truncated output", envelope("{}", "MAX_TOKENS"), /output limit/],
    ["blocked input", { promptFeedback: { blockReason: "SAFETY" } }, /blocked/],
    ["blocked output", envelope("{}", "SAFETY"), /did not complete/],
    ["missing candidates", {}, /did not complete/],
    ["missing text", { candidates: [{ finishReason: "STOP" }] }, /No valid assessment/],
    ["malformed envelope", { candidates: "invalid" }, /invalid response/],
    ["invalid JSON", envelope("{"), /not valid JSON/],
    ["invalid assessment", envelope("{}"), /did not pass validation/],
  ] as const) {
    it(`rejects ${name} instead of producing a score`, async () => {
      respond(payload);
      await assert.rejects(extractAssessment(source, config, signal(), options), message);
    });
  }

  it("rejects malformed HTTP JSON", async () => {
    mock.method(globalThis, "fetch", async () => new Response("{", { status: 200 }));
    await assert.rejects(extractAssessment(source, config, signal(), options), /invalid response/);
  });

  it("rejects a response missing any category or regional check", async () => {
    for (const remove of [(payload: ReturnType<typeof providerPayload>) => delete payload.findings.collection, (payload: ReturnType<typeof providerPayload>) => delete payload.legal.ccpa_gpc]) {
      const payload = providerPayload();
      remove(payload);
      respond(envelope(JSON.stringify(payload)));
      await assert.rejects(extractAssessment(source, config, signal(), options), (error: unknown) =>
        error instanceof AnalysisError && /did not pass validation/.test(error.message) && Array.isArray(error.cause));
      mock.restoreAll();
    }
  });

  it("requires an English privacy policy", async () => {
    respond(envelope(JSON.stringify({ ...providerPayload(), isEnglishPrivacyPolicy: false })));
    await assert.rejects(extractAssessment(source, config, signal(), options), /English privacy policy/);
  });

  it("propagates cancellation to the provider request", async () => {
    const controller = new AbortController();
    controller.abort();
    mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      assert.equal(init?.signal?.aborted, true);
      throw init?.signal?.reason;
    });
    await assert.rejects(extractAssessment(source, config, controller.signal, options), { name: "AbortError" });
  });

  it("stops retrying when cancelled during the retry wait", async () => {
    const controller = new AbortController();
    const fetch = mock.method(globalThis, "fetch", async () => { setTimeout(() => controller.abort(), 10); return Response.json({}, { status: 503 }); });
    await assert.rejects(extractAssessment(source, config, controller.signal, { retryDelayMs: 5000 }), { name: "AbortError" });
    assert.equal(fetch.mock.callCount(), 1);
  });
});

describe("quotation repair", () => {
  afterEach(() => mock.restoreAll());
  const report = sampleReports()[0];
  const extraction = { ...report, legal: legalChecks.map(({ region, topic }, index) => ({ ...report.legal[index % report.legal.length], region, topic })) };
  const sourceText = [...extraction.findings, ...extraction.legal].map(({ quote }) => quote).filter(Boolean).join("\n");
  const repairSource = { finalUrl: source.finalUrl, text: sourceText };
  const broken = { ...extraction, findings: extraction.findings.map((finding) => finding.id === "sharing" ? { ...finding, quote: "We absolutely never share anything with anyone at all." } : finding) };
  const exactSharing = extraction.findings.find(({ id }) => id === "sharing")!.quote!;

  it("makes no provider call when every quotation verifies", async () => {
    const fetch = respond({});
    const result = await repairQuotes(extraction, repairSource, config, signal(), options);
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(result.extraction, extraction);
    assert.equal(result.attempted, 0);
  });
  it("requests only the failed items and applies verified corrections without changing states", async () => {
    let schema: { properties: { quotes: { required: string[] } } } | undefined;
    mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      schema = JSON.parse(String(init?.body)).generationConfig.responseJsonSchema;
      return Response.json(envelope(JSON.stringify({ quotes: { sharing: exactSharing } })));
    });
    const result = await repairQuotes(broken, repairSource, config, signal(), options);
    assert.deepEqual(schema?.properties.quotes.required, ["sharing"]);
    assert.equal(result.attempted, 1);
    assert.equal(result.repaired, 1);
    assert.equal(result.extraction.findings.find(({ id }) => id === "sharing")?.quote, exactSharing);
    assert.deepEqual(result.extraction.findings.map(({ state }) => state), broken.findings.map(({ state }) => state));
  });
  it("leaves unverifiable corrections to be downgraded by verification", async () => {
    respond(envelope(JSON.stringify({ quotes: { sharing: "Another invented sentence that is not present." } })));
    const result = await repairQuotes(broken, repairSource, config, signal(), options);
    assert.equal(result.repaired, 0);
    assert.equal(verifyEvidence(result.extraction, sourceText).findings.find(({ id }) => id === "sharing")?.state, "unknown");
  });
  it("accepts null when the document has no supporting text", async () => {
    respond(envelope(JSON.stringify({ quotes: { sharing: null } })));
    const result = await repairQuotes(broken, repairSource, config, signal(), options);
    assert.equal(result.extraction.findings.find(({ id }) => id === "sharing")?.quote, null);
  });
  it("falls back to the original extraction when the repair request fails", async () => {
    for (const status of [400, 503]) {
      respond({}, status);
      const result = await repairQuotes(broken, repairSource, config, signal(), options);
      assert.equal(result.extraction, broken);
      assert.equal(result.repaired, 0);
      mock.restoreAll();
    }
  });
  it("propagates cancellation during repair", async () => {
    const controller = new AbortController();
    controller.abort();
    mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => { throw init?.signal?.reason; });
    await assert.rejects(repairQuotes(broken, repairSource, config, controller.signal, options), { name: "AbortError" });
  });
});

describe("Gemini configuration", () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
  });

  it("requires both Gemini settings", () => {
    for (const [key, model] of [["", ""], [" ", config.model], [config.apiKey, ""]]) {
      process.env.GEMINI_API_KEY = key;
      process.env.GEMINI_MODEL = model;
      assert.throws(geminiConfig, /Add GEMINI_API_KEY and GEMINI_MODEL/);
    }
  });

  it("rejects model paths and trims configured values", () => {
    process.env.GEMINI_API_KEY = ` ${config.apiKey} `;
    process.env.GEMINI_MODEL = "models/gemini-3.5-flash-lite";
    assert.throws(geminiConfig, /must be a Gemini model ID/);
    process.env.GEMINI_MODEL = ` ${config.model} `;
    assert.deepEqual(geminiConfig(), config);
  });
});
