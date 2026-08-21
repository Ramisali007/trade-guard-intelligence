/**
 * The data-visualisation palette.
 *
 * Chart colour is defined once, here, and nowhere else. Both sets were checked for contrast
 * against their own surface and for separability under the three common forms of colour vision
 * deficiency, so a chart is readable without relying on hue alone. Picking a colour ad hoc in a
 * component would quietly break that, which is why the charts take their series colours from
 * `seriesColor()` rather than from a literal.
 *
 * Two rules follow the palette and are enforced by the chart components rather than by comment:
 * every chart with two or more series carries a legend, and every value is also written as a
 * number somewhere on screen — a couple of these hues are light enough that the fill alone is
 * not sufficient contrast for a reader.
 */

export type ThemeMode = 'light' | 'dark';

/** Sentiment, ordered positive → neutral → negative so the donut reads left to right. */
const SENTIMENT: Record<string, [light: string, dark: string]> = {
  positive: ['#1baf7a', '#12855e'],
  neutral: ['#4b5563', '#8b95a6'],
  negative: ['#e34948', '#e66767'],
};

/** Emotion. Seven distinct hues; assignment is semantic but the set itself is fixed. */
const EMOTION: Record<string, [light: string, dark: string]> = {
  happy: ['#1baf7a', '#199e70'],
  sad: ['#2a78d6', '#3987e5'],
  angry: ['#e34948', '#e66767'],
  excited: ['#eda100', '#c98500'],
  fear: ['#4a3aa7', '#9085e9'],
  surprise: ['#eb6834', '#d95926'],
  neutral: ['#4b5563', '#8b95a6'],
};

/**
 * Dimensions with a long tail of values — content type and topic each have ten — are drawn as
 * horizontal bars where the category is already named on the axis. Colour there would be pure
 * decoration and ten separable hues do not exist, so a single accent is used instead.
 */
const CATEGORICAL_ACCENT: Record<string, [light: string, dark: string]> = {
  contentType: ['#2a78d6', '#3987e5'],
  topic: ['#4a3aa7', '#9085e9'],
  unitType: ['#4b5563', '#8b95a6'],
};

const FALLBACK: [light: string, dark: string] = ['#4b5563', '#8b95a6'];

function pick(entry: [string, string] | undefined, mode: ThemeMode): string {
  const value = entry ?? FALLBACK;
  return mode === 'dark' ? value[1] : value[0];
}

/** Colour for one value of one dimension, in the current theme. */
export function seriesColor(dimensionId: string, valueId: string, mode: ThemeMode): string {
  if (dimensionId === 'sentiment') return pick(SENTIMENT[valueId], mode);
  if (dimensionId === 'emotion') return pick(EMOTION[valueId], mode);
  return pick(CATEGORICAL_ACCENT[dimensionId], mode);
}

/** True when the dimension is drawn with one colour per value rather than a single accent. */
export function isMultiHue(dimensionId: string): boolean {
  return dimensionId === 'sentiment' || dimensionId === 'emotion';
}

/** Colour keyed by the taxonomy's coarse tone, for chips and single-value accents. */
export function toneColor(tone: string, mode: ThemeMode): string {
  switch (tone) {
    case 'positive':
      return pick(SENTIMENT['positive'], mode);
    case 'negative':
      return pick(SENTIMENT['negative'], mode);
    default:
      return pick(FALLBACK, mode);
  }
}

/** Maps a taxonomy tone onto the global chip classes in styles.scss. */
export function toneChipClass(tone: string | undefined): string {
  switch (tone) {
    case 'positive':
      return 'chip-positive';
    case 'negative':
      return 'chip-negative';
    case 'informational':
      return 'chip-info';
    default:
      return '';
  }
}