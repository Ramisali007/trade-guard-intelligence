import type { Request, Response } from 'express';
import { TAXONOMY, UNIT_TYPES } from '../config/taxonomy';

/**
 * The classification taxonomy, served to the client.
 *
 * The Angular app builds its filters, chips, chart series and legends from this response rather
 * than from its own hard-coded lists. Adding a sentiment value or a whole new dimension is then
 * one edit in `config/taxonomy.ts`, and the UI follows — which is the point of keeping the
 * taxonomy as data.
 */
export function getTaxonomy(_req: Request, res: Response): void {
  // Stable for the lifetime of a deployment, so it is worth caching in the browser.
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    dimensions: TAXONOMY.map((dimension) => ({
      id: dimension.id,
      label: dimension.label,
      description: dimension.description,
      fallback: dimension.fallback,
      required: dimension.required,
      values: dimension.values.map((value) => ({
        id: value.id,
        label: value.label,
        description: value.description,
        tone: value.tone,
      })),
    })),
    unitTypes: UNIT_TYPES.map((entry) => ({ id: entry.id, label: entry.label })),
  });
}