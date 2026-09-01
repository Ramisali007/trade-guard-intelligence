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
              Official Authority Feed ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .sources-page {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      padding: 1.5rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    .header-card {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #f8fafc;
      padding: 1.75rem;
      border-radius: 12px;
      border: 1px solid #334155;
    }

    .badge-title {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .source-badge {
      background: #059669;
      color: #fff;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      letter-spacing: 0.05em;
    }

    .status-badge.live {
      background: rgba(16, 185, 129, 0.2);
      color: #34d399;
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }

    h1 {
      margin: 0 0 0.5rem 0;
      font-size: 1.6rem;
      font-weight: 700;
    }

    .subtitle {
      margin: 0;
      color: #94a3b8;
      font-size: 0.9rem;
      line-height: 1.4;
      max-width: 900px;
    }

    .sources-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
      gap: 1.25rem;
    }

    .source-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      border-top: 4px solid #cbd5e1;
    }

    .source-card.healthy {
      border-top-color: #059669;
    }

    .source-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .jurisdiction-pill {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      background: #f1f5f9;
      color: #334155;
    }

    .jurisdiction-pill[data-jur="US"] { background: #e0f2fe; color: #0369a1; }
    .jurisdiction-pill[data-jur="UN"] { background: #ede9fe; color: #6d28d9; }
    .jurisdiction-pill[data-jur="EU"] { background: #fef3c7; color: #92400e; }
    .jurisdiction-pill[data-jur="UK"] { background: #fee2e2; color: #991b1b; }
    .jurisdiction-pill[data-jur="PK"] { background: #ecfdf5; color: #065f46; }

    .health-pill {
      font-size: 0.7rem;
      font-weight: 700;
      color: #64748b;
    }

    .health-pill.healthy {
      color: #059669;
    }

    .source-name {
      margin: 0;
      font-size: 1rem;
      color: #0f172a;
      line-height: 1.3;
    }

    .auth-name {
      font-size: 0.8rem;
      color: #64748b;
    }

    .meta-list {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      background: #f8fafc;
      padding: 0.75rem;
      border-radius: 6px;
      font-size: 0.8rem;
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
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
      justify-content: flex-end;
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
  `]
})
export class SourcesHealthComponent implements OnInit {
  private readonly documentsService = inject(DocumentsService);
  sources = signal<any[]>([]);

  ngOnInit(): void {
    this.documentsService.getComplianceSources().subscribe({
      next: (res) => {
        this.sources.set(res.sources || []);
      }
    });
  }
}
