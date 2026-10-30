export const RUBRIC_VERSION = "1.0.0";

export const categories = [
  { id: "collection", name: "Data collection", weight: 14, critical: true, weak: "Broad or unnecessary collection", strong: "Limited to necessary data" },
  { id: "purposes", name: "Purpose & reuse", weight: 12, critical: true, weak: "Unrestricted secondary use or AI training", strong: "Specific purposes and bounded secondary use" },
  { id: "sharing", name: "Sharing & advertising", weight: 18, critical: true, weak: "Sale, behavioral advertising or broad onward sharing", strong: "No sale or behavioral advertising; limited processors" },
  { id: "controls", name: "Consent & controls", weight: 12, critical: true, weak: "Intrusive defaults or burdensome opt-outs", strong: "Protective defaults and accessible withdrawal" },
  { id: "rights", name: "Your rights", weight: 12, critical: true, weak: "Materially restricted access or deletion", strong: "Usable access, correction, deletion and redress" },
  { id: "retention", name: "Retention & deletion", weight: 10, critical: false, weak: "Indefinite or unbounded retention", strong: "Specific periods and bounded deletion exceptions" },
  { id: "sensitive", name: "Sensitive data & children", weight: 8, critical: false, weak: "Sensitive collection without additional limits", strong: "Explicit minimization and age-appropriate protections" },
  { id: "security", name: "Security commitments", weight: 6, critical: false, weak: "Explicitly weak safeguards or broad disclaimers", strong: "Specific safeguards and incident commitments" },
  { id: "transfers", name: "International transfers", weight: 4, critical: false, weak: "Unrestricted transfers without safeguards", strong: "Clear destinations and transfer safeguards" },
  { id: "transparency", name: "Transparency", weight: 4, critical: false, weak: "Unclear scope, ownership or change practices", strong: "Clear entity, scope, contact and change notices" },
] as const;

export type CategoryId = (typeof categories)[number]["id"];
export type EvidenceState = "strong" | "mixed" | "weak" | "unknown" | "not_applicable";
export type CategoryFinding = {
  id: CategoryId;
  state: EvidenceState;
  explanation: string;
  quote: string | null;
  section: string | null;
};

export function scoreReport(findings: CategoryFinding[]) {
  const points = { strong: 10, mixed: 5, weak: 0 };
  let applicable = 0;
  let covered = 0;
  let total = 0;
  let criticalCovered = true;
  const breakdown = categories.map((category) => {
    const finding = findings.find((entry) => entry.id === category.id);
    const state = finding?.state ?? "unknown";
    const supported = Boolean(finding?.quote?.trim());
    const justifiedNA = state === "not_applicable" && supported && !category.critical;
    const score = supported && state in points ? points[state as keyof typeof points] : null;
    if (!justifiedNA) applicable += category.weight;
    if (score !== null) {
      covered += category.weight;
      total += score * category.weight;
    }
    if (category.critical && score === null) criticalCovered = false;
    return { ...category, score, state: justifiedNA ? "not_applicable" : score === null ? "unknown" : state };
  });
  const coverage = applicable ? Math.round((covered / applicable) * 100) : 0;
  const eligible = covered >= applicable * 0.8 && criticalCovered;
  return { overall: eligible && covered ? Math.round((total / covered) * 10) / 10 : null, coverage, breakdown };
}