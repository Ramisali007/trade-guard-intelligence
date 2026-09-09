import crypto from 'node:crypto';
import { ComplianceStore, type ComplianceImportBatchRecord, type ComplianceAuditLogRecord } from '../db/compliance-store';
import { ENTITY_REGISTRY, sanitizeForCsvInjection, type SupportedEntityType } from './entity-registry';
import { ComplianceSyncEngine } from '../sync/sync-engine.service';
import { createLogger } from '../../utils/logger';

const log = createLogger('import-batch-service');

export interface ImportPreviewResult {
  entityType: string;
  totalDetected: number;
  validRecords: number;
  updatesCount: number;
  newCount: number;
  duplicatesCount: number;
  invalidCount: number;
  errors: Array<{ row: number; identifier?: string; message: string }>;
  previewRows: Array<{
    action: 'CREATE' | 'UPDATE' | 'INVALID';
    identifier: string;
    existingData?: any;
    incomingData: any;
    changedFields?: string[];
    error?: string;
  }>;
}

export interface CommitBatchOptions {
  entityType: SupportedEntityType;
  ingestionMethod: 'MANUAL_FORM' | 'JSON' | 'CSV' | 'EXCEL' | 'SCRAPER' | 'URL';
  sourceName?: string;
  sourceUrl?: string;
  importedBy?: string;
  notes?: string;
}

export class ImportBatchService {
  private static instance: ImportBatchService;
  private readonly store = ComplianceStore.getInstance();
  private readonly syncEngine = ComplianceSyncEngine.getInstance();

  private constructor() {}

  public static getInstance(): ImportBatchService {
    if (!ImportBatchService.instance) {
      ImportBatchService.instance = new ImportBatchService();
    }
    return ImportBatchService.instance;
  }

  /**
   * Generates a deterministic banking-standard Batch ID (e.g. IMP-20260909-001234)
   */
  public generateBatchId(): string {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `IMP-${today}-${rand}`;
  }

  /**
   * Dry-run validation & conflict detection preview for bulk payloads (CSV / JSON).
   */
  public async previewBulkImport(
    entityType: SupportedEntityType,
    records: Array<Record<string, any>>,
  ): Promise<ImportPreviewResult> {
    await this.store.init();
    const entityDef = ENTITY_REGISTRY[entityType];
    if (!entityDef) {
      throw new Error(`Unknown entity type "${entityType}"`);
    }

    const previewRows: ImportPreviewResult['previewRows'] = [];
    const errors: ImportPreviewResult['errors'] = [];
    let validCount = 0;
    let updatesCount = 0;
    let newCount = 0;
    let duplicatesCount = 0;
    let invalidCount = 0;

    const seenIdentifiers = new Set<string>();

    for (let idx = 0; idx < records.length; idx++) {
      const rawRow = records[idx] || {};
      const rowNum = idx + 1;

      // 1. Sanitize against formula injection
      const sanitizedRow: Record<string, any> = {};
      for (const [k, v] of Object.entries(rawRow)) {
        sanitizedRow[k] = sanitizeForCsvInjection(v);
      }

      // 2. Validate
      const validation = entityDef.validate(sanitizedRow);
      if (!validation.valid) {
        invalidCount++;
        errors.push({ row: rowNum, message: validation.errors.join('; ') });
        previewRows.push({
          action: 'INVALID',
          identifier: `ROW-${rowNum}`,
          incomingData: sanitizedRow,
          error: validation.errors.join('; '),
        });
        continue;
      }

      // 3. Normalize & Deduplicate
      const normalized = entityDef.normalize(sanitizedRow);
      const deterministicId = entityDef.generateDeterministicId(normalized);

      // Check intra-batch duplicate
      if (seenIdentifiers.has(deterministicId)) {
        duplicatesCount++;
        previewRows.push({
          action: 'UPDATE',
          identifier: deterministicId,
          incomingData: normalized,
          changedFields: ['Duplicate in batch — latest row applies'],
        });
        continue;
      }
      seenIdentifiers.add(deterministicId);

      // 4. Check against Database
      const existing = await this.store.getMasterEntityById(entityType, deterministicId);
      if (existing) {
        updatesCount++;
        validCount++;
        const changedFields = this.diffFields(existing, normalized);
        previewRows.push({
          action: 'UPDATE',
          identifier: deterministicId,
          existingData: existing,
          incomingData: normalized,
          changedFields,
        });
      } else {
        newCount++;
        validCount++;
        previewRows.push({
          action: 'CREATE',
          identifier: deterministicId,
          incomingData: normalized,
        });
      }
    }

    return {
      entityType,
      totalDetected: records.length,
      validRecords: validCount,
      updatesCount,
      newCount,
      duplicatesCount,
      invalidCount,
      errors,
      previewRows: previewRows.slice(0, 100), // Preview top 100 rows for display
    };
  }

  /**
   * Commit a single record manually (Level 1: Create Complete Entity, or Level 2: Patch Details).
   */
  public async commitSingleRecord(
    entityType: SupportedEntityType,
    payload: Record<string, any>,
    options: {
      isPatchDetails?: boolean;
      actor?: string;
      sourceName?: string;
      notes?: string;
    } = {},
  ): Promise<{ success: boolean; record: any; action: 'CREATE' | 'UPDATE' | 'PATCH_DETAILS'; batchId: string }> {
    await this.store.init();
    const entityDef = ENTITY_REGISTRY[entityType];
    if (!entityDef) throw new Error(`Unknown entity type: ${entityType}`);

    const batchId = this.generateBatchId();
    const now = new Date().toISOString();
    const actor = options.actor || 'COMPLIANCE_OFFICER';

    // Formula injection sanitizer
    const cleanPayload: Record<string, any> = {};
    for (const [k, v] of Object.entries(payload)) {
      cleanPayload[k] = sanitizeForCsvInjection(v);
    }

    let deterministicId = entityDef.generateDeterministicId(cleanPayload);
    let existing = await this.store.getMasterEntityById(entityType, deterministicId);

    // If identifier was provided directly in payload, search by that too
    if (!existing && payload[entityDef.primaryKey]) {
      existing = await this.store.getMasterEntityById(entityType, String(payload[entityDef.primaryKey]));
      if (existing) {
        deterministicId = String(payload[entityDef.primaryKey]);
      }
    }

    let action: 'CREATE' | 'UPDATE' | 'PATCH_DETAILS' = 'CREATE';
    let finalRecord: any;
    const auditLogs: ComplianceAuditLogRecord[] = [];

    if (existing) {
      action = options.isPatchDetails ? 'PATCH_DETAILS' : 'UPDATE';
      const normalizedIncoming = entityDef.normalize({ ...existing, ...cleanPayload });

      const changedFields: Record<string, { oldValue: any; newValue: any }> = {};
      for (const key of Object.keys(cleanPayload)) {
        if (existing[key] !== normalizedIncoming[key]) {
          changedFields[key] = { oldValue: existing[key], newValue: normalizedIncoming[key] };
        }
      }

      finalRecord = {
        ...existing,
        ...normalizedIncoming,
        lastVerifiedAt: now,
        lastUpdated: now,
      };

      auditLogs.push({
        logId: `AUD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        batchId,
        entityType,
        recordId: deterministicId,
        action,
        actor,
        timestamp: now,
        changedFields,
        provenance: {
          source_type: 'MANUAL',
          source_name: options.sourceName || 'Manual Compliance Portal',
          confidence: 'VERY_HIGH',
        },
        notes: options.notes || (options.isPatchDetails ? 'Field-level compliance detail update' : 'Full entity update'),
      });
    } else {
      // Validate complete record before creation
      const val = entityDef.validate(cleanPayload);
      if (!val.valid) {
        throw new Error(`Validation failed: ${val.errors.join(', ')}`);
      }

      const normalized = entityDef.normalize(cleanPayload);
      finalRecord = {
        ...normalized,
        [entityDef.primaryKey]: deterministicId,
        lastVerifiedAt: now,
        lastUpdated: now,
      };

      auditLogs.push({
        logId: `AUD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        batchId,
        entityType,
        recordId: deterministicId,
        action: 'CREATE',
        actor,
        timestamp: now,
        provenance: {
          source_type: 'MANUAL',
          source_name: options.sourceName || 'Manual Compliance Entry',
          confidence: 'HIGH',
        },
        notes: options.notes || 'Master entity manually registered',
      });
    }

    // Upsert into master store
    await this.persistMasterEntity(entityType, finalRecord);

    // Save audit log & batch record
    const batchRecord: ComplianceImportBatchRecord = {
      batchId,
      entityType,
      ingestionMethod: 'MANUAL_FORM',
      sourceName: options.sourceName || 'Manual Entry',
      importedBy: actor,
      totalRecords: 1,
      createdCount: action === 'CREATE' ? 1 : 0,
      updatedCount: action !== 'CREATE' ? 1 : 0,
      unchangedCount: 0,
      failedCount: 0,
      duplicateCount: 0,
      status: 'COMPLETED',
      startedAt: now,
      completedAt: now,
      notes: options.notes,
    };

    await this.store.saveImportBatch(batchRecord);
    await this.store.saveAuditLogs(auditLogs);
    this.store.invalidateCaches(entityType);

    log.info('Single master record committed successfully', { entityType, id: deterministicId, action, batchId });

    return {
      success: true,
      record: finalRecord,
      action,
      batchId,
    };
  }

  /**
   * Commit a bulk batch (from CSV / JSON) following preview confirmation.
   */
  public async commitBulkBatch(
    entityType: SupportedEntityType,
    records: Array<Record<string, any>>,
    options: CommitBatchOptions,
  ): Promise<ComplianceImportBatchRecord> {
    await this.store.init();
    const entityDef = ENTITY_REGISTRY[entityType];
    if (!entityDef) throw new Error(`Unknown entity type "${entityType}"`);

    const batchId = this.generateBatchId();
    const startedAt = new Date().toISOString();
    const actor = options.importedBy || 'ADMIN_USER';

    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let failedCount = 0;
    let duplicateCount = 0;
    const errors: Array<{ row: number; identifier?: string; message: string }> = [];
    const auditLogs: ComplianceAuditLogRecord[] = [];
    const recordsToPersist: any[] = [];
    const seenIds = new Set<string>();

    for (let idx = 0; idx < records.length; idx++) {
      const row = records[idx] || {};
      const rowNum = idx + 1;

      try {
        const sanitizedRow: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          sanitizedRow[k] = sanitizeForCsvInjection(v);
        }

        const val = entityDef.validate(sanitizedRow);
        if (!val.valid) {
          failedCount++;
          errors.push({ row: rowNum, message: val.errors.join('; ') });
          continue;
        }

        const normalized = entityDef.normalize(sanitizedRow);
        const deterministicId = entityDef.generateDeterministicId(normalized);

        if (seenIds.has(deterministicId)) {
          duplicateCount++;
          continue;
        }
        seenIds.add(deterministicId);

        const existing = await this.store.getMasterEntityById(entityType, deterministicId);
        const now = new Date().toISOString();

        if (existing) {
          const diff = this.diffFields(existing, normalized);
          if (diff.length === 0) {
            unchangedCount++;
            continue;
          }

          updatedCount++;
          const merged = {
            ...existing,
            ...normalized,
            lastVerifiedAt: now,
            lastUpdated: now,
          };
          recordsToPersist.push(merged);

          const changedFields: Record<string, any> = {};
          for (const f of diff) {
            changedFields[f] = { oldValue: existing[f], newValue: normalized[f] };
          }

          auditLogs.push({
            logId: `AUD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
            batchId,
            entityType,
            recordId: deterministicId,
            action: 'UPDATE',
            actor,
            timestamp: now,
            changedFields,
            provenance: {
              source_type: options.ingestionMethod === 'CSV' ? 'MANUAL' : 'API',
              source_name: options.sourceName || 'Bulk File Ingestion',
              source_url: options.sourceUrl,
              confidence: 'HIGH',
            },
          });
        } else {
          createdCount++;
          const newRec = {
            ...normalized,
            [entityDef.primaryKey]: deterministicId,
            lastVerifiedAt: now,
            lastUpdated: now,
          };
          recordsToPersist.push(newRec);

          auditLogs.push({
            logId: `AUD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
            batchId,
            entityType,
            recordId: deterministicId,
            action: 'CREATE',
            actor,
            timestamp: now,
            provenance: {
              source_type: options.ingestionMethod === 'CSV' ? 'MANUAL' : 'API',
              source_name: options.sourceName || 'Bulk Ingestion',
              source_url: options.sourceUrl,
              confidence: 'HIGH',
            },
          });
        }
      } catch (err: any) {
        failedCount++;
        errors.push({ row: rowNum, message: err?.message || 'Processing exception' });
      }
    }

    // Persist valid records in bulk
    for (const rec of recordsToPersist) {
      await this.persistMasterEntity(entityType, rec);
    }

    const completedAt = new Date().toISOString();
    const batchRecord: ComplianceImportBatchRecord = {
      batchId,
      entityType,
      ingestionMethod: options.ingestionMethod,
      sourceName: options.sourceName || `${options.ingestionMethod} Ingestion`,
      sourceUrl: options.sourceUrl,
      importedBy: actor,
      totalRecords: records.length,
      createdCount,
      updatedCount,
      unchangedCount,
      failedCount,
      duplicateCount,
      status: failedCount === 0 ? 'COMPLETED' : (recordsToPersist.length > 0 ? 'PARTIAL_FAILED' : 'FAILED'),
      startedAt,
      completedAt,
      errors: errors.slice(0, 100),
      notes: options.notes,
    };

    await this.store.saveImportBatch(batchRecord);
    if (auditLogs.length > 0) {
      await this.store.saveAuditLogs(auditLogs);
    }
    this.store.invalidateCaches(entityType);

    log.info('Bulk import batch completed', { batchId, entityType, createdCount, updatedCount, failedCount });

    return batchRecord;
  }

  /**
   * Trigger real-time scraper/feed synchronization for an entity.
   */
  public async triggerScraperForEntity(entityType: SupportedEntityType, actor = 'ADMIN_USER'): Promise<any> {
    await this.store.init();
    let sourceId: string | null = null;

    switch (entityType) {
      case 'sanctions':
        sourceId = 'OFAC_SDN';
        break;
      case 'prices':
        sourceId = 'UN_COMTRADE_PRICING';
        break;
      case 'currencies':
        sourceId = 'CENTRAL_BANK_FX';
        break;
      case 'ports':
        sourceId = 'UN_LOCODE_PORTS';
        break;
      case 'countries':
        sourceId = 'OFAC_SDN';
        break;
      default:
        sourceId = null;
    }

    if (!sourceId) {
      throw new Error(`No automated external scraping pipeline configured for entity "${entityType}"`);
    }

    const run = await this.syncEngine.syncSource(sourceId, {
      triggerType: 'MANUAL',
      actor,
      force: true,
    });

    this.store.invalidateCaches(entityType);
    return run;
  }

  /**
   * SSRF-protected URL source fetcher.
   * Blocks internal RFC 1918 subnets, localhost, and cloud metadata IPs.
   */
  public async fetchUrlSourceSafely(targetUrl: string): Promise<string> {
    const url = new URL(targetUrl);
    const hostname = url.hostname.toLowerCase();

    // SSRF Blocklist: Localhost, AWS metadata, private IPv4 ranges
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.')
    ) {
      throw new Error(`SSRF Protection Error: Access to private or loopback host "${hostname}" is forbidden.`);
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`Invalid URL protocol: "${url.protocol}". Only HTTP and HTTPS are permitted.`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

    try {
      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'TradeGuard-Compliance-Ingestion-Engine/2.0',
          'Accept': 'text/csv, application/json, text/plain',
        },
      });

      if (!res.ok) {
        throw new Error(`External source returned HTTP status ${res.status}: ${res.statusText}`);
      }

      return await res.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private diffFields(oldRec: any, newRec: any): string[] {
    const changed: string[] = [];
    for (const key of Object.keys(newRec)) {
      if (['lastVerifiedAt', 'lastUpdated', 'version', 'syncedAt'].includes(key)) continue;
      if (JSON.stringify(oldRec[key]) !== JSON.stringify(newRec[key])) {
        changed.push(key);
      }
    }
    return changed;
  }

  private async persistMasterEntity(entityType: SupportedEntityType, record: any): Promise<void> {
    switch (entityType) {
      case 'countries':
        await this.store.saveCountries([record]);
        break;
      case 'sanctions':
        await this.store.saveEntities([record]);
        break;
      case 'prices':
        await this.store.savePriceBenchmarks([record]);
        break;
      case 'products':
        await this.store.saveProducts([record]);
        break;
      case 'ports':
        await this.store.savePorts([record]);
        break;
      case 'routes':
        await this.store.saveRoutes([record]);
        break;
      case 'banks':
        await this.store.saveBanks([record]);
        break;
      case 'currencies':
        await this.store.saveFxRates([record]);
        break;
      case 'regulations':
        await this.store.saveRegulations([record]);
        break;
      case 'vessels':
        await this.store.saveVessels([record]);
        break;
      default:
        throw new Error(`Cannot persist unknown entity type: ${entityType}`);
    }
  }
}

export const importBatchService = ImportBatchService.getInstance();

