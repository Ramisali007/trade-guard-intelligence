import http from 'node:http';
import { Buffer } from 'node:buffer';

const BASE_URL = 'http://localhost:4000/api';

interface TestResult {
  endpoint: string;
  method: string;
  status: number;
  success: boolean;
  notes?: string;
}

const results: TestResult[] = [];

async function request(
  endpoint: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
  const url = new URL(BASE_URL + endpoint);
  return new Promise((resolve, reject) => {
    const method = options.method || 'GET';
    const payload = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null;

    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };
    if (payload && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const req = http.request(url, { method, headers }, (res: http.IncomingMessage) => {
      let body = '';
      const isBinary = res.headers['content-type']?.includes('pdf') || res.headers['content-type']?.includes('octet-stream');
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        if (isBinary) {
          chunks.push(chunk);
        } else {
          body += chunk.toString();
        }
      });

      res.on('end', () => {
        let parsed: any = body;
        if (!isBinary && body) {
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = body;
          }
        }
        resolve({
          status: res.statusCode || 0,
          data: isBinary ? Buffer.concat(chunks) : parsed,
          headers: res.headers,
        });
      });
    });

    req.on('error', (err: Error) => reject(err));
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

export async function runAllVerification(): Promise<void> {
  console.log('================================================================');
  console.log('  TRADEGUARD COMPLETE ENDPOINT & CHECKPOINT VERIFICATION SUITE');
  console.log('================================================================\n');

  // 1. GET /health
  try {
    const res = await request('/health');
    results.push({ endpoint: '/api/health', method: 'GET', status: res.status, success: res.status === 200, notes: `Driver: ${res.data?.storage?.driver}, Provider: ${res.data?.engine?.provider}` });
  } catch (e: any) {
    results.push({ endpoint: '/api/health', method: 'GET', status: 500, success: false, notes: e.message });
  }

  // 2. GET /config
  try {
    const res = await request('/config');
    results.push({ endpoint: '/api/config', method: 'GET', status: res.status, success: res.status === 200, notes: `Allowed extensions: ${res.data?.allowedExtensions?.join(', ')}` });
  } catch (e: any) {
    results.push({ endpoint: '/api/config', method: 'GET', status: 500, success: false, notes: e.message });
  }

  // 3. GET /taxonomy
  try {
    const res = await request('/taxonomy');
    results.push({ endpoint: '/api/taxonomy', method: 'GET', status: res.status, success: res.status === 200, notes: `Sentiments: ${res.data?.sentiments?.length}, Topics: ${res.data?.topics?.length}` });
  } catch (e: any) {
    results.push({ endpoint: '/api/taxonomy', method: 'GET', status: 500, success: false, notes: e.message });
  }

  // 4. GET /sanctions/lists
  try {
    const res = await request('/sanctions/lists');
    results.push({ endpoint: '/api/sanctions/lists', method: 'GET', status: res.status, success: res.status === 200, notes: `Lists available: ${res.data?.lists?.length || res.data?.length}` });
  } catch (e: any) {
    results.push({ endpoint: '/api/sanctions/lists', method: 'GET', status: 500, success: false, notes: e.message });
  }

  // 5. GET /sanctions/lists/OFAC_SDN/versions
  try {
    const res = await request('/sanctions/lists/OFAC_SDN/versions');
    results.push({ endpoint: '/api/sanctions/lists/:source/versions', method: 'GET', status: res.status, success: res.status === 200, notes: `Versions returned: ${res.data?.versions?.length || res.data?.length}` });
  } catch (e: any) {
    results.push({ endpoint: '/api/sanctions/lists/:source/versions', method: 'GET', status: 500, success: false, notes: e.message });
  }

  // 6. GET /sanctions/entities/IR-AIR-001/history
  try {
    const res = await request('/sanctions/entities/IR-AIR-001/history');
    results.push({ endpoint: '/api/sanctions/entities/:id/history', method: 'GET', status: res.status, success: res.status === 200, notes: `History entries: ${res.data?.history?.length || (Array.isArray(res.data) ? res.data.length : 'OK')}` });
  } catch (e: any) {
    results.push({ endpoint: '/api/sanctions/entities/:id/history', method: 'GET', status: 500, success: false, notes: e.message });
  }

  // 7. POST /sanctions/screen/as-of
  try {
    const res = await request('/sanctions/screen/as-of', {
      method: 'POST',
      body: {
        parties: [
          { name: 'Iran Air', role: 'CARRIER', country: 'Iran' }
        ],
        as_of_date: '2024-05-01',
      }
    });
    results.push({ endpoint: '/api/sanctions/screen/as-of', method: 'POST', status: res.status, success: res.status === 200, notes: `Screening match: ${res.data?.results?.[0]?.matchesCount > 0 ? 'MATCH' : 'CLEAN'}` });
  } catch (e: any) {
    results.push({ endpoint: '/api/sanctions/screen/as-of', method: 'POST', status: 500, success: false, notes: e.message });
  }

  // 8. GET /customers
  let sampleCustomerId = '';
  try {
    const res = await request('/customers');
    const customers = res.data?.customers || res.data || [];
    if (customers.length > 0) sampleCustomerId = customers[0].id || customers[0].customerReferenceId;
    results.push({ endpoint: '/api/customers', method: 'GET', status: res.status, success: res.status === 200, notes: `Profiles registered: ${customers.length}` });
  } catch (e: any) {
    results.push({ endpoint: '/api/customers', method: 'GET', status: 500, success: false, notes: e.message });
  }

  // 9. GET /customers/:id
  if (sampleCustomerId) {
    try {
      const res = await request(`/customers/${sampleCustomerId}`);
      results.push({ endpoint: '/api/customers/:id', method: 'GET', status: res.status, success: res.status === 200, notes: `Profile retrieved for: ${res.data?.legalName || sampleCustomerId}` });
    } catch (e: any) {
      results.push({ endpoint: '/api/customers/:id', method: 'GET', status: 500, success: false, notes: e.message });
    }
  }

  // 10. POST /chat
  try {
    const res = await request('/chat', {
      method: 'POST',
      body: {
        messages: [
          { role: 'user', content: 'What are the main Trade-Based Money Laundering indicators under SBP regulations?' }
        ],
      }
    });
    results.push({ endpoint: '/api/chat', method: 'POST', status: res.status, success: res.status === 200, notes: `AI response: ${res.data?.message?.slice(0, 40) || 'OK'}...` });
  } catch (e: any) {
    results.push({ endpoint: '/api/chat', method: 'POST', status: 500, success: false, notes: e.message });
  }

  // 11. GET /documents
  let sampleDocId = '';
  try {
    const res = await request('/documents');
    const docs = res.data?.items || res.data?.documents || res.data || [];
    if (docs.length > 0) sampleDocId = docs[0].id;
    results.push({ endpoint: '/api/documents', method: 'GET', status: res.status, success: res.status === 200, notes: `Existing documents: ${docs.length}` });
  } catch (e: any) {
    results.push({ endpoint: '/api/documents', method: 'GET', status: 500, success: false, notes: e.message });
  }

  // 12. GET /documents/compliance/sources
  try {
    const res = await request('/documents/compliance/sources');
    results.push({ endpoint: '/api/documents/compliance/sources', method: 'GET', status: res.status, success: res.status === 200, notes: `Sources tracked: ${res.data?.sources?.length || res.data?.length}` });
  } catch (e: any) {
    results.push({ endpoint: '/api/documents/compliance/sources', method: 'GET', status: 500, success: false, notes: e.message });
  }

  // 13. POST /documents/compliance/screen/historical
  try {
    const res = await request('/documents/compliance/screen/historical', {
      method: 'POST',
      body: {
        partyName: 'National Iranian Tanker Company',
        asOfDate: '2023-01-15'
      }
    });
    results.push({ endpoint: '/api/documents/compliance/screen/historical', method: 'POST', status: res.status, success: res.status === 200, notes: `Status: Screened (${res.data?.matchesCount ?? 0} matches)` });
  } catch (e: any) {
    results.push({ endpoint: '/api/documents/compliance/screen/historical', method: 'POST', status: 500, success: false, notes: e.message });
  }

  // 14. GET /documents/compliance/retrospective-alerts
  try {
    const res = await request('/documents/compliance/retrospective-alerts');
    results.push({ endpoint: '/api/documents/compliance/retrospective-alerts', method: 'GET', status: res.status, success: res.status === 200, notes: `Alerts found: ${res.data?.alerts?.length || (Array.isArray(res.data) ? res.data.length : 0)}` });
  } catch (e: any) {
    results.push({ endpoint: '/api/documents/compliance/retrospective-alerts', method: 'GET', status: 500, success: false, notes: e.message });
  }

  // 15. If a document exists, test all document specific endpoints!
  if (sampleDocId) {
    console.log(`\nTesting Document-Specific Sub-endpoints for Document ID: ${sampleDocId}...`);

    // GET /documents/:id
    try {
      const res = await request(`/documents/${sampleDocId}`);
      results.push({ endpoint: '/api/documents/:id', method: 'GET', status: res.status, success: res.status === 200, notes: `Filename: ${res.data?.filename}` });
    } catch (e: any) {
      results.push({ endpoint: '/api/documents/:id', method: 'GET', status: 500, success: false, notes: e.message });
    }

    // GET /documents/:id/status
    try {
      const res = await request(`/documents/${sampleDocId}/status`);
      results.push({ endpoint: '/api/documents/:id/status', method: 'GET', status: res.status, success: res.status === 200, notes: `Status: ${res.data?.status}, Progress: ${res.data?.progress?.percent}%` });
    } catch (e: any) {
      results.push({ endpoint: '/api/documents/:id/status', method: 'GET', status: 500, success: false, notes: e.message });
    }

    // GET /documents/:id/results
    try {
      const res = await request(`/documents/${sampleDocId}/results`);
      results.push({ endpoint: '/api/documents/:id/results', method: 'GET', status: res.status, success: res.status === 200, notes: `Risk Score: ${res.data?.complianceReport?.riskScoring?.riskScore ?? res.data?.analysis?.summary?.dominantSentiment}` });
    } catch (e: any) {
      results.push({ endpoint: '/api/documents/:id/results', method: 'GET', status: 500, success: false, notes: e.message });
    }

    // GET /documents/:id/units
    try {
      const res = await request(`/documents/${sampleDocId}/units?page=1&pageSize=10`);
      results.push({ endpoint: '/api/documents/:id/units', method: 'GET', status: res.status, success: res.status === 200, notes: `Units returned: ${res.data?.items?.length} of ${res.data?.total}` });
    } catch (e: any) {
      results.push({ endpoint: '/api/documents/:id/units', method: 'GET', status: 500, success: false, notes: e.message });
    }

    // GET /documents/:id/timeline
    try {
      const res = await request(`/documents/${sampleDocId}/timeline`);
      results.push({ endpoint: '/api/documents/:id/timeline', method: 'GET', status: res.status, success: res.status === 200, notes: `Timeline items: ${res.data?.timeline?.length || res.data?.pageTimeline?.length || 'OK'}` });
    } catch (e: any) {
      results.push({ endpoint: '/api/documents/:id/timeline', method: 'GET', status: 500, success: false, notes: e.message });
    }

    // GET /documents/:id/evidence
    try {
      const res = await request(`/documents/${sampleDocId}/evidence`);
      results.push({ endpoint: '/api/documents/:id/evidence', method: 'GET', status: res.status, success: res.status === 200, notes: `Evidence items: ${res.data?.evidenceRecords?.length || (Array.isArray(res.data) ? res.data.length : 'OK')}` });
    } catch (e: any) {
      results.push({ endpoint: '/api/documents/:id/evidence', method: 'GET', status: 500, success: false, notes: e.message });
    }

    // GET /documents/:id/audit-certificate
    try {
      const res = await request(`/documents/${sampleDocId}/audit-certificate`);
      results.push({ endpoint: '/api/documents/:id/audit-certificate', method: 'GET', status: res.status, success: res.status === 200, notes: `Hash: ${res.data?.tamperEvidenceChain?.merkleRootSha256 || res.data?.sha256 || 'OK'}` });
    } catch (e: any) {
      results.push({ endpoint: '/api/documents/:id/audit-certificate', method: 'GET', status: 500, success: false, notes: e.message });
    }

    // GET /documents/:id/report
    try {
      const res = await request(`/documents/${sampleDocId}/report`);
      results.push({ endpoint: '/api/documents/:id/report', method: 'GET', status: res.status, success: res.status === 200, notes: `Report text length: ${(res.data?.content || String(res.data)).length} chars` });
    } catch (e: any) {
      results.push({ endpoint: '/api/documents/:id/report', method: 'GET', status: 500, success: false, notes: e.message });
    }

    // GET /documents/:id/report/pdf
    try {
      const res = await request(`/documents/${sampleDocId}/report/pdf`);
      const isBuffer = Buffer.isBuffer(res.data);
      results.push({ endpoint: '/api/documents/:id/report/pdf', method: 'GET', status: res.status, success: res.status === 200 && isBuffer, notes: `PDF binary size: ${isBuffer ? res.data.length : 0} bytes` });
    } catch (e: any) {
      results.push({ endpoint: '/api/documents/:id/report/pdf', method: 'GET', status: 500, success: false, notes: e.message });
    }

    // POST /documents/:id/override
    try {
      const res = await request(`/documents/${sampleDocId}/override`, {
        method: 'POST',
        body: {
          decision: 'APPROVED_WITH_CONDITIONS',
          overridingAuditor: 'Chief Compliance Officer (Test)',
          justification: 'Automated verification test override confirmation.'
        }
      });
      results.push({ endpoint: '/api/documents/:id/override', method: 'POST', status: res.status, success: res.status === 200, notes: `Decision updated to: ${res.data?.complianceReport?.decision?.decision || res.data?.decision || 'OK'}` });
    } catch (e: any) {
      results.push({ endpoint: '/api/documents/:id/override', method: 'POST', status: 500, success: false, notes: e.message });
    }

    // POST /chat/document/:id
    try {
      const res = await request(`/chat/document/${sampleDocId}`, {
        method: 'POST',
        body: {
          messages: [
            { role: 'user', content: 'What is the declared item and total amount in this document?' }
          ],
        }
      });
      results.push({ endpoint: '/api/chat/document/:id', method: 'POST', status: res.status, success: res.status === 200, notes: `Doc Chat response: ${res.data?.message?.slice(0, 40) || 'OK'}...` });
    } catch (e: any) {
      results.push({ endpoint: '/api/chat/document/:id', method: 'POST', status: 500, success: false, notes: e.message });
    }

    // POST /documents/compare
    try {
      const res = await request('/documents/compare', {
        method: 'POST',
        body: {
          documentIds: [sampleDocId, sampleDocId]
        }
      });
      results.push({ endpoint: '/api/documents/compare', method: 'POST', status: res.status, success: res.status === 200, notes: `Comparison items: ${res.data?.discrepancies?.length ?? 0} discrepancies` });
    } catch (e: any) {
      results.push({ endpoint: '/api/documents/compare', method: 'POST', status: 500, success: false, notes: e.message });
    }

    // POST /documents/compare/pdf
    try {
      const res = await request('/documents/compare/pdf', {
        method: 'POST',
        body: {
          documentIds: [sampleDocId, sampleDocId]
        }
      });
      const isBuffer = Buffer.isBuffer(res.data);
      results.push({ endpoint: '/api/documents/compare/pdf', method: 'POST', status: res.status, success: res.status === 200 && isBuffer, notes: `Comparison PDF size: ${isBuffer ? res.data.length : 0} bytes` });
    } catch (e: any) {
      results.push({ endpoint: '/api/documents/compare/pdf', method: 'POST', status: 500, success: false, notes: e.message });
    }
  }

  console.log('\n================================================================');
  console.log('                 VERIFICATION RESULTS SUMMARY');
  console.log('================================================================');
  let passCount = 0;
  for (const r of results) {
    const icon = r.success ? '✅ PASS' : '❌ FAIL';
    if (r.success) passCount++;
    console.log(`${icon} [${r.method}] ${r.endpoint.padEnd(45)} (Status: ${r.status}) - ${r.notes || ''}`);
  }
  console.log('================================================================');
  console.log(`TOTAL: ${passCount} / ${results.length} ENDPOINTS PASSED CLEANLY (${Math.round((passCount/results.length)*100)}%)`);
  console.log('================================================================');
}

if (require.main === module) {
  runAllVerification().catch(console.error);
}
