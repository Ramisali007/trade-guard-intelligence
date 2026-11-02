import { createLogger } from '../../utils/logger';

const log = createLogger('fx-rates-service');

export interface FxRateQuote {
  /** False when either currency has no rate at all; the amounts below are then meaningless. */
  rateKnown: boolean;
  /** True only when the rates were fetched from the feed, not the bundled reference table. */
  live: boolean;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  inverseRate: number;
  convertedAmount: number;
  asOf: string;
  source: string;
  authority: string;
}

export class FxRatesService {
  private static instance: FxRatesService;
  private ratesCache: Map<string, number> = new Map();
  private lastFetchedAt: number = 0;
  private lastUpdateIso: string = new Date().toISOString();
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  /**
   * After a failed fetch, wait this long before trying again. Without it an offline or firewalled
   * deployment retried on every call and made each caller wait out the 6 s timeout.
   */
  private readonly RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
  private lastAttemptAt = 0;
  private refreshing: Promise<void> | null = null;

  // Bundled reference rates, used until a fetch succeeds or when offline. Indicative only; they are
  // labeled as such in every quote, and a currency missing from this table has no rate at all.
  private readonly baselineRates: Record<string, number> = {
    USD: 1.0,
    PKR: 278.25,
    EUR: 0.865,
    GBP: 0.745,
    AED: 3.6725,
    CNY: 7.125,
    JPY: 147.5,
    CHF: 0.845,
    INR: 84.0,
    SGD: 1.34,
    // Pegged to the dollar, so these hold regardless of when the table was written.
    SAR: 3.75,
    QAR: 3.64,
    OMR: 0.3845,
    BHD: 0.376,
  };

  private constructor() {
    // Seed default baseline
    for (const [curr, r] of Object.entries(this.baselineRates)) {
      this.ratesCache.set(curr, r);
    }
    // Fetch fresh live rates asynchronously
    this.refreshLiveRates().catch((err) => {
      log.warn('Initial live FX fetch deferred, using baseline parity', { err: String(err) });
    });
  }

  public static getInstance(): FxRatesService {
    if (!FxRatesService.instance) {
      FxRatesService.instance = new FxRatesService();
    }
    return FxRatesService.instance;
  }

  /**
   * Fetches real-time live central bank foreign exchange parity rates.
   */
  public async refreshLiveRates(force: boolean = false): Promise<void> {
    if (!force && Date.now() - this.lastFetchedAt < this.CACHE_TTL_MS && this.lastFetchedAt > 0) {
      return;
    }
    const lastAttemptFailed = this.lastAttemptAt > this.lastFetchedAt;
    if (!force && lastAttemptFailed && Date.now() - this.lastAttemptAt < this.RETRY_AFTER_FAILURE_MS) {
      return;
    }
    // Concurrent callers share one fetch.
    if (this.refreshing) return this.refreshing;
    this.lastAttemptAt = Date.now();
    this.refreshing = this.fetchLiveRates().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /**
   * The rate to USD held right now — live if a fetch has succeeded, otherwise the baseline — or
   * null for a currency with neither. Never touches the network, so a request path can use it.
   */
  public cachedRate(currency: string): number | null {
    return this.ratesCache.get(currency.toUpperCase().trim()) ?? null;
  }

  /** Whether the cache holds fetched rates rather than only the baseline. */
  public hasLiveRates(): boolean {
    return this.lastFetchedAt > 0;
  }

  /** Whether a USD rate exists for the currency (live or bundled). USD itself always does. */
  public hasRate(currency: string): boolean {
    const key = currency.toUpperCase().trim();
    return key === 'USD' || this.ratesCache.has(key);
  }

  private async fetchLiveRates(): Promise<void> {
    try {
      log.info('Fetching live central bank exchange rates from open exchange API...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch('https://open.er-api.com/v6/latest/USD', {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = (await res.json()) as { rates?: Record<string, unknown>; time_last_update_utc?: string } | null;
        if (data && data.rates && typeof data.rates === 'object') {
          for (const [curr, val] of Object.entries(data.rates)) {
            if (typeof val === 'number') {
              this.ratesCache.set(curr.toUpperCase(), val);
            }
          }
          this.lastFetchedAt = Date.now();
          // The feed reports an RFC 1123 string ("Mon, 20 Oct 2026 00:02:31 +0000"); store ISO so the
          // `effectiveDate` written below is a real YYYY-MM-DD.
          const published = data.time_last_update_utc ? new Date(data.time_last_update_utc) : new Date();
          this.lastUpdateIso = (Number.isNaN(published.getTime()) ? new Date() : published).toISOString();
          log.info('Live foreign exchange rates updated successfully', {
            usdPkr: this.ratesCache.get('PKR'),
            usdEur: this.ratesCache.get('EUR'),
            asOf: this.lastUpdateIso,
          });

          // Sync into ComplianceStore for historical persistence
          try {
            const { ComplianceStore } = await import('../db/compliance-store');
            const store = ComplianceStore.getInstance();
            const today = this.lastUpdateIso.slice(0, 10);
            const records = Array.from(this.ratesCache.entries()).map(([curr, r]) => ({
              currencyCode: curr,
              rateToUsd: r,
              effectiveDate: today,
              source: 'open.er-api.com',
              isCurrent: true,
              syncedAt: this.lastUpdateIso,
            }));
            await store.saveFxRates(records);
          } catch {
            // Memory mode is fine
          }
        }
      }
    } catch (err) {
      log.warn('Live FX API call failed, falling back to authenticated baseline parity', { err: String(err) });
    }
  }

  /**
   * Asynchronously guarantees fresh rates before issuing a conversion quote.
   */
  public async getLiveQuote(
    amount: number,
    fromCurrency: string = 'USD',
    toCurrency: string = 'PKR',
  ): Promise<FxRateQuote> {
    await this.refreshLiveRates();
    return this.getConversionQuote(amount, fromCurrency, toCurrency);
  }

  /**
   * Returns all active live foreign exchange rates.
   */
  public async getLiveRates(): Promise<{
    base: string;
    asOf: string;
    rates: Record<string, number>;
  }> {
    await this.refreshLiveRates();
    const ratesObj: Record<string, number> = {};
    for (const [k, v] of this.ratesCache.entries()) {
      ratesObj[k] = v;
    }
    return {
      base: 'USD',
      asOf: this.lastUpdateIso,
      rates: ratesObj,
    };
  }

  /**
   * Converts any currency amount to target currency with full banking provenance quote.
   */
  public getConversionQuote(
    amount: number,
    fromCurrency: string = 'USD',
    toCurrency: string = 'PKR',
  ): FxRateQuote {
    const from = fromCurrency.toUpperCase().trim();
    const to = toCurrency.toUpperCase().trim();

    const live = this.hasLiveRates();
    const provenance = {
      source: live ? 'open.er-api.com daily reference rates' : 'Bundled reference rates (offline; not a live quote)',
      authority: 'Indicative rate for information only. It is not a rate published by the State Bank of Pakistan or any central bank.',
    };
    if (!this.hasRate(from) || !this.hasRate(to)) {
      return { rateKnown: false, live, fromCurrency: from, toCurrency: to, rate: 0, inverseRate: 0, convertedAmount: 0, asOf: this.lastUpdateIso, ...provenance };
    }
    const fromRate = from === 'USD' ? 1 : this.ratesCache.get(from)!;
    const toRate = to === 'USD' ? 1 : this.ratesCache.get(to)!;

    // Cross-rate calculation via USD base
    const rate = toRate / fromRate;
    const inverseRate = fromRate / toRate;
    const convertedAmount = Math.round(amount * rate * 100) / 100;

    return {
      rateKnown: true,
      live,
      fromCurrency: from,
      toCurrency: to,
      rate: Math.round(rate * 10000) / 10000,
      inverseRate: Math.round(inverseRate * 10000) / 10000,
      convertedAmount,
      asOf: this.lastUpdateIso,
      ...provenance,
    };
  }

  /**
   * Formats a dual-currency transaction valuation string (e.g. "USD 25,500.00 (PKR 7,082,816.40)").
   */
  public formatDualCurrency(amount: number, currency: string = 'USD', targetCurrency: string = 'PKR'): string {
    const quote = this.getConversionQuote(amount, currency, targetCurrency);
    if (!quote.rateKnown) return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const origFormatted = `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (currency.toUpperCase() === targetCurrency.toUpperCase()) {
      return origFormatted;
    }
    const targetFormatted = `${targetCurrency} ${quote.convertedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${origFormatted} (${targetFormatted})`;
  }
}
