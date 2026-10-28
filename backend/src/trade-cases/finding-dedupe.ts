import type { CandidateFinding } from './rule-helpers';

/**
 * The AI review and the rules engine can find the same problem: a field no document states, or an
 * invoice whose arithmetic does not add up. The case should list it once. The AI tags each issue with
 * the application field it is about (the same names the rules use), and an AI issue is left out when
 * every field it names is already reported by a rule that says the same kind of thing. The rule's
 * finding is the one kept: it is deterministic and carries the audit trail.
 *
 * What is NOT treated as a duplicate: a difference between documents (the rules compare the
 * application with the proforma invoice, not the documents with each other), an issue with no field
 * tag, and an issue about a field no rule has reported.
 */

/** The tag the AI uses when a quantity x price or a total does not add up. */
export const ARITHMETIC_TAG = 'arithmetic';

/** The fields an arithmetic check is about: quantity x unit price = line total, lines add up to the total. */
const ARITHMETIC_OPERANDS = new Set(['quantity', 'unitPrice', 'amount', 'unitOfMeasure']);

function coveredByRule(ai: CandidateFinding, rules: CandidateFinding[]): boolean {
  if (ai.fields.length === 0) return false;
  if (ai.category === 'MISSING_INFORMATION') {
    // "The application does not state X" is the same point as "this document does not state X".
    return ai.fields.every((field) => rules.some((r) => r.ruleId === 'PT-REQ-001' && r.fields.includes(field)));
  }
  if (ai.key.startsWith('AI-DOC-REVIEW:') && ai.fields.includes('hsCode') && ai.fields.every((f) => f === 'hsCode' || f === 'goodsDescription')) {
    // "The HS code does not fit the goods" in one document: the official-reference check on that document says so already.
    const documentType = ai.key.split(':')[1];
    return rules.some((r) => (r.ruleId === 'EXT-HS-CLASS' || r.ruleId === 'EXT-HS-VALID') && r.key.split(':')[1] === documentType);
  }
  if (ai.category === 'DATA_INCONSISTENCY' && ai.key.startsWith('AI-CASE-REVIEW:') && ai.fields.every((f) => f === 'hsCode')) {
    // The documents declare different HS codes: the deterministic cross-document check says so already.
    return rules.some((r) => r.ruleId === 'EXT-HS-CROSSDOC');
  }
  if (ai.category === 'DATA_INCONSISTENCY' && ai.key.startsWith('AI-DOC-REVIEW:PROFORMA_INVOICE:') && ai.fields.includes(ARITHMETIC_TAG)) {
    // The rule checks the proforma invoice's own arithmetic; the issue must be about nothing else.
    return ai.fields.every((f) => f === ARITHMETIC_TAG || ARITHMETIC_OPERANDS.has(f)) && rules.some((r) => r.ruleId === 'PT-PI-ARITHMETIC');
  }
  return false;
}

/** The AI candidates that are not already reported by a rule candidate. */
export function withoutRuleDuplicates(aiFindings: CandidateFinding[], ruleFindings: CandidateFinding[]): CandidateFinding[] {
  return aiFindings.filter((ai) => !coveredByRule(ai, ruleFindings));
}
