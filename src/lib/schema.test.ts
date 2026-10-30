import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractionSchema, findSourceSpan, verifyEvidence } from "./schema.ts";
import { sampleReports } from "./sample.ts";

describe("structured evidence validation", () => {
  it("samples satisfy the same schema as live reports", () => {
    for (const report of sampleReports()) assert.equal(extractionSchema.safeParse(report).success, true);
  });
  it("downgrades fabricated quotes instead of scoring them", () => {
    const report = sampleReports()[0];
    const verified = verifyEvidence(report, "An unrelated policy document.");
    assert.ok(verified.findings.every((finding) => finding.state === "unknown" && finding.quote === null));
    assert.ok(verified.legal.every((finding) => finding.status === "unclear"));
  });
  it("preserves exact quoted evidence", () => {
    const report = sampleReports()[0];
    const text = report.findings.map(({ quote }) => quote).join("\n");
    assert.equal(verifyEvidence(report, text).findings[0].state, "strong");
  });
  it("rejects duplicate category assessments", () => {
    const report = sampleReports()[0];
    report.findings[0] = report.findings[1];
    assert.equal(extractionSchema.safeParse(report).success, false);
  });
});

describe("source quotation matching", () => {
  const source = "Intro.\nThe data we collect can include the following:\nName and contact details.\nWe don\u2019t sell \u201cpersonal data\u201d.\nWe use data to:\nProvide our services\nMaintain our services";

  it("matches across line breaks and returns the exact source excerpt", () => {
    assert.equal(findSourceSpan(source, "the following: Name and contact details."), "the following:\nName and contact details.");
  });
  it("ignores only curly versus straight quote marks", () => {
    assert.equal(findSourceSpan(source, "We don't sell \"personal data\"."), "We don\u2019t sell \u201cpersonal data\u201d.");
  });
  it("rejects list items joined with added punctuation", () => {
    assert.equal(findSourceSpan(source, "We use data to: Provide our services, Maintain our services"), null);
  });
  it("rejects changed or omitted words", () => {
    assert.equal(findSourceSpan(source, "We never sell personal data."), null);
    assert.equal(findSourceSpan(source, "The data we collect includes the following:"), null);
  });
  it("stores the source excerpt in verified reports", () => {
    const report = sampleReports()[0];
    const text = report.findings.map(({ quote }) => quote?.replace(/ /g, "\n")).join("\n");
    const verified = verifyEvidence(report, text);
    assert.equal(verified.findings[0].state, report.findings[0].state);
    assert.equal(verified.findings[0].quote, report.findings[0].quote?.replace(/ /g, "\n"));
  });
  it("verifies many quotations in a maximum-size policy within a second", () => {
    const text = "We describe how personal data is used.\n".repeat(8300) + "Final unique sentence about retention.";
    assert.ok(Buffer.byteLength(text) >= 320_000);
    const report = sampleReports()[0];
    const started = performance.now();
    verifyEvidence({ ...report, legal: Array(20).fill({ ...report.legal[0], quote: "Final unique sentence about retention." }) }, text);
    assert.ok(performance.now() - started < 1000);
  });
});