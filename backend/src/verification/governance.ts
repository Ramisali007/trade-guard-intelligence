import path from 'node:path';
import { config } from '../config';
import { hasPermission } from '../authorization/permissions';
import type { AuthenticatedUser } from '../middleware/auth.middleware';
import { getRule } from '../trade-cases/rule-registry';
import { AppError, Errors } from '../utils/errors';
import { chainAlgorithmField, GENESIS_HASH, hashEntry, verifyHashChain, type ChainVerification } from '../utils/hash-chain';
import { DebouncedSnapshot, readJsonIfPresent } from '../utils/json-snapshot';
import { createLogger } from '../utils/logger';

const log = createLogger('verification-governance');

/**
 * Who decided that a verification rule or a reference dataset may act as a bank control, and when.
 *
 * Three things are kept apart:
 *  - the rule as written in the code (its source, interpretation and the sign-off status it ships with);
 *  - the bank's decision about it, recorded here by a person with the authority to make it, never the
 *    person who proposed it (dual control), in an append-only, hash-chained log;
 *  - how the platform behaves while no decision exists (see `enforcementOf`): demonstration enforcement
 *    or shadow mode, always labeled.
 * An approval applies to one version of one rule. A new version is a new rule and starts unapproved. If
 * the log fails its own integrity check nothing counts as approved: the safe reading of a log that may have
 * been altered is that no control is approved.
 */

export interface GovernanceActor {
  id: string;
  name: string;
  role: string;
}

export type RuleApprovalStatus = 'PENDING_BANK_SIGN_OFF' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'REVOKED';

export type GovernanceEvent =
  | 'RULE_PROPOSED'
  | 'RULE_APPROVED'
  | 'RULE_REJECTED'
  | 'RULE_REVOKED'
  | 'DATASET_SUBMITTED'
  | 'DATASET_APPROVED'
  | 'DATASET_REJECTED'
  | 'DATASET_RETIRED';

export interface GovernanceEntry {
  seq: number;
  prevHash: string;
  hash: string;
  alg?: 'hmac-sha256';
  at: string;
  event: GovernanceEvent;
  /** `ruleId@version` for a rule, the dataset id for a dataset. */
  subject: string;
  by: GovernanceActor;
  rationale: string;
  detail?: Record<string, unknown>;
}

export interface RuleApprovalState {
  ruleId: string;
  version: string;
  status: RuleApprovalStatus;
  proposedBy: GovernanceActor | null;
  proposedAt: string | null;
  decidedBy: GovernanceActor | null;
  decidedAt: string | null;
  rationale: string;
}

const MIN_RATIONALE = 10;

const actorOf = (user: AuthenticatedUser): GovernanceActor => ({ id: user.id, name: user.name, role: user.role });
const forbidden = (message: string): AppError => new AppError({ status: 403, code: 'FORBIDDEN', message });

export class VerificationGovernance {
  private static instance: VerificationGovernance;
  private entries: GovernanceEntry[] = [];
  private snapshot: DebouncedSnapshot | null = null;
  private chainProblem: string | null = null;

  static getInstance(): VerificationGovernance {
    if (!VerificationGovernance.instance) VerificationGovernance.instance = new VerificationGovernance();
    return VerificationGovernance.instance;
  }

  /** Test suites start from an empty log. */
  resetForTesting(): void {
    this.entries = [];
    this.chainProblem = null;
    this.snapshot = null;
  }

  async init(): Promise<void> {
    if (!config.storage.persistToDisk) return;
    const file = path.join(config.upload.dataDir, 'verification-governance.json');
    try {
      this.entries = (await readJsonIfPresent<GovernanceEntry[]>(file)) ?? [];
    } catch (error) {
      this.chainProblem = `The governance log could not be read: ${String(error).slice(0, 120)}`;
      log.error('the governance log could not be read', { error: String(error) });
    }
    this.checkChain();
    this.snapshot = new DebouncedSnapshot(file, () => this.entries, 250);
  }

  async flush(): Promise<void> {
    await this.snapshot?.flush();
  }

  private checkChain(): ChainVerification {
    const result = verifyHashChain(this.entries);
    this.chainProblem = result.valid ? this.chainProblem : result.problem;
    if (!result.valid) log.error('the governance log failed its integrity check; no approval will be honoured', { problem: result.problem });
    return result;
  }

  /** Whether the log can be trusted. Approvals are honoured only while this is true. */
  integrity(): { valid: boolean; problem: string | null; entries: number } {
    const result = verifyHashChain(this.entries);
    return { valid: result.valid && !this.chainProblem, problem: result.problem ?? this.chainProblem, entries: this.entries.length };
  }

  log(): GovernanceEntry[] {
    return [...this.entries].reverse();
  }

  private append(event: GovernanceEvent, subject: string, by: GovernanceActor, rationale: string, detail?: Record<string, unknown>): GovernanceEntry {
    const prev = this.entries[this.entries.length - 1];
    const body = { seq: (prev?.seq ?? 0) + 1, prevHash: prev?.hash ?? GENESIS_HASH, ...chainAlgorithmField(), at: new Date().toISOString(), event, subject, by, rationale: rationale.slice(0, 1000), ...(detail ? { detail } : {}) };
    const entry = { ...body, hash: hashEntry(body) } as GovernanceEntry;
    this.entries.push(entry);
    this.snapshot?.markDirty();
    log.info('[AUDIT_LOG] verification_governance', { event, subject, by: by.id, seq: entry.seq });
    return entry;
  }

  // ------------------------------------------------------------------ rules

  /** The bank's decision on one version of one rule, replayed from the log. */
  ruleState(ruleId: string, version?: string): RuleApprovalState {
    const rule = getRule(ruleId);
    const v = version ?? rule.version;
    const subject = `${ruleId}@${v}`;
    const state: RuleApprovalState = { ruleId, version: v, status: 'PENDING_BANK_SIGN_OFF', proposedBy: null, proposedAt: null, decidedBy: null, decidedAt: null, rationale: '' };
    for (const e of this.entries) {
      if (e.subject !== subject) continue;
      if (e.event === 'RULE_PROPOSED') Object.assign(state, { status: 'PROPOSED', proposedBy: e.by, proposedAt: e.at, decidedBy: null, decidedAt: null, rationale: e.rationale });
      else if (e.event === 'RULE_APPROVED') Object.assign(state, { status: 'APPROVED', decidedBy: e.by, decidedAt: e.at, rationale: e.rationale });
      else if (e.event === 'RULE_REJECTED') Object.assign(state, { status: 'REJECTED', decidedBy: e.by, decidedAt: e.at, rationale: e.rationale });
      else if (e.event === 'RULE_REVOKED') Object.assign(state, { status: 'REVOKED', decidedBy: e.by, decidedAt: e.at, rationale: e.rationale });
    }
    // A log that may have been altered cannot make a control approved.
    if (state.status === 'APPROVED' && !this.integrity().valid) return { ...state, status: 'PENDING_BANK_SIGN_OFF', rationale: 'The governance log failed its integrity check; the approval is not honoured.' };
    return state;
  }

  history(ruleId: string): GovernanceEntry[] {
    return this.entries.filter((e) => e.subject.startsWith(`${ruleId}@`)).reverse();
  }

  private need(user: AuthenticatedUser, permission: Parameters<typeof hasPermission>[1], what: string): void {
    if (!hasPermission(user, permission)) throw forbidden(`You do not have permission to ${what}.`);
  }

  private rationaleOf(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length < MIN_RATIONALE) throw Errors.validation(`A rationale of at least ${MIN_RATIONALE} characters is required.`);
    return text;
  }

  private ruleOrThrow(ruleId: string): void {
    try {
      getRule(ruleId);
    } catch {
      throw Errors.notFound('rule');
    }
  }

  proposeRule(user: AuthenticatedUser, ruleId: string, rationale: unknown): RuleApprovalState {
    this.need(user, 'verification.rules.propose', 'propose a rule for approval');
    this.ruleOrThrow(ruleId);
    const text = this.rationaleOf(rationale);
    const current = this.ruleState(ruleId);
    if (current.status === 'PROPOSED') throw Errors.conflict('This version of the rule is already waiting for a decision.');
    if (current.status === 'APPROVED') throw Errors.conflict('This version of the rule is already approved.');
    this.append('RULE_PROPOSED', `${ruleId}@${current.version}`, actorOf(user), text);
    return this.ruleState(ruleId);
  }

  /** The second person's decision. The person who proposed it cannot decide it. */
  decideRule(user: AuthenticatedUser, ruleId: string, approve: unknown, rationale: unknown): RuleApprovalState {
    this.need(user, 'verification.rules.approve', 'approve or reject a rule');
    this.ruleOrThrow(ruleId);
    if (typeof approve !== 'boolean') throw Errors.validation('Say whether the rule is approved: approve must be true or false.');
    const text = this.rationaleOf(rationale);
    const current = this.ruleState(ruleId);
    if (current.status !== 'PROPOSED') throw Errors.conflict('Only a rule that has been proposed can be decided.');
    if (current.proposedBy?.id === user.id) throw forbidden('Dual control: the person who proposed a rule cannot decide it.');
    this.append(approve === true ? 'RULE_APPROVED' : 'RULE_REJECTED', `${ruleId}@${current.version}`, actorOf(user), text);
    return this.ruleState(ruleId);
  }

  revokeRule(user: AuthenticatedUser, ruleId: string, rationale: unknown): RuleApprovalState {
    this.need(user, 'verification.rules.approve', 'revoke a rule');
    this.ruleOrThrow(ruleId);
    const text = this.rationaleOf(rationale);
    const current = this.ruleState(ruleId);
    if (current.status !== 'APPROVED') throw Errors.conflict('Only an approved rule can be revoked.');
    this.append('RULE_REVOKED', `${ruleId}@${current.version}`, actorOf(user), text);
    return this.ruleState(ruleId);
  }

  // ------------------------------------------------------------------ datasets (used by the tariff adapter)

  datasetEvents(datasetId: string): GovernanceEntry[] {
    return this.entries.filter((e) => e.subject === datasetId).reverse();
  }

  recordDatasetEvent(event: Extract<GovernanceEvent, `DATASET_${string}`>, datasetId: string, by: GovernanceActor, rationale: string, detail?: Record<string, unknown>): GovernanceEntry {
    return this.append(event, datasetId, by, rationale, detail);
  }

  datasetIntegrityValid(): boolean {
    return this.integrity().valid;
  }
}

// ---------------------------------------------------------------------- behavior while a rule is unapproved

/**
 * What the platform does with a finding from a rule the bank has not approved.
 *  DEMO_ENFORCE: the rule acts as written (it may block), and every finding says it is a demonstration.
 *  SHADOW: the rule is evaluated and shown, labeled as advisory, and never blocks.
 * The default is SHADOW in production and DEMO_ENFORCE elsewhere; the setting is explicit so it can never be
 * mistaken for an approved control.
 */
export type UnapprovedRuleMode = 'DEMO_ENFORCE' | 'SHADOW';

export function unapprovedRuleMode(): UnapprovedRuleMode {
  const set = process.env['VERIFICATION_UNAPPROVED_RULE_MODE'];
  if (set === 'DEMO_ENFORCE' || set === 'SHADOW') return set;
  return process.env['NODE_ENV'] === 'production' ? 'SHADOW' : 'DEMO_ENFORCE';
}

export interface Enforcement {
  ruleId: string;
  version: string;
  approval: RuleApprovalStatus;
  mode: 'ENFORCED' | 'DEMO_ENFORCED' | 'SHADOW';
  /** Whether a finding from this rule may stop a case from progressing. */
  mayBlock: boolean;
  label: string;
}

export function enforcementOf(ruleId: string, governance: VerificationGovernance = VerificationGovernance.getInstance()): Enforcement {
  const state = governance.ruleState(ruleId);
  if (state.status === 'APPROVED') {
    return { ruleId, version: state.version, approval: state.status, mode: 'ENFORCED', mayBlock: true, label: `Approved bank control (${state.decidedBy?.name ?? 'policy owner'}, ${state.decidedAt?.slice(0, 10) ?? ''})` };
  }
  const note = state.status === 'REVOKED' ? 'approval revoked' : state.status === 'REJECTED' ? 'rejected' : state.status === 'PROPOSED' ? 'awaiting the policy owner' : 'pending bank approval';
  return unapprovedRuleMode() === 'SHADOW'
    ? { ruleId, version: state.version, approval: state.status, mode: 'SHADOW', mayBlock: false, label: `SHADOW MODE: rule ${note}; advisory only, does not block` }
    : { ruleId, version: state.version, approval: state.status, mode: 'DEMO_ENFORCED', mayBlock: true, label: `DEMONSTRATION: rule ${note}; enforced for demonstration only, not an approved control` };
}

/**
 * Sources whose absence must stop a case, once the rule that depends on them is a control. Configured with
 * VERIFICATION_MANDATORY_SOURCES (comma-separated source ids). None by default: an optional source that is
 * down produces a visible, non-blocking warning and the check stays marked incomplete.
 */
export function mandatorySources(): Set<string> {
  return new Set((process.env['VERIFICATION_MANDATORY_SOURCES'] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

export interface VerificationPolicy {
  enforcement(ruleId: string): Enforcement;
  sourceMandatory(sourceId: string): boolean;
}

export function currentVerificationPolicy(): VerificationPolicy {
  const governance = VerificationGovernance.getInstance();
  const mandatory = mandatorySources();
  return { enforcement: (ruleId) => enforcementOf(ruleId, governance), sourceMandatory: (id) => mandatory.has(id) };
}
