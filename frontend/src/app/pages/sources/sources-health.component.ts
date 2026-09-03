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
            <span class="source-badge">REGULATORY FEEDS</span>
            <span class="status-badge live">6 FEEDS ACTIVE</span>
          </div>
          <h1>Authoritative Regulatory Sources & Snapshot Registry</h1>
          <p class="subtitle">
            Live health, synchronization SLA tracking, immutable SHA-256 dataset checksums, and versioned snapshots for OFAC, UN, EU, UK, and SBP regulatory authorities.
          </p>
        </div>
      </div>

      <!-- Live Sources Grid -->
      <div class="sources-grid">
        <div *ngFor="let s of sources()" class="source-card" [class.healthy]="s.healthStatus === 'HEALTHY'">
          <div class="source-header">
            <div class="jurisdiction-pill" [attr.data-jur]="s.jurisdiction">
              {{ s.jurisdiction }} REGIME
            </div>
            <span class="health-pill" [class.healthy]="s.healthStatus === 'HEALTHY'">
              ● {{ s.healthStatus }}
            </span>
          </div>

          <h3 class="source-name">{{ s.sourceName }}</h3>
          <div class="auth-name">{{ s.regulatoryAuthority }}</div>

          <div class="meta-list">
            <div class="meta-row">
              <span class="label">Dataset Version:</span>
              <span class="val font-mono">{{ s.currentVersion }}</span>
            </div>
            <div class="meta-row">
              <span class="label">Total Records:</span>
              <span class="val">{{ s.recordCount | number }} active entities</span>
            </div>
            <div class="meta-row">
              <span class="label">Last Synced:</span>
              <span class="val">{{ s.retrievedAt | date:'medium' }}</span>
            </div>
            <div class="meta-row">
              <span class="label">Feed Type:</span>
              <span class="val">{{ s.sourceType }} ({{ s.datasetType }})</span>
            </div>
          </div>

          <div class="checksum-box">
            <span class="checksum-label">SHA-256 Provenance Checksum:</span>
            <code class="checksum-val">{{ s.checksumSha256 }}</code>
          </div>

          <div class="source-footer">
            <a [href]="s.sourceUrl" target="_blank" rel="noopener noreferrer" class="source-link">
              Official Public Portal ↗
            </a>
            <button (click)="openInspector(s)" class="inspect-btn">
              Inspect Records 👁
            </button>
          </div>
        </div>
      </div>

      <!-- Record & XML Inspector Modal -->
      <div *ngIf="inspectingSource()" class="modal-backdrop" (click)="closeInspector()">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div>
              <span class="chip">{{ inspectingSource()?.jurisdiction }} REGIME</span>
              <h2 class="modal-title mt-4">{{ inspectingSource()?.sourceName }}</h2>
              <div class="small muted">Snapshot Version: {{ inspectingSource()?.currentVersion }} | Format: {{ inspectingSource()?.sourceType }}</div>
            </div>
            <button (click)="closeInspector()" class="close-btn">&times;</button>
          </div>

          <div class="modal-body">
            <div class="guide-box">
              <strong>💡 How to read this Authority Feed:</strong>
              <p class="small mt-4">
                Regulatory authorities (such as the UN, OFAC, and EU) publish their official sanctions lists as structured <strong>XML/CSV/API feeds</strong> designed for automated compliance pipelines. TradeGuard Intelligence ingests and indexes these raw XML schemas into searchable bitemporal entity records shown below.
              </p>
            </div>

            <h4 class="mt-16">Parsed Snapshot Entities (Sample):</h4>
            <div class="sample-records mt-8">
              <pre class="json-viewer">{{ getSampleRecordsJson(inspectingSource()?.sourceId) }}</pre>
            </div>

            <div class="row gap-8 mt-16 wrap">
              <a [href]="inspectingSource()?.sourceUrl" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-primary">
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
      background: #ffffff;
      color: var(--ink);
      padding: 20px 24px;
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
      box-shadow: var(--shadow-sm);
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
      max-width: 900px;
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

    .jurisdiction-pill[data-jur="US"] { background: #e0f2fe; color: #0369a1; }
    .jurisdiction-pill[data-jur="UN"] { background: #ede9fe; color: #6d28d9; }
    .jurisdiction-pill[data-jur="EU"] { background: #fef3c7; color: #92400e; }
    .jurisdiction-pill[data-jur="UK"] { background: #fee2e2; color: #991b1b; }
    .jurisdiction-pill[data-jur="PK"] { background: #ecfdf5; color: #065f46; }

    .health-pill {
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--ink-3);
    }

    .health-pill.healthy {
      color: #10b981;
    }

    .source-name {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--ink);
      line-height: 1.3;
    }

    .auth-name {
      font-size: 0.82rem;
      color: var(--ink-3);
    }

    .meta-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      background: var(--sunken);
      padding: 14px 16px;
      border-radius: var(--radius-sm);
      font-size: 0.82rem;
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .meta-row .label {
      color: #475467;
      font-weight: 750;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .meta-row .val {
      color: var(--ink);
      font-weight: 600;
    }

    .checksum-box {
      background: var(--sunken);
      padding: 12px 14px;
      border-radius: var(--radius-sm);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .checksum-label {
      font-size: 0.72rem;
      font-weight: 750;
      color: #475467;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .checksum-val {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--ink);
      word-break: break-all;
    }

    .meta-row .label {
      color: #64748b;
    }

    .meta-row .val {
      font-weight: 600;
      color: #1e293b;
    }

    .font-mono {
      font-family: monospace;
    }

    .checksum-box {
      background: #f1f5f9;
      padding: 0.6rem;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .checksum-label {
      font-size: 0.65rem;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
    }

    .checksum-val {
      font-family: monospace;
      font-size: 0.7rem;
      color: #0f172a;
      word-break: break-all;
    }

    .source-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 0.5rem;
      border-top: 1px solid #f1f5f9;
    }

    .source-link {
      color: #0284c7;
      font-size: 0.75rem;
      font-weight: 600;
      text-decoration: none;
    }

    .source-link:hover {
      text-decoration: underline;
    }

    .inspect-btn {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .inspect-btn:hover {
      background: #e2e8f0;
      color: #0f172a;
    }

    /* Modal Styles */
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.7);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .modal-card {
      background: #ffffff;
      border-radius: 12px;
      width: 100%;
      max-width: 850px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      border: 1px solid #e2e8f0;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
    }

    .modal-title {
      font-size: 1.2rem;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
    }

    .close-btn {
      background: transparent;
      border: none;
      font-size: 1.5rem;
      color: #64748b;
      cursor: pointer;
      padding: 0 4px;
    }

    .modal-body {
      padding: 1.5rem;
    }

    .guide-box {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-left: 4px solid #3b82f6;
      padding: 12px 16px;
      border-radius: 6px;
      color: #1e3a8a;
    }

    .json-viewer {
      background: #0f172a;
      color: #38bdf8;
      padding: 14px 16px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 0.78rem;
      max-height: 320px;
      overflow: auto;
      white-space: pre-wrap;
    }
  `]
})
export class SourcesHealthComponent implements OnInit {
  private readonly documentsService = inject(DocumentsService);
  sources = signal<any[]>([]);
  inspectingSource = signal<any | null>(null);

  ngOnInit(): void {
    this.documentsService.getComplianceSources().subscribe({
      next: (res) => {
        this.sources.set(res.sources || []);
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
      BIS_ENTITY_LIST: [
        {
          licenseRequirement: 'For all items subject to the EAR',
          name: 'Baltic Navigation Electronics LLC',
          eccnControls: ['7A001', '7A003'],
          validFrom: '2024-05-01',
          federalRegisterNotice: '89 FR 34567'
        }
      ]
    };

    return JSON.stringify(samples[sourceId] || samples['OFAC_SDN'], null, 2);
  }
}
