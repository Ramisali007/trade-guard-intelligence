import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../../config';
import { AppError, Errors } from '../../utils/errors';
import { DebouncedSnapshot, readJsonIfPresent } from '../../utils/json-snapshot';
import { createLogger } from '../../utils/logger';
import { ENTITY_REGISTRY, type SupportedEntityType } from './entity-registry';
import { ImportBatchService } from './import-batch.service';

const log = createLogger('master-data-changes');

/**
 * Four-eyes control for reference data.
 *
 * Sanctions entries, country risk flags, price corridors, banks and the rest decide what the screening
 * engines conclude. One person typing a change into the form must not be able to alter a conclusion on
 * their own, so a manual change is *submitted*, and only applied when a different person holding
 * `masterdata.approve` accepts it. The applied change is written to the master-data audit log under the
 * submitter's name with the approver recorded beside it. Feeds synchronized from the publishers are
 * not affected: they are automated and carry their own checksums and depletion guard.
 */

export interface ChangeActor {
  id: string;
  name: string;
  role: string;
}

export type ChangeStatus = 'PENDING' | 'APPLIED' | 'REJECTED' | 'APPLY_FAILED';

export interface MasterDataChange {
  changeId: string;
  entityType: SupportedEntityType;
  kind: 'SINGLE' | 'BULK';
  /** SINGLE: one record (or the fields to patch). BULK: the validated records. */
  payload: Record<string, unknown> | Array<Record<string, unknown>>;
  options: {
    isPatchDetails?: boolean;
    notes?: string;
    ingestionMethod?: 'MANUAL_FORM' | 'JSON' | 'CSV' | 'EXCEL' | 'SCRAPER' | 'URL';
    sourceName?: string;
    sourceUrl?: string;
  };
  summary: string;
  recordCount: number;
  requestedBy: ChangeActor;
  requestedAt: string;
  status: ChangeStatus;
  decidedBy: ChangeActor | null;
  decidedAt: string | null;
  rationale: string;
  /** Batch id of the import that applied it. */
  appliedBatchId: string | null;
  failure: string | null;
}

const MAX_BULK_RECORDS = 5000;
const MAX_PENDING_PER_USER = 25;

export class MasterDataChangeService {
  private static instance: MasterDataChangeService;
  private readonly changes = new Map<string, MasterDataChange>();
  private snapshot: DebouncedSnapshot | null = null;

  static getInstance(): MasterDataChangeService {
    if (!MasterDataChangeService.instance) MasterDataChangeService.instance = new MasterDataChangeService();
    return MasterDataChangeService.instance;
  }

  async init(): Promise<void> {
    if (!config.storage.persistToDisk) return;
    const file = path.join(config.upload.dataDir, 'master-data-changes.json');
    try {
      for (const change of (await readJsonIfPresent<MasterDataChange[]>(file)) ?? []) this.changes.set(change.changeId, change);
    } catch (error) {
      log.error('the change-request file could not be read', { error: String(error) });
    }
    this.snapshot = new DebouncedSnapshot(file, () => [...this.changes.values()], 250);
  }

  async flush(): Promise<void> {
    await this.snapshot?.flush();
  }

  list(status?: ChangeStatus): MasterDataChange[] {
    return [...this.changes.values()]
      .filter((c) => !status || c.status === status)
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))
      .slice(0, 200);
  }

  /** Validate and queue a change. Nothing is applied here. */
  async submit(
    actor: ChangeActor,
    input: {
      entityType: SupportedEntityType;
      kind: 'SINGLE' | 'BULK';
      payload: Record<string, unknown> | Array<Record<string, unknown>>;
      options?: MasterDataChange['options'];
    },
  ): Promise<MasterDataChange> {
    if (!ENTITY_REGISTRY[input.entityType]) throw Errors.validation('Unsupported entity type.');
    const pending = [...this.changes.values()].filter((c) => c.status === 'PENDING' && c.requestedBy.id === actor.id).length;
    if (pending >= MAX_PENDING_PER_USER) throw Errors.conflict('You already have ' + pending + ' changes waiting for approval.');

    const batch = ImportBatchService.getInstance();
    let recordCount = 1;
    let summary: string;
    if (input.kind === 'BULK') {
      const records = input.payload as Array<Record<string, unknown>>;
      if (!Array.isArray(records) || records.length === 0) throw Errors.validation('Payload must contain a non-empty "records" array.');
      if (records.length > MAX_BULK_RECORDS) throw Errors.validation('A bulk change may carry at most ' + MAX_BULK_RECORDS + ' records.');
      const preview = await batch.previewBulkImport(input.entityType, records);
      if (preview.validRecords === 0) throw Errors.validation('None of the records is valid: ' + preview.errors.slice(0, 3).map((e) => 'row ' + e.row + ': ' + e.message).join('; '));
      recordCount = records.length;
      summary = 'Bulk import into ' + input.entityType + ': ' + preview.newCount + ' new, ' + preview.updatesCount + ' updated, ' + preview.invalidCount + ' invalid';
    } else {
      const record = input.payload as Record<string, unknown>;
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw Errors.validation('A record is required.');
      if (!input.options?.isPatchDetails) {
        const preview = await batch.previewBulkImport(input.entityType, [record]);
        if (preview.invalidCount > 0) throw Errors.validation(preview.errors[0]?.message ?? 'The record is not valid.');
        const row = preview.previewRows[0];
        summary = (row?.action === 'UPDATE' ? 'Update ' : 'Create ') + input.entityType + ' ' + (row?.identifier ?? '') + (row?.changedFields?.length ? ' (' + row.changedFields.join(', ') + ')' : '');
      } else {
        summary = 'Patch ' + input.entityType + ' ' + Object.keys(record).slice(0, 6).join(', ');
      }
    }

    const change: MasterDataChange = {
      changeId: 'MDC-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      entityType: input.entityType,
      kind: input.kind,
      payload: input.payload,
      options: { ...(input.options ?? {}) },
      summary: summary.slice(0, 300),
      recordCount,
      requestedBy: actor,
      requestedAt: new Date().toISOString(),
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
      rationale: '',
      appliedBatchId: null,
      failure: null,
    };
    this.changes.set(change.changeId, change);
    this.snapshot?.markDirty();
    log.info('[AUDIT_LOG] master_data_change_submitted', { changeId: change.changeId, entityType: change.entityType, by: actor.id, summary: change.summary });
    return change;
  }

  /** The second person's decision. Approval applies the change. */
  async decide(actor: ChangeActor, changeId: string, input: { approve?: unknown; rationale?: unknown }): Promise<MasterDataChange> {
    const change = this.changes.get(changeId);
    if (!change) throw Errors.notFound('change request');
    if (change.status !== 'PENDING') throw Errors.conflict('This change has already been decided.');
    if (change.requestedBy.id === actor.id) {
      throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'Dual control: the person who submitted a change cannot approve it.' });
    }
    const rationale = typeof input.rationale === 'string' ? input.rationale.trim() : '';
    if (rationale.length < 10) throw Errors.validation('A rationale of at least 10 characters is required.');

    change.decidedBy = actor;
    change.decidedAt = new Date().toISOString();
    change.rationale = rationale.slice(0, 1000);

    if (input.approve !== true) {
      change.status = 'REJECTED';
      this.snapshot?.markDirty();
      log.info('[AUDIT_LOG] master_data_change_rejected', { changeId, by: actor.id });
      return change;
    }

    const batch = ImportBatchService.getInstance();
    const notes = [change.options.notes, 'Change ' + change.changeId + ' approved by ' + actor.name + ' (' + actor.role + '): ' + change.rationale].filter(Boolean).join(' | ');
    try {
      if (change.kind === 'SINGLE') {
        const result = await batch.commitSingleRecord(change.entityType, change.payload as Record<string, unknown>, {
          isPatchDetails: change.options.isPatchDetails === true,
          actor: change.requestedBy.name + ' <' + change.requestedBy.id + '>',
          approvedBy: actor.name + ' <' + actor.id + '>',
          notes,
        });
        change.appliedBatchId = result.batchId;
      } else {
        const result = await batch.commitBulkBatch(change.entityType, change.payload as Array<Record<string, unknown>>, {
          entityType: change.entityType,
          ingestionMethod: change.options.ingestionMethod ?? 'CSV',
          sourceName: change.options.sourceName,
          sourceUrl: change.options.sourceUrl,
          importedBy: change.requestedBy.name + ' <' + change.requestedBy.id + '>',
          approvedBy: actor.name + ' <' + actor.id + '>',
          notes,
        });
        change.appliedBatchId = result.batchId;
      }
      change.status = 'APPLIED';
      log.info('[AUDIT_LOG] master_data_change_applied', { changeId, by: actor.id, batchId: change.appliedBatchId });
    } catch (error) {
      change.status = 'APPLY_FAILED';
      change.failure = error instanceof Error ? error.message.slice(0, 500) : 'The change could not be applied.';
      log.error('master data change failed to apply', { changeId, error: change.failure });
    }
    this.snapshot?.markDirty();
    return change;
  }
}
