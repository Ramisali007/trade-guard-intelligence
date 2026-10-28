/**
 * TradeGuard Intelligence — Transaction Identity & Identifier History Registry
 * In-memory and persistent registry tracking canonical transaction fingerprints,
 * semantic identifier lifecycles, and cross-transaction relationships.
 */

import crypto from 'node:crypto';
import { DebouncedSnapshot, readJsonIfPresent } from '../../utils/json-snapshot';
import { createLogger } from '../../utils/logger';
import type { SemanticIdentifier, SemanticIdentifierType } from './identifier-normalizer';

export interface TransactionIdentityRecord {
  transactionId: string;
  fingerprintHash: string;
  customerId: string;
  lcNumber?: string;
  invoiceNumber?: string;
  billOfLadingNumber?: string;
  airwayBillNumber?: string;
  purchaseOrderNumber?: string;
  containerNumbers: string[];
  vesselImo?: string;
  uetr?: string;
  paymentReference?: string;
  applicant: string;
  beneficiary: string;
  issuingBank?: string;
  currency: string;
  totalAmount: number;
  totalQuantity: number;
  goodsSummary: string;
  hsCodes: string[];
  portOfLoading?: string;
  portOfDischarge?: string;
  originCountry?: string;
  destinationCountry?: string;
  transactionTimestamp: string;
  primaryDocumentId: string;
  associatedDocumentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface IdentifierOccurrence {
  documentId: string;
  documentName: string;
  /** Classified type of the presenting document (Commercial Invoice, Bill of Lading, ...). */
  documentType?: string;
  transactionId: string;
  customerId: string;
  amount?: number;
  currency?: string;
  beneficiary?: string;
  applicant?: string;
  timestamp: string;
  paymentReference?: string;
  uetr?: string;
  vesselImo?: string;
  pageNumber?: number;
}

export interface IdentifierHistoryEntry {
  type: SemanticIdentifierType;
  normalizedValue: string;
  firstSeenAt: string;
  lastSeenAt: string;
  appearancesCount: number;
  occurrences: IdentifierOccurrence[];
}

const log = createLogger('transaction-registry');

/** Per identifier, enough history to see a pattern without letting one reused number grow without bound. */
const MAX_OCCURRENCES_PER_IDENTIFIER = 200;

interface RegistrySnapshot {
  version: 1;
  transactions: TransactionIdentityRecord[];
  identifiers: IdentifierHistoryEntry[];
}

export class TransactionRegistry {
  private static instance: TransactionRegistry;

  // In-memory indexes for sub-millisecond retrieval
  private readonly transactionsById = new Map<string, TransactionIdentityRecord>();
  private readonly transactionsByFingerprint = new Map<string, TransactionIdentityRecord[]>();
  private readonly identifierIndex = new Map<string, IdentifierHistoryEntry>(); // Key: `${type}:${normalizedValue}`

  private snapshot: DebouncedSnapshot | null = null;

  private constructor() {}

  /**
   * Load the history from `file` and keep it written there as it changes. Without this the replay,
   * reuse and double-financing checks forget everything on a restart and a reused invoice or bill of
   * lading from yesterday looks new.
   */
  public async attachPersistence(file: string): Promise<void> {
    try {
      const stored = await readJsonIfPresent<RegistrySnapshot>(file);
      if (stored?.version === 1) {
        for (const txn of stored.transactions) {
          this.transactionsById.set(txn.transactionId, txn);
          const list = this.transactionsByFingerprint.get(txn.fingerprintHash) ?? [];
          list.push(txn);
          this.transactionsByFingerprint.set(txn.fingerprintHash, list);
        }
        for (const entry of stored.identifiers) this.identifierIndex.set(`${entry.type}:${entry.normalizedValue}`, entry);
        log.info('restored the transaction history', { transactions: this.transactionsById.size, identifiers: this.identifierIndex.size });
      }
    } catch (error) {
      // A corrupt history must not silently become an empty one.
      log.error('the transaction history file could not be read; fraud history starts empty', { file, error: String(error) });
    }
    this.snapshot = new DebouncedSnapshot(file, () => this.serialize());
  }

  /** Write any pending change now (shutdown). */
  public async flush(): Promise<void> {
    await this.snapshot?.flush();
  }

  private serialize(): RegistrySnapshot {
    return { version: 1, transactions: [...this.transactionsById.values()], identifiers: [...this.identifierIndex.values()] };
  }

  public static getInstance(): TransactionRegistry {
    if (!TransactionRegistry.instance) {
      TransactionRegistry.instance = new TransactionRegistry();
    }
    return TransactionRegistry.instance;
  }

  public clearAll(): void {
    this.transactionsById.clear();
    this.transactionsByFingerprint.clear();
    this.identifierIndex.clear();
  }

  /**
   * Generates a canonical deterministic SHA-256 fingerprint from core transaction invariants.
   */
  public generateFingerprint(input: {
    applicant?: string;
    beneficiary?: string;
    currency: string;
    totalAmount: number;
    invoiceNumber?: string;
    billOfLadingNumber?: string;
    lcNumber?: string;
    totalQuantity?: number;
    hsCodes?: string[];
  }): string {
    const norm = (s?: string) => (s ? s.trim().toLowerCase().replace(/[\s\-_]/g, '') : '');
    const tokens = [
      norm(input.applicant),
      norm(input.beneficiary),
      (input.currency || 'USD').toUpperCase(),
      Math.round(input.totalAmount || 0),
      norm(input.invoiceNumber),
      norm(input.billOfLadingNumber),
      norm(input.lcNumber),
      input.totalQuantity ? Math.round(input.totalQuantity) : 0,
      (input.hsCodes || []).sort().join(','),
    ];

    return crypto.createHash('sha256').update(tokens.join(':::')).digest('hex');
  }

  /**
   * Registers or updates a transaction in the identity registry.
   */
  public registerTransaction(record: TransactionIdentityRecord): void {
    const existing = this.transactionsById.get(record.transactionId);
    if (existing) {
      existing.associatedDocumentIds = Array.from(
        new Set([...existing.associatedDocumentIds, ...record.associatedDocumentIds, record.primaryDocumentId]),
      );
      existing.updatedAt = new Date().toISOString();
      this.snapshot?.markDirty();
      return;
    }

    this.transactionsById.set(record.transactionId, record);

    const fpList = this.transactionsByFingerprint.get(record.fingerprintHash) || [];
    fpList.push(record);
    this.transactionsByFingerprint.set(record.fingerprintHash, fpList);
    this.snapshot?.markDirty();
  }

  /**
   * Records an occurrence of an identifier in the historical registry.
   */
  public recordIdentifier(identifier: SemanticIdentifier, context: {
    transactionId: string;
    customerId: string;
    documentType?: string;
    amount?: number;
    currency?: string;
    beneficiary?: string;
    applicant?: string;
    paymentReference?: string;
    uetr?: string;
    vesselImo?: string;
  }): void {
    const key = `${identifier.type}:${identifier.normalizedValue}`;
    const now = new Date().toISOString();
    let entry = this.identifierIndex.get(key);

    const occurrence: IdentifierOccurrence = {
      documentId: identifier.sourceDocumentId,
      documentName: identifier.sourceDocumentName,
      documentType: context.documentType,
      transactionId: context.transactionId,
      customerId: context.customerId,
      amount: context.amount,
      currency: context.currency,
      beneficiary: context.beneficiary,
      applicant: context.applicant,
      timestamp: now,
      paymentReference: context.paymentReference,
      uetr: context.uetr,
      vesselImo: context.vesselImo,
      pageNumber: identifier.pageNumber,
    };

    if (!entry) {
      entry = {
        type: identifier.type,
        normalizedValue: identifier.normalizedValue,
        firstSeenAt: now,
        lastSeenAt: now,
        appearancesCount: 1,
        occurrences: [occurrence],
      };
      this.identifierIndex.set(key, entry);
    } else {
      entry.lastSeenAt = now;
      entry.appearancesCount += 1;
      entry.occurrences.push(occurrence);
      if (entry.occurrences.length > MAX_OCCURRENCES_PER_IDENTIFIER) {
        entry.occurrences.splice(0, entry.occurrences.length - MAX_OCCURRENCES_PER_IDENTIFIER);
      }
    }
    this.snapshot?.markDirty();
  }

  /**
   * Retrieves identifier history.
   */
  public getIdentifierHistory(type: SemanticIdentifierType, normalizedValue: string): IdentifierHistoryEntry | null {
    const key = `${type}:${normalizedValue}`;
    return this.identifierIndex.get(key) || null;
  }

  /**
   * Queries existing transactions matching exact or partial fingerprints.
   */
  public findTransactionsByFingerprint(fingerprintHash: string): TransactionIdentityRecord[] {
    return this.transactionsByFingerprint.get(fingerprintHash) || [];
  }

  public findByFingerprint(fingerprintHash: string): TransactionIdentityRecord[] {
    return this.findTransactionsByFingerprint(fingerprintHash);
  }

  /**
   * Finds transaction by transactionId.
   */
  public findById(transactionId: string): TransactionIdentityRecord | null {
    return this.transactionsById.get(transactionId) || null;
  }

  /**
   * Returns all stored transactions for analysis.
   */
  public listAll(): TransactionIdentityRecord[] {
    return Array.from(this.transactionsById.values());
  }

  /**
   * Clears internal state (primarily used in automated test isolation).
   */
  public resetForTesting(): void {
    this.transactionsById.clear();
    this.transactionsByFingerprint.clear();
    this.identifierIndex.clear();
  }
}
