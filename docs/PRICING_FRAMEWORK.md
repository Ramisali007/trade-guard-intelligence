# Price comparison framework

**Date:** 2026-10-26. Code: `backend/src/compliance/pricing/` (`pricing-intelligence.service.ts`, `pricing-policy.ts`, `price-comparability.ts`). Tests: `pricing-framework.test.ts` (synthetic benchmarks only), plus the earlier `compliance-correctness` and `hardening` pricing cases.

## What was audited

| Item | Finding |
|---|---|
| Global thresholds `+30%` high, `-28%` low | Hard-coded in the service with no methodology, source or approval. They are **kept** (so existing behaviour does not change) but are now labelled everywhere as the *platform default, an unapproved screening indicator*. They are not replaced with another universal threshold. |
| Built-in reference corridors (rice, cotton fabric, shirts, ...) | Figures bundled in code, previously written as "UN Comtrade / WTO" evidence. They were already relabelled `built-in reference corridor, MODERATE confidence, not a live quotation`. They are now recognised as `BUILT_IN_REFERENCE` and can never be an approved control. Their observation date and sample size are shown as unknown, not as fresh. |
| Fixed `FOB` comparison basis | The declared price was always moved to FOB even if the benchmark was CIF. The comparison is now made on the benchmark's own basis (`FOB`/`CIF`); any other basis (CFR, EXW) makes the benchmark a weak proxy. |
| Flat `+/-8%` freight and insurance allowance | Unchanged, now stated on every result as a flat allowance, not the invoice's charges. |

## How a price is judged

1. Currency to USD (rate for the transaction date where held), Incoterm to the benchmark's basis, unit of measure to the benchmark's unit. Anything that cannot be converted is `NOT COMPARABLE`; no conclusion is drawn.
2. **Threshold**, resolved by HS prefix: an *approved category entry* if one matches (longest prefix wins), otherwise the unapproved default.
3. **Comparability** of the benchmark, factor by factor: product (HS agreement to 4 digits = match; chapter only = partial; different chapter = mismatch), specification (always unknown), unit, currency, Incoterm, destination (global reference = partial), origin (always unknown), freshness, sample size. A mismatch makes the benchmark a **weak proxy**: the variance is shown as an indication but **no over- or under-invoicing classification is raised**. Otherwise the grade is `PROXY`, or `COMPARABLE` only when the product matches and nothing is partial or unknown, from a non-bundled source.
4. **Classification** only if the benchmark's confidence is MODERATE or better *and* the grade is not weak.
5. `approvedControl` is true only for an approved category threshold on a `LIVE_SOURCE` or `BANK_SUPPLIED` benchmark that is not a weak proxy. Every anomaly that is not an approved control says, in its explanation, that it is a screening indicator and what to confirm.

Each result keeps its `assessment`: declared price/currency/unit/Incoterm, the USD figures at each step, the FX basis, the Incoterm adjustment, the benchmark (id, category, HS prefix, origin, confidence, sample count, date, age, basis, unit, publishers), the threshold and its source, the comparability factors, the limitations, and the time of assessment.

## Category thresholds: how to introduce one

The platform ships **none**. A bank that has a documented methodology supplies `PRICING_POLICY_FILE` (default `backend/data/pricing-policy.json`):

```json
[{ "id": "STEEL-7208", "hsPrefix": "7208", "highPct": 15, "lowPct": 12,
   "methodology": "How the figures were derived, from what data, over what period (at least a sentence).",
   "approvedBy": "Person or committee", "approvedOn": "2026-09-01",
   "minSamples": 5, "maxBenchmarkAgeDays": 45 }]
```

An entry missing the methodology, the approver or the date, with an out-of-range figure or a duplicate id, is **ignored and reported** (the result says how many entries were not used). `minSamples` and `maxBenchmarkAgeDays` turn too-thin and too-old benchmarks into weak proxies for that category.

## Provider adapter

`PricingIntelligenceService` takes a `BenchmarkProvider` (`findMarketBenchmark(...)`). The platform's own provider (database first, then the built-in corridors) is the default; a licensed price index is a second implementation of the same interface. The tests inject synthetic providers; no licensed provider is connected.

## Not done

- No pre-shipment (pre-trade) pricing finding. Pricing remains in the post-trade analysis (TBML); a pre-trade finding would be based on bundled corridors and is deliberately not added.
- No quantity-band, specification or origin comparison; the benchmarks do not carry them.
- No licensed benchmark source; no category thresholds. Both need the bank.
