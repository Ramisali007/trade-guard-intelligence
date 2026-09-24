/**
 * TradeGuard Intelligence — Transaction Identity & Identifier History Registry
 * In-memory and persistent registry tracking canonical transaction fingerprints,
 * semantic identifier lifecycles, and cross-transaction relationships.
 */

import crypto from 'node:crypto';
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
  transactionId: string;
  customerId: string;
  amount?: number;
  currency?: string;
  beneficiary?: string;
  applicant?: string;
  timestamp: string;
  paymentReference?: string;
  uetr?: string;
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

export class TransactionRegistry {
  private static instance: TransactionRegistry;

  // In-memory indexes for sub-millisecond retrieval
  private readonly transactionsById = new Map<string, TransactionIdentityRecord>();
  private readonly transactionsByFingerprint = new Map<string, TransactionIdentityRecord[]>();
  private readonly identifierIndex = new Map<string, IdentifierHistoryEntry>(); // Key: `${type}:${normalizedValue}`

  private constructor() {}

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
      return;
    }

    this.transactionsById.set(record.transactionId, record);

    const fpList = this.transactionsByFingerprint.get(record.fingerprintHash) || [];
    fpList.push(record);
    this.transactionsByFingerprint.set(record.fingerprintHash, fpList);
  }

  /**
   * Records an occurrence of an identifier in the historical registry.
   */
  public recordIdentifier(identifier: SemanticIdentifier, context: {
    transactionId: string;
    customerId: string;
    amount?: number;
    currency?: string;
    beneficiary?: string;
    applicant?: string;
    paymentReference?: string;
    uetr?: string;
  }): void {
    const key = `${identifier.type}:${identifier.normalizedValue}`;
    const now = new Date().toISOString();
    let entry = this.identifierIndex.get(key);

    const occurrence: IdentifierOccurrence = {
      documentId: identifier.sourceDocumentId,
      documentName: identifier.sourceDocumentName,
      transactionId: context.transactionId,
      customerId: context.customerId,
      amount: context.amount,
      currency: context.currency,
      beneficiary: context.beneficiary,
      applicant: context.applicant,
      timestamp: now,
      paymentReference: context.paymentReference,
      uetr: context.uetr,
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
    }
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
