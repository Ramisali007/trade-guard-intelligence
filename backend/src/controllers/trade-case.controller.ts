import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../middleware/auth.middleware';
import type { UploadedFile } from '../services/document.service';
import { REGULATORY_SOURCES, RULES, RULE_SET_VERSION } from '../trade-cases/rule-registry';
import { clearedBy, getTradeCaseService } from '../trade-cases/trade-case.service';
import type { TradeCase } from '../trade-cases/trade-case.types';
import { getWorkflowPolicy } from '../trade-cases/workflow.policy';
import { enforcementOf, VerificationGovernance } from '../verification/governance';
import { contentDisposition } from '../utils/http';
import { AppError, Errors } from '../utils/errors';

/** HTTP translation for the trade lifecycle; every rule lives in the service. */

const CASE_ID = /^TC-\d{4}-\d{5}$/;
const SUB_ID = /^[A-Z]{1,3}-\d{2,5}$/;

function user(req: Request): AuthenticatedUser {
  if (!req.user) throw Errors.unauthorized();
  return req.user;
}

function caseId(req: Request): string {
  const id = String(req.params['id'] ?? '');
  if (!CASE_ID.test(id)) throw Errors.validation('That trade case id is not valid.');
  return id;
}

function subId(req: Request, name: string): string {
  const id = String(req.params[name] ?? '');
  if (!SUB_ID.test(id)) throw Errors.validation(`That ${name} is not valid.`);
  return id;
}

function send(req: Request, res: Response, tradeCase: TradeCase, status = 200): void {
  res.status(status).json(getTradeCaseService().toView(user(req), tradeCase));
}

const svc = () => getTradeCaseService();

export async function listTradeCases(req: Request, res: Response): Promise<void> {
  // The list always carries what this user cleared (flagged), so the screen can show it under "Cleared history".
  const cases = await svc().listCases(user(req), { status: req.query['status'], history: 'all', stage: req.query['stage'] });
  const clearedIds = new Set(req.query['stage'] === 'post' ? [] : cases.filter((c) => clearedBy(user(req), c)).map((c) => c.caseId));
  const signalsOf = new Map(cases.map((c) => [c.caseId, svc().caseSignals(user(req), c)]));
  const views = cases.map((c) => svc().toView(user(req), c) as Record<string, unknown> & { applicationVersions: TradeCase['applicationVersions'] });
  // A list row needs the headline fields, not every version and finding.
  res.json({
    items: views.map((v) => {
      const app = v.applicationVersions[v.applicationVersions.length - 1]!.data;
      const findings = (v['findings'] as TradeCase['findings']) ?? [];
      return {
        caseId: v['caseId'],
        status: v['status'],
        cleared: clearedIds.has(String(v['caseId'])),
        reference: v['preShipmentReference'] ?? null,
        // What the headline boxes count, per case, so a box can list the cases behind its number.
        openCustomerQueries: signalsOf.get(String(v['caseId']))?.openCustomerQueries ?? 0,
        blocked: signalsOf.get(String(v['caseId']))?.blocked ?? false,
        complianceAlerts: signalsOf.get(String(v['caseId']))?.complianceAlerts ?? 0,
        customerRef: v['customerRef'],
        applicant: app.applicant.name,
        beneficiary: app.beneficiary.name,
        currency: app.currency,
        amount: app.amount,
        goodsDescription: app.goodsDescription,
        openFindings: findings.filter((f) => f.status === 'OPEN').length,
        blockingFindings: findings.filter((f) => f.status === 'OPEN' && f.blocking).length,
        openQueries: ((v['queries'] as TradeCase['queries']) ?? []).filter((q) => q.status === 'OPEN').length,
        lcNumber: (v['issuedLc'] as TradeCase['issuedLc'])?.lcNumber ?? null,
        updatedAt: v['updatedAt'],
        availableActions: v['availableActions'],
      };
    }),
    total: views.length,
  });
}

export async function clearTradeCaseHistory(req: Request, res: Response): Promise<void> {
  res.json(await svc().clearHistory(user(req)));
}

export async function tradeCaseDashboard(req: Request, res: Response): Promise<void> {
  res.json(await svc().dashboard(user(req), req.query['stage']));
}

export async function tradeRuleRegistry(req: Request, res: Response): Promise<void> {
  if (user(req).role === 'CORPORATE_CUSTOMER') throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'The rule registry is internal to the bank.' });
  // The sign-off a rule ships with in the code, overlaid by the bank's recorded decision for the verification rules.
  const governance = VerificationGovernance.getInstance();
  const rules = RULES.map((r) => {
    if (!r.ruleId.startsWith('EXT-')) return r;
    const state = governance.ruleState(r.ruleId);
    return { ...r, signOff: state.status === 'APPROVED' ? { status: 'APPROVED' as const, by: state.decidedBy?.name ?? null, on: state.decidedAt } : r.signOff, enforcement: enforcementOf(r.ruleId, governance) };
  });
  res.json({ ruleSetVersion: RULE_SET_VERSION, rules, sources: REGULATORY_SOURCES, policy: getWorkflowPolicy() });
}

export async function createTradeCase(req: Request, res: Response): Promise<void> {
  const { tradeCase, created } = await svc().createCase(user(req), req.body ?? {});
  send(req, res, tradeCase, created ? 201 : 200);
}

export async function getTradeCase(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().getCase(user(req), caseId(req)));
}

export async function getTradeCaseAudit(req: Request, res: Response): Promise<void> {
  res.json(await svc().getAudit(user(req), caseId(req)));
}

export async function updateTradeCaseApplication(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().updateApplication(user(req), caseId(req), req.body ?? {}));
}

export async function attachTradeCaseDocument(req: Request, res: Response): Promise<void> {
  const { tradeCase, document } = await svc().attachDocument(user(req), caseId(req), req.file as UploadedFile | undefined, req.body?.['documentType']);
  res.status(201).json({ document, tradeCase: svc().toView(user(req), tradeCase) });
}

/** The signed-in customer's approved requests with their pre-shipment references and post-shipment applications. */
export async function postShipmentLcs(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items: await svc().postShipmentLcs(user(req)) });
}

export async function startPostShipment(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().startPostShipment(user(req), caseId(req)), 201);
}

export async function attachPresentationDocument(req: Request, res: Response): Promise<void> {
  const { tradeCase, document } = await svc().attachPresentationDocument(user(req), caseId(req), req.file as UploadedFile | undefined, req.body?.['documentType']);
  res.status(201).json({ document, tradeCase: svc().toView(user(req), tradeCase) });
}

export async function removePresentationDocument(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().removePresentationDocument(user(req), caseId(req), subId(req, 'linkId')));
}

export async function submitPostShipment(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().submitPostShipment(user(req), caseId(req)));
}

export async function postShipmentReview(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await svc().postShipmentReview(user(req), caseId(req)));
}

export async function requestPostShipmentClarification(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().requestClarification(user(req), caseId(req), req.body ?? {}));
}

export async function aiScrutinyPostShipment(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().aiScrutinyOfPresentation(user(req), caseId(req)));
}

export async function addPostShipmentFinding(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().addManualFinding(user(req), caseId(req), req.body ?? {}), 201);
}

export async function tradeCaseScrutiny(req: Request, res: Response): Promise<void> {
  res.json(await svc().scrutiny(user(req), caseId(req)));
}

export async function tradeCaseVerificationReport(req: Request, res: Response): Promise<void> {
  const report = await svc().exportVerificationReport(user(req), caseId(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(report.filename));
  res.setHeader('X-Content-SHA256', report.contentHash);
  res.setHeader('Cache-Control', 'no-store');
  res.send(report.pdf);
}

export async function sendTradeCaseDocuments(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().sendDocuments(user(req), caseId(req)));
}

export async function composeTradeCaseMail(req: Request, res: Response): Promise<void> {
  res.json(await svc().composeCustomerMail(user(req), caseId(req), req.body?.['findingIds']));
}

export async function approveTradeCasePreShipment(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().approvePreShipment(user(req), caseId(req), req.body?.['rationale']));
}

export async function removeTradeCaseDocument(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().removeDocument(user(req), caseId(req), subId(req, 'linkId')));
}

export async function analyzeTradeCaseDocuments(req: Request, res: Response): Promise<void> {
  const { tradeCase, started, alreadyDone, running } = await svc().startScrutiny(user(req), caseId(req));
  res.status(202).json({ started, alreadyDone, running, tradeCase: svc().toView(user(req), tradeCase) });
}

export async function retypeTradeCaseDocument(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().retypeDocument(user(req), caseId(req), subId(req, 'linkId'), req.body?.['documentType']));
}

export async function downloadTradeCaseDocument(req: Request, res: Response): Promise<void> {
  const file = await svc().getDocumentFile(user(req), caseId(req), subId(req, 'linkId'));
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', contentDisposition(file.filename));
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.buffer);
}

export async function submitTradeCase(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().submit(user(req), caseId(req)));
}

export async function withdrawTradeCase(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().withdraw(user(req), caseId(req), req.body?.['rationale']));
}

export async function revalidateTradeCase(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().revalidateByUser(user(req), caseId(req)));
}

export async function decideTradeCaseReview(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().decideReview(user(req), caseId(req), req.params['department'], req.body ?? {}));
}

export async function raiseTradeCaseQuery(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().raiseQuery(user(req), caseId(req), req.body ?? {}), 201);
}

export async function respondTradeCaseQuery(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().respondQuery(user(req), caseId(req), subId(req, 'queryId'), req.body ?? {}));
}

export async function resolveTradeCaseQuery(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().resolveQuery(user(req), caseId(req), subId(req, 'queryId'), req.body ?? {}));
}

export async function dispositionTradeCaseFinding(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().dispositionFinding(user(req), caseId(req), subId(req, 'findingId'), req.body ?? {}));
}

export async function applicantWaiverTradeCaseFinding(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().applicantWaiver(user(req), caseId(req), subId(req, 'findingId'), req.body ?? {}));
}

export async function recordTradeCaseCreditFacility(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().recordCreditFacility(user(req), caseId(req), req.body ?? {}));
}

export async function requestTradeCaseApproval(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().requestApproval(user(req), caseId(req), req.body?.['note']));
}

export async function decideTradeCaseApproval(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().decideApproval(user(req), caseId(req), req.body ?? {}));
}

export async function rejectTradeCase(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().reject(user(req), caseId(req), req.body?.['rationale']));
}

export async function cancelTradeCase(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().cancel(user(req), caseId(req), req.body?.['rationale']));
}

export async function issueTradeCaseLc(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().recordIssuance(user(req), caseId(req), req.body ?? {}));
}

export async function recordTradeCasePresentation(req: Request, res: Response): Promise<void> {
  const files = (req.files as UploadedFile[] | undefined) ?? [];
  send(req, res, await svc().recordPresentation(user(req), caseId(req), files, req.body?.['documentTypes']), 201);
}

export async function examineTradeCasePresentation(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().examinePresentation(user(req), caseId(req)));
}

export async function decideTradeCasePresentation(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().decidePresentation(user(req), caseId(req), req.body ?? {}));
}

export async function recordTradeCaseSettlement(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().recordSettlement(user(req), caseId(req), req.body ?? {}));
}

export async function openTradeCaseInvestigation(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().openInvestigation(user(req), caseId(req), req.body ?? {}));
}

export async function closeTradeCaseInvestigation(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().closeInvestigation(user(req), caseId(req), req.body ?? {}));
}

export async function closeTradeCase(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().closeCase(user(req), caseId(req), req.body?.['rationale']));
}

export async function requestTradeCaseAmendment(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().requestAmendment(user(req), caseId(req), req.body ?? {}), 201);
}

export async function reviewTradeCaseAmendment(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().reviewAmendment(user(req), caseId(req), req.params['department'], req.body ?? {}));
}

export async function submitTradeCaseAmendment(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().submitAmendment(user(req), caseId(req), req.body?.['note']));
}

export async function decideTradeCaseAmendment(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().decideAmendment(user(req), caseId(req), req.body ?? {}));
}

export async function issueTradeCaseAmendment(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().issueAmendment(user(req), caseId(req), req.body ?? {}));
}

export async function recordTradeCaseAmendmentResponse(req: Request, res: Response): Promise<void> {
  send(req, res, await svc().recordAmendmentResponse(user(req), caseId(req), req.body ?? {}));
}

export async function tradeCaseAuditOverview(req: Request, res: Response): Promise<void> {
  res.json({ cases: await svc().auditOverview(user(req)) });
}
