/**
 * Text normalisation applied between extraction and segmentation.
 *
 * The rule here is conservative: fix artefacts introduced by the *extraction* (mojibake,
 * ligatures, soft hyphens, control characters, collapsed whitespace) and never rewrite the
 * author's words. Nothing is truncated, no sentences are dropped, and no content is
 * summarised — the analysed text stays faithful to the source.
 */

const LIGATURES: Array<[RegExp, string]> = [
  [/ﬀ/g, 'ff'],
  [/ﬁ/g, 'fi'],
  [/ﬂ/g, 'fl'],
  [/ﬃ/g, 'ffi'],
  [/ﬄ/g, 'ffl'],
  [/ﬅ/g, 'st'],
  [/ﬆ/g, 'st'],
];

/** Common UTF-8-read-as-latin1 sequences, which show up in older PDFs and .doc files. */
const MOJIBAKE: Array<[RegExp, string]> = [
  [/â€™/g, '’'],
  [/â€˜/g, '‘'],
  [/â€œ/g, '“'],
  [/â€/g, '”'],
  [/â€"/g, '—'],
  [/â€"/g, '–'],
  [/â€¦/g, '…'],
  [/Â /g, ' '],
];

export function normalizeText(input: string): string {
  let text = input;

  // Unicode canonical composition first, so accented characters compare predictably.
  try {
    text = text.normalize('NFKC');
  } catch {
    /* NFKC is available on every supported Node version; ignore defensively. */
  }

  for (const [pattern, replacement] of MOJIBAKE) text = text.replace(pattern, replacement);
  for (const [pattern, replacement] of LIGATURES) text = text.replace(pattern, replacement);

  text = text
    // Soft hyphen and zero-width characters are invisible noise from PDF text layers.
    .replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '')
    // Control characters, except tab and newline.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    // Every exotic space becomes a plain space.
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    // Unicode line/paragraph separators become newlines.
    .replace(/[\u2028\u2029]/g, '\n')
    // Windows / classic Mac line endings.
    .replace(/\r\n?/g, '\n');

  text = text
    // Collapse runs of spaces/tabs, but keep newlines meaningful.
    .replace(/[ \t]{2,}/g, ' ')
    // Space before common punctuation is an extraction artefact.
    .replace(/ +([,.;:!?])/g, '$1')
    // Never more than one blank line.
    .replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/** Single-block normalisation: everything above, plus newlines flattened to spaces. */
export function normalizeUnitText(input: string): string {
  return normalizeText(input).replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return matches ? matches.length : 0;
}

/**
 * Text with no letters at all (pure page furniture, dot leaders, rule characters) carries no
 * analysable meaning. Used to skip units rather than waste an AI call on them.
 */
export function isMeaningless(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '').length;
  if (letters === 0) return true;
  // Dot leaders and rules: "......... 42", "-------".
  if (/^[\s.\-_=~•*]+$/.test(text)) return true;
  return false;
}