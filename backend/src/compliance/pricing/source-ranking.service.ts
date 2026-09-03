import crypto from 'node:crypto';
import type { SourceAuthorityLevel } from './pricing.types';

export class SourceRankingService {
  /**
   * Determine the authority level of a source URL and publisher.
   */
  classifyAuthorityLevel(url: string, publisher: string): SourceAuthorityLevel {
    const domain = this.extractDomain(url).toLowerCase();
    const pub = publisher.toLowerCase();

    // Level 1: Official government, customs, central banks, national statistical agencies
    if (
      domain.endsWith('.gov') ||
      domain.endsWith('.gov.pk') ||
      domain.includes('fbr.gov.pk') ||
      domain.includes('sbp.org.pk') ||
      domain.includes('commerce.gov.pk') ||
      domain.includes('usitc.gov') ||
      domain.includes('customs.gov') ||
      domain.includes('comtradeplus.un.org') ||
      pub.includes('pakistan customs') ||
      pub.includes('federal board of revenue') ||
      pub.includes('state bank of pakistan') ||
      pub.includes('us international trade commission')
    ) {
      return 'LEVEL_1_OFFICIAL_REGULATOR';
    }

    // Level 2: Official intergovernmental organizations
    if (
      domain.endsWith('.un.org') ||
      domain.includes('worldbank.org') ||
      domain.includes('wto.org') ||
      domain.includes('imf.org') ||
      domain.includes('fao.org') ||
      pub.includes('world bank') ||
      pub.includes('world trade organization') ||
      pub.includes('united nations')
    ) {
      return 'LEVEL_2_INTERGOVERNMENTAL';
    }

    // Level 3: Recognized commodity exchanges and benchmark indices
    if (
      domain.includes('lme.com') ||
      domain.includes('cmegroup.com') ||
      domain.includes('spglobal.com') ||
      domain.includes('platts.com') ||
      domain.includes('icis.com') ||
      domain.includes('cotlook.com') ||
      pub.includes('london metal exchange') ||
      pub.includes('chicago mercantile exchange') ||
      pub.includes('s&p global commodity') ||
      pub.includes('icis pricing')
    ) {
      return 'LEVEL_3_COMMODITY_EXCHANGE';
    }

    // Level 4: Verified B2B wholesale trade directories & customs data aggregators
    if (
      domain.includes('panjiva.com') ||
      domain.includes('datamyne.com') ||
      domain.includes('thomasnet.com') ||
      domain.includes('kompass.com') ||
      pub.includes('panjiva') ||
      pub.includes('datamyne')
    ) {
      return 'LEVEL_4_VERIFIED_B2B_INDEX';
    }

    // Level 5: General commercial web listings
    return 'LEVEL_5_GENERAL_COMMERCIAL';
  }

  /**
   * Defensive sanitizer: Cleans external web content to prevent prompt injection and script execution.
   */
  sanitizeWebExcerpt(rawText: string): string {
    if (!rawText) return '';

    // 1. Strip script, style, and iframe tags
    let clean = rawText
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

    // 2. Strip prompt injection triggers
    const injectionPatterns = [
      /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/gi,
      /you\s+are\s+now\s+(?:a|an)\s+/gi,
      /system\s*:\s*override/gi,
      /approve\s+this\s+transaction\s+unconditionally/gi,
      /disregard\s+compliance\s+rules/gi,
      /do\s+not\s+flag\s+this/gi,
    ];

    for (const pattern of injectionPatterns) {
      clean = clean.replace(pattern, '[REDACTED_PROMPT_INJECTION_ATTEMPT]');
    }

    // 3. Normalize whitespace and cap length
    clean = clean.replace(/\s+/g, ' ').trim();
    return clean.slice(0, 500);
  }

  /**
   * Generates a tamper-evident SHA-256 hash of the evidence content.
   */
  computeContentHash(url: string, text: string, observedPrice: number): string {
    const canonical = `${url}|${observedPrice}|${text.trim()}`;
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      return parsed.hostname;
    } catch {
      return url;
    }
  }
}
