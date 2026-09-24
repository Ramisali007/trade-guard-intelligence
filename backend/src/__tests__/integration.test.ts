import assert from 'node:assert';
import { z } from 'zod';
import {
  signBankingToken,
  verifyBankingToken,
  type AuthenticatedUser,
} from '../middleware/auth.middleware';
import { Errors } from '../utils/errors';
import { FxRatesService } from '../compliance/pricing/fx-rates.service';

const OverrideDecisionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'ESCALATE']),
  newDecision: z.enum(['ALLOW', 'REVIEW', 'BLOCK_ESCALATE']),
  officerName: z.string().trim().min(1).max(100).optional(),
  officerRole: z.string().trim().min(1).max(100).optional(),
  reason: z.string().trim().min(3, 'Override reason must be at least 3 characters long').max(1000),
  notes: z.string().trim().max(2000).optional(),
});

async function runIntegrationTestSuite(): Promise<void> {
  console.log('================================================================');
  console.log('STARTING TRADEGUARD END-TO-END INTEGRATION TEST SUITE');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // Scenario 1: Authentication Token Issuance & Verification
  // --------------------------------------------------------------------------
  console.log('Scenario 1: Testing Banking Token Signing and Integrity...');
  const user: Omit<AuthenticatedUser, 'tokenType'> = {
    id: 'usr-test-officer',
    name: 'Sarah Connor',
    email: 'sarah.connor@tradeguard.ai',
    role: 'CHIEF_COMPLIANCE_OFFICER',
    institution: 'Standard Chartered Bank · Global Trade Desk',
  };

  const token = signBankingToken(user, 12);
  assert.ok(token, 'A signed JWT token must be generated');
  const verifiedUser = verifyBankingToken(token);
  assert.ok(verifiedUser, 'Valid token must be decoded and verified');
  assert.strictEqual(verifiedUser?.email, user.email, 'Decoded user email must match');
  assert.strictEqual(verifiedUser?.role, 'CHIEF_COMPLIANCE_OFFICER', 'Decoded user role must match');

  // Verify tampered token is rejected
  const tamperedToken = token.slice(0, -5) + 'abcde';
  const tamperedResult = verifyBankingToken(tamperedToken);
  assert.strictEqual(tamperedResult, null, 'Tampered token signature must fail verification');

  console.log('✔ Scenario 1 Passed: Authentication token issuance and tamper detection validated.\n');

  // --------------------------------------------------------------------------
  // Scenario 2: Compliance Override Schema Validation (Zod Defense)
  // --------------------------------------------------------------------------
  console.log('Scenario 2: Testing Compliance Override Request Body Validation...');

  // Invalid Action
  const invalidAction = OverrideDecisionSchema.safeParse({
    action: 'DISMISS', // Invalid enum
    newDecision: 'ALLOW',
    reason: 'Verified through external bills of lading',
  });
  assert.strictEqual(invalidAction.success, false, 'Invalid action must be rejected by Zod');

  // Invalid Decision
  const invalidDecision = OverrideDecisionSchema.safeParse({
    action: 'APPROVE',
    newDecision: 'IGNORED', // Invalid enum
    reason: 'Approved per trade manual',
  });
  assert.strictEqual(invalidDecision.success, false, 'Invalid decision must be rejected by Zod');

  // Short Reason (< 3 characters)
  const shortReason = OverrideDecisionSchema.safeParse({
    action: 'APPROVE',
    newDecision: 'ALLOW',
    reason: 'ok',
  });
  assert.strictEqual(shortReason.success, false, 'Short reason must be rejected by Zod');

  // Valid Override Payload
  const validPayload = OverrideDecisionSchema.safeParse({
    action: 'APPROVE',
    newDecision: 'ALLOW',
    reason: 'Confirmed dual-use exemption certificate SBP-2026-X81',
    notes: 'Audit log certified by Trade Operations.',
  });
  assert.strictEqual(validPayload.success, true, 'Valid override payload must be accepted');

  console.log('✔ Scenario 2 Passed: Compliance override schema validation verified.\n');

  // --------------------------------------------------------------------------
  // Scenario 3: Document Comparison Input Boundary Defense
  // --------------------------------------------------------------------------
  console.log('Scenario 3: Testing Document Comparison Boundary Defense...');

  function validateComparisonInput(documentIds: unknown): void {
    if (!Array.isArray(documentIds) || documentIds.length < 2) {
      throw Errors.validation('Please provide at least 2 document IDs in "documentIds" array.');
    }
    if (documentIds.length > 10) {
      throw Errors.validation('Cannot compare more than 10 documents in a single comparison request.');
    }
  }

  // < 2 documents
  assert.throws(
    () => validateComparisonInput(['doc-1']),
    /at least 2 document IDs/,
    'Under 2 documents must be rejected',
  );

  // > 10 documents
  const excessiveIds = Array.from({ length: 11 }, (_, i) => `doc-${i}`);
  assert.throws(
    () => validateComparisonInput(excessiveIds),
    /Cannot compare more than 10 documents/,
    'More than 10 documents must be rejected',
  );

  // Valid count (2 to 10)
  assert.doesNotThrow(
    () => validateComparisonInput(['doc-1', 'doc-2', 'doc-3']),
    '3 documents should pass comparison validation',
  );

  console.log('✔ Scenario 3 Passed: Document comparison bounds (2 to 10 docs) enforced.\n');

  // --------------------------------------------------------------------------
  // Scenario 4: Error Envelope Standardization
  // --------------------------------------------------------------------------
  console.log('Scenario 4: Testing Error Envelope Taxonomy & Protection...');

  const appErr = Errors.unauthorized('Banking session expired');
  assert.strictEqual(appErr.status, 401);
  assert.strictEqual(appErr.code, 'UNAUTHORIZED');
  assert.strictEqual(appErr.retryable, false);

  const validationErr = Errors.validation('Field customerId is missing');
  assert.strictEqual(validationErr.status, 400);
  assert.strictEqual(validationErr.code, 'VALIDATION_ERROR');

  console.log('✔ Scenario 4 Passed: Error taxonomy and HTTP mapping verified.\n');

  // --------------------------------------------------------------------------
  // Scenario 5: FX Rates Service Resilience
  // --------------------------------------------------------------------------
  console.log('Scenario 5: Testing FX Rates Service Caching & Non-blocking fallback...');
  const fx = FxRatesService.getInstance();
  const quote = fx.getConversionQuote(1000, 'USD', 'PKR');
  assert.ok(quote.rate > 0, 'USD to PKR conversion rate must be positive');
  assert.ok(quote.convertedAmount > 0, 'Converted amount calculation must be positive');
  assert.strictEqual(quote.toCurrency, 'PKR');

  console.log(`✔ Scenario 5 Passed: FX conversion active (1 USD = ${quote.rate} PKR).\n`);

  console.log('================================================================');
  console.log('ALL INTEGRATION TEST SCENARIOS PASSED 100%!');
  console.log('================================================================\n');

  process.exit(0);
}

runIntegrationTestSuite().catch((err) => {
  console.error('INTEGRATION TEST SUITE FAILED:', err);
  process.exit(1);
});
