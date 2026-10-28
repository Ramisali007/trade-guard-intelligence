/**
 * A value whose shape someone else decides, and which is checked field by field where it is read:
 * a model's free-form JSON, a CSV row, a pdf.js internal object, a stored raw feed payload, a test double.
 *
 * `any` is the honest type at those boundaries; `unknown` would only move the same casts to every read.
 * Giving it one name keeps the exception in one reviewed place (the lint rule stays on everywhere else) and
 * makes every such boundary easy to find: search for `Loose`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;
