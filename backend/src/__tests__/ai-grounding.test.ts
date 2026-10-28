import './test-env';
import assert from 'node:assert';
import { TradeComplianceExtractor } from '../ai/trade-extractor';
import { TransactionRegistry } from '../compliance/fraud/transaction-registry';
import { digestFacts } from '../trade-cases/document-text';
import { candidate } from '../trade-cases/rule-helpers';
import { withoutRuleDuplicates } from '../trade-cases/finding-dedupe';
import { matchForm, verifyCaseIssues, verifyDocumentIssues } from '../trade-cases/grounding';
import { statesQuantity } from '../trade-cases/rule-helpers';
import type { AiIssue, FindingCategory } from '../trade-cases/trade-case.types';

/**
 * The AI scrutiny must not report what the documents do not say. These suites use the text of a real
 * sample import permit, which states no quantity, and the mistake that was seen on it: a model-made
 * "the permit states 1 KGS" turned into a discrepancy against the invoice.
 */

const PERMIT = `TRADE FACILITATION OFFICE, KARACHI
IMPORT PERMIT
PERMIT NO: IP-2026-04424
DATE OF ISSUE: 05.01.2026
VALID UNTIL: 31.12.2026
IMPORTER: Kamran Textiles (Pvt) Ltd
The importer named above is registered and permitted to import raw cotton, not carded or combed (HS 5201).
PERMITTED GOODS: Raw cotton, HS 5201
ANNUAL QUANTITY LIMIT: None`;

const INVOICE = `PROFORMA INVOICE
INVOICE NO: PI-2026-0721
RAW COTTON FIBRE HS 5201.0010 100,000.00 KG USD 2.50 USD 250,000.00
TOTAL: USD 250,000.00`;

const issue = (over: Partial<AiIssue>): AiIssue => ({
  code: 'x',
  severity: 'MEDIUM',
  category: 'DATA_INCONSISTENCY',
  title: 'A point',
  description: 'd',
  evidence: '',
  regulation: '',
  customerAction: '',
  documentsInvolved: [],
  ...over,
});

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('AI scrutiny: nothing is reported that the documents do not say');
  console.log('================================================================\n');

  // ------------------------------------------------------------------ 1. matching ignores layout, not figures
  assert.strictEqual(matchForm('100,000 KGS'), matchForm('100000 kgs'));
  assert.notStrictEqual(matchForm('100,000 KG'), matchForm('1,000 KG'));
  console.log('✔ Scenario 1 Passed: quotes match on letters and digits, so layout does not matter and figures do.\n');

  // ------------------------------------------------------------------ 2. one document's issues
  const own = verifyDocumentIssues(
    [
      issue({ code: 'invented', title: 'Quantity is 1 KGS', evidence: 'Import permit quantity: "1 KGS"' }),
      issue({ code: 'real', title: 'Permit expires within the year', category: 'LC_TERM_ISSUE', evidence: '"VALID UNTIL: 31.12.2026"' }),
      issue({ code: 'unquoted', title: 'Dates conflict', evidence: '' }),
      issue({ code: 'missing', title: 'No signature date', category: 'MISSING_INFORMATION', evidence: '' }),
      issue({ code: 'bank', title: 'Dual use', category: 'COMPLIANCE_ALERT', evidence: '' }),
    ],
    PERMIT,
  );
  assert.deepStrictEqual(own.kept.map((i) => i.code), ['real', 'missing', 'bank'], 'a quote that is in the text stays; one that is not, and a claim with no quote, go');
  assert.deepStrictEqual(own.discarded.map((d) => d.title), ['Quantity is 1 KGS', 'Dates conflict']);
  assert.ok(own.discarded.every((d) => d.reason.length > 10), 'each dropped point says why');
  console.log('✔ Scenario 2 Passed: a one-document review keeps quoted facts and drops invented or unquoted ones.\n');

  // ------------------------------------------------------------------ 3. documents against each other
  const texts = new Map([
    ['04_Import_Permit.pdf', PERMIT],
    ['01_Proforma.pdf', INVOICE],
  ]);
  const cross = verifyCaseIssues(
    [
      // The mistake from the demo: the permit "states 1 KGS" and so differs from the invoice.
      issue({ code: 'permit-qty', title: 'Quantity Discrepancy in Import Permit', documentsInvolved: ['04_Import_Permit.pdf', '01_Proforma.pdf'], quotes: [{ file: '04_Import_Permit.pdf', text: 'Import permit quantity: 1 KGS' }, { file: '01_Proforma.pdf', text: '100,000.00 KG' }] }),
      issue({ code: 'one-sided', title: 'Only one side quoted', quotes: [{ file: '01_Proforma.pdf', text: '100,000.00 KG' }] }),
      issue({ code: 'ghost-file', title: 'Unknown file', quotes: [{ file: '09_Other.pdf', text: 'USD 250,000.00' }, { file: '01_Proforma.pdf', text: 'USD 250,000.00' }] }),
      // A real difference: the invoice total against a different figure the permit states, both quoted from the texts.
      issue({ code: 'real', title: 'Totals differ', quotes: [{ file: '01_Proforma', text: 'TOTAL: USD 250,000.00' }, { file: '04_Import_Permit.pdf', text: 'VALID UNTIL: 31.12.2026' }] }),
      issue({ code: 'doc-missing', title: 'No bill of exchange', category: 'MISSING_INFORMATION' }),
    ],
    texts,
  );
  assert.deepStrictEqual(cross.kept.map((i) => i.code), ['real', 'doc-missing'], 'only an issue whose every quote is in its document, from two documents for a difference, survives');
  assert.ok(cross.kept[0]!.evidence.includes('01_Proforma.pdf: "TOTAL: USD 250,000.00"'), 'the evidence is rebuilt from the verified quotes, with the real file name');
  assert.strictEqual(cross.discarded.length, 3);
  assert.ok(/not in that document/.test(cross.discarded[0]!.reason));
  console.log('✔ Scenario 3 Passed: a discrepancy between documents needs words from two of them and is dropped when a quote is invented.\n');

  // ------------------------------------------------------------------ 4. "not stated" never becomes a number
  const placeholder = { quantity: 1, unitPrice: 0, totalLineValue: 0 };
  assert.strictEqual(statesQuantity(placeholder), false, 'the old placeholder (1, no price, no total) is not a stated quantity');
  assert.strictEqual(statesQuantity({ quantity: 0, unitPrice: 0, totalLineValue: 0 }), false);
  assert.strictEqual(statesQuantity({ quantity: 1, unitPrice: 5, totalLineValue: 5 }), true, 'one item at a stated price is a real quantity');
  assert.strictEqual(statesQuantity({ quantity: 100000, unitPrice: 0, totalLineValue: 0 }), true, 'a quantity limit with no price is real');

  TransactionRegistry.getInstance().resetForTesting();
  const analysis = await new TradeComplianceExtractor().processTradeDocument({
    documentId: '00000000-0000-4000-8000-0000000000a1',
    filename: '04_Import_Permit.pdf',
    rawText: PERMIT,
    rawBuffer: Buffer.from(PERMIT),
    aiModel: 'stub',
    // What the model returns for a permit with no quantity: zero, as the extraction prompt asks.
    aiJsonOutput: { documentClassification: { type: 'Import Permit', number: 'IP-2026-04424' }, goods: [{ productDescription: 'Raw cotton', quantity: 0, unitOfMeasure: 'KGS', unitPrice: 0, totalLineValue: 0, hsCode: '5201' }] },
  });
  assert.strictEqual(analysis.goods[0]!.quantity, 0, 'a quantity the document does not state stays 0 (it used to become 1)');
  const facts = digestFacts(analysis);
  assert.ok(facts.includes('quantity not stated') && !/quantity 1\b/.test(facts), `the review is told the quantity is not stated (got: ${facts.split('\n').find((l) => l.startsWith('Goods line'))})`);
  // An analysis stored before the fix still carries the placeholder; the review is not told "1 KGS".
  const legacy = digestFacts({ ...analysis, goods: [{ ...analysis.goods[0]!, quantity: 1 }] });
  assert.ok(legacy.includes('quantity not stated'), 'an old stored placeholder is not repeated either');
  console.log('✔ Scenario 4 Passed: a quantity the document does not state stays "not stated" in the extraction and in what the review is told.\n');

  // ------------------------------------------------------------------ 5. one point, listed once
  const base = { expected: 'e', recommendedAction: 'r', description: 'd' };
  const rule = (ruleId: string, subject: string, fields: string[]) => candidate(ruleId, subject, { ...base, title: ruleId, fields });
  const ai = (key: string, category: FindingCategory, title: string, fields: string[]) => candidate('AI-DOC-REVIEW', key, { ...base, title, category, fields });
  const rules = [rule('EXT-HS-CLASS', 'PROFORMA_INVOICE:1', ['hsCode']), rule('PT-REQ-001', 'expiryDate', ['expiryDate']), rule('PT-REQ-001', 'latestShipmentDate', ['latestShipmentDate']), rule('PT-PI-ARITHMETIC', 'doc', ['amount'])];
  const kept = withoutRuleDuplicates(
    [
      ai('LC_APPLICATION_FORM:a', 'MISSING_INFORMATION', 'both dates missing', ['expiryDate', 'latestShipmentDate']),
      ai('LC_APPLICATION_FORM:b', 'MISSING_INFORMATION', 'date and a port missing', ['expiryDate', 'portOfLoading']),
      ai('LC_APPLICATION_FORM:c', 'MISSING_INFORMATION', 'no field named', []),
      ai('PROFORMA_INVOICE:d', 'DATA_INCONSISTENCY', 'invoice arithmetic', ['quantity', 'unitPrice', 'amount', 'arithmetic']),
      ai('PURCHASE_ORDER:e', 'DATA_INCONSISTENCY', 'order arithmetic', ['arithmetic']),
      ai('PROFORMA_INVOICE:f', 'DATA_INCONSISTENCY', 'amount differs between documents', ['amount']),
      ai('PROFORMA_INVOICE:g', 'DATA_INCONSISTENCY', 'arithmetic and a date', ['arithmetic', 'latestShipmentDate']),
      ai('PROFORMA_INVOICE:h', 'LC_TERM_ISSUE', 'HS code does not fit the goods (AI)', ['hsCode', 'goodsDescription']),
      ai('PURCHASE_ORDER:i', 'LC_TERM_ISSUE', 'HS code does not fit the goods, other document (AI)', ['hsCode']),
    ],
    rules,
  ).map((c) => c.title);
  assert.deepStrictEqual(kept, ['date and a port missing', 'no field named', 'order arithmetic', 'amount differs between documents', 'arithmetic and a date', 'HS code does not fit the goods, other document (AI)'], 'only what a rule already reports is dropped: not a partly covered issue, an untagged one, another document, or a difference between documents');
  assert.deepStrictEqual(withoutRuleDuplicates([ai('LC_APPLICATION_FORM:x', 'MISSING_INFORMATION', 'expiry missing', ['expiryDate'])], []).length, 1, 'with no rule finding, nothing is dropped');
  console.log('✔ Scenario 5 Passed: a point the AI and a rule both report is listed once, as the rule; nothing else is dropped.\n');

  console.log('================================================================');
  console.log('ALL AI GROUNDING SCENARIOS PASSED');
  console.log('================================================================');
}

run().catch((error) => {
  console.error('AI GROUNDING TEST FAILED:', error);
  process.exit(1);
});
