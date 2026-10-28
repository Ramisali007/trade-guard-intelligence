import type { Department } from '../models/trade-case.models';
import { humanize } from './format';

/** How an open finding can be closed, by its category: the same table the API enforces. */
export const DISPOSITIONS: Record<string, string[]> = {
  MISSING_INFORMATION: ['JUSTIFIED'],
  DATA_INCONSISTENCY: ['JUSTIFIED'],
  LC_TERM_ISSUE: ['JUSTIFIED'],
  DOCUMENT_QUALITY: ['VERIFIED_MANUALLY'],
  LOW_CONFIDENCE_EXTRACTION: ['VERIFIED_MANUALLY'],
  OPERATIONAL: ['VERIFIED_MANUALLY'],
  CREDIT_BLOCKER: ['JUSTIFIED'],
  REGULATORY_CONCERN: ['JUSTIFIED', 'CHECKPOINT_CONFIRMED', 'CONFIRMED_ESCALATED'],
  COMPLIANCE_ALERT: ['FALSE_POSITIVE', 'RISK_ACCEPTED', 'CONFIRMED_ESCALATED'],
  TBML_RED_FLAG: ['FALSE_POSITIVE', 'RISK_ACCEPTED', 'CONFIRMED_ESCALATED'],
  DOCUMENTARY_DISCREPANCY: [],
};

export const COMPLIANCE_CATEGORIES = ['COMPLIANCE_ALERT', 'TBML_RED_FLAG', 'REGULATORY_CONCERN'];

/** The permission that lets a user act for a department: the server's DEPARTMENT_PERMISSION. */
export const DEPARTMENT_PERMISSION: Record<Department, string> = {
  RM: 'tradecase.review.rm',
  TRADE_OPS: 'tradecase.review.trade_ops',
  COMPLIANCE: 'tradecase.review.compliance',
  CREDIT: 'tradecase.review.credit',
};

/** What each way of closing a finding is called on screen. Escalating is the only one that keeps it blocking. */
export function dispositionLabel(code: string): string {
  const labels: Record<string, string> = {
    FALSE_POSITIVE: 'Resolve: false positive, not a concern',
    RISK_ACCEPTED: 'Resolve: risk reviewed and accepted',
    JUSTIFIED: 'Resolve: justified',
    VERIFIED_MANUALLY: 'Resolve: checked manually',
    CHECKPOINT_CONFIRMED: 'Resolve: checkpoint confirmed',
    CONFIRMED_ESCALATED: 'Escalate: confirmed, keeps blocking',
  };
  return labels[code] ?? humanize(code.toLowerCase());
}
