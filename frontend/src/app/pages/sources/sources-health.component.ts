import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { DocumentsService } from '../../services/documents.service';

@Component({
  selector: 'app-sources-health',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="sources-page">
      <!-- Header -->
      <div class="header-card">
        <div class="header-left">
          <div class="badge-title">
            <span class="source-badge">EXTERNAL INTELLIGENCE LAYER</span>
            <span class="status-badge live">DATABASE-FIRST &amp; OFFLINE-READY</span>
          </div>
          <h1>Authoritative Sources, Data Health &amp; Synchronization Operations</h1>
          <p class="subtitle">
            Local canonical intelligence repository with continuous background synchronization, SLA tracking, immutable SHA-256 checksums, and bitemporal point-in-time versioning for international trade finance compliance.
          </p>
        </div>
        <div class="header-actions">
          <button (click)="syncAllSources()" [disabled]="isSyncingAll()" class="btn btn-primary">
            <span *ngIf="isSyncingAll()" class="spinner-inline"></span>
            {{ isSyncingAll() ? 'Synchronizing All...' : 'Sync All Sources Now' }}
          </button>
        </div>
      </div>

      <!-- Health Overview Metrics -->
      <div *ngIf="health()" class="health-metrics-grid">
        <div class="metric-card">
          <span class="metric-label">Total Sources</span>
          <span class="metric-value">{{ health()?.totalSources || sources().length }}</span>
          <span class="metric-sub">Active Regimes &amp; Portals</span>
        </div>
        <div class="metric-card healthy">
          <span class="metric-label">Healthy &amp; Fresh</span>
          <span class="metric-value text-success">{{ health()?.healthySources || sources().length }}</span>
          <span class="metric-sub">Within Freshness SLA</span>
        </div>
        <div class="metric-card" [class.warning]="(health()?.staleSources || 0) > 0">
          <span class="metric-label">Stale / Alert</span>
          <span class="metric-value" [class.text-warning]="(health()?.staleSources || 0) > 0">{{ health()?.staleSources || 0 }}</span>
          <span class="metric-sub">Requires Sync</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Canonical Entities</span>
          <span class="metric-value font-mono">{{ (health()?.totalCanonicalEntities || 0) | number }}</span>
          <span class="metric-sub">Bitemporal Designations</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Price Benchmarks</span>
          <span class="metric-value font-mono">{{ (health()?.totalPriceBenchmarks || 0) | number }}</span>
          <span class="metric-sub">Customs Corridors</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Last Global Sync</span>
          <span class="metric-value small-date">{{ (health()?.lastGlobalSync | date:'medium') || 'Just Now' }}</span>
          <span class="metric-sub">Verified Canonical State</span>
        </div>
      </div>

      <!-- Section Title -->
      <div class="section-heading mt-8">
        <h2>Registered External Data Sources</h2>
        <span class="counter-badge">{{ sources().length }} Sources</span>
      </div>

      <!-- Sources Grid -->
      <div class="sources-grid">
        <div *ngFor="let s of sources()" class="source-card" [class.healthy]="s.syncStatus === 'SUCCESS' || s.healthStatus === 'HEALTHY'">
          <div class="source-header">
            <div class="jurisdiction-pill" [attr.data-cat]="s.dataCategory || 'SANCTIONS'">
              {{ s.dataCategory || s.jurisdiction || 'REGULATORY' }}
            </div>
            <span class="freshness-pill" [class.fresh]="s.freshnessStatus === 'FRESH' || s.healthStatus === 'HEALTHY'" [class.failed]="s.syncStatus === 'FAILED' || s.freshnessStatus === 'SYNC_FAILED'">
              ● {{ s.freshnessStatus || (s.healthStatus === 'HEALTHY' ? 'FRESH' : 'AGING') }}
            </span>
          </div>

          <h3 class="source-name">{{ s.sourceName }}</h3>
          <div class="auth-name">{{ s.provider || s.regulatoryAuthority }}</div>

          <div class="meta-list">
            <div class="meta-row">
              <span class="label">Current Version:</span>
              <span class="val font-mono">{{ s.currentVersion }}</span>
            </div>
            <div class="meta-row">
              <span class="label">Active Records:</span>
              <span class="val">{{ (s.recordCount || 0) | number }} records</span>
            </div>
            <div class="meta-row">
              <span class="label">Update Cadence:</span>
              <span class="val">{{ s.updateFrequency || 'DAILY' }}</span>
            </div>
            <div class="meta-row">
              <span class="label">Last Synced:</span>
              <span class="val">{{ (s.lastSuccessfulSync || s.retrievedAt) | date:'medium' }}</span>
            </div>
          </div>

          <div class="checksum-box">
            <span class="checksum-label">SHA-256 Provenance Checksum:</span>
            <code class="checksum-val">{{ s.checksumSha256 }}</code>
          </div>

          <div class="source-footer">
            <button (click)="syncSingleSource(s.sourceId)" [disabled]="isSyncingSource(s.sourceId)" class="btn btn-sm btn-outline">
              <span *ngIf="isSyncingSource(s.sourceId)" class="spinner-inline"></span>
              {{ isSyncingSource(s.sourceId) ? 'Syncing...' : 'Sync Now 🔄' }}
            </button>
            <a [href]="s.endpointOrReference || s.sourceUrl" target="_blank" rel="noopener noreferrer" class="source-link">
              Official Portal ↗
            </a>
            <button (click)="openInspector(s)" class="inspect-btn">
              Inspect Records 👁
            </button>
          </div>
        </div>
      </div>

      <!-- Recent Synchronization Runs Table -->
      <div *ngIf="recentRuns().length > 0" class="sync-history-card mt-24">
        <div class="history-header">
          <div>
            <h3>Audit Synchronization Provenance Log</h3>
            <p class="history-sub">Immutable audit log of scheduled and manual data ingestions with execution durations and cryptographic checksums.</p>
          </div>
          <span class="counter-badge">{{ recentRuns().length }} Runs Logged</span>
        </div>

        <div class="table-responsive mt-12">
          <table class="history-table">
            <thead>
              <tr>
                <th>Sync Run ID</th>
                <th>Source</th>
                <th>Trigger</th>
                <th>Finished At</th>
                <th>Duration</th>
                <th>Records (Ins/Upd/Unch)</th>
                <th>Status</th>
                <th>Dataset SHA-256 Checksum</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let run of recentRuns()">
                <td class="font-mono text-bold">{{ run.syncRunId }}</td>
                <td>{{ run.sourceId }}</td>
                <td><span class="badge-trigger">{{ run.triggerType }}</span></td>
                <td>{{ run.finishedAt | date:'medium' }}</td>
                <td>{{ run.durationMs }}ms</td>
                <td>
                  <span class="text-success">+{{ run.recordsInserted }}</span> /
                  <span class="text-warning">~{{ run.recordsUpdated }}</span> /
                  <span class="muted">{{ run.recordsUnchanged }}</span>
                </td>
                <td>
                  <span class="status-pill" [class.success]="run.status === 'SUCCESS' || run.status === 'SKIPPED_NOT_MODIFIED'" [class.failed]="run.status === 'FAILED' || run.status === 'SUSPICIOUS'">
                    {{ run.status }}
                  </span>
                </td>
                <td><code class="mini-checksum">{{ run.payloadChecksumSha256.slice(0, 16) }}…</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Record & JSON Inspector Modal -->
      <div *ngIf="inspectingSource()" class="modal-backdrop" (click)="closeInspector()">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div>
              <span class="chip">{{ inspectingSource()?.dataCategory || inspectingSource()?.jurisdiction }} REGIME</span>
              <h2 class="modal-title mt-4">{{ inspectingSource()?.sourceName }}</h2>
              <div class="small muted">Snapshot Version: {{ inspectingSource()?.currentVersion }} | Frequency: {{ inspectingSource()?.updateFrequency || 'DAILY' }}</div>
            </div>
            <button (click)="closeInspector()" class="close-btn">&times;</button>
          </div>

          <div class="modal-body">
            <div class="guide-box">
              <strong>💡 Authoritative Knowledge Layer:</strong>
              <p class="small mt-4">
                TradeGuard Intelligence ingests external regulatory, customs valuation, and maritime feeds into searchable canonical database collections. Document analysis queries this local knowledge store with zero dependency on live internet access.
              </p>
            </div>

            <h4 class="mt-16">Canonical Entity &amp; Dataset Sample:</h4>
            <div class="sample-records mt-8">
              <pre class="json-viewer">{{ getSampleRecordsJson(inspectingSource()?.sourceId) }}</pre>
            </div>

            <div class="row gap-8 mt-16 wrap">
              <button (click)="syncSingleSource(inspectingSource()?.sourceId); closeInspector()" class="btn btn-sm btn-primary">
                Synchronize Now 🔄
              </button>
              <a [href]="inspectingSource()?.endpointOrReference || inspectingSource()?.sourceUrl" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline">
                Open Official Authority Website ↗
              </a>
              <button (click)="closeInspector()" class="btn btn-sm btn-ghost">
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .sources-page {
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 24px 32px 64px;
      max-width: 1440px;
      margin: 0 auto;
      font-family: var(--font);
    }

    .header-card {
      background: var(--raised);
      color: var(--ink);
      padding: 24px 28px;
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
      box-shadow: var(--shadow-sm);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 24px;
      flex-wrap: wrap;
    }

    .header-left {
      max-width: 900px;
    }

    .badge-title {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .source-badge {
      background: var(--accent);
      color: #fff;
      font-size: 0.72rem;
      font-weight: 750;
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .status-badge.live {
      background: #ecfdf5;
      color: #059669;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      border: 1px solid #bbf7d0;
    }

    h1 {
      margin: 0 0 0.5rem 0;
      font-size: 1.45rem;
      font-weight: 700;
      color: var(--ink);
      letter-spacing: -0.02em;
    }

    .subtitle {
      margin: 0;
      color: var(--ink-3);
      font-size: 0.88rem;
      line-height: 1.5;
    }

    .health-metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
    }

    .metric-card {
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      box-shadow: var(--shadow-sm);
    }

    .metric-label {
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--ink-3);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .metric-value {
      font-size: 1.65rem;
      font-weight: 750;
      color: var(--ink);
      line-height: 1.1;
    }

    .metric-value.small-date {
      font-size: 0.95rem;
      padding-top: 4px;
    }

    .metric-sub {
      font-size: 0.75rem;
      color: var(--ink-4);
    }

    .section-heading {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .section-heading h2 {
      font-size: 1.15rem;
      font-weight: 700;
      margin: 0;
      color: var(--ink);
    }

    .counter-badge {
      background: var(--sunken);
      color: var(--ink-2);
      font-size: 0.72rem;
      font-weight: 700;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
    }

    .sources-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
      gap: 14px;
    }

    .source-card {
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 20px 22px;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      box-shadow: var(--shadow-sm);
      border-top: 3px solid var(--line-strong);
      transition: all var(--dur-fast) var(--ease);
    }

    .source-card.healthy {
      border-top-color: #10b981;
    }

    .source-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .jurisdiction-pill {
      font-size: 0.72rem;
      font-weight: 750;
      padding: 0.2rem 0.55rem;
      border-radius: 4px;
      background: var(--sunken);
      color: var(--ink-2);
      letter-spacing: 0.04em;
    }

    .jurisdiction-pill[data-cat="SANCTIONS"] { background: #e0f2fe; color: #0369a1; }
    .jurisdiction-pill[data-cat="PRICING"] { background: #fef3c7; color: #92400e; }
    .jurisdiction-pill[data-cat="PORTS"] { background: #ede9fe; color: #6d28d9; }
    .jurisdiction-pill[data-cat="FX_RATES"] { background: #ecfdf5; color: #065f46; }

    .freshness-pill {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 0.2rem 0.55rem;
      border-radius: 4px;
      background: #f1f5f9;
      color: #64748b;
    }

    .freshness-pill.fresh { background: #ecfdf5; color: #059669; }
    .freshness-pill.failed { background: #fee2e2; color: #dc2626; }

    .source-name {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--ink);
      margin: 0;
      line-height: 1.35;
    }

    .auth-name {
      font-size: 0.78rem;
      color: var(--ink-3);
      margin-top: -0.35rem;
    }

    .meta-list {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin: 0.25rem 0;
      font-size: 0.8rem;
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .meta-row .label { color: var(--ink-3); }
    .meta-row .val { font-weight: 600; color: var(--ink); }

    .checksum-box {
      background: var(--sunken);
      border-radius: 4px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      border: 1px solid var(--line);
    }

    .checksum-label {
      font-size: 0.68rem;
      font-weight: 700;
      color: var(--ink-4);
      text-transform: uppercase;
    }

    .checksum-val {
      font-size: 0.72rem;
      word-break: break-all;
      color: var(--ink-2);
      font-family: monospace;
    }

    .source-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid var(--line);
    }

    .source-link {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--accent);
      text-decoration: none;
      margin-left: auto;
    }

    .inspect-btn {
      background: var(--sunken);
      border: 1px solid var(--line);
      color: var(--ink-2);
      font-size: 0.74rem;
      font-weight: 600;
      padding: 0.35rem 0.65rem;
      border-radius: 4px;
      cursor: pointer;
    }

    .sync-history-card {
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 20px 24px;
      box-shadow: var(--shadow-sm);
    }

    .history-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .history-header h3 {
      font-size: 1.05rem;
      font-weight: 700;
      margin: 0;
      color: var(--ink);
    }

    .history-sub {
      font-size: 0.8rem;
      color: var(--ink-3);
      margin: 2px 0 0 0;
    }

    .table-responsive {
      overflow-x: auto;
    }

    .history-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
      text-align: left;
    }

    .history-table th {
      padding: 8px 12px;
      color: var(--ink-3);
      font-weight: 700;
      font-size: 0.72rem;
      text-transform: uppercase;
      border-bottom: 1px solid var(--line);
    }

    .history-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      color: var(--ink);
    }

    .badge-trigger {
      background: var(--sunken);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
    }

    .status-pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 700;
    }

    .status-pill.success { background: #ecfdf5; color: #059669; }
    .status-pill.failed { background: #fee2e2; color: #dc2626; }

    .mini-checksum {
      font-size: 0.72rem;
      background: var(--sunken);
      padding: 2px 4px;
      border-radius: 3px;
    }

    .spinner-inline {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: currentColor;
      animation: spin 0.8s linear infinite;
      margin-right: 4px;
      vertical-align: middle;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
    }

    .modal-card {
      background: #ffffff;
      border-radius: var(--radius-lg);
      max-width: 720px;
      width: 100%;
      max-height: 85vh;
      overflow-y: auto;
      box-shadow: var(--shadow-lg);
      border: 1px solid var(--line);
    }

    .modal-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--line);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .modal-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--ink);
      margin: 0;
    }

    .close-btn {
      background: none;
      border: none;
      font-size: 1.5rem;
      color: var(--ink-3);
      cursor: pointer;
    }

    .modal-body {
      padding: 20px 24px;
    }

    .guide-box {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      padding: 12px 14px;
      color: #1e3a8a;
    }

    .sample-records {
      background: #0f172a;
      color: #f8fafc;
      padding: 14px;
      border-radius: 6px;
    }

    .json-viewer {
      margin: 0;
      font-family: monospace;
      font-size: 0.78rem;
      max-height: 320px;
      overflow: auto;
      white-space: pre-wrap;
    }

    .text-success { color: #059669; }
    .text-warning { color: #d97706; }
    .mt-8 { margin-top: 8px; }
    .mt-12 { margin-top: 12px; }
    .mt-16 { margin-top: 16px; }
    .mt-24 { margin-top: 24px; }
  `]
})
export class SourcesHealthComponent implements OnInit {
  private readonly documentsService = inject(DocumentsService);
  sources = signal<any[]>([]);
  health = signal<any | null>(null);
  recentRuns = signal<any[]>([]);
  inspectingSource = signal<any | null>(null);

  isSyncingAll = signal<boolean>(false);
  syncingSources = signal<Set<string>>(new Set());

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.documentsService.getComplianceSources().subscribe({
      next: (res) => {
        this.sources.set(res.sources || []);
        if (res.health) this.health.set(res.health);
        if (res.recentSyncRuns) this.recentRuns.set(res.recentSyncRuns);
      }
    });
  }

  isSyncingSource(sourceId: string): boolean {
    return this.syncingSources().has(sourceId);
  }

  syncSingleSource(sourceId: string): void {
    this.syncingSources.update((s) => new Set(s).add(sourceId));
    this.documentsService.syncSource(sourceId).subscribe({
      next: () => {
        this.syncingSources.update((s) => {
          const next = new Set(s);
          next.delete(sourceId);
          return next;
        });
        this.loadData();
      },
      error: () => {
        this.syncingSources.update((s) => {
          const next = new Set(s);
          next.delete(sourceId);
          return next;
        });
      }
    });
  }

  syncAllSources(): void {
    this.isSyncingAll.set(true);
    this.documentsService.syncAllSources().subscribe({
      next: () => {
        this.isSyncingAll.set(false);
        this.loadData();
      },
      error: () => {
        this.isSyncingAll.set(false);
      }
    });
  }

  openInspector(source: any): void {
    this.inspectingSource.set(source);
  }

  closeInspector(): void {
    this.inspectingSource.set(null);
  }

  getSampleRecordsJson(sourceId?: string): string {
    if (!sourceId) return '';
    const samples: Record<string, any[]> = {
      OFAC_SDN: [
        {
          uid: '1001',
          lastName: 'Vnesheconombank',
          sdnType: 'Entity',
          programList: ['RUSSIA-EO14024', 'UKRAINE-EO13662'],
          validFrom: '2022-02-22',
          remarks: 'State development corporation subject to full blocking sanctions.',
        },
        {
          uid: '1005',
          lastName: 'Al-Manar Petrochemicals FZE',
          sdnType: 'Entity',
          programList: ['IRAN-EO13846'],
          validFrom: '2026-07-10',
          remarks: 'Designated post-transaction for front-company brokering.',
        }
      ],
      UN_CONSOLIDATED: [
        {
          dataId: '2001',
          firstName: 'Democratic People Republic of Korea',
          secondName: 'Maritime Administration',
          unListType: 'Entity',
          referenceNumber: 'KPe.027',
          validFrom: '2016-03-02',
          committee: '1718 (DPRK Sanctions Committee)'
        }
      ],
      EU_FSF: [
        {
          euId: '3001',
          name: 'Promsyrioimport',
          entityType: 'enterprise',
          regulation: 'Council Regulation (EU) No 269/2014',
          validFrom: '2018-11-20',
          legalBasis: 'Official Journal L 294'
        }
      ],
      UK_SANCTIONS_LIST: [
        {
          uniqueId: '4001',
          name: 'United Shipbuilding Corporation',
          entityType: 'Entity',
          regime: 'Russia (Sanctions) (EU Exit) Regulations 2019',
          validFrom: '2022-03-15',
          sanctionsImposed: ['Asset freeze', 'Trust services sanctions']
        }
      ],
      SBP_TFS_LIST: [
        {
          proscriptionId: 'SBP-3001',
          name: 'Al-Akhtar Trust International',
          regulatoryAuthority: 'NACTA / Ministry of Foreign Affairs (MOFA)',
          statutoryFramework: 'Anti-Terrorism Act 1997 / UNSCR 1267',
          validFrom: '2003-10-14'
        }
      ],
      UN_COMTRADE_PRICING: [
        {
          benchmarkId: 'BENCH-COMTRADE-6205-COTTON-SHIRTS',
          category: 'Textiles, Garments & Apparel',
          productKey: 'apparel_cotton_woven_shirts',
          hsCodePrefix: '6205',
          benchmarkUnitPrice: 11.80,
          observedCorridor: '$8.50 - $16.50',
          currency: 'USD',
          unitOfMeasure: 'PCS',
          incotermBasis: 'FOB'
        }
      ],
      CENTRAL_BANK_FX: [
        { currency: 'USD', rateToUsd: 1.0 },
        { currency: 'EUR', rateToUsd: 0.92 },
        { currency: 'GBP', rateToUsd: 0.79 },
        { currency: 'PKR', rateToUsd: 278.5 }
      ],
      UN_LOCODE_PORTS: [
        { locode: 'PKKHI', name: 'Karachi Port', country: 'Pakistan', isSanctioned: false },
        { locode: 'GBFXT', name: 'Port of Felixstowe', country: 'United Kingdom', isSanctioned: false },
        { locode: 'IRBND', name: 'Bandar Abbas', country: 'Iran', isSanctioned: true }
      ]
    };

    return JSON.stringify(samples[sourceId] || samples['OFAC_SDN'], null, 2);
  }
}
