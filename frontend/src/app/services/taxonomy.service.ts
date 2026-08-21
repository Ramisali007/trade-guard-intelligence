import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { shareReplay, tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import type { Taxonomy, TaxonomyDimension, TaxonomyValue } from '../models/api.models';
import { humanize } from '../shared/format';

/**
 * The classification taxonomy, fetched from the backend and cached for the session.
 *
 * The filters, chips, chart series and legends are all built from this response rather than from
 * lists duplicated in the frontend. That is the whole reason the endpoint exists: adding an
 * emotion or a new dimension is one edit in the backend's `config/taxonomy.ts`, and every control
 * in this UI picks it up on the next load. Nothing here enumerates a sentiment by name.
 *
 * `label()` and `tone()` degrade gracefully. If a document was analysed under an older taxonomy
 * and carries a value the current one no longer lists, the value is title-cased and shown rather
 * than dropped — losing a row would be worse than labelling it plainly.
 */
@Injectable({ providedIn: 'root' })
export class TaxonomyService {
  private readonly api = inject(ApiService);

  private readonly data = signal<Taxonomy | null>(null);
  private request: Observable<Taxonomy> | null = null;

  readonly taxonomy = this.data.asReadonly();
  readonly loaded = computed(() => this.data() !== null);
  readonly dimensions = computed<TaxonomyDimension[]>(() => this.data()?.dimensions ?? []);
  readonly unitTypes = computed(() => this.data()?.unitTypes ?? []);

  /** The dimensions offered as filters, in the order the backend declares them. */
  readonly filterableDimensions = computed(() => this.dimensions());

  /** Fetch once per session; every later caller shares the same response. */
  load(): Observable<Taxonomy> {
    const cached = this.data();
    if (cached) return of(cached);

    this.request ??= this.api.get<Taxonomy>('/taxonomy').pipe(
      tap((taxonomy) => this.data.set(taxonomy)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.request;
  }

  dimension(id: string): TaxonomyDimension | undefined {
    return this.dimensions().find((entry) => entry.id === id);
  }

  values(dimensionId: string): TaxonomyValue[] {
    return this.dimension(dimensionId)?.values ?? [];
  }

  value(dimensionId: string, valueId: string): TaxonomyValue | undefined {
    return this.values(dimensionId).find((entry) => entry.id === valueId);
  }

  /** Human label for a value id, falling back to a title-cased version of the id itself. */
  label(dimensionId: string, valueId: string | null | undefined): string {
    if (!valueId) return '—';
    return this.value(dimensionId, valueId)?.label ?? humanize(valueId);
  }

  dimensionLabel(dimensionId: string): string {
    return this.dimension(dimensionId)?.label ?? humanize(dimensionId);
  }

  tone(dimensionId: string, valueId: string | null | undefined): string {
    if (!valueId) return 'neutral';
    return this.value(dimensionId, valueId)?.tone ?? 'neutral';
  }

  description(dimensionId: string, valueId: string): string {
    return this.value(dimensionId, valueId)?.description ?? '';
  }

  unitTypeLabel(id: string | null | undefined): string {
    if (!id) return '—';
    return this.unitTypes().find((entry) => entry.id === id)?.label ?? humanize(id);
  }
}