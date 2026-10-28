import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../middleware/auth.middleware';
import { RULES, RULE_SET_VERSION } from '../trade-cases/rule-registry';
import { enforcementOf, mandatorySources, unapprovedRuleMode, VerificationGovernance } from '../verification/governance';
import { allSourceHealth } from '../verification/source-health';
import { SOURCE_CATALOGUE } from '../verification/source-catalogue';
import { PctStore } from '../verification/pct/pct-store';
import { Errors } from '../utils/errors';

/** HTTP translation for verification governance and source health; the rules live in the services. */

function user(req: Request): AuthenticatedUser {
  if (!req.user) throw Errors.unauthorized();
  return req.user;
}

const RULE_ID = /^[A-Z0-9-]{3,40}$/;

function ruleId(req: Request): string {
  const id = String(req.params['ruleId'] ?? '');
  if (!RULE_ID.test(id)) throw Errors.validation('That rule id is not valid.');
  return id;
}

/** The verification rules, each with the bank's decision on it and what the platform does while it is unapproved. */
function ruleViews() {
  const governance = VerificationGovernance.getInstance();
  return RULES.filter((r) => r.ruleId.startsWith('EXT-')).map((rule) => ({
    rule,
    approval: governance.ruleState(rule.ruleId),
    enforcement: enforcementOf(rule.ruleId, governance),
    history: governance.history(rule.ruleId).map((e) => ({ seq: e.seq, at: e.at, event: e.event, by: e.by, rationale: e.rationale })),
  }));
}

export async function verificationOverview(_req: Request, res: Response): Promise<void> {
  const governance = VerificationGovernance.getInstance();
  res.json({
    ruleSetVersion: RULE_SET_VERSION,
    policy: {
      unapprovedRuleMode: unapprovedRuleMode(),
      mandatorySources: [...mandatorySources()],
      note: 'While a rule is not approved it runs in demonstration enforcement or in shadow mode; every finding says which. Approval is recorded by a person other than the proposer.',
    },
    governanceIntegrity: governance.integrity(),
    rules: ruleViews(),
    sources: { catalogue: SOURCE_CATALOGUE, health: await allSourceHealth() },
  });
}

export async function proposeRule(req: Request, res: Response): Promise<void> {
  VerificationGovernance.getInstance().proposeRule(user(req), ruleId(req), req.body?.rationale);
  res.status(201).json({ rules: ruleViews() });
}

export async function decideRule(req: Request, res: Response): Promise<void> {
  VerificationGovernance.getInstance().decideRule(user(req), ruleId(req), req.body?.approve, req.body?.rationale);
  res.json({ rules: ruleViews() });
}

export async function revokeRule(req: Request, res: Response): Promise<void> {
  VerificationGovernance.getInstance().revokeRule(user(req), ruleId(req), req.body?.rationale);
  res.json({ rules: ruleViews() });
}

export async function governanceLog(_req: Request, res: Response): Promise<void> {
  const governance = VerificationGovernance.getInstance();
  res.json({ integrity: governance.integrity(), entries: governance.log().slice(0, 200) });
}

// ---------------------------------------------------------------------- reference datasets (Pakistan Customs Tariff)

export async function listDatasets(_req: Request, res: Response): Promise<void> {
  res.json({ datasets: PctStore.getInstance().list(), health: PctStore.getInstance().health() });
}

export async function submitDataset(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) throw Errors.validation('Attach the tariff as a .csv file in the "file" field.');
  if (file.buffer.includes(0)) throw Errors.validation('That file is not plain CSV text.');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const dataset = PctStore.getInstance().submit(user(req), {
    csv: file.buffer.toString('utf8'),
    version: body['version'],
    publisher: body['publisher'],
    sourceReference: body['sourceReference'],
    publicationDate: body['publicationDate'],
    scope: body['scope'],
    licenceNote: body['licenceNote'],
    licenceConfirmed: body['licenceConfirmed'] === 'true' || body['licenceConfirmed'] === true,
  });
  res.status(201).json({ dataset });
}

function datasetId(req: Request): string {
  const id = String(req.params['datasetId'] ?? '');
  if (!/^PCT-\d{8}-[0-9a-f]{8}$/.test(id)) throw Errors.validation('That dataset id is not valid.');
  return id;
}

export async function decideDataset(req: Request, res: Response): Promise<void> {
  res.json({ dataset: PctStore.getInstance().decide(user(req), datasetId(req), req.body?.approve, req.body?.rationale) });
}

export async function retireDataset(req: Request, res: Response): Promise<void> {
  res.json({ dataset: PctStore.getInstance().retire(user(req), datasetId(req), req.body?.rationale) });
}
