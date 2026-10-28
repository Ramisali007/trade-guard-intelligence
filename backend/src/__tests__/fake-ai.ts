import { HeuristicProvider } from '../ai/providers/heuristic.provider';
import type { AIAnalysisService, ClassificationRequest, SummaryRequest } from '../ai/types';
import { Errors } from '../utils/errors';

/**
 * A stand-in for the AI model in the suites: no network, answers decided by the test. It
 * classifies passages with the local engine (so the document pipeline runs unchanged) and answers
 * the pre-shipment steps (recognise a document, review it, compare the documents, write the mail)
 * from what the test configured.
 */

export interface FakeIssue {
  code: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'MISSING_INFORMATION' | 'DATA_INCONSISTENCY' | 'DOCUMENT_QUALITY' | 'LC_TERM_ISSUE' | 'REGULATORY_CONCERN' | 'COMPLIANCE_ALERT';
  title: string;
  description: string;
  evidence?: string;
  customerAction?: string;
  documentsInvolved?: string[];
  quotes?: Array<{ file: string; text: string }>;
  fields?: string[];
}

export class FakeReviewAi implements AIAnalysisService {
  readonly id = 'fake-ai';
  readonly model = 'fake-reviewer-1';
  readonly supportsSummary = false;
  readonly isLocal = false;
  private readonly inner = new HeuristicProvider();

  /** True while the model is "down": every pre-shipment call fails as an outage would. */
  down = false;
  calls = { classify: 0, review: 0, compare: 0, mail: 0, confirm: 0, hsJudge: 0, postReview: 0 };
  /** Issues the reading of presented (post-shipment) documents returns. */
  postIssues: FakeIssue[] = [];
  /** What the second opinion on an HS heading says when the description shares no wording with it. */
  hsVerdict: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNCLEAR' = 'INCOMPATIBLE';
  /** Titles of claimed differences the second look refuses to confirm (their quotes agree or are about different things). */
  unconfirmed: string[] = [];
  /** Issues the review of a document returns, chosen by a pattern on its file name. */
  reviewIssues: Array<{ file: RegExp; issues: FakeIssue[] }> = [];
  compareIssues: FakeIssue[] = [];
  /** The order documents were reviewed in, for checking that they are read one at a time. */
  reviewed: string[] = [];

  classify(request: ClassificationRequest) {
    return this.inner.classify(request);
  }

  summarize(request: SummaryRequest) {
    return this.inner.summarize(request);
  }

  async completeJson(system: string, user: string): Promise<Record<string, unknown>> {
    if (this.down) throw Errors.aiUnavailable('the stub model is down');

    if (system.includes('You identify trade documents')) {
      this.calls.classify += 1;
      const text = user.toLowerCase();
      const type = /application for an irrevocable documentary credit/.test(text)
        ? 'LC_APPLICATION_FORM'
        : /import permit/.test(text)
          ? 'IMPORT_PERMIT'
          : /purchase order/.test(text)
            ? 'PURCHASE_ORDER'
            : /sales and purchase contract|purchase contract/.test(text)
              ? 'PURCHASE_CONTRACT'
              : /proforma invoice/.test(text)
                ? 'PROFORMA_INVOICE'
                : /bill of lading/.test(text)
                  ? 'SHIPPING_DOCUMENT'
                  : 'UNKNOWN';
      return { type, confidence: 0.93, title: type.replace(/_/g, ' ').toLowerCase(), reason: 'The title and the wording of the text.' };
    }

    if (system.includes('reviewing ONE document')) {
      this.calls.review += 1;
      const file = /File name: (.+)/.exec(user)?.[1]?.trim() ?? '';
      this.reviewed.push(file);
      const issues = this.reviewIssues.filter((r) => r.file.test(file)).flatMap((r) => r.issues);
      return { summary: `Reviewed ${file}.`, present: ['parties', 'amount'], missing: [], notCheckable: [], issues };
    }

    if (system.includes('post-shipment documents of ONE request')) {
      this.calls.postReview += 1;
      return { summary: 'Read the presented documents against the approved set.', notCheckable: [], issues: this.postIssues };
    }

    if (system.includes('reviewing the documents of ONE request')) {
      this.calls.compare += 1;
      return { summary: 'Compared the current documents.', notCheckable: [], issues: this.compareIssues };
    }

    if (system.includes('You compare a description of goods')) {
      this.calls.hsJudge += 1;
      return { verdict: this.hsVerdict, reason: this.hsVerdict === 'INCOMPATIBLE' ? 'The goods are textiles; the heading covers iron and steel products.' : 'Cannot tell from the description.' };
    }

    if (system.includes('You check one claimed difference')) {
      this.calls.confirm += 1;
      const claim = (JSON.parse(user) as { claim: string }).claim;
      return this.unconfirmed.includes(claim) ? { confirmed: false, reason: 'Both quotes state the same value.' } : { confirmed: true, reason: 'The values differ.' };
    }

    if (system.includes('You write on behalf')) {
      this.calls.mail += 1;
      const input = JSON.parse(user) as { requestReference: string; customer: string; sender: { name: string }; issues: Array<{ number: number; title: string; detail: string; action: string }> };
      const lines = input.issues.map((i) => `${i.number}. ${i.title}. ${i.detail} ${i.action}`.trim());
      return {
        subject: `${input.requestReference}: ${input.issues.length} point(s) to correct`,
        body: [`Dear ${input.customer},`, '', 'The bank reviewed your documents and found:', '', ...lines, '', 'Please upload the corrected documents.', '', input.sender.name].join('\n'),
      };
    }

    throw Errors.aiInvalidResponse('the stub model was asked something it does not know');
  }
}
