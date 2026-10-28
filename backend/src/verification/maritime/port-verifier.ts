import type { ClaimRef, ClaimVerification, ModuleRun, VerificationEvidence } from '../verification.types';
import { normalizeExact, normalizePortName, PORT_SOURCE_ID, type PortIndex, type PortLite } from './port-index';

/**
 * Whether the port a document names is a real port, and the one it says it is. The check is of IDENTITY: which
 * UN/LOCODE location the words refer to, and whether it is in the country the document states. It does not, and
 * says it does not, decide whether a port or terminal is subject to a sanction or restriction: no source for that
 * is integrated. A name that matches several places is routed to a person, never guessed.
 */

export interface PortClaim {
  documentId: string;
  filename: string;
  documentType: string;
  documentVersion?: number | null;
  page?: number | null;
  snippet?: string | null;
  extractionConfidence?: number | null;
  field: 'portOfLoading' | 'portOfDischarge';
  value: string;
}

const LIMITS = [
  'This identifies the port. Whether a port, terminal or free-trade zone is subject to a designation or restriction is NOT checked: no source for it is integrated.',
  'The country status shown elsewhere in the case is a static indicator list, not a legal determination for this transaction.',
];

const LOCODE = /\b([A-Z]{2}[A-Z0-9]{3})\b/;

interface Parsed {
  locode: string | null;
  name: string;
  countryCode: string | null;
  countryText: string | null;
  /** Text after the port name that is not a country the list knows, so it could not be used and is reported. */
  unrecognised: string | null;
}

function parsePortText(raw: string, index: PortIndex): Parsed {
  const text = raw.trim();
  const direct = LOCODE.exec(text);
  const locode = direct && index.byLocode.has(direct[1]!) ? direct[1]! : null;
  const segments = text.split(/[,;/()–-]/).map((s) => s.trim()).filter(Boolean);
  const name = segments[0] ?? text;
  let countryCode: string | null = null;
  let countryText: string | null = null;
  for (const segment of segments.slice(1).reverse()) {
    const code = index.countries.get(segment.toLowerCase());
    if (code) {
      countryCode = code;
      countryText = segment;
      break;
    }
  }
  const unrecognised = !countryCode && segments.length > 1 ? segments[segments.length - 1]! : null;
  return { locode, name, countryCode, countryText, unrecognised };
}

/** The port whose whole name is what the document says; failing that, those whose name matches once words like "port of" are dropped. */
function resolveByName(name: string, index: PortIndex): PortLite[] {
  const exact = index.exactByName.get(normalizeExact(name));
  if (exact && exact.length > 0) return exact;
  return index.byName.get(normalizePortName(name)) ?? [];
}

function evidenceFor(port: PortLite, index: PortIndex, now: Date): VerificationEvidence {
  return {
    sourceId: PORT_SOURCE_ID,
    sourceName: 'UN/LOCODE (UNECE), as synchronised into the platform',
    recordId: port.locode,
    excerpt: `${port.locode} - ${port.name}, ${port.country}`,
    url: 'https://unece.org/trade/uncefact/unlocode',
    retrievedAt: index.retrievedAt ?? now.toISOString(),
    publishedOn: null,
    effectiveFrom: null,
    contentHash: index.contentHash ?? 'not recorded',
    datasetVersion: index.version,
    lineage: 'UN/LOCODE is maintained by UNECE with UN/CEFACT and loaded into the platform by the scheduled synchroniser.',
    origin: index.origin,
    stale: index.stale,
  };
}

const ref = (c: PortClaim, normalized: string | null): ClaimRef => ({
  documentId: c.documentId,
  filename: c.filename,
  documentType: c.documentType,
  field: c.field,
  extractedValue: c.value,
  page: c.page ?? null,
  documentVersion: c.documentVersion ?? null,
  normalizedValue: normalized,
  extractionConfidence: c.extractionConfidence ?? null,
  snippet: c.snippet ?? null,
});

export function verifyPortClaims(claims: PortClaim[], index: PortIndex, ctx: { now: Date; transactionDate: string | null }): { results: ClaimVerification[]; module: ModuleRun } {
  const results: ClaimVerification[] = [];
  const assessedAt = ctx.now.toISOString();
  const originLabel = index.origin === 'SEED' ? ' The loaded port list is a built-in seed, not the publisher\'s file.' : '';
  const stale = index.stale ? ['The port list could not be refreshed and may be out of date.'] : [];

  for (const claim of claims) {
    const parsed = parsePortText(claim.value, index);
    const ignored = parsed.unrecognised ? ` The text "${parsed.unrecognised}" after the port name was not recognised as a country and was not used.` : '';
    const make = (over: Pick<ClaimVerification, 'status' | 'severity' | 'blocking' | 'humanReviewRequired' | 'customerFixable' | 'title' | 'explanation' | 'retrieved' | 'evidence'>, normalized: string | null): ClaimVerification => ({
      subject: `${claim.documentType}:${claim.field}`,
      module: 'PORT_IDENTITY',
      ruleId: 'EXT-PORT-ID',
      claims: [ref(claim, normalized)],
      declared: `${claim.field === 'portOfLoading' ? 'Port of loading' : 'Port of discharge'}: "${claim.value}"`,
      limitations: [...LIMITS, ...stale],
      assessedAt,
      transactionDate: ctx.transactionDate,
      ...over,
    });

    let candidates: PortLite[] = parsed.locode ? [index.byLocode.get(parsed.locode)!] : resolveByName(parsed.name, index);
    if (candidates.length === 0) {
      results.push(
        make({ status: 'INSUFFICIENT_EVIDENCE', severity: 'LOW', blocking: false, humanReviewRequired: true, customerFixable: true, title: `Port "${parsed.name}" could not be identified`, explanation: `"${claim.value}" does not match a location in the UN/LOCODE list. It may be a spelling variant or a private terminal. Ask for the port's UN/LOCODE or its exact name and country.${originLabel}`, retrieved: null, evidence: [] }, null),
      );
      continue;
    }
    if (parsed.countryCode) {
      const inCountry = candidates.filter((p) => p.countryCode === parsed.countryCode);
      if (inCountry.length === 0) {
        const where = [...new Set(candidates.map((p) => `${p.name}, ${p.country} (${p.locode})`))].slice(0, 4).join('; ');
        results.push(
          make(
            { status: 'DISCREPANCY', severity: 'MEDIUM', blocking: true, humanReviewRequired: true, customerFixable: true, title: `Port "${parsed.name}" is not in ${parsed.countryText}`, explanation: `The document places "${parsed.name}" in ${parsed.countryText}, but UN/LOCODE lists it only in: ${where}. The country or the port may be misstated. This is a discrepancy to confirm, not a finding of wrongdoing.${originLabel}`, retrieved: where, evidence: candidates.slice(0, 4).map((p) => evidenceFor(p, index, ctx.now)) },
            null,
          ),
        );
        continue;
      }
      candidates = inCountry;
    }
    // Several places answer to the name, but one of them is the place itself and the others are its terminals: that one.
    if (candidates.length > 1 && !parsed.locode) {
      const plain = candidates.filter((p) => p.plain);
      if (plain.length === 1) candidates = plain;
    }
    if (candidates.length > 1) {
      const where = candidates.slice(0, 5).map((p) => `${p.name}, ${p.country} (${p.locode})`).join('; ');
      results.push(
        make(
          { status: 'HUMAN_REVIEW_REQUIRED', severity: 'LOW', blocking: false, humanReviewRequired: true, customerFixable: true, title: `Port "${parsed.name}" could mean more than one place`, explanation: `UN/LOCODE lists several locations by this name: ${where}. The document does not say which. Ask for the country or the UN/LOCODE.${originLabel}`, retrieved: where, evidence: candidates.slice(0, 5).map((p) => evidenceFor(p, index, ctx.now)) },
          null,
        ),
      );
      continue;
    }
    const port = candidates[0]!;
    results.push(
      make(
        {
          status: 'VERIFIED',
          severity: 'INFO',
          blocking: false,
          humanReviewRequired: false,
          customerFixable: false,
          title: `Port "${parsed.name}" identified as ${port.locode} (${port.name}, ${port.country})`,
          explanation: `The document's port matches the UN/LOCODE record ${port.locode}${parsed.countryCode ? ` in the country it states (${port.country})` : ', identified by name alone because the document states no country'}. This confirms identity only.${ignored}${originLabel}`,
          retrieved: `${port.locode} - ${port.name}, ${port.country}`,
          evidence: [evidenceFor(port, index, ctx.now)],
        },
        port.locode,
      ),
    );
  }

  return {
    results,
    module: {
      module: 'PORT_IDENTITY',
      state: claims.length === 0 ? 'NOT_RUN' : index.stale ? 'PARTIAL' : 'COMPLETE',
      claimsChecked: claims.length,
      sourcesConsulted: claims.length ? [PORT_SOURCE_ID] : [],
      notChecked: [
        'Port, terminal and free-trade-zone restrictions or designations: no source is integrated, so none was checked.',
        'Intermediate and transshipment ports given only as free text were not parsed.',
      ],
    },
  };
}
