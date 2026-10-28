/**
 * Name matching for sanctions screening.
 *
 * Substring tests are the classic way to wreck a screening engine: with real lists loaded, a
 * listed alias like "NALU" or "STAR" is a substring of thousands of innocent company names, and
 * every one of them would be "listed at transaction time". Matching here works on whole tokens:
 *
 *  - names are normalised (accents folded, punctuation dropped, `&` → `and`) and legal-form words
 *    (Ltd, LLC, FZE, JSC, …) are set aside so "ACME TRADING LLC" and "Acme Trading Co." compare equal;
 *  - an exact normalised match is the strongest signal;
 *  - a listed name all of whose tokens appear in the query is a strong match only if it is
 *    distinctive (two or more tokens, or one long token) and covers most of the query;
 *  - otherwise a near-identical spelling (character-bigram similarity) catches transliteration
 *    variants and typos.
 */

// Only words that say what kind of legal person something is. Descriptive words such as
// "trading" or "international" stay: dropping them would make "Al Noor Trading LLC" identical to a
// listed "AL NOOR".
const LEGAL_FORMS = new Set([
  'ltd', 'limited', 'llc', 'co', 'company', 'inc', 'incorporated', 'corp', 'corporation', 'plc', 'pvt',
  'private', 'pte', 'sa', 'ag', 'gmbh', 'bv', 'nv', 'fze', 'fzc', 'fzco', 'fz', 'jsc', 'pjsc', 'ojsc', 'cjsc',
  'zao', 'ao', 'ooo', 'oao', 'pao', 'llp', 'lp', 'the', 'and', 'of', 'srl', 'spa', 'sarl', 'kft',
]);

/** Matches at or above this confidence are treated as a listing; below it, as a possible match for review. */
export const CONFIRMED_MATCH_THRESHOLD = 0.95;

/**
 * Cyrillic and Greek are folded to Latin so a name on a Russian-language document meets the
 * Latin transliteration the sanctions lists publish. Arabic and CJK are kept as Unicode letters:
 * they cannot be transliterated reliably without a dictionary, but an identical listing (lists
 * carry the original script as an alias) still matches exactly.
 */
const TRANSLITERATION: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
  ў: 'u', ә: 'a', ғ: 'gh', қ: 'q', ң: 'ng', ө: 'o', ұ: 'u', ү: 'u', һ: 'h',
  α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm',
  ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

function transliterate(text: string): string {
  let out = '';
  for (const ch of text) out += TRANSLITERATION[ch] ?? ch;
  return out;
}

export function normalizeName(raw: string): string {
  const folded = (raw || '')
    .normalize('NFKD')
    // Combining marks: Latin accents, Arabic vowel marks, the breve on Cyrillic й.
    .replace(/\p{M}/gu, '')
    // Arabic tatweel (a purely decorative elongation).
    .replace(/\u0640/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ');
  return transliterate(folded)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether a name carries anything that can be compared. A party name that normalises to nothing
 * (symbols only, or a script that was lost in extraction) was not screened, and callers must not
 * report it as clear.
 */
export function isScreenableName(raw: string | null | undefined): boolean {
  return normalizeName(raw ?? '').length >= 2;
}

/** Distinctive tokens: the normalised name without legal-form and filler words. */
export function coreTokens(normalized: string): string[] {
  const tokens = normalized.split(' ').filter(Boolean);
  const core = tokens.filter((t) => !LEGAL_FORMS.has(t));
  return core.length > 0 ? core : tokens;
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  const compact = text.replace(/\s+/g, ' ');
  for (let i = 0; i < compact.length - 1; i++) {
    const gram = compact.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice coefficient over character bigrams (0..1). */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [gram, count] of ga) {
    overlap += Math.min(count, gb.get(gram) ?? 0);
    total += count;
  }
  for (const count of gb.values()) total += count;
  return (2 * overlap) / total;
}

export interface PreparedName {
  normalized: string;
  core: string[];
  coreJoined: string;
}

export function prepareName(raw: string): PreparedName {
  const normalized = normalizeName(raw);
  const core = coreTokens(normalized);
  return { normalized, core, coreJoined: core.join(' ') };
}

export type NameMatchKind = 'EXACT' | 'TOKEN_CONTAINMENT' | 'FUZZY';

export interface NameMatch {
  kind: NameMatchKind;
  confidence: number;
}

/**
 * Compare a screened name with one listed name. Returns null when they should not be treated as
 * the same party.
 */
export function matchNames(query: PreparedName, listed: PreparedName): NameMatch | null {
  if (!query.normalized || !listed.normalized) return null;

  if (query.normalized === listed.normalized || (query.coreJoined && query.coreJoined === listed.coreJoined)) {
    return { kind: 'EXACT', confidence: 1.0 };
  }

  // Every distinctive token of the listed name appears in the query, and the listed name is
  // distinctive enough on its own that this is unlikely to be coincidence.
  const listedDistinctive = listed.core.length >= 2 || (listed.core[0]?.length ?? 0) >= 7;
  if (listedDistinctive) {
    const queryTokens = new Set(query.core);
    const contained = listed.core.every((t) => queryTokens.has(t));
    const coverage = listed.core.length / Math.max(1, query.core.length);
    if (contained && coverage >= 0.6) {
      // Below CONFIRMED_MATCH_THRESHOLD by construction: extra words in the query may name a
      // different party, so this is a lead for an analyst, not a listing.
      return { kind: 'TOKEN_CONTAINMENT', confidence: Math.min(0.92, 0.8 + 0.12 * coverage) };
    }
  }

  // The reverse direction: the query is a shortened form of a longer listing ("Bank Melli" for
  // "BANK MELLI IRAN"). Only distinctive queries qualify, and it is a lead for an analyst, never a listing.
  const queryDistinctive = query.core.length >= 2 || (query.core[0]?.length ?? 0) >= 7;
  if (queryDistinctive) {
    const listedTokens = new Set(listed.core);
    const queryContained = query.core.every((t) => listedTokens.has(t));
    const listedCoverage = query.core.length / Math.max(1, listed.core.length);
    if (queryContained && listedCoverage >= 0.5) {
      return { kind: 'TOKEN_CONTAINMENT', confidence: Math.min(0.9, 0.78 + 0.12 * listedCoverage) };
    }
  }

  // Near-identical spelling (transliteration variants, a dropped letter). Short strings are
  // excluded: two 4-letter names differing by one letter are different names.
  if (query.coreJoined.length >= 6 && listed.coreJoined.length >= 6) {
    const similarity = diceSimilarity(query.coreJoined, listed.coreJoined);
    if (similarity >= 0.9) return { kind: 'FUZZY', confidence: Math.min(0.9, similarity - 0.02) };
  }

  return null;
}
