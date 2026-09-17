import assert from 'node:assert';
import { ImageStorageService } from '../services/image-storage.service';
import { ImportBatchService } from '../compliance/import/import-batch.service';
import {
  signBankingToken,
  verifyBankingToken,
  normalizeRole,
  requireRole,
  type BankingRole,
  type AuthenticatedUser,
} from '../middleware/auth.middleware';

async function runSecurityTestSuite(): Promise<void> {
  console.log('================================================================');
  console.log('STARTING BANK-GRADE SECURITY & VULNERABILITY REGRESSION TEST');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // Scenario 1: Path Traversal Defense (CWE-22)
  // --------------------------------------------------------------------------
  console.log('Scenario 1: Testing Path Traversal Defense on Image Storage...');
  const imageStorage = new ImageStorageService('storage/test-images');

  // Test 1.1: Malicious documentId traversal
  let pathTraversalBlocked = false;
  try {
    await imageStorage.getImage('../../etc', 'passwd');
  } catch (err: any) {
    if (err.message.includes('Security Exception') || err.message.includes('Path traversal')) {
      pathTraversalBlocked = true;
    }
  }
  assert.strictEqual(pathTraversalBlocked, true, 'Expected path traversal with ../ in documentId to be blocked');

  // Test 1.2: Malicious imageId traversal
  pathTraversalBlocked = false;
  try {
    await imageStorage.getImage('valid-doc-id', '../../../win.ini');
  } catch (err: any) {
    if (err.message.includes('Security Exception') || err.message.includes('Path traversal')) {
      pathTraversalBlocked = true;
    }
  }
  assert.strictEqual(pathTraversalBlocked, true, 'Expected path traversal with ../ in imageId to be blocked');

  // Test 1.3: Null byte / special characters injection
  let specialCharBlocked = false;
  try {
    await imageStorage.getImage('doc<script>', 'img|pipe');
  } catch (err: any) {
    if (err.message.includes('Security Exception')) {
      specialCharBlocked = true;
    }
  }
  assert.strictEqual(specialCharBlocked, true, 'Expected special characters/null bytes in IDs to be blocked');
  console.log('✔ Scenario 1 Passed: Path Traversal attacks (CWE-22) successfully neutralized.\n');

  // --------------------------------------------------------------------------
  // Scenario 2: Server-Side Request Forgery (SSRF) Defense (CWE-918)
  // --------------------------------------------------------------------------
  console.log('Scenario 2: Testing SSRF Defense & Cloud Metadata Shielding...');
  const batchService = ImportBatchService.getInstance();

  const maliciousUrls = [
    { url: 'http://169.254.169.254/latest/meta-data/', desc: 'AWS/Cloud Metadata Endpoint' },
    { url: 'http://127.0.0.1:4000/api/documents/delete-history', desc: 'Loopback Localhost IP' },
    { url: 'http://localhost:4000/api/config', desc: 'Localhost Domain' },
    { url: 'http://10.0.0.1/admin-console', desc: 'RFC 1918 10.0.0.0/8 Subnet' },
    { url: 'http://172.20.0.1/secrets', desc: 'RFC 1918 172.16.0.0/12 Subnet' },
    { url: 'http://192.168.1.1/router-settings', desc: 'RFC 1918 192.168.0.0/16 Subnet' },
    { url: 'http://[::1]/status', desc: 'IPv6 Loopback' },
    { url: 'ftp://ftp.bank.internal/dump.csv', desc: 'Non-HTTP Protocol' },
    { url: 'http://2130706433/login', desc: 'Decimal Encoded Localhost IP' },
  ];

  for (const { url, desc } of maliciousUrls) {
    let ssrfBlocked = false;
    try {
      await batchService.fetchUrlSourceSafely(url);
    } catch (err: any) {
      if (
        err.message.includes('SSRF Protection Error') ||
        err.message.includes('Invalid URL') ||
        err.message.includes('Only HTTP/HTTPS')
      ) {
        ssrfBlocked = true;
      }
    }
    assert.strictEqual(ssrfBlocked, true, `Expected SSRF protection to block ${desc} (${url})`);
  }
  console.log('✔ Scenario 2 Passed: SSRF attacks & internal subnet exfiltration (CWE-918) 100% blocked.\n');

  // --------------------------------------------------------------------------
  // Scenario 3: Bank-Grade Cryptographic JWT Signing & Token Integrity
  // --------------------------------------------------------------------------
  console.log('Scenario 3: Testing Cryptographic Token Generation & Signature Integrity...');
  const officerUser: Omit<AuthenticatedUser, 'tokenType'> = {
    id: 'usr-sbp-01',
    name: 'Ramis Ali',
    email: 'ramis.ali@tradeguard.ai',
    role: 'CHIEF_COMPLIANCE_OFFICER',
    institution: 'State Bank of Pakistan · Trade Operations',
  };

  const token = signBankingToken(officerUser, 24);
  assert.ok(token, 'Token should be generated');
  const tokenParts = token.split('.');
  assert.strictEqual(tokenParts.length, 3, 'JWT token must have header.payload.signature format');

  const decoded = verifyBankingToken(token);
  assert.ok(decoded, 'Token should successfully verify');
  assert.strictEqual(decoded.id, officerUser.id);
  assert.strictEqual(decoded.email, officerUser.email);
  assert.strictEqual(decoded.role, 'CHIEF_COMPLIANCE_OFFICER');

  // Test 3.2: Tampered Token Rejection
  const tamperedPayload = Buffer.from(JSON.stringify({ ...officerUser, role: 'CHIEF_COMPLIANCE_OFFICER', id: 'hacked-id' })).toString('base64url');
  const tamperedToken = `${tokenParts[0]}.${tamperedPayload}.${tokenParts[2]}`;
  const tamperedResult = verifyBankingToken(tamperedToken);
  assert.strictEqual(tamperedResult, null, 'Tampered token payload must be rejected by HMAC verification');

  // Test 3.3: Expired Token Rejection
  const expiredToken = signBankingToken(officerUser, -1); // expired 1 hour ago
  const expiredResult = verifyBankingToken(expiredToken);
  assert.strictEqual(expiredResult, null, 'Expired banking token must be rejected');
  console.log('✔ Scenario 3 Passed: HMAC-SHA256 Token integrity & tamper detection verified.\n');

  // --------------------------------------------------------------------------
  // Scenario 4: Role-Based Access Control (RBAC) & Privilege Boundaries
  // --------------------------------------------------------------------------
  console.log('Scenario 4: Testing Banking Role Enforcement & Privilege Boundaries...');
  assert.strictEqual(normalizeRole('Chief Compliance Officer'), 'CHIEF_COMPLIANCE_OFFICER');
  assert.strictEqual(normalizeRole('Director AML Risk'), 'CHIEF_COMPLIANCE_OFFICER');
  assert.strictEqual(normalizeRole('Senior TBML Risk Analyst'), 'TBML_RISK_ANALYST');
  assert.strictEqual(normalizeRole('State Bank Regulatory Auditor'), 'TRADE_AUDITOR');
  assert.strictEqual(normalizeRole('Front Desk Clerk'), 'OPERATIONS_DESK');

  const guard = requireRole(['CHIEF_COMPLIANCE_OFFICER']);
  const fakeReqAdmin = { user: { role: 'CHIEF_COMPLIANCE_OFFICER', email: 'officer@bank.local' }, originalUrl: '/api/documents/history' } as any;
  const fakeReqAnalyst = { user: { role: 'TBML_RISK_ANALYST', email: 'analyst@bank.local' }, originalUrl: '/api/documents/history' } as any;

  let adminAllowed = false;
  guard(fakeReqAdmin, {} as any, () => { adminAllowed = true; });
  assert.strictEqual(adminAllowed, true, 'Chief Compliance Officer must be granted access');

  let analystBlocked = false;
  try {
    guard(fakeReqAnalyst, {} as any, () => {});
  } catch (err: any) {
    if (err.status === 403 && err.code === 'FORBIDDEN') {
      analystBlocked = true;
    }
  }
  assert.strictEqual(analystBlocked, true, 'Analyst must be blocked with 403 Forbidden from admin action');
  console.log('✔ Scenario 4 Passed: Role-Based Access Control boundaries verified.\n');

  console.log('================================================================');
  console.log('ALL BANK-GRADE SECURITY REGRESSION TESTS PASSED 100%!');
  console.log('================================================================\n');
}

runSecurityTestSuite().catch((err) => {
  console.error('SECURITY TEST FAILED:', err);
  process.exit(1);
});
