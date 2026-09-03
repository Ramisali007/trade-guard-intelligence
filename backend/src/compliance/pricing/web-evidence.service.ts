import { SourceRankingService } from './source-ranking.service';
import type { WebEvidenceRecord } from './pricing.types';

export class WebEvidenceService {
  private readonly rankingService = new SourceRankingService();

  /**
   * Build an immutable, tamper-evident WebEvidenceRecord.
   */
  createEvidenceRecord(params: {
    url: string;
    sourceTitle: string;
    publisher: string;
    sourceType: WebEvidenceRecord['sourceType'];
    observedPrice: number;
    observedCurrency: string;
    observedUnit: string;
    observedIncoterm?: string;
    quotedExcerpt: string;
    confidenceScore: number;
    researchQuery: string;
    country?: string;
  }): WebEvidenceRecord {
    const sanitizedExcerpt = this.rankingService.sanitizeWebExcerpt(params.quotedExcerpt);
    const authorityLevel = this.rankingService.classifyAuthorityLevel(params.url, params.publisher);
    const hash = this.rankingService.computeContentHash(params.url, sanitizedExcerpt, params.observedPrice);

    return {
      evidenceId: `WEBEV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      url: params.url,
      sourceTitle: params.sourceTitle,
      publisher: params.publisher,
      retrievedAt: new Date().toISOString(),
      sourceAuthorityLevel: authorityLevel,
      sourceType: params.sourceType,
      country: params.country || 'Global / International',
      observedPrice: params.observedPrice,
      observedCurrency: params.observedCurrency,
      observedUnit: params.observedUnit,
      observedIncoterm: params.observedIncoterm || 'CIF',
      quotedExcerpt: sanitizedExcerpt,
      confidenceScore: Math.min(1.0, Math.max(0.1, params.confidenceScore)),
      contentHashSha256: hash,
      researchQuery: params.researchQuery,
    };
  }
}
