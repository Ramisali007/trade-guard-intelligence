/**
 * What the sanctions screening of one document found, in words a reviewer can read at a glance.
 *
 * The workbench used to print "100% CLEARED" on every document. A status that cannot say "match" is
 * not a status, so this is derived from the screening result and nothing else.
 */

export interface SanctionsScreeningSummary {
  status: string;
  matches: ReadonlyArray<unknown>;
  jurisdictionRisks: ReadonlyArray<unknown>;
  screenedEntitiesCount: number;
  screenedCountriesCount: number;
  datasetVersion: string;
  unscreenedNames?: ReadonlyArray<string>;
}

export type AssuranceTone = 'ok' | 'warn' | 'alert';

export interface SanctionsAssurance {
  tone: AssuranceTone;
  /** Short badge text. */
  tag: string;
  headline: string;
  detail: string;
  /** Number of list hits plus jurisdiction findings. */
  hits: number;
}

export function sanctionsAssurance(screening: SanctionsScreeningSummary | null | undefined): SanctionsAssurance {
  if (!screening) {
    return { tone: 'warn', tag: 'NOT SCREENED', headline: 'No screening result is recorded', detail: 'This document has not been screened.', hits: 0 };
  }
  const hits = screening.matches.length + screening.jurisdictionRisks.length;
  const scope = `${screening.screenedEntitiesCount} parties and ${screening.screenedCountriesCount} countries screened against ${screening.datasetVersion || 'the loaded lists'}.`;

  switch (screening.status) {
    case 'NONE':
      return { tone: 'ok', tag: 'NO MATCH', headline: 'No designation match in the lists loaded', detail: scope, hits };
    case 'CONFIRMED_MATCH':
    case 'RESTRICTED_JURISDICTION':
    case 'RESTRICTED_PARTY':
    case 'RESTRICTED_VESSEL':
    case 'RESTRICTED_BANK':
      return { tone: 'alert', tag: 'MATCH', headline: `${hits} sanctions finding${hits === 1 ? '' : 's'} — do not release`, detail: scope, hits };
    case 'POTENTIAL_MATCH':
    case 'REQUIRES_LICENSE_AUTHORIZATION':
      return { tone: 'warn', tag: 'REVIEW', headline: 'Possible match — analyst review required', detail: scope, hits };
    case 'UNKNOWN_INSUFFICIENT_DATA': {
      const unread = screening.unscreenedNames?.length ?? 0;
      return {
        tone: 'warn',
        tag: 'INCOMPLETE',
        headline: unread > 0 ? `${unread} party name${unread === 1 ? '' : 's'} could not be screened` : 'Nothing could be extracted to screen',
        detail: 'Screen the missing parties manually before release. ' + scope,
        hits,
      };
    }
    default:
      return { tone: 'warn', tag: 'REVIEW', headline: 'Screening needs review', detail: scope, hits };
  }
}
