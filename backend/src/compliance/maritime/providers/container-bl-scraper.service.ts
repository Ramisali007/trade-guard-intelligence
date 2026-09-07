import { parse } from 'node-html-parser';
import { createLogger } from '../../../utils/logger';

const log = createLogger('container-bl-scraper');

export interface EnrichedContainerBlResult {
  carrierName?: string;
  carrierCode?: string;
  vesselName?: string;
  vesselImo?: string;
  voyageNumber?: string;
  containerNumber?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  etd?: string;
  eta?: string;
  shipmentStatus?: string;
  source: string;
}

export class ContainerBlScraperService {
  private readonly cache = new Map<string, { data: EnrichedContainerBlResult; cachedAt: number }>();
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Performs strictly real-time live web scraping for B/L and Container tracking.
   * No mock data, no synthetic assumptions.
   */
  async lookupAndEnrich(params: {
    billOfLadingNumber?: string;
    containerNumber?: string;
    portOfLoading?: string;
    portOfDischarge?: string;
  }): Promise<EnrichedContainerBlResult | null> {
    const rawBl = (params.billOfLadingNumber || '').trim();
    const rawContainer = (params.containerNumber || '').trim();

    if ((!rawBl || rawBl === 'Not Found') && (!rawContainer || rawContainer === 'Not Found')) {
      return null;
    }

    const query = rawBl && rawBl !== 'Not Found' ? rawBl : rawContainer;
    const cleanQuery = query.replace(/[^A-Za-z0-9\-\/]/g, '').trim();
    if (cleanQuery.length < 4) return null;

    const queryKey = cleanQuery.toUpperCase();
    const cached = this.cache.get(queryKey);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.data;
    }

    log.info('Fetching real-time tracking data from live web scrapers...', { query: cleanQuery });

    // Source 1: Track-Trace Live Container & B/L Web Scraper
    const trackTraceResult = await this.scrapeTrackTrace(cleanQuery);
    if (trackTraceResult) {
      this.cache.set(queryKey, { data: trackTraceResult, cachedAt: Date.now() });
      return trackTraceResult;
    }

    // Source 2: Searates / Public Logistics Live Endpoint Scraper
    const searatesResult = await this.scrapeSearates(cleanQuery);
    if (searatesResult) {
      this.cache.set(queryKey, { data: searatesResult, cachedAt: Date.now() });
      return searatesResult;
    }

    // If live scraping across public endpoints yields no live data, return null (strictly truthful)
    log.info('No live tracking data found on public tracking endpoints for query', { query: cleanQuery });
    return null;
  }

  /**
   * Scrapes Track-Trace live tracking endpoint
   */
  private async scrapeTrackTrace(cleanQuery: string): Promise<EnrichedContainerBlResult | null> {
    const targetUrl = `https://www.track-trace.com/container?number=${encodeURIComponent(cleanQuery)}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
      }).catch(() => null);
      clearTimeout(timeoutId);

      if (res && res.ok) {
        const html = await res.text();
        const root = parse(html);

        const vesselEl =
          root.querySelector('.vessel-name') ||
          root.querySelector('.vessel') ||
          root.querySelector('[data-field="vessel"]');

        const voyageEl =
          root.querySelector('.voyage-number') ||
          root.querySelector('.voyage') ||
          root.querySelector('[data-field="voyage"]');

        const carrierEl =
          root.querySelector('.carrier-name') ||
          root.querySelector('.shipping-line') ||
          root.querySelector('[data-field="carrier"]');

        const polEl = root.querySelector('.pol') || root.querySelector('.port-of-loading');
        const podEl = root.querySelector('.pod') || root.querySelector('.port-of-discharge');
        const etdEl = root.querySelector('.etd') || root.querySelector('.departure-date');
        const etaEl = root.querySelector('.eta') || root.querySelector('.arrival-date');

        if (vesselEl && vesselEl.text.trim()) {
          const scrapedVessel = vesselEl.text.trim().toUpperCase();
          return {
            carrierName: carrierEl?.text?.trim(),
            vesselName: scrapedVessel,
            voyageNumber: voyageEl?.text?.trim(),
            containerNumber: cleanQuery.length >= 10 && /^[A-Z]{4}\d{6,7}/.test(cleanQuery) ? cleanQuery : undefined,
            portOfLoading: polEl?.text?.trim(),
            portOfDischarge: podEl?.text?.trim(),
            etd: etdEl?.text?.trim(),
            eta: etaEl?.text?.trim(),
            shipmentStatus: 'LIVE_TRACKING_RETRIEVED',
            source: 'TRACK_TRACE_LIVE_SCRAPED',
          };
        }
      }
    } catch (err) {
      log.debug('Live Track-Trace scraping network check completed', { error: String(err) });
    }

    return null;
  }

  /**
   * Scrapes Searates / Public Shipping Web Endpoint
   */
  private async scrapeSearates(cleanQuery: string): Promise<EnrichedContainerBlResult | null> {
    const targetUrl = `https://www.searates.com/container/tracking/?number=${encodeURIComponent(cleanQuery)}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/json',
        },
      }).catch(() => null);
      clearTimeout(timeoutId);

      if (res && res.ok) {
        const text = await res.text();
        const root = parse(text);

        const vesselEl = root.querySelector('.vessel') || root.querySelector('.tracking-vessel-name');
        const voyageEl = root.querySelector('.voyage') || root.querySelector('.tracking-voyage');
        const lineEl = root.querySelector('.line') || root.querySelector('.tracking-line-name');

        if (vesselEl && vesselEl.text.trim()) {
          return {
            carrierName: lineEl?.text?.trim(),
            vesselName: vesselEl.text.trim().toUpperCase(),
            voyageNumber: voyageEl?.text?.trim(),
            containerNumber: cleanQuery.length >= 10 && /^[A-Z]{4}\d{6,7}/.test(cleanQuery) ? cleanQuery : undefined,
            source: 'SEARATES_LIVE_SCRAPED',
          };
        }
      }
    } catch (err) {
      log.debug('Live Searates scraping network check completed', { error: String(err) });
    }

    return null;
  }
}
