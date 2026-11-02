import { DEPARTMENT_PERMISSION, hasAnyPermission, hasPermission } from '../authorization/permissions';
import { isDocumentsOnly } from './application-from-documents';
import {
  applicationState, awaitingSend, bankAskedForCorrection, blocksNow, currentPreTradeDocuments, INTERNAL_CATEGORIES, isAiFinding, isCustomerView,
  mayAddDocuments, officerOnly, preShipmentReferenceOf, presentationSummary, RESTRICTED_TITLE, unconfirmedPostShipmentAi, withoutModelNote,
} from './case-rules';
import { DEPARTMENTS, type Amendment, type CaseHeader, type CaseQuery, type CaseStatus, type Department, type Finding, type TradeCase } from './trade-case.types';
import { ACTION_PERMISSIONS, STATE_TRANSITIONS, type CaseAction, type WorkflowPolicy } from './workflow.policy';
import type { AuthenticatedUser } from '../middleware/auth.middleware';

/**
 * What each user sees of a case, and what they may do next. Customers get the customer view (no internal findings, no holds,
 * no investigations); bank staff get the case with compliance, credit and investigation detail removed unless they hold the
 * permission to read it. A list or queue row is built from the case header alone (`listRow`), so a list never needs the bulky
 * AI-review and screening results. Nothing here changes a case; the service owns every write.
 */
export class CaseViews {
  /** The policy is read on every call: it can be replaced while the process runs (a bank edits its policy file). */
  constructor(private readonly currentPolicy: () => WorkflowPolicy) {}

  private get policy(): WorkflowPolicy {
    return this.currentPolicy();
  }

  applicableChecklist(c: TradeCase, department: Department) {
    const threshold = this.policy.thresholds.exporterReportPkr;
    return (this.policy.checklists[department] ?? []).filter((item) => {
      if (item.condition !== 'AMOUNT_AT_OR_ABOVE_EXPORTER_REPORT_THRESHOLD') return true;
      // Without a rate, assume the threshold may be met: the safer reading.
      return c.validation.amountInPkr === null || c.validation.amountInPkr >= threshold;
    });
  }

  /** What stops a department approving. */
  reviewBlockers(c: TradeCase, department: Department): string[] {
    const blockers: string[] = [];
    const review = c.reviews[department];
    for (const item of this.applicableChecklist(c, department)) {
      if (!review.checklist[item.itemId]?.checked) blockers.push(`Checklist item not confirmed: ${item.label}`);
    }
    for (const f of c.findings) {
      if (f.stage === 'PRE_TRADE' && f.ownerDepartment === department && blocksNow(f)) blockers.push(`${f.findingId} ${f.title}`);
    }
    if (department === 'CREDIT' && !c.creditFacility) blockers.push('No facility verification recorded');
    if (department === 'COMPLIANCE' && c.validation.lastRunAt === null) blockers.push('Screening has not run');
    for (const q of c.queries) {
      if (q.department === department && q.status !== 'RESOLVED') blockers.push(`Query ${q.queryId} not resolved`);
    }
    return blockers;
  }

  /** A finding in the customer's words: what is wrong, and what to send. Internal advice is not repeated. */
  /**
   * What the customer may read of a finding from external verification: the plain request, the value from their own
   * document, and nothing of the officer's reading (the official wording, an AI second opinion, "possible
   * misdeclaration", the source file, the rule's approval state, the officer's history).
   */
  customerSafeExternalFinding(f: Finding): Finding {
    return {
      ...f,
      description: this.customerWording(f),
      recommendedAction: 'Please confirm the details, or send a corrected document.',
      expected: 'The details stated in your documents agree with each other and can be checked.',
      observed: f.observed.filter((o) => o.source === 'DOCUMENT' || o.source === 'APPLICATION'),
      confidence: null,
      history: [],
      disposition: f.disposition ? { ...f.disposition, rationale: '(internal)' } : null,
    };
  }

  customerWording(f: Finding): string {
    if (f.ruleId === 'EXT-PORT-ID') return `We could not confirm the port named in your documents (${f.observed.find((o) => o.source === 'DOCUMENT')?.value ?? 'the port'}). Please confirm the port's exact name and country, or its UN/LOCODE, and send a corrected document if it is wrong.`;
    if (f.ruleId === 'EXT-VESSEL-ID') return `The vessel details in your documents could not be confirmed (${f.observed.find((o) => o.source === 'DOCUMENT')?.value ?? 'the vessel'}). Please confirm the vessel's name and IMO number.`;
    if (f.ruleId === 'EXT-PCT-VALID') return `We could not confirm the customs tariff code in your documents (${f.observed.find((o) => o.source === 'DOCUMENT')?.value ?? 'the code'}). Please confirm the full 8-digit tariff code from your supplier or clearing agent, and send a corrected document if it is wrong.`;
    if (f.ruleId === 'EXT-HS-VALID' || f.ruleId === 'EXT-HS-CLASS') {
      const stated = f.observed.find((o) => o.source === 'DOCUMENT')?.value ?? 'the HS code';
      return f.category === 'MISSING_INFORMATION'
        ? `The goods description in your documents is too general for us to check its HS code (${stated}). Please send the product name, material and use, for example from the supplier's specification.`
        : `We could not confirm that the HS code in your documents matches the goods described (${stated}). Please confirm the correct HS classification, for example from your supplier's tariff classification, and send a corrected document if it is wrong.`;
    }
    if (f.ruleId === 'EXT-HS-CROSSDOC') return 'Your documents state different HS codes for the goods. Please confirm which code is correct and send a corrected document.';
    if (isAiFinding(f)) return `${f.title}: ${withoutModelNote(f.description)}${f.recommendedAction ? ` ${f.recommendedAction}` : ''}`;
    if (f.ruleId === 'PT-REQ-001') {
      const label = f.title.replace(/ not provided$/i, '');
      return `${label}: this is not stated in the documents you sent. Please send a document that shows it.`;
    }
    if (f.ruleId === 'PK-FEM13-07-FIRM') return "We could not find the supplier's proforma invoice, purchase order or contract. Please send the supplier's proforma invoice.";
    if (f.ruleId === 'PT-DOC-EXTRACTION') {
      return f.category === 'LOW_CONFIDENCE_EXTRACTION'
        ? 'Some details of the proforma invoice could not be read with confidence. Please send a clear copy (a text-based PDF rather than a photo or scan, if you can).'
        : 'One of your documents could not be read. Please send a clearer copy.';
    }
    return `${f.title}. ${f.description} Please send a corrected document, or explain the difference.`;
  }

  /** Everything that stops the maker asking for approval. Empty means ready. */
  approvalBlockers(c: TradeCase): string[] {
    const blockers: string[] = [];
    for (const review of Object.values(c.reviews)) {
      if (!review.required) continue;
      if (review.status !== 'APPROVED') blockers.push(`${review.department} review: ${review.status.replace(/_/g, ' ').toLowerCase()}`);
      else if (review.applicationVersion !== c.currentApplicationVersion) blockers.push(`${review.department} approved an earlier application version`);
    }
    for (const f of c.findings) if (f.stage === 'PRE_TRADE' && blocksNow(f)) blockers.push(`${f.findingId} ${f.title}`);
    for (const q of c.queries) if (q.status !== 'RESOLVED') blockers.push(`Query ${q.queryId} is ${q.status.toLowerCase()}`);
    if (c.reviews.CREDIT.required && !c.creditFacility) blockers.push('No credit facility verification recorded');
    return blockers;
  }

  openAmendment(c: CaseHeader): Amendment | null {
    return c.amendments?.find((a) => ['UNDER_REVIEW', 'APPROVAL_PENDING', 'APPROVED', 'ISSUED_AWAITING_BENEFICIARY'].includes(a.status)) ?? null;
  }

  /** What this user could do next on this case — for the UI; the server re-checks each action. */
  availableActions(user: AuthenticatedUser, c: CaseHeader): string[] {
    const actions: string[] = [];
    const amendment = this.openAmendment(c);
    const amendmentGate: Partial<Record<CaseAction, boolean>> = {
      REQUEST_AMENDMENT: !amendment,
      SUBMIT_AMENDMENT: amendment?.status === 'UNDER_REVIEW' && Object.values(amendment.reviews).every((r) => r?.status === 'APPROVED'),
      DECIDE_AMENDMENT: amendment?.status === 'APPROVAL_PENDING',
      ISSUE_AMENDMENT: amendment?.status === 'APPROVED',
      AMENDMENT_BENEFICIARY_RESPONSE: amendment?.status === 'ISSUED_AWAITING_BENEFICIARY',
      SEND_DOCUMENTS: awaitingSend(c).length > 0,
      SUBMIT: currentPreTradeDocuments(c).length > 0,
      START_POST_SHIPMENT: !c.presentations.some((p) => !p.decision),
      ATTACH_PRESENTATION_DOCUMENT: c.presentations.some(
        (p) => !p.decision && (p.applicationStatus === 'DRAFT' ? !(c.status === 'DOCUMENT_EXAMINATION' || c.status === 'DISCREPANCY_RESOLUTION') : (c.status === 'DOCUMENT_EXAMINATION' || c.status === 'DISCREPANCY_RESOLUTION') && bankAskedForCorrection(c)),
      ),
      ATTACH_PRETRADE_DOCUMENT: mayAddDocuments(c),
      REMOVE_PRETRADE_DOCUMENT: c.status === 'DRAFT' || awaitingSend(c).length > 0,
      REMOVE_PRESENTATION_DOCUMENT: c.presentations.some((p) => !p.decision && p.applicationStatus === 'DRAFT' && p.documentLinkIds.length > 0),
      REMOVE_POST_SHIPMENT_DRAFT: c.presentations.some((p) => !p.decision && p.applicationStatus === 'DRAFT'),
      SUBMIT_POST_SHIPMENT: c.presentations.some((p) => !p.decision && p.applicationStatus === 'DRAFT' && p.documentLinkIds.length > 0),
    };
    for (const action of Object.keys(STATE_TRANSITIONS) as CaseAction[]) {
      if (!hasAnyPermission(user, ACTION_PERMISSIONS[action])) continue;
      if (!STATE_TRANSITIONS[action]!.includes(c.status)) continue;
      if (action in amendmentGate && !amendmentGate[action]) continue;
      actions.push(action);
    }
    if (['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION'].includes(c.status)) {
      for (const d of DEPARTMENTS) if (c.reviews[d].required && hasPermission(user, DEPARTMENT_PERMISSION[d])) actions.push(`REVIEW_${d}`);
    }
    if (amendment?.status === 'UNDER_REVIEW') {
      for (const d of DEPARTMENTS) if (amendment.reviews[d]?.status === 'PENDING' && hasPermission(user, DEPARTMENT_PERMISSION[d])) actions.push(`REVIEW_AMENDMENT_${d}`);
    }
    // Only an open or escalated finding can be dispositioned (see dispositionFinding), so with none
    // left there is nothing to do and the case must not show up as waiting on this user.
    const dispositionable = c.findings.some((f) => f.status === 'OPEN' || (f.status === 'DISPOSITIONED' && f.disposition?.code === 'CONFIRMED_ESCALATED'));
    if (dispositionable && !['DRAFT', 'CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'].includes(c.status)) {
      if (hasAnyPermission(user, ['tradecase.finding.disposition.data', 'tradecase.finding.disposition.credit'])) actions.push('DISPOSITION_FINDING');
      if (hasPermission(user, 'tradecase.finding.disposition.compliance')) actions.push('DISPOSITION_COMPLIANCE_FINDING');
    }
    return actions;
  }

  /** A finding reduced to "something restricted exists", for staff without the permission to read it. */
  redactFinding(f: Finding, kind: 'compliance' | 'credit'): Finding {
    return {
      ...f,
      key: `restricted:${f.findingId}`,
      ruleId: 'RESTRICTED',
      title: kind === 'credit' ? 'Restricted credit matter' : RESTRICTED_TITLE,
      description: kind === 'credit' ? 'Details are visible to credit and approval roles only.' : 'Details are visible to compliance roles only.',
      fields: [],
      observed: [],
      expected: '',
      confidence: null,
      recommendedAction: kind === 'credit' ? 'Owned by Credit.' : 'Owned by Compliance.',
      history: [],
      disposition: f.disposition ? { ...f.disposition, rationale: '(restricted)' } : null,
    };
  }

  /**
   * The case as this user may see it, decided on the server. Customers get the customer view (no
   * internal findings, no holds, no investigations). Bank staff get the case with compliance, credit
   * and investigation detail removed unless they hold the permission to read it — a placeholder
   * stays, so they can see a blocker exists without seeing what it is.
   */
  toView(user: AuthenticatedUser, c: TradeCase): Record<string, unknown> {
    if (isCustomerView(user)) return this.customerView(user, c);

    const internal = hasPermission(user, 'tradecase.findings.internal.view');
    const credit = hasPermission(user, 'tradecase.credit.view');
    const investigations = hasPermission(user, 'tradecase.investigation.view');
    const restricted = new Map<string, string>();
    const findings = c.findings.map((f) => {
      if (this.policy.complianceCategories.includes(f.category) && !internal) {
        restricted.set(f.findingId, RESTRICTED_TITLE);
        return this.redactFinding(f, 'compliance');
      }
      if (f.category === 'CREDIT_BLOCKER' && !credit) {
        restricted.set(f.findingId, 'Restricted credit matter');
        return this.redactFinding(f, 'credit');
      }
      return f;
    });
    const scrub = (lines: string[]) =>
      lines.map((line) => {
        const id = line.split(' ')[0] ?? '';
        return restricted.has(id) ? `${id} ${restricted.get(id)}` : line;
      });
    const compliance = c.reviews.COMPLIANCE;
    const reviews = internal
      ? c.reviews
      : {
          ...c.reviews,
          COMPLIANCE: { ...compliance, rationale: compliance.rationale ? '(restricted)' : '', history: compliance.history.map((h) => ({ ...h, note: '(restricted)' })) },
        };
    const investigationRelated = (s: TradeCase['statusHistory'][number]) => s.to === 'UNDER_INVESTIGATION' || s.from === 'UNDER_INVESTIGATION';

    // A draft application is the customer's own until they submit it: the bank sees neither it nor its documents.
    const draftIds = new Set(c.presentations.filter((p) => p.applicationStatus === 'DRAFT').map((p) => p.presentationId));
    return {
      ...c,
      hostPayload: hasPermission(user, 'tradecase.hostpayload.view') ? c.hostPayload ?? null : undefined,
      preShipmentReference: preShipmentReferenceOf(c),
      presentations: c.presentations.filter((p) => !draftIds.has(p.presentationId)).map((p) => ({ ...p, state: applicationState(c, p) })),
      documents: c.documents.filter((d) => !d.presentationId || !draftIds.has(d.presentationId)),
      findings,
      reviews,
      queries: internal ? c.queries : c.queries.map((q) => (q.department === 'COMPLIANCE' && q.assignee !== 'CUSTOMER' ? { ...q, question: '(restricted)', responses: [] } : q)),
      creditFacility: credit ? c.creditFacility : null,
      creditFacilityRecorded: Boolean(c.creditFacility),
      investigations: investigations ? c.investigations : [],
      statusHistory: investigations ? c.statusHistory : c.statusHistory.map((s) => (investigationRelated(s) ? { ...s, reason: 'Restricted: investigation activity' } : s)),
      availableActions: this.availableActions(user, c),
      approvalBlockers: ['UNDER_REVIEW', 'APPROVAL_PENDING'].includes(c.status) ? scrub(this.approvalBlockers(c)) : [],
      checklists: Object.fromEntries(DEPARTMENTS.map((d) => [d, this.applicableChecklist(c, d)])),
      reviewBlockers: Object.fromEntries(DEPARTMENTS.map((d) => [d, c.status === 'UNDER_REVIEW' ? scrub(this.reviewBlockers(c, d)) : []])),
      viewer: { internalFindings: internal, credit, investigations },
    };
  }

  /** The status a customer is shown: an open investigation is never revealed, the case reads as it did before it. */
  customerStatus(c: CaseHeader): CaseStatus {
    return c.status === 'UNDER_INVESTIGATION' ? c.investigations.find((i) => !i.closedAt)?.resumeStatus ?? c.status : c.status;
  }

  /**
   * The findings a customer may read. A customer who sent documents only typed nothing the bank could find "missing" or
   * "wrong", so the bank's scrutiny findings are not theirs to read: they see what the bank asks them in a query, together
   * with the finding that query is about.
   */
  customerFindings(c: CaseHeader): Finding[] {
    return c.findings.filter((f) => !INTERNAL_CATEGORIES.includes(f.category) && !officerOnly(f) && !unconfirmedPostShipmentAi(c, f) && (!isDocumentsOnly(c) || c.queries.some((q) => q.assignee === 'CUSTOMER' && q.findingIds.includes(f.findingId))));
  }

  /**
   * What one row of a list or queue needs of a case, as this user sees it. It gives the same answers as `toView` for these
   * fields without building the whole view (checklists, blockers, redaction), and it works from a `CaseHeader`, so a list
   * never has to load the AI-review and screening results.
   */
  listRow(user: AuthenticatedUser, c: CaseHeader): { status: CaseStatus; availableActions: string[]; findings: Finding[]; queries: CaseQuery[] } {
    if (isCustomerView(user)) {
      return {
        status: this.customerStatus(c),
        availableActions: c.status === 'UNDER_INVESTIGATION' ? [] : this.availableActions(user, c),
        findings: this.customerFindings(c),
        queries: c.queries.filter((q) => q.assignee === 'CUSTOMER'),
      };
    }
    // Staff see every finding and query in a list; what they may not read is redacted in the case itself, and the counts do not change.
    return { status: c.status, availableActions: this.availableActions(user, c), findings: c.findings, queries: c.queries };
  }

  customerView(user: AuthenticatedUser, c: TradeCase): Record<string, unknown> {
    const investigating = c.status === 'UNDER_INVESTIGATION';
    const visibleStatus = this.customerStatus(c);
    return {
      caseId: c.caseId,
      transactionType: c.transactionType,
      customerRef: c.customerRef,
      status: visibleStatus,
      statusHistory: c.statusHistory.filter((s) => s.to !== 'UNDER_INVESTIGATION' && s.from !== 'UNDER_INVESTIGATION').map((s) => ({ ...s, reason: s.actor === 'SYSTEM' ? s.reason : s.reason.slice(0, 200) })),
      applicationVersions: c.applicationVersions,
      currentApplicationVersion: c.currentApplicationVersion,
      documents: c.documents,
      findings: this.customerFindings(c).map((f) => (f.origin === 'EXTERNAL_VERIFICATION' ? this.customerSafeExternalFinding(f) : f)),
      reviews: Object.fromEntries(
        DEPARTMENTS.map((d) => {
          const r = c.reviews[d];
          // A compliance hold reads as "in review": telling the customer would be tipping-off.
          const status = r.status === 'ON_HOLD' || r.status === 'REJECT_RECOMMENDED' ? 'PENDING' : r.status;
          return [d, { department: d, required: r.required, status }];
        }),
      ),
      queries: c.queries.filter((q) => q.assignee === 'CUSTOMER'),
      issuedLc: c.issuedLc,
      preShipmentReference: preShipmentReferenceOf(c),
      amendments: (c.amendments ?? []).map((a) => ({
        amendmentId: a.amendmentId,
        number: a.number,
        status: a.status === 'UNDER_REVIEW' || a.status === 'APPROVAL_PENDING' || a.status === 'APPROVED' ? 'IN_PROGRESS' : a.status,
        reason: a.reason,
        requestedAt: a.requestedAt,
        changedFields: a.changedFields,
        proposedTerms: a.proposedTerms,
        issuance: a.issuance ? { reference: a.issuance.reference, mode: a.issuance.mode, at: a.issuance.at } : null,
        beneficiaryResponse: a.beneficiaryResponse ? { accepted: a.beneficiaryResponse.accepted, at: a.beneficiaryResponse.at } : null,
      })),
      presentations: c.presentations.map((p) => ({ ...presentationSummary(c, p), documentLinkIds: p.documentLinkIds, applicationStatus: p.applicationStatus ?? 'SUBMITTED' })),
      settlement: c.settlement,
      validation: { lastRunAt: c.validation.lastRunAt, piExtractionSource: c.validation.piExtractionSource },
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      submittedAt: c.submittedAt,
      closedAt: c.closedAt,
      availableActions: investigating ? [] : this.availableActions(user, c),
      approvalBlockers: [],
      checklists: {},
      reviewBlockers: {},
      viewer: { internalFindings: false, credit: false, investigations: false },
    };
  }

  /** Queue counts for the dashboard, scoped to what the user may see. */
  /**
   * What each headline count on the case page is made of, for one case: the open questions to the customer, whether a
   * finding is blocking it, and its open compliance/TBML alerts (staff who may read them only). The dashboard adds
   * these up and the case list carries them, so a box and the cases behind it always agree.
   */
  caseSignals(user: AuthenticatedUser, c: CaseHeader): { openCustomerQueries: number; blocked: boolean; complianceAlerts: number } {
    const internal = hasPermission(user, 'tradecase.findings.internal.view');
    return {
      openCustomerQueries: c.queries.filter((q) => q.assignee === 'CUSTOMER' && q.status === 'OPEN').length,
      blocked: c.findings.some((f) => blocksNow(f) && (!isCustomerView(user) || !INTERNAL_CATEGORIES.includes(f.category))),
      complianceAlerts: internal ? c.findings.filter((f) => f.status === 'OPEN' && (f.category === 'COMPLIANCE_ALERT' || f.category === 'TBML_RED_FLAG')).length : 0,
    };
  }

}
