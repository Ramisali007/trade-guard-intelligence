import type { CustomerProfile, EntityResolutionResult } from './behavioral.types';

export class EntityResolutionService {
  /**
   * Resolve an extracted party into a canonical CustomerProfile.
   * Prevents duplicate entity generation while ensuring distinct companies are never silently merged.
   */
  resolveEntity(params: {
    searchedName: string;
    tradingName?: string;
    registrationNumber?: string;
    taxVatNumber?: string;
    country?: string;
    existingProfiles: CustomerProfile[];
  }): EntityResolutionResult {
    const rawName = (params.searchedName || '').trim();
    const normalizedName = this.normalizeCompanyName(rawName);
    const taxClean = (params.taxVatNumber || params.registrationNumber || '').replace(/\W/g, '').toUpperCase();

    // 1. Exact Tax / NTN / Registration Number Match (Highest Confidence: 1.0)
    if (taxClean && taxClean !== 'NOTFOUND' && taxClean !== 'NOTSPECIFIED') {
      const taxMatch = params.existingProfiles.find(
        (p) =>
          (p.taxVatNumber && p.taxVatNumber.replace(/\W/g, '').toUpperCase() === taxClean) ||
          (p.registrationNumber && p.registrationNumber.replace(/\W/g, '').toUpperCase() === taxClean),
      );
      if (taxMatch) {
        return {
          customerReferenceId: taxMatch.customerReferenceId,
          matchedName: taxMatch.legalName,
          searchedName: rawName,
          resolutionMethod: 'EXACT_TAX_ID',
          matchConfidence: 1.0,
          isNewCustomer: false,
          requiresManualVerification: false,
          details: `Resolved via exact statutory tax/registration identifier (${params.taxVatNumber || params.registrationNumber}).`,
        };
      }
    }

    // 2. Exact Normalized Legal Name Match (Confidence: 0.96)
    const exactNameMatch = params.existingProfiles.find(
      (p) => p.normalizedName === normalizedName || this.normalizeCompanyName(p.legalName) === normalizedName,
    );
    if (exactNameMatch) {
      return {
        customerReferenceId: exactNameMatch.customerReferenceId,
        matchedName: exactNameMatch.legalName,
        searchedName: rawName,
        resolutionMethod: 'EXACT_NORMALIZED_NAME',
        matchConfidence: 0.96,
        isNewCustomer: false,
        requiresManualVerification: false,
        details: `Resolved via canonical company name normalization match ("${exactNameMatch.legalName}").`,
      };
    }

    // 3. Known Alias Match (Confidence: 0.92)
    const aliasMatch = params.existingProfiles.find((p) =>
      p.aliases.some((a) => this.normalizeCompanyName(a) === normalizedName),
    );
    if (aliasMatch) {
      return {
        customerReferenceId: aliasMatch.customerReferenceId,
        matchedName: aliasMatch.legalName,
        searchedName: rawName,
        resolutionMethod: 'FUZZY_ALIAS_MATCH',
        matchConfidence: 0.92,
        isNewCustomer: false,
        requiresManualVerification: false,
        details: `Resolved via registered corporate trade alias ("${aliasMatch.legalName}").`,
      };
    }

    // 4. Token Overlap & Fuzzy Similarity Match (Confidence: 0.80 - 0.89)
    for (const p of params.existingProfiles) {
      const score = this.calculateJaccardSimilarity(normalizedName, p.normalizedName);
      if (score >= 0.82) {
        return {
          customerReferenceId: p.customerReferenceId,
          matchedName: p.legalName,
          searchedName: rawName,
          resolutionMethod: 'FUZZY_ALIAS_MATCH',
          matchConfidence: Number(score.toFixed(2)),
          isNewCustomer: false,
          requiresManualVerification: score < 0.88,
          details: `Fuzzy corporate name match (${Math.round(score * 100)}% similarity) with existing record "${p.legalName}".`,
        };
      }
    }

    // 5. No match found: Generate a new candidate Customer Profile
    const newCustId = `TG-CUST-${(params.existingProfiles.length + 100101).toString()}`;
    return {
      customerReferenceId: newCustId,
      matchedName: rawName,
      searchedName: rawName,
      resolutionMethod: 'NEW_PROFILE_CREATED',
      matchConfidence: 0.95,
      isNewCustomer: true,
      requiresManualVerification: false,
      details: `New customer entity established: Assigned reference ${newCustId}.`,
    };
  }

  /**
   * Normalizes legal company suffixes to prevent duplicate entities.
   * e.g. "ABC Trading Pvt Ltd" == "ABC Trading Private Limited"
   */
  normalizeCompanyName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
      .replace(/\bprivate\s+limited\b/g, 'ltd')
      .replace(/\bpvt\s+ltd\b/g, 'ltd')
      .replace(/\blimited\b/g, 'ltd')
      .replace(/\bcorporation\b/g, 'corp')
      .replace(/\bincorporated\b/g, 'inc')
      .replace(/\bcompany\b/g, 'co')
      .replace(/\bgmbh\b/g, 'gmbh')
      .replace(/\bfze\b/g, 'fze')
      .replace(/\bllc\b/g, 'llc')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private calculateJaccardSimilarity(strA: string, strB: string): number {
    const tokensA = new Set(strA.split(' ').filter((t) => t.length > 1));
    const tokensB = new Set(strB.split(' ').filter((t) => t.length > 1));
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection++;
    }

    const union = new Set([...tokensA, ...tokensB]).size;
    return union === 0 ? 0 : intersection / union;
  }
}
