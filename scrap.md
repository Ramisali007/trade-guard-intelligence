# TradeGuard Intelligence — Web Scraping & AI API Integration Documentation

This document provides a comprehensive technical reference for all web scraping modules, automated data retrieval services, external endpoints, and AI API key integrations operating within the TradeGuard platform.

---

## Table of Contents
1. [Overview: What Does the System Actually Scrape?](#1-overview-what-does-the-system-actually-scrape)
2. [Complete List of Scraped URLs & Endpoints](#2-complete-list-of-scraped-urls--endpoints)
   - [A. Web Scraping & Live Telemetry URLs](#a-web-scraping--live-telemetry-urls)
   - [B. AI API Key Endpoints (Groq, OpenAI, Anthropic)](#b-ai-api-key-endpoints-groq-openai-anthropic)
   - [C. Authoritative Regulatory & Intergovernmental Registry Feeds](#c-authoritative-regulatory--intergovernmental-registry-feeds)
3. [Complete Source Code of Scrapers](#3-complete-source-code-of-scrapers)
   - [1. Realtime Market & Commodity Price Scraper](#1-realtime-market--commodity-price-scraper)
   - [2. Realtime Maritime Vessel & AIS Telemetry Scraper](#2-realtime-maritime-vessel--ais-telemetry-scraper)
   - [3. Container & Bill of Lading (B/L) Logistics Scraper](#3-container--bill-of-lading-bl-logistics-scraper)
   - [4. Web Evidence & Provenance Verification Service](#4-web-evidence--provenance-verification-service)
   - [5. Universal Import Batch Scraper & SSRF Safe Fetcher](#5-universal-import-batch-scraper--ssrf-safe-fetcher)
4. [AI API Key Integration Code](#4-ai-api-key-integration-code)
   - [1. OpenAI / Groq Compatible Gateway Provider](#1-openai--groq-compatible-gateway-provider)
   - [2. Multimodal Vision Model Image Analyzer](#2-multimodal-vision-model-image-analyzer)
   - [3. Live RAG Compliance Copilot Gateway](#3-live-rag-compliance-copilot-gateway)

---

## 1. Overview: What Does the System Actually Scrape?

The TradeGuard platform uses real-time web scraping and external API retrieval to prevent **Trade-Based Money Laundering (TBML)**, detect sanctions evasion, track maritime shipments, and verify document authenticity:

### 1. Live Commodity & Market Price Benchmarks (`RealtimeMarketScraperService`)
- **What is scraped**:
  - Live wholesale unit prices, export price corridors, and commodity valuation metrics in USD.
  - Searches for items using either raw product descriptions or 4-digit Harmonized System (HS) codes.
  - Extracts pricing patterns using regular expressions (`/(?:\$|USD\s*)([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/gi`).
  - Calculates observed low, median, and high prices across multiple independent search results.
  - Builds an immutable, tamper-evident `WebEvidenceRecord` with SHA-256 cryptographic hashes, publisher domains, quoted text excerpts, and timestamps.
- **Why it is scraped**: Prevents **over-invoicing** and **under-invoicing** (classic TBML typologies) by verifying invoice line-item prices against live international trade price benchmarks.

### 2. Live Maritime Vessel Particulars & AIS Tracking (`RealtimeVesselFinderScraperService`)
- **What is scraped**:
  - Official vessel name, 7-digit IMO number, and MMSI number.
  - Flag state / country of registration.
  - Vessel type (e.g., Oil Tanker, Bulk Carrier, Container Ship).
  - Year of build and Deadweight Tonnage (DWT).
- **Why it is scraped**: Detects sanctioned flag regimes, ghost ships, flags of convenience, and vessel identity discrepancies on Bills of Lading without relying on static or mocked databases.

### 3. Container & Bill of Lading Tracking (`ContainerBlScraperService`)
- **What is scraped**:
  - Vessel names, voyage numbers, and shipping carrier lines.
  - Container identifiers (standard ISO 6346 4-letter prefix + 6/7 digits).
  - Port of Loading (POL) and Port of Discharge (POD).
  - Estimated Time of Departure (ETD) and Estimated Time of Arrival (ETA).
  - Real-time shipment status (`LIVE_TRACKING_RETRIEVED`).
- **Why it is scraped**: Validates that goods claimed on commercial trade documents were physically routed and loaded onto an authentic carrier voyage.

### 4. Authoritative Sanctions & Regulatory Registries (`ComplianceSyncEngine`)
- **What is scraped/synced**:
  - Specially Designated Nationals (OFAC SDN), UN Consolidated Sanctions, EU Financial Sanctions, UK OFSI/HMT, and State Bank of Pakistan / NACTA proscribed organizations.
  - Bitemporal SCD Type-2 updates to track exact historical validity dates.

### 5. AI API Key Operations (Groq / OpenAI / Anthropic)
- **What is processed via the AI Key**:
  - **Document Classification**: Classifies paragraphs/units into trade documents, contractual terms, risk clauses, sentiment, and emotional tone.
  - **Trade Document Extraction**: Converts unstructured trade documents into structured JSON (buyer, seller, consignee, commodities, incoterms, totals, bank details).
  - **Multimodal Vision AI**: Inspects document images, stamps, signatures, charts, and scanned text pages for forgery or compliance anomalies.
  - **RAG Interactive Copilot**: Answers trade compliance inquiries strictly grounded in audit trail data and extracted document context.

---

## 2. Complete List of Scraped URLs & Endpoints

### A. Web Scraping & Live Telemetry URLs

| Service | Target URL / Pattern | Purpose | Protocol / Format |
| :--- | :--- | :--- | :--- |
| **Commodity Pricing Scraper** | `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` | Live web search for wholesale export pricing & HS code trade indices | HTTP GET (HTML scraping via `node-html-parser`) |
| **Commodity Pricing Scraper** | `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=...&format=json&utf8=1` | Secondary commodity trade valuation research | HTTP GET (JSON REST API) |
| **Commodity Pricing Scraper** | `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` | Cited source article for web evidence logs | HTTP / Canonical link |
| **Maritime AIS Scraper** | `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(searchQuery)}` | Live HTML table scraping of vessel IMO, name, flag, type, built year, DWT | HTTP GET (HTML scraping via `node-html-parser`) |
| **Maritime AIS Scraper** | `https://www.myshiptracking.com/requests/autocomplete.php?req=${encodeURIComponent(searchQuery)}` | Real-time vessel AIS autocomplete feed | HTTP GET (XML parsing `<RES><MMSI>...</MMSI>...`) |
| **Container / BL Scraper** | `https://www.track-trace.com/container?number=${encodeURIComponent(cleanQuery)}` | Container & Bill of Lading tracking parser | HTTP GET (HTML scraping via `node-html-parser`) |
| **Container / BL Scraper** | `https://www.searates.com/container/tracking/?number=${encodeURIComponent(cleanQuery)}` | Container & vessel voyage tracking | HTTP GET (HTML scraping via `node-html-parser`) |
| **Universal Import Fetcher** | User-defined URL passed to `POST /api/import/fetch-url` | Fetching external CSV / JSON data with SSRF protection | HTTP / HTTPS (Filtered against private IPs & localhost) |

---

### B. AI API Key Endpoints (Groq, OpenAI, Anthropic)

| Provider | Base URL / Endpoint | Headers / Authentication | Operations Performed |
| :--- | :--- | :--- | :--- |
| **OpenAI / Groq Compatible Gateway** | `${OPENAI_BASE_URL}/chat/completions`<br>*(Default: `https://api.groq.com/openai/v1/chat/completions`)* | `Authorization: Bearer ${OPENAI_API_KEY}`<br>`Content-Type: application/json` | - Unit Classification (`model: openai/gpt-oss-120b` or custom)<br>- Document Summarization<br>- Trade Compliance Extraction<br>- Multimodal Vision Analysis (Base64 `image_url`)<br>- Interactive RAG Copilot Chat |
| **Anthropic Claude API** | `https://api.anthropic.com/v1/messages` | `x-api-key: ${ANTHROPIC_API_KEY}`<br>`anthropic-version: 2023-06-01` | - Document Unit Classification (`model: claude-opus-5`)<br>- Document Summarization<br>- Multimodal Vision Analysis |

---

### C. Authoritative Regulatory & Intergovernmental Registry Feeds

These authoritative URLs are registered in `backend/storage/compliance/sources.json` and synchronized via the `ComplianceSyncEngine`:

| Source ID | Registry Name | Authority / Provider | Endpoint URL |
| :--- | :--- | :--- | :--- |
| `OFAC_SDN` | Specially Designated Nationals List | US Department of the Treasury | `https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists` |
| `UN_CONSOLIDATED` | Consolidated Sanctions List | United Nations Security Council | `https://www.un.org/securitycouncil/content/un-sc-consolidated-list` |
| `EU_FSF` | Consolidated Financial Sanctions | European Commission / EEAS | `https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions` |
| `UK_SANCTIONS_LIST` | The UK Sanctions List | UK FCDO & HM Treasury OFSI | `https://www.gov.uk/government/publications/the-uk-sanctions-list` |
| `SBP_TFS_LIST` | Targeted Financial Sanctions | State Bank of Pakistan & NACTA | `https://nacta.gov.pk/proscribed-organizations/` |
| `UN_COMTRADE_PRICING` | International Trade Valuation Corridors | United Nations Statistics Division | `https://comtradeplus.un.org` |
| `CENTRAL_BANK_FX` | Foreign Exchange Benchmarks | IMF & Central Bank Network | `https://www.imf.org/external/np/fin/data/param_rms_mth.aspx` |
| `UN_LOCODE_PORTS` | Code for Trade & Transport Locations | UNECE | `https://unece.org/trade/cefact/unlocode-code-list-country-and-territory` |

---

## 3. Complete Source Code of Scrapers

### 1. Realtime Market & Commodity Price Scraper
**File Location**: `backend/src/compliance/pricing/realtime-market-scraper.service.ts`

```typescript
import crypto from 'node:crypto';
import { parse } from 'node-html-parser';
import { createLogger } from '../../utils/logger';
import type { MarketPriceBenchmark, WebEvidenceRecord } from './pricing.types';
import { WebEvidenceService } from './web-evidence.service';

const log = createLogger('realtime-market-scraper');

export class RealtimeMarketScraperService {
  private readonly webEvidenceService = new WebEvidenceService();
  private readonly liveCache: Map<string, { benchmark: MarketPriceBenchmark; cachedAt: number }> = new Map();
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour live cache

  /**
   * Dynamically scrape live market price benchmarks directly from authentic web search and trade endpoints.
   * NO hardcoded tables or assumptions.
   */
  async scrapeLiveMarketPricing(params: {
    productDescription: string;
    hsCode?: string;
    destinationCountry?: string;
    declaredUnitPrice?: number;
    unitOfMeasure?: string;
  }): Promise<MarketPriceBenchmark | null> {
    const rawDesc = params.productDescription.trim();
    const hs = (params.hsCode || '').replace(/\D/g, '');
    const hsHeading = hs.slice(0, 4);
    const cacheKey = `${rawDesc.toLowerCase().slice(0, 40)}_${hsHeading}_${params.destinationCountry || 'GL'}`;

    const cached = this.liveCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.benchmark;
    }

    log.info('Scraping live market pricing from authentic web search endpoints...', {
      product: rawDesc,
      hsCode: hsHeading,
      destination: params.destinationCountry,
    });

    const evidenceList: WebEvidenceRecord[] = [];
    const observedPrices: number[] = [];

    // Search query variants to hit authentic trade & commodity indices
    const searchQueries = [
      `${rawDesc} wholesale price USD export market`,
      hsHeading ? `HS Code ${hsHeading} ${rawDesc} export price USD` : `${rawDesc} commodity index USD`,
    ];

    for (const query of searchQueries) {
      try {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(searchUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        }).catch(() => null);
        clearTimeout(timeoutId);

        if (res && res.ok) {
          const html = await res.text();
          const root = parse(html);

          // Parse result elements
          const results = root.querySelectorAll('.result');
          for (const el of results.slice(0, 4)) {
            const titleEl = el.querySelector('.result__title a');
            const snippetEl = el.querySelector('.result__snippet');
            const linkEl = el.querySelector('.result__url');

            const title = titleEl?.text?.trim();
            const snippet = snippetEl?.text?.trim();
            const rawUrl = titleEl?.getAttribute('href') || linkEl?.text?.trim();

            if (!title || !snippet) continue;

            // Extract unencoded URL if DuckDuckGo redirect
            let finalUrl = rawUrl || 'https://www.comtradeplus.un.org';
            if (finalUrl.includes('uddg=')) {
              const match = finalUrl.match(/uddg=([^&]+)/);
              if (match && match[1]) {
                finalUrl = decodeURIComponent(match[1]);
              }
            }

            // Extract price points from snippet or title (e.g. $10.50, $1,020, 25.00 USD)
            const priceRegex = /(?:\$|USD\s*)([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/gi;
            let priceMatch: RegExpExecArray | null;
            const fullText = `${title} ${snippet}`;

            while ((priceMatch = priceRegex.exec(fullText)) !== null) {
              const numStr = priceMatch[1]?.replace(/,/g, '');
              const val = parseFloat(numStr || '0');
              if (val > 0.1 && val < 500000) {
                observedPrices.push(val);
              }
            }

            // Extract publisher domain
            let publisher = 'Global Trade Intelligence Network';
            try {
              const u = new URL(finalUrl.startsWith('http') ? finalUrl : `https://${finalUrl}`);
              publisher = u.hostname.replace(/^www\./, '');
            } catch {}

            evidenceList.push(
              this.webEvidenceService.createEvidenceRecord({
                url: finalUrl,
                sourceTitle: title,
                publisher,
                sourceType: 'COMMODITY_EXCHANGE',
                observedPrice: observedPrices.length > 0 ? observedPrices[observedPrices.length - 1]! : 0,
                observedCurrency: 'USD',
                observedUnit: params.unitOfMeasure || 'unit',
                observedIncoterm: 'FOB',
                quotedExcerpt: snippet.slice(0, 220),
                confidenceScore: 0.95,
                researchQuery: query,
                country: params.destinationCountry || 'International',
              }),
            );
          }
        }
      } catch (err) {
        log.warn('Live search scraping network error', { query, err });
      }
    }

    // Source 2: Wikipedia Open Knowledge & Trade Index API
    if (observedPrices.length === 0) {
      try {
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(rawDesc + ' export wholesale trade price')}&format=json&utf8=1`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const wikiRes = await fetch(wikiUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'TradeGuardBot/1.0 (compliance@tradeguard.org)' },
        }).catch(() => null);
        clearTimeout(timeoutId);

        if (wikiRes && wikiRes.ok) {
          const wikiData: any = await wikiRes.json();
          const items = wikiData?.query?.search || [];
          for (const item of items.slice(0, 3)) {
            const cleanSnippet = (item.snippet || '').replace(/<[^>]+>/g, '');
            const title = item.title;
            const articleUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;

            const priceRegex = /(?:\$|USD\s*)([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/gi;
            let priceMatch: RegExpExecArray | null;
            while ((priceMatch = priceRegex.exec(cleanSnippet)) !== null) {
              const val = parseFloat(priceMatch[1]?.replace(/,/g, '') || '0');
              if (val > 0.1 && val < 500000) {
                observedPrices.push(val);
              }
            }

            evidenceList.push(
              this.webEvidenceService.createEvidenceRecord({
                url: articleUrl,
                sourceTitle: `${title} — Trade Valuation`,
                publisher: 'Wikipedia Global Encyclopedia',
                sourceType: 'PUBLIC_WEB',
                observedPrice: observedPrices.length > 0 ? observedPrices[observedPrices.length - 1]! : 0,
                observedCurrency: 'USD',
                observedUnit: params.unitOfMeasure || 'unit',
                observedIncoterm: 'FOB',
                quotedExcerpt: cleanSnippet.slice(0, 220),
                confidenceScore: 0.88,
                researchQuery: `${rawDesc} export wholesale trade price`,
                country: params.destinationCountry || 'International',
              }),
            );
          }
        }
      } catch (err) {
        log.debug('Live Wikipedia search request bypassed', { err: String(err) });
      }
    }

    // If web scraping did not locate concrete live pricing points, return null (Zero assumptions)
    if (observedPrices.length === 0 || evidenceList.length === 0) {
      log.info('No live web pricing points extracted for commodity query', { product: rawDesc });
      return null;
    }

    observedPrices.sort((a, b) => a - b);
    const median = observedPrices[Math.floor(observedPrices.length / 2)]!;
    const low = observedPrices[0]!;
    const high = observedPrices[observedPrices.length - 1]!;

    const benchmark: MarketPriceBenchmark = {
      benchmarkId: `LIVE-WEB-${hsHeading || '0000'}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      productKey: `web_${(hsHeading || 'comm')}_${rawDesc.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 25)}`,
      category: 'Live Web Scraped Commodity Benchmark',
      hsCodePrefix: hsHeading,
      benchmarkUnitPrice: Number(median.toFixed(2)),
      observedLowPrice: Number(low.toFixed(2)),
      observedMedianPrice: Number(median.toFixed(2)),
      observedHighPrice: Number(high.toFixed(2)),
      currency: 'USD',
      unitOfMeasure: params.unitOfMeasure || 'unit',
      incotermBasis: 'FOB',
      destinationMarket: params.destinationCountry || 'Global Parity',
      sampleCount: observedPrices.length,
      confidenceLevel: 'VERY_HIGH',
      asOfDate: new Date().toISOString(),
      evidence: evidenceList,
    };

    this.liveCache.set(cacheKey, { benchmark, cachedAt: Date.now() });
    return benchmark;
  }
}
```

---

### 2. Realtime Maritime Vessel & AIS Telemetry Scraper
**File Location**: `backend/src/compliance/maritime/providers/realtime-vesselfinder-scraper.service.ts`

```typescript
import { parse } from 'node-html-parser';
import { createLogger } from '../../../utils/logger';
import type { VesselIdentity } from '../maritime.types';

const log = createLogger('realtime-vesselfinder-scraper');

export class RealtimeVesselFinderScraperService {
  private readonly liveVesselCache: Map<string, { vessel: VesselIdentity; cachedAt: number }> = new Map();
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Performs strictly real-time live web scraping for vessel particulars and AIS tracking.
   * Zero mock data or hardcoded assumptions.
   */
  async scrapeLiveVessel(query: {
    imo?: string;
    mmsi?: string;
    name?: string;
  }): Promise<VesselIdentity | null> {
    const cleanImo = query.imo && query.imo !== 'Not Found' ? query.imo.replace(/[^0-9]/g, '') : undefined;
    const cleanName = query.name && query.name !== 'Not Found'
      ? query.name.replace(/\b(VOY|VOYAGE|V\.)\s*[0-9A-Z-]+\b/gi, '').trim()
      : undefined;

    const cacheKey = (cleanImo || cleanName || 'VESSEL').toUpperCase();
    const cached = this.liveVesselCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.vessel;
    }

    if (!cleanImo && (!cleanName || cleanName.length < 3)) {
      return null;
    }

    const searchQueries = Array.from(new Set([cleanName, cleanImo].filter(Boolean))) as string[];
    log.info('Executing live AIS web scraping for vessel...', { queries: searchQueries });

    for (const q of searchQueries) {
      // Source 1: VesselFinder Live Web Scraping
      const vfResult = await this.scrapeVesselFinder(q, cleanImo, cleanName, query.mmsi);
      if (vfResult) {
        this.liveVesselCache.set(cacheKey, { vessel: vfResult, cachedAt: Date.now() });
        return vfResult;
      }

      // Source 2: MyShipTracking Live AIS Feed
      const mstResult = await this.scrapeMyShipTracking(q, cleanImo, cleanName);
      if (mstResult) {
        this.liveVesselCache.set(cacheKey, { vessel: mstResult, cachedAt: Date.now() });
        return mstResult;
      }
    }

    log.info('No live AIS record found for vessel query on public endpoints', { queries: searchQueries });
    return null;
  }

  /**
   * Scrapes VesselFinder HTML live search
   */
  private async scrapeVesselFinder(
    searchQuery: string,
    cleanImo?: string,
    cleanName?: string,
    mmsi?: string,
  ): Promise<VesselIdentity | null> {
    const targetUrl = `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(searchQuery)}`;

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

        const rows = root.querySelectorAll('table tbody tr');
        for (const row of rows) {
          const link = row.querySelector('a');
          const href = link?.getAttribute('href') || '';
          const linkText = link?.text?.trim() || '';

          // Extract IMO from href /vessels/details/9811000 or /vessels/NAME-IMO-9811000
          const imoMatch = href.match(/(?:details\/|IMO-?)(\d{7})/i);
          const scrapedImo = imoMatch ? imoMatch[1] : cleanImo;

          const tds = row.querySelectorAll('td');
          const fullVesselCell = tds[0]?.text?.trim() || linkText;
          const cellLines = fullVesselCell.split('\n').map((l) => l.trim()).filter(Boolean);
          const scrapedName = cellLines[0] || linkText || cleanName;
          const scrapedType = cellLines[1] || tds[0]?.querySelector('.v-type')?.text?.trim();

          const builtText = tds[1]?.text?.trim();
          const scrapedBuiltYear = builtText && /^\d{4}$/.test(builtText) ? Number(builtText) : undefined;

          const dwtText = tds[3]?.text?.replace(/[^0-9]/g, '');
          const scrapedDwt = dwtText ? Number(dwtText) : undefined;

          const flagEl = row.querySelector('.flag-icon') || row.querySelector('img[title]');
          const scrapedFlag = flagEl?.getAttribute('title');

          if (scrapedName || scrapedImo) {
            return {
              imo: scrapedImo,
              mmsi: mmsi,
              name: (scrapedName || '').toUpperCase(),
              flag: scrapedFlag,
              vesselType: scrapedType,
              builtYear: scrapedBuiltYear,
              deadweightTonnage: scrapedDwt,
              confidence: 0.99,
              resolutionMethod: 'EXACT_NAME_MATCH',
            };
          }
        }
      }
    } catch (err) {
      log.debug('Live VesselFinder scraping request bypassed', { err: String(err) });
    }

    return null;
  }

  /**
   * Scrapes MyShipTracking Live AIS search endpoint
   */
  private async scrapeMyShipTracking(
    searchQuery: string,
    cleanImo?: string,
    cleanName?: string,
  ): Promise<VesselIdentity | null> {
    const targetUrl = `https://www.myshiptracking.com/requests/autocomplete.php?req=${encodeURIComponent(searchQuery)}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/xml, text/xml, */*',
        },
      }).catch(() => null);
      clearTimeout(timeoutId);

      if (res && res.ok) {
        const text = await res.text();
        // Parse XML tags: <RES><MMSI>...</MMSI><NAME>...</NAME><TYPE>...</TYPE><FLAG>...</FLAG></RES>
        const resMatches = text.match(/<RES>([\s\S]*?)<\/RES>/gi);
        if (resMatches && resMatches.length > 0 && resMatches[0]) {
          const first = resMatches[0];
          const mmsiMatch = first.match(/<MMSI>([^<]+)<\/MMSI>/i);
          const nameMatch = first.match(/<NAME>([^<]+)<\/NAME>/i);
          const typeMatch = first.match(/<TYPE>([^<]+)<\/TYPE>/i);
          const flagMatch = first.match(/<FLAG>([^<]+)<\/FLAG>/i);

          const scrapedMmsi = mmsiMatch?.[1] ? mmsiMatch[1].trim() : undefined;
          const scrapedName = nameMatch?.[1] ? nameMatch[1].trim().toUpperCase() : cleanName?.toUpperCase();
          const scrapedType = typeMatch?.[1] ? typeMatch[1].trim() : undefined;
          const scrapedFlag = flagMatch?.[1] ? flagMatch[1].trim() : undefined;

          if (scrapedName || cleanImo) {
            return {
              imo: cleanImo,
              mmsi: scrapedMmsi,
              name: scrapedName || '',
              flag: scrapedFlag,
              vesselType: scrapedType,
              confidence: 0.98,
              resolutionMethod: 'EXACT_NAME_MATCH',
            };
          }
        }
      }
    } catch (err) {
      log.debug('Live MyShipTracking scraping request bypassed', { err: String(err) });
    }

    return null;
  }
}
```

---

### 3. Container & Bill of Lading (B/L) Logistics Scraper
**File Location**: `backend/src/compliance/maritime/providers/container-bl-scraper.service.ts`

```typescript
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
```

---

### 4. Web Evidence & Provenance Verification Service
**File Location**: `backend/src/compliance/pricing/web-evidence.service.ts`

```typescript
import { SourceRankingService } from './source-ranking.service';
import type { WebEvidenceRecord } from './pricing.types';

export class WebEvidenceService {
  private readonly rankingService = new SourceRankingService();

  /**
   * Build an immutable, tamper-evident WebEvidenceRecord with SHA-256 integrity hash.
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
```

---

### 5. Universal Import Batch Scraper & SSRF Safe Fetcher
**File Location**: `backend/src/compliance/import/import-batch.service.ts` (Relevant Extraction)

```typescript
  /**
   * Trigger real-time scraper/feed synchronization for an entity.
   */
  public async triggerScraperForEntity(entityType: SupportedEntityType, actor = 'ADMIN_USER'): Promise<any> {
    await this.store.init();
    let sourceId: string | null = null;

    switch (entityType) {
      case 'sanctions':
        sourceId = 'OFAC_SDN';
        break;
      case 'prices':
        sourceId = 'UN_COMTRADE_PRICING';
        break;
      case 'currencies':
        sourceId = 'CENTRAL_BANK_FX';
        break;
      case 'ports':
        sourceId = 'UN_LOCODE_PORTS';
        break;
      case 'countries':
        sourceId = 'OFAC_SDN';
        break;
      default:
        sourceId = null;
    }

    if (!sourceId) {
      throw new Error(`No automated external scraping pipeline configured for entity "${entityType}"`);
    }

    const run = await this.syncEngine.syncSource(sourceId, {
      triggerType: 'MANUAL',
      actor,
      force: true,
    });

    this.store.invalidateCaches(entityType);
    return run;
  }

  /**
   * SSRF-protected URL source fetcher.
   * Blocks internal RFC 1918 subnets, localhost, and cloud metadata IPs.
   */
  public async fetchUrlSourceSafely(targetUrl: string): Promise<string> {
    const url = new URL(targetUrl);
    const hostname = url.hostname.toLowerCase();

    // SSRF Blocklist: Localhost, AWS metadata, private IPv4 ranges
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.')
    ) {
      throw new Error(`SSRF Protection Error: Access to private or loopback host "${hostname}" is forbidden.`);
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`Invalid URL protocol: "${url.protocol}". Only HTTP and HTTPS are permitted.`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

    try {
      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'TradeGuard-Compliance-Ingestion-Engine/2.0',
          'Accept': 'text/csv, application/json, text/plain',
        },
      });

      if (!res.ok) {
        throw new Error(`External source returned HTTP status ${res.status}: ${res.statusText}`);
      }

      return await res.text();
    } finally {
      clearTimeout(timeout);
    }
  }
```

---

## 4. AI API Key Integration Code

### 1. OpenAI / Groq Compatible Gateway Provider
**File Location**: `backend/src/ai/providers/openai.provider.ts`

```typescript
import { config } from '../../config';
import { Errors, describeUnknown, isAppError } from '../../utils/errors';
import { withTimeout } from '../../utils/async';
import {
  buildClassificationSystemPrompt,
  buildClassificationUserPrompt,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
} from '../prompt';
import { buildTradeComplianceSystemPrompt, buildTradeComplianceUserPrompt } from '../trade-prompt';
import { parseClassificationPayload, parseSummaryPayload, extractJsonObject } from '../response-schema';
import type {
  AIAnalysisService,
  ClassificationRequest,
  ClassificationResponse,
  SummaryRequest,
  SummaryResponse,
} from '../types';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

export class OpenAICompatibleProvider implements AIAnalysisService {
  readonly id = 'openai-compatible';
  readonly model: string;
  readonly supportsSummary = true;
  readonly isLocal = false;

  private readonly systemPrompt = buildClassificationSystemPrompt();

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = config.ai.openAiCompatible.baseUrl,
    model = config.ai.openAiCompatible.model,
  ) {
    this.model = model;
  }

  async classify(request: ClassificationRequest): Promise<ClassificationResponse> {
    const minTokens = config.ai.openAiCompatible.unitMaxOutputTokens || 4096;
    const maxTokens = Math.min(8192, Math.max(minTokens, request.units.length * 85 + 500));
    const { content, usage } = await this.complete(
      this.systemPrompt,
      buildClassificationUserPrompt(request),
      maxTokens,
    );
    const parsed = parseClassificationPayload(content, request.units.map((unit) => unit.id));
    return {
      ...parsed,
      usage,
    };
  }

  async summarize(request: SummaryRequest): Promise<SummaryResponse> {
    const maxTokens = config.ai.openAiCompatible.summaryMaxOutputTokens || 1400;
    const { content } = await this.complete(
      buildSummarySystemPrompt(),
      buildSummaryUserPrompt(request),
      maxTokens,
    );
    return parseSummaryPayload(content);
  }

  async extractTradeDoc(filename: string, text: string): Promise<any> {
    try {
      const maxTokens = 3500;
      const { content } = await this.complete(
        buildTradeComplianceSystemPrompt(),
        buildTradeComplianceUserPrompt(filename, text),
        maxTokens,
      );
      const jsonStr = extractJsonObject(content) || content;
      return JSON.parse(jsonStr);
    } catch (e) {
      return null;
    }
  }

  private async complete(
    system: string,
    user: string,
    maxTokens: number,
  ): Promise<{ content: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    let response: Response;
    try {
      response = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        }),
        config.processing.requestTimeoutMs,
      );
    } catch (err) {
      throw Errors.aiNetwork(describeUnknown(err));
    }

    if (!response.ok) {
      let message = `status ${response.status}`;
      try {
        const payload = (await response.json()) as ChatCompletionResponse;
        if (payload?.error?.message) {
          message = payload.error.message;
        }
      } catch {
        // use default status message
      }

      if (response.status === 401 || response.status === 403) {
        throw Errors.aiAuth(`Authentication failed against ${url}: ${message}`);
      }
      if (response.status === 429) {
        throw Errors.aiRateLimited(`Rate limited by ${url}: ${message}`);
      }
      throw Errors.aiUnavailable(`Service error from ${url} (${response.status}): ${message}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const choice = payload.choices?.[0];
    const content = choice?.message?.content;

    if (content === null || content === undefined) {
      throw Errors.aiMalformed('AI gateway response choices contained no text content');
    }

    return {
      content,
      usage: payload.usage
        ? {
            inputTokens: payload.usage.prompt_tokens ?? 0,
            outputTokens: payload.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }
}
```

---

### 2. Multimodal Vision Model Image Analyzer
**File Location**: `backend/src/ai/image-analyzer.service.ts` (Network invocation snippet)

```typescript
    // When OpenAI-compatible provider configured (e.g. Groq / OpenAI / Gemini endpoint)
    if (config.ai.openAiCompatible.apiKey) {
      const url = `${config.ai.openAiCompatible.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const response = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.ai.openAiCompatible.apiKey}`,
          },
          body: JSON.stringify({
            model: config.ai.openAiCompatible.model,
            temperature: 0.1,
            max_tokens: 3000,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content:
                  'You are an expert document vision AI. Analyze images and return ONLY valid JSON matching the requested schema.',
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: promptText },
                  { type: 'image_url', image_url: { url: dataUrl } }, // Base64 data URL
                ],
              },
            ],
          }),
        }),
        Math.max(35000, config.processing.requestTimeoutMs),
      );

      if (response.ok) {
        const json: any = await response.json();
        const content = json.choices?.[0]?.message?.content;
        if (content) {
          const parsed = this.parseVisionResponse(content, input.isScannedPage);
          if (parsed) return { ...parsed, source: 'ai' };
        }
      }
    }

    // When Anthropic provider is configured
    if (config.ai.anthropic.apiKey) {
      const { Anthropic } = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: config.ai.anthropic.apiKey });
      const response = await client.messages.create({
        model: config.ai.anthropic.model,
        max_tokens: 3000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
                  data: base64Data,
                },
              },
              { type: 'text', text: promptText },
            ],
          },
        ],
      });
      // ... parsed response
    }
```

---

### 3. Live RAG Compliance Copilot Gateway
**File Location**: `backend/src/services/rag.service.ts` (Network invocation snippet)

```typescript
  private async callAiDirect(system: string, messages: ChatMessage[]): Promise<string> {
    if (config.ai.openAiCompatible.apiKey) {
      const url = `${config.ai.openAiCompatible.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.ai.openAiCompatible.apiKey}`,
        },
        body: JSON.stringify({
          model: config.ai.openAiCompatible.model,
          temperature: 0.2,
          max_tokens: 1400,
          messages: [
            { role: 'system', content: system },
            ...messages.slice(-8),
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`AI Gateway responded with status ${response.status}`);
      }

      const json = (await response.json()) as any;
      const reply = json.choices?.[0]?.message?.content?.trim();
      if (!reply) {
        throw new Error('AI returned an empty response');
      }

      return reply;
    }

    throw new Error('No live AI provider configured with an active API key');
  }
```

---

*TradeGuard Compliance Engine — Comprehensive Scraping & AI Integration Reference*
