import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { describeUnknown } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { initHostPayloadRepository, type HostPayloadRecord, type PayloadAccess, type StoredPayloadVersion } from './host-payload.repository';

const log = createLogger('host-payload');

/** The payload is identified by its case number (`TC-2026-00003`): one reference for the case, the link, the file and the PDF; only the TI reference differs. */
export const payloadIdFor = (caseId: string): string => caseId;

export const payloadFilename = (caseId: string, version?: number): string => `${caseId}-host-payload${version && version > 1 ? `-v${version}` : ''}.pdf`;

/** 256 random bits in URL-safe characters. */
export const newPayloadToken = (): string => randomBytes(32).toString('base64url');

/** `TI-2026-000007`. */
export const formatTiReference = (year: number, sequence: number): string => `${config.hostPayload.tiPrefix}-${year}-${String(sequence).padStart(6, '0')}`;

export const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** The address the host reaches this API at. */
export function publicBaseUrl(): string {
  const configured = config.hostPayload.publicBaseUrl?.trim().replace(/\/+$/, '');
  return configured || `http://localhost:${config.server.port}`;
}

/** Whether the operator has said what address the host reaches; without it the link only works on this machine. */
export const publicBaseUrlConfigured = (): boolean => Boolean(config.hostPayload.publicBaseUrl?.trim());

/** The link the host opens: a page with the client's pre-shipment documents and this payload. It names the case and carries the token. */
export const payloadUrl = (_caseId: string, payloadId: string, token: string): string => `${publicBaseUrl()}/api/host-payloads/${payloadId}/${token}`;

/** The payload PDF itself, for a host that wants the file directly; the last segment is only a readable file name. */
export const payloadPdfUrl = (caseId: string, payloadId: string, token: string): string => `${payloadUrl(caseId, payloadId, token)}/${payloadFilename(caseId)}`;

const sameToken = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export interface PublicPayload {
  filename: string;
  pdf: Buffer;
  sha256: string;
  version: number;
}

/**
 * The stored payload for a link, when the token is right. An unknown payload and a wrong token are the same answer
 * (null), so a link cannot be used to find out which payloads exist. Nothing is recorded here.
 */
export async function authoriseLink(payloadId: string, token: string): Promise<HostPayloadRecord | null> {
  const record = await (await initHostPayloadRepository()).findByPayloadId(payloadId);
  if (!record || record.versions.length === 0 || !sameToken(record.token, token)) return null;
  return record;
}

/** Writes down that the host opened something. The host is served even if this fails; the failure is logged. */
export async function recordOpen(record: HostPayloadRecord, kind: NonNullable<PayloadAccess['kind']>, caller: string, item?: string): Promise<void> {
  const latest = record.versions[record.versions.length - 1]!;
  await (await initHostPayloadRepository())
    .recordAccess(record.payloadId, { at: new Date().toISOString(), caller: createHash('sha256').update(caller).digest('hex').slice(0, 10), version: latest.version, kind, ...(item ? { item: item.slice(0, 200) } : {}) })
    .catch((error: unknown) => log.error('could not record the opening of a host payload', { payloadId: record.payloadId, error: describeUnknown(error) }));
}

/** The payload PDF for a link (latest version); each open is recorded. */
export async function openByLink(payloadId: string, token: string, caller: string): Promise<PublicPayload | null> {
  const record = await authoriseLink(payloadId, token);
  if (!record) return null;
  const latest = record.versions[record.versions.length - 1]!;
  await recordOpen(record, 'PAYLOAD_PDF', caller);
  return { filename: payloadFilename(record.caseId, latest.version), pdf: latest.pdf, sha256: latest.sha256, version: latest.version };
}

export const latestVersion = (versions: StoredPayloadVersion[]): StoredPayloadVersion | undefined => versions[versions.length - 1];

// ---------------------------------------------------------------- delivery

export interface DeliveryInput {
  tiReference: string;
  caseId: string;
  /** The page the host opens: the client's documents and the payload. */
  payloadUrl: string;
  /** The payload PDF itself. */
  pdfUrl: string;
  sha256: string;
  sizeBytes: number;
  version: number;
  generatedAt: string;
  approvedAt: string | null;
  applicant: string;
  beneficiary: string;
  currency: string;
  amount: number | null;
}

export interface DeliveryResult {
  mode: 'RECORDED_ONLY' | 'HTTP';
  ok: boolean;
  httpStatus: number | null;
  message: string;
}

/**
 * Hands the payload to the host. With a host endpoint configured the details and the link are posted to it; the PDF itself
 * is not pushed, the host fetches it from the link. Without one, nothing is sent and the result says so: the payload and
 * its link are recorded for the host to collect. A failure is reported, never hidden, and never loses the TI reference.
 */
export async function deliverToHost(input: DeliveryInput, fetchImpl: typeof fetch = fetch): Promise<DeliveryResult> {
  const endpoint = config.hostPayload.deliveryUrl?.trim();
  if (!endpoint) {
    return { mode: 'RECORDED_ONLY', ok: true, httpStatus: null, message: 'No host endpoint is configured: the payload and its link are recorded and ready for the host to open. Nothing was posted.' };
  }
  let target: URL;
  try {
    target = new URL(endpoint);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('not http(s)');
  } catch {
    return { mode: 'HTTP', ok: false, httpStatus: null, message: 'The host endpoint address in the configuration is not a valid http(s) address.' };
  }
  try {
    const response = await fetchImpl(target, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.tiReference,
        ...(config.hostPayload.deliveryToken ? { authorization: `Bearer ${config.hostPayload.deliveryToken}` } : {}),
      },
      body: JSON.stringify({ event: 'PRESHIPMENT_APPROVED_PAYLOAD', ...input }),
    });
    return response.ok
      ? { mode: 'HTTP', ok: true, httpStatus: response.status, message: `The host accepted the payload (HTTP ${response.status}).` }
      : { mode: 'HTTP', ok: false, httpStatus: response.status, message: `The host did not accept the payload (HTTP ${response.status}). The TI reference is kept; send again when the host is ready.` };
  } catch (error) {
    log.warn('host delivery failed', { caseId: input.caseId, error: describeUnknown(error).slice(0, 200) });
    return { mode: 'HTTP', ok: false, httpStatus: null, message: 'The host could not be reached. The TI reference is kept; send again when the host is available.' };
  }
}
