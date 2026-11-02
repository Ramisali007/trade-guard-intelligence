import { AppError } from '../utils/errors';
import type { LcApplicationData } from './trade-case.types';

/**
 * The channel through which an authorized LC is actually issued.
 *
 * In production this is the bank's SWIFT interface (an MT700 to the advising bank) and the PSW
 * Financial Instrument exchange. Neither is integrated here, so the only adapter is the sandbox:
 * it assigns a reference prefixed SBX-, sends nothing, and creates no obligation. The record it
 * produces says so, and every screen that shows it says so.
 *
 * A live adapter must implement this interface, be selected with LC_ISSUANCE_ADAPTER, and only be
 * called after the service has verified the authorization — it never decides anything itself.
 */
export interface LcIssuanceRequest {
  caseId: string;
  approvalId: string;
  terms: LcApplicationData;
  financialInstrument: { number: string; expiryDate: string };
}

export interface LcIssuanceResult {
  lcNumber: string;
  mode: 'SANDBOX';
  adapter: string;
  message: string;
}

export interface LcAmendmentRequest {
  caseId: string;
  lcNumber: string;
  amendmentNumber: number;
  changes: Partial<LcApplicationData>;
}

export interface LcIssuanceAdapter {
  readonly id: string;
  issue(request: LcIssuanceRequest): Promise<LcIssuanceResult>;
  /** The amendment message (an MT707 in a live channel). */
  amend(request: LcAmendmentRequest): Promise<{ reference: string; mode: 'SANDBOX'; message: string }>;
}

export class SandboxLcIssuanceAdapter implements LcIssuanceAdapter {
  readonly id = 'sandbox';

  async amend(request: LcAmendmentRequest): Promise<{ reference: string; mode: 'SANDBOX'; message: string }> {
    return {
      reference: `${request.lcNumber.replace('SBX-LC-', 'SBX-AMD-')}-${String(request.amendmentNumber).padStart(2, '0')}`,
      mode: 'SANDBOX',
      message:
        'SANDBOX AMENDMENT: no SWIFT MT707 was sent and the Financial Instrument was not amended in PSW. The amended terms become effective in this platform only once the beneficiary\'s acceptance is recorded.',
    };
  }

  async issue(request: LcIssuanceRequest): Promise<LcIssuanceResult> {
    const year = new Date().getUTCFullYear();
    return {
      lcNumber: `SBX-LC-${year}-${request.caseId.replace(/[^0-9]/g, '').slice(-6)}`,
      mode: 'SANDBOX',
      adapter: this.id,
      message:
        'SANDBOX ISSUANCE: no SWIFT MT700 was sent, no Financial Instrument was transmitted to PSW, and no bank obligation was created. This record exists to carry the approved terms into post-trade processing for testing.',
    };
  }
}

export function getLcIssuanceAdapter(): LcIssuanceAdapter {
  const configured = (process.env['LC_ISSUANCE_ADAPTER'] ?? 'sandbox').trim().toLowerCase();
  if (configured === 'sandbox') return new SandboxLcIssuanceAdapter();
  throw new AppError({
    status: 501,
    code: 'ISSUANCE_CHANNEL_NOT_INTEGRATED',
    message: 'No live LC issuance channel is integrated. Only the sandbox adapter is available.',
    internal: `LC_ISSUANCE_ADAPTER=${configured} has no implementation`,
  });
}

/**
 * FE Manual Ch.13 para 6B(viii) as amended by EPD CL 09/2026: "<AD acronym>-IMP-<6-digit serial>-
 * <DDMMYYYY>", optionally followed by up to three characters for the transaction type.
 */
const FI_NUMBER = /^([A-Z]{2,10})-IMP-(\d{6})-(\d{2})(\d{2})(\d{4})([A-Z0-9]{0,3})$/;

export function validateFinancialInstrument(fi: { number: string; expiryDate: string }, lcExpiry: string | null, issuedOn: Date): string[] {
  const problems: string[] = [];
  const match = FI_NUMBER.exec(fi.number.trim().toUpperCase());
  if (!match) {
    problems.push('Financial Instrument number must follow <AD>-IMP-<6-digit serial>-<DDMMYYYY>[up to 3 characters], e.g. ABC-IMP-000001-15032021LC.');
  } else {
    const [, , , dd, mm, yyyy] = match;
    const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    if (date.getUTCDate() !== Number(dd) || date.getUTCMonth() !== Number(mm) - 1) {
      problems.push('The date in the Financial Instrument number is not a valid DDMMYYYY date.');
    } else if (date.getTime() > issuedOn.getTime()) {
      problems.push('The Financial Instrument issuance date is in the future.');
    }
  }
  if (!lcExpiry) problems.push('The credit has no expiry date to match.');
  else if (fi.expiryDate !== lcExpiry) {
    problems.push(`Financial Instrument expiry ${fi.expiryDate} must match the LC expiry ${lcExpiry} (FE Manual Ch.13 para 6B(viii)).`);
  }
  return problems;
}
