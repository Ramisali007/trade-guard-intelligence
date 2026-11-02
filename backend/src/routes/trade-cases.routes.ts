import { Router } from 'express';
import * as tc from '../controllers/trade-case.controller';
import { multiDocumentUpload, singleDocumentUpload } from '../middleware/upload.middleware';
import { uploadRateLimit } from '../middleware/rate-limit.middleware';
import { asyncHandler } from '../utils/http';
import { requirePermission } from '../middleware/auth.middleware';
import { TRADE_CASE_VIEW } from '../authorization/permissions';

// Coarse gate: the caller can see some trade cases. The service then checks the exact permission,
// the case's scope (ownership / RM assignment), its state and separation of duties.
const caseAccess = requirePermission(...TRADE_CASE_VIEW);

/**
 * /api/trade-cases — the import LC lifecycle. Mounted behind `authenticate`; role, ownership,
 * status and separation-of-duties checks happen in the service for every action.
 */
export const tradeCasesRouter = Router();

tradeCasesRouter.get('/', caseAccess, asyncHandler(tc.listTradeCases));
tradeCasesRouter.post('/', caseAccess, asyncHandler(tc.createTradeCase));
tradeCasesRouter.post('/clear-history', requirePermission('tradecase.history.clear'), asyncHandler(tc.clearTradeCaseHistory));
tradeCasesRouter.post('/recover-history', requirePermission('tradecase.history.clear'), asyncHandler(tc.recoverTradeCaseHistory));
tradeCasesRouter.get('/dashboard', caseAccess, asyncHandler(tc.tradeCaseDashboard));
tradeCasesRouter.get('/audit-overview', requirePermission('audit.overview'), asyncHandler(tc.tradeCaseAuditOverview));
tradeCasesRouter.get('/rules', requirePermission('tradecase.rules.view'), asyncHandler(tc.tradeRuleRegistry));

// Post-shipment. The client's side: their approved requests, then a draft application that is prepared and submitted.
// The officer's side: the examination screen, a request for clarification, and a finding recorded by hand.
// Examination, the applicant's waiver and the decision are the presentation routes below.
tradeCasesRouter.get('/post-shipment/lcs', requirePermission('tradecase.postshipment.apply'), asyncHandler(tc.postShipmentLcs));
tradeCasesRouter.post('/:id/post-shipment', caseAccess, requirePermission('tradecase.postshipment.apply'), asyncHandler(tc.startPostShipment));
tradeCasesRouter.post('/:id/post-shipment/documents', caseAccess, requirePermission('tradecase.postshipment.apply'), uploadRateLimit, singleDocumentUpload, asyncHandler(tc.attachPresentationDocument));
tradeCasesRouter.delete('/:id/post-shipment/documents/:linkId', caseAccess, requirePermission('tradecase.postshipment.apply'), asyncHandler(tc.removePresentationDocument));
tradeCasesRouter.delete('/:id/post-shipment', caseAccess, requirePermission('tradecase.postshipment.apply'), asyncHandler(tc.removePostShipmentDraft));
tradeCasesRouter.post('/:id/post-shipment/submit', caseAccess, requirePermission('tradecase.postshipment.apply'), asyncHandler(tc.submitPostShipment));
tradeCasesRouter.get('/:id/post-shipment/review', caseAccess, requirePermission('tradecase.findings.internal.view'), asyncHandler(tc.postShipmentReview));
tradeCasesRouter.post('/:id/post-shipment/clarification', caseAccess, requirePermission('tradecase.presentation.examine'), asyncHandler(tc.requestPostShipmentClarification));
tradeCasesRouter.post('/:id/post-shipment/ai-review', caseAccess, requirePermission('tradecase.presentation.examine'), asyncHandler(tc.aiScrutinyPostShipment));
tradeCasesRouter.post('/:id/post-shipment/findings', caseAccess, requirePermission('tradecase.presentation.examine'), asyncHandler(tc.addPostShipmentFinding));

tradeCasesRouter.get('/:id', caseAccess, asyncHandler(tc.getTradeCase));
tradeCasesRouter.get('/:id/scrutiny', caseAccess, asyncHandler(tc.tradeCaseScrutiny));
tradeCasesRouter.get('/:id/verification-report', caseAccess, requirePermission('tradecase.verification.export'), asyncHandler(tc.tradeCaseVerificationReport));
tradeCasesRouter.get('/:id/audit', requirePermission('tradecase.audit.view'), asyncHandler(tc.getTradeCaseAudit));
tradeCasesRouter.post('/:id/application', caseAccess, asyncHandler(tc.updateTradeCaseApplication));
tradeCasesRouter.post('/:id/documents', caseAccess, uploadRateLimit, singleDocumentUpload, asyncHandler(tc.attachTradeCaseDocument));
tradeCasesRouter.post('/:id/documents/send', caseAccess, requirePermission('tradecase.submit'), asyncHandler(tc.sendTradeCaseDocuments));
tradeCasesRouter.post('/:id/documents/analyze', caseAccess, uploadRateLimit, asyncHandler(tc.analyzeTradeCaseDocuments));
tradeCasesRouter.post('/:id/documents/:linkId/type', caseAccess, asyncHandler(tc.retypeTradeCaseDocument));
tradeCasesRouter.delete('/:id/documents/:linkId', caseAccess, asyncHandler(tc.removeTradeCaseDocument));
tradeCasesRouter.get('/:id/documents/:linkId/file', caseAccess, asyncHandler(tc.downloadTradeCaseDocument));
tradeCasesRouter.post('/:id/submit', caseAccess, asyncHandler(tc.submitTradeCase));
tradeCasesRouter.post('/:id/withdraw', caseAccess, asyncHandler(tc.withdrawTradeCase));
tradeCasesRouter.post('/:id/revalidate', caseAccess, asyncHandler(tc.revalidateTradeCase));

tradeCasesRouter.post('/:id/reviews/:department', caseAccess, asyncHandler(tc.decideTradeCaseReview));
tradeCasesRouter.post('/:id/queries/compose', caseAccess, asyncHandler(tc.composeTradeCaseMail));
tradeCasesRouter.post('/:id/queries', caseAccess, asyncHandler(tc.raiseTradeCaseQuery));
tradeCasesRouter.post('/:id/queries/:queryId/respond', caseAccess, asyncHandler(tc.respondTradeCaseQuery));
tradeCasesRouter.post('/:id/queries/:queryId/resolve', caseAccess, asyncHandler(tc.resolveTradeCaseQuery));
tradeCasesRouter.post('/:id/findings/:findingId/disposition', caseAccess, asyncHandler(tc.dispositionTradeCaseFinding));
tradeCasesRouter.post('/:id/findings/:findingId/applicant-waiver', caseAccess, asyncHandler(tc.applicantWaiverTradeCaseFinding));
tradeCasesRouter.post('/:id/credit-facility', caseAccess, asyncHandler(tc.recordTradeCaseCreditFacility));

tradeCasesRouter.post('/:id/approval/preshipment', caseAccess, asyncHandler(tc.approveTradeCasePreShipment));
// The payload PDF handed to the host after the approval: its status and link, the PDF, making it when missing, and sending it (which creates the TI reference).
tradeCasesRouter.get('/:id/host-payload', caseAccess, requirePermission('tradecase.hostpayload.view'), asyncHandler(tc.hostPayloadView));
tradeCasesRouter.get('/:id/host-payload/pdf', caseAccess, requirePermission('tradecase.hostpayload.view'), asyncHandler(tc.hostPayloadPdf));
tradeCasesRouter.post('/:id/host-payload', caseAccess, requirePermission('tradecase.hostpayload.send'), asyncHandler(tc.generateHostPayload));
tradeCasesRouter.post('/:id/host-payload/send', caseAccess, requirePermission('tradecase.hostpayload.send'), asyncHandler(tc.sendHostPayload));
tradeCasesRouter.post('/:id/approval/request', caseAccess, asyncHandler(tc.requestTradeCaseApproval));
tradeCasesRouter.post('/:id/approval/decision', caseAccess, asyncHandler(tc.decideTradeCaseApproval));
tradeCasesRouter.post('/:id/reject', caseAccess, asyncHandler(tc.rejectTradeCase));
tradeCasesRouter.post('/:id/cancel', caseAccess, asyncHandler(tc.cancelTradeCase));
tradeCasesRouter.post('/:id/issuance', caseAccess, asyncHandler(tc.issueTradeCaseLc));

tradeCasesRouter.post('/:id/presentations', caseAccess, uploadRateLimit, multiDocumentUpload, asyncHandler(tc.recordTradeCasePresentation));
tradeCasesRouter.post('/:id/presentations/examine', caseAccess, asyncHandler(tc.examineTradeCasePresentation));
tradeCasesRouter.post('/:id/presentations/decision', caseAccess, asyncHandler(tc.decideTradeCasePresentation));
tradeCasesRouter.post('/:id/settlement', caseAccess, asyncHandler(tc.recordTradeCaseSettlement));
tradeCasesRouter.post('/:id/investigations', caseAccess, asyncHandler(tc.openTradeCaseInvestigation));
tradeCasesRouter.post('/:id/investigations/close', caseAccess, asyncHandler(tc.closeTradeCaseInvestigation));
tradeCasesRouter.post('/:id/close', caseAccess, asyncHandler(tc.closeTradeCase));

// Amendments to an issued credit: one open amendment at a time, so the routes need no amendment id.
tradeCasesRouter.post('/:id/amendments', caseAccess, asyncHandler(tc.requestTradeCaseAmendment));
tradeCasesRouter.post('/:id/amendments/reviews/:department', caseAccess, asyncHandler(tc.reviewTradeCaseAmendment));
tradeCasesRouter.post('/:id/amendments/submit', caseAccess, asyncHandler(tc.submitTradeCaseAmendment));
tradeCasesRouter.post('/:id/amendments/decision', caseAccess, asyncHandler(tc.decideTradeCaseAmendment));
tradeCasesRouter.post('/:id/amendments/issuance', caseAccess, asyncHandler(tc.issueTradeCaseAmendment));
tradeCasesRouter.post('/:id/amendments/beneficiary-response', caseAccess, asyncHandler(tc.recordTradeCaseAmendmentResponse));
