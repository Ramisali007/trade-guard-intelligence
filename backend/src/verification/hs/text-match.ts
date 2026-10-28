/**
 * Comparing a goods description with the official wording of an HS heading. This is a deliberately
 * simple word-overlap measure: it can show that a description and a heading share their subject
 * ("raw cotton fibre" / "Cotton; not carded or combed"), and it can show that they share nothing
 * ("cotton fabric" / "Iron or non-alloy steel; flat-rolled products"). It cannot decide a hard
 * classification, and the verifier never treats it as doing so.
 */

const STOP = new Set(
  (
    'the and for with not other than are from into its their this that these those per etc such any all ' +
    'whether whose which when where been being have has had can may also only more most less than ' +
    'whole part parts used use using made make making'
  ).split(' '),
);

/** Words that describe a trade, not a product: they say nothing about which heading applies. */
const TRADE_NOISE = new Set(
  'grade quality type class new standard general merchandise goods product products item items material materials assorted various brand model size sizes premium commercial export import bulk lot pack packed packing packaging ' +
    'containing contains containing consisting'.split(' '),
);

/** British/American and other spellings the HS wording and invoices mix. */
const CANONICAL: Record<string, string> = {
  fiber: 'fibre',
  fibers: 'fibre',
  fibres: 'fibre',
  colour: 'color',
  coloured: 'colored',
  aluminum: 'aluminium',
  sulfur: 'sulphur',
  sulfate: 'sulphate',
  tyre: 'tire',
  tyres: 'tire',
  jewelry: 'jewellery',
  yarns: 'yarn',
  fabrics: 'fabric',
};

function stem(word: string): string {
  if (CANONICAL[word]) return CANONICAL[word]!;
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ses|xes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

/** The meaningful words of a text: lower case, no stop or trade-noise words, plurals folded. */
export function meaningfulTokens(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().replace(/[^a-z]+/g, ' ').split(' ')) {
    if (raw.length < 3 || STOP.has(raw) || TRADE_NOISE.has(raw)) continue;
    const word = stem(raw);
    if (word.length >= 3 && !STOP.has(word) && !TRADE_NOISE.has(word)) out.add(word);
  }
  return [...out];
}

/** The words two texts have in common, from the description's side. */
export function sharedWords(description: string, official: string): string[] {
  const theirs = new Set(meaningfulTokens(official));
  return meaningfulTokens(description).filter((w) => theirs.has(w));
}

/** A description with nothing to classify by: placeholders, or too few meaningful words. */
export function isGenericDescription(description: string | null | undefined): boolean {
  const text = (description ?? '').trim();
  if (!text || /^(not found|not specified|n\/a|general merchandise|goods|various|assorted|as per|as per invoice)\b/i.test(text)) return true;
  return meaningfulTokens(text).length === 0;
}
