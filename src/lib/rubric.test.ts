import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { categories, scoreReport, type CategoryFinding } from "./rubric.ts";

const complete = (): CategoryFinding[] => categories.map(({ id }) => ({ id, state: "strong", explanation: "Specific commitment", quote: "We limit the data we collect.", section: "Privacy" }));

describe("evidence-backed privacy scoring", () => {
  it("weights total 100 and supported protections receive ten", () => {
    assert.equal(categories.reduce((sum, item) => sum + item.weight, 0), 100);
    assert.equal(scoreReport(complete()).overall, 10);
  });
  it("withholds a score when evidence is missing", () => {
    assert.equal(scoreReport([]).overall, null);
    assert.equal(scoreReport([]).coverage, 0);
  });
  it("requires every high-impact category even above 80% coverage", () => {
    const findings = complete().filter(({ id }) => id !== "controls");
    assert.equal(scoreReport(findings).overall, null);
    assert.equal(scoreReport(findings).coverage, 88);
  });
  it("does not award points to unsupported assertions", () => {
    const findings = complete().map((finding) => ({ ...finding, quote: null }));
    assert.equal(scoreReport(findings).overall, null);
  });
  it("does not turn a critical category into not applicable", () => {
    const findings = complete();
    findings[0].state = "not_applicable";
    assert.equal(scoreReport(findings).overall, null);
  });
  it("distinguishes explicit weak protections from unknowns", () => {
    const findings = complete();
    findings[2].state = "weak";
    assert.equal(scoreReport(findings).overall, 8.2);
    assert.equal(scoreReport(findings).coverage, 100);
  });
});