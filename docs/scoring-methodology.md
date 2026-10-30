# Scoring Methodology v1.0.0

This is a proposed, versioned consumer rubric inspired by NIST privacy risk management, FTC guidance and consumer-rights disclosure expectations. These sources do not prescribe or certify a numeric score. Scores assess the supplied policy, not independently verified conduct or legal compliance.

| Category | Weight | Strong anchor | Weak anchor |
| --- | ---: | --- | --- |
| Collection | 14% | Necessary data and bounded sources | Broad or unnecessary collection |
| Purposes | 12% | Specific purposes and bounded secondary use | Unrestricted secondary use or AI training |
| Sharing | 18% | No sale/behavioral ads; limited contracted processors | Sale, behavioral advertising, broad onward sharing |
| Controls | 12% | Protective defaults and accessible withdrawal | Intrusive defaults or burdensome opt-outs |
| Rights | 12% | Usable access, correction, deletion and redress | Explicit material restrictions on access/deletion |
| Retention | 10% | Specific periods and bounded exceptions | Indefinite or unbounded retention |
| Sensitive data/children | 8% | Explicit minimization and age-appropriate protections | Sensitive collection without added limits |
| Security | 6% | Specific safeguards and incident commitments | Explicitly weak safeguards or broad disclaimers |
| Transfers | 4% | Destinations and safeguards explained | Unrestricted transfers without safeguards |
| Transparency | 4% | Clear entity, scope, contact and change notices | Unclear scope, ownership or change practices |

Strong = 10, mixed = 5, weak = 0. Mixed means specific protective commitments exist but material exceptions remain. Weak needs explicit policy evidence, not silence. Strong needs specific commitments satisfying the anchor without material exceptions; generic buzzwords are insufficient. Unknown means absent, ambiguous, or unverifiable evidence and carries no numerical value. Supported not-applicable can exclude only noncritical categories. Each evidence-bearing finding needs a verbatim source quote: words and punctuation must match the fetched text, ignoring only whitespace and curly-versus-straight quote marks, and the stored excerpt is always the exact source text. Quotations that fail verification get one targeted re-request for an exact excerpt supporting the same assessment; the assessment itself is never changed, and anything still unverifiable becomes unknown.

The overall score is the weighted mean of assessable applicable categories, rounded once to one decimal. Coverage is assessable applicable weight divided by applicable rubric weight. Supported noncritical N/A categories leave the denominator. The overall score is withheld below 80% coverage or if collection, purposes, sharing, controls or rights is unassessable. Unknown is never scored zero or ten. Compare only compatible rubrics and category bases, with dates and coverage visible. No winner is automatically declared.

Sharing practice is scored under sharing; usability of its choice mechanisms belongs under controls. Security commitments are not a security audit. Applicable legal rights and exceptions must not be reduced to unconditional promises. Regional checks are separate from the protection score and use a fixed checklist so policies are comparable. GDPR covers data subject rights, purposes and lawful basis, retention periods, and international transfers. CCPA/CPRA covers rights to know, delete and correct; sale or sharing opt-out; sensitive personal information limits; and Global Privacy Control. Each result is evidence found, potential gap, unclear, or qualified not applicable. A missing disclosure is not automatically a legal violation. Model interpretation can still be wrong even when a quote matches exactly.

Source URL, final URL, analysis time, normalized text hash, model, prompt and rubric versions accompany reports. Only short excerpts survive publication; full source reproduction is intentionally not possible from stored reports alone. Policies can change after retrieval.

## References

- https://www.nist.gov/privacy-framework
- https://www.ftc.gov/business-guidance/privacy-security
- https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en
- https://oag.ca.gov/privacy/ccpa

Review current primary legal sources before changing disclosure criteria. This prototype does not certify GDPR or CCPA/CPRA applicability or compliance.