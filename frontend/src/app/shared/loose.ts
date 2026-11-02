/**
 * A value whose shape someone else decides, and which is checked field by field where it is read: master-data records
 * whose columns come from the entity definition, a source's raw health payload, a report unit's free-form fields.
 *
 * `any` is the honest type at those boundaries; `unknown` would only move the same casts to every read. Giving it one name
 * keeps the exception in one reviewed place (the lint rule stays on everywhere else) and makes every such boundary easy to
 * find: search for `Loose`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;
