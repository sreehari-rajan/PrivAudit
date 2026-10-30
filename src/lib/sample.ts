import { categories, type EvidenceState } from "./rubric.ts";
import { buildReport, type Extraction, type Report } from "./schema.ts";

const samplePolicies = [
  {
    name: "Willow Notes", domain: "willow.example", states: ["strong", "strong", "mixed", "strong", "strong", "mixed", "strong", "strong", "strong", "strong"],
    quotes: [
      "We collect your email address and the notes you choose to save. Optional diagnostics are off by default.",
      "We use your information only to provide and maintain your notes. We do not use your content to train AI models.",
      "We do not sell your information or use behavioral advertising. Our hosting and email providers process information under contract, although their subprocessor lists may change.",
      "Optional processing is off by default. You can withdraw permission at any time in your account settings.",
      "You can access, export, correct or delete your information in settings, or contact our privacy team to appeal a decision.",
      "We delete active account data within 30 days of a deletion request. Encrypted backups are retained as long as needed for operational purposes.",
      "Do not submit sensitive personal information. We do not knowingly collect information from children under 16.",
      "We encrypt data in transit and at rest, restrict staff access, and notify affected users of confirmed breaches where required.",
      "Our primary servers are in the EU. Transfers to US support processors use standard contractual clauses and supplementary safeguards.",
      "Willow Notes Ltd is responsible for this policy. We notify users before material changes and provide a dedicated privacy contact.",
    ],
  },
  {
    name: "Beacon Social", domain: "beacon.example", states: ["mixed", "weak", "weak", "mixed", "strong", "mixed", "mixed", "strong", "mixed", "strong"],
    quotes: [
      "We collect account details, device identifiers, activity, approximate location and information from advertising partners.",
      "We may use your content for any business purpose, including training general-purpose AI models, without additional permission.",
      "We share browsing activity and identifiers with advertising partners for cross-context behavioral advertising and may sell this information.",
      "Personalized advertising is enabled by default. You may opt out using the privacy request form.",
      "You can request access, correction, export or deletion and appeal a denial through our privacy portal.",
      "We retain account information while your account is active and for as long as reasonably necessary for business purposes afterward.",
      "Precise location is collected with device permission. Teen accounts receive limited advertising, with some personalization remaining enabled.",
      "We use encryption, role-based access and regular testing, and maintain an incident response process.",
      "Information may be transferred to international service providers under contractual protections; destination countries vary.",
      "Beacon Social Inc controls this information. This policy identifies our privacy contact and explains how we announce changes.",
    ],
  },
  {
    name: "Atlas Calendar", domain: "atlas.example", states: ["strong", "mixed", "mixed", "strong", "strong", "mixed", "unknown", "strong", "unknown", "strong"],
    quotes: [
      "We collect calendar entries and your email address only when needed to deliver the service.",
      "We use calendar metadata to improve the service and may develop related products using aggregated information.",
      "We do not sell personal information. We share information with analytics providers, which may use it for their own service improvements.",
      "Optional analytics is disabled initially and permission can be withdrawn from settings at any time.",
      "You can access, correct, export and delete your data, and contact us to appeal decisions.",
      "Deleted entries are removed from active systems within 30 days, but operational archives have no fixed deletion schedule.",
      null,
      "We encrypt calendar information in transit and at rest and restrict access to authorized personnel.",
      null,
      "Atlas Calendar LLC is the data controller. We publish a dated policy and notify users of material changes.",
    ],
  },
] as const;

export function sampleReports(): Report[] {
  return samplePolicies.map((sample) => {
    const extraction: Extraction = {
      organization: sample.name,
      isEnglishPrivacyPolicy: true,
      findings: categories.map((category, index) => ({
        id: category.id,
        state: sample.states[index] as EvidenceState,
        quote: sample.quotes[index],
        section: category.name,
        explanation: sample.states[index] === "unknown" ? "This fictional policy does not provide enough information to assess this category." : sample.states[index] === "strong" ? category.strong + ". This is a stated commitment, not an independent audit." : sample.states[index] === "weak" ? category.weak + ". This explicitly permits a material privacy risk." : "Some protections are stated, but material exceptions or vague commitments remain.",
      })),
      legal: [
        { region: "GDPR", topic: "Access, correction and deletion", status: "evidence_found", explanation: "A rights process is described. Actual fulfillment, exceptions and GDPR applicability are not verified.", quote: sample.quotes[4], section: "Your rights" },
        { region: "GDPR", topic: "Retention disclosures", status: "potential_gap", explanation: "Retention language includes unbounded exceptions. This is a disclosure concern, not a finding of noncompliance.", quote: sample.quotes[5], section: "Retention" },
        { region: "CCPA/CPRA", topic: "Sale and sharing disclosure", status: "evidence_found", explanation: "The policy discusses sharing. Applicability, notice delivery and real-world practices are not established.", quote: sample.quotes[2], section: "Sharing" },
        { region: "CCPA/CPRA", topic: "Global Privacy Control", status: "unclear", explanation: "No verified Global Privacy Control commitment was found. Legal applicability remains uncertain.", quote: null, section: null },
      ],
    };
    return buildReport(extraction, { url: `https://${sample.domain}/privacy`, finalUrl: `https://${sample.domain}/privacy`, hash: "fictional-sample-not-fetched" }, "Fictional sample - no AI call", true);
  });
}