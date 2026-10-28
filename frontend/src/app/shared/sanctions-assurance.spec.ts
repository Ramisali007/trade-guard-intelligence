import { sanctionsAssurance, type SanctionsScreeningSummary } from './sanctions-assurance';

function screening(partial: Partial<SanctionsScreeningSummary>): SanctionsScreeningSummary {
  return { status: 'NONE', matches: [], jurisdictionRisks: [], screenedEntitiesCount: 4, screenedCountriesCount: 3, datasetVersion: 'OFAC_SDN@v1', ...partial };
}

describe('sanctionsAssurance', () => {
  it('says "no match" only for a clean result, and states what was screened', () => {
    const result = sanctionsAssurance(screening({}));
    expect(result.tone).toBe('ok');
    expect(result.detail).toContain('4 parties');
  });

  it('never reports a confirmed match or an embargoed route as cleared', () => {
    expect(sanctionsAssurance(screening({ status: 'CONFIRMED_MATCH', matches: [{}] })).tone).toBe('alert');
    expect(sanctionsAssurance(screening({ status: 'RESTRICTED_JURISDICTION', jurisdictionRisks: [{}] })).tone).toBe('alert');
  });

  it('treats an incomplete screening as an open question', () => {
    const result = sanctionsAssurance(screening({ status: 'UNKNOWN_INSUFFICIENT_DATA', unscreenedNames: ['BUYER: ???'] }));
    expect(result.tone).toBe('warn');
    expect(result.tag).toBe('INCOMPLETE');
  });

  it('does not invent a result when there is none', () => {
    expect(sanctionsAssurance(null).tag).toBe('NOT SCREENED');
  });
});
