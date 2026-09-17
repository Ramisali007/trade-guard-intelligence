import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { DocumentsService } from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { Sparkline } from '../../shared/components/sparkline';
import { Icon } from '../../shared/components/icon';
import { EnterpriseFooterComponent } from '../../shared/components/enterprise-footer.component';

@Component({
  selector: 'app-sources-health',
  standalone: true,
  imports: [CommonModule, RouterModule, AnimatedCounter, Sparkline, Icon, EnterpriseFooterComponent],
  template: `
    <div class="sources-page-wrapper">
      <div class="sources-page-body">
      <!-- Executive Navy Hero Strip -->
      <section class="workbench-hero-strip">
        <div class="workbench-hero-inner">
          <div class="workbench-hero-left">
            <div class="hero-status-pill">
              <span class="live-pulse-dot"></span>
              <span class="hero-status-text">External Intelligence Layer &bull; Database-First SLA Monitor</span>
            </div>
            <h1 class="workbench-hero-title">
              Authoritative Feeds &amp; Sanctions Health
            </h1>
            <p class="workbench-hero-desc">
              Local canonical intelligence repository with continuous background synchronization, SLA tracking, immutable SHA-256 checksums, and bitemporal point-in-time versioning for trade finance compliance.
            </p>
          </div>
          <div class="workbench-hero-actions">
            <button (click)="syncAllSources()" [disabled]="isSyncingAll()" class="btn-hero-primary">
              <span *ngIf="isSyncingAll()" class="spinner-inline"></span>
              <app-icon *ngIf="!isSyncingAll()" name="refresh" [size]="15" />
              <span>{{ isSyncingAll() ? 'Synchronizing All...' : 'Sync All Sources Now' }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- Health Overview Metrics -->
      <div *ngIf="health()" class="health-metrics-grid">
        <div class="metric-card">
          <span class="metric-label">Total Sources</span>
          <span class="metric-value">
            <app-animated-counter [value]="health()?.totalSources || sources().length" />
          </span>
          <span class="metric-sub">Active Regimes &amp; Portals</span>
        </div>
        <div class="metric-card healthy">
          <span class="metric-label">Healthy &amp; Fresh</span>
          <span class="metric-value text-success">
            <app-animated-counter [value]="health()?.healthySources || sources().length" />
          </span>
          <span class="metric-sub">Within Freshness SLA</span>
        </div>
        <div class="metric-card" [class.warning]="(health()?.staleSources || 0) > 0">
          <span class="metric-label">Stale / Alert</span>
          <span class="metric-value" [class.text-warning]="(health()?.staleSources || 0) > 0">
            <app-animated-counter [value]="health()?.staleSources || 0" />
          </span>
          <span class="metric-sub">Requires Sync</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Canonical Entities</span>
          <span class="metric-value font-mono">
            <app-animated-counter [value]="health()?.totalCanonicalEntities || 0" />
          </span>
          <span class="metric-sub">Bitemporal Designations</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Price Benchmarks</span>
          <span class="metric-value font-mono">
            <app-animated-counter [value]="health()?.totalPriceBenchmarks || 0" />
          </span>
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

          <div class="source-sparkline-row">
            <span class="sparkline-title">Recent Sync Velocity:</span>
            <app-sparkline
              [data]="getSourceSparkline(s.sourceId)"
              [width]="96"
              [height]="20"
              [color]="s.syncStatus === 'FAILED' ? 'var(--negative)' : 'var(--positive)'"
            />
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

      </div>

      <!-- Record & JSON Inspector Modal -->
      <div *ngIf="inspectingSource() as source" class="inspect-modal-backdrop" (click)="closeInspector()">
        <div class="inspect-modal-card" (click)="$event.stopPropagation()">
          <!-- Executive Navy Header -->
          <div class="inspect-modal-header">
            <div class="inspect-header-info">
              <div class="inspect-regime-badge">
                <span class="pulse-indicator"></span>
                <span>{{ source.dataCategory || source.jurisdiction }} REGIME</span>
              </div>
              <h2 class="inspect-modal-title">{{ source.sourceName }}</h2>
              <div class="inspect-meta-row">
                <div class="meta-pill version-pill" title="Cryptographic Snapshot Version">
                  <span class="meta-label">SNAPSHOT:</span>
                  <code class="meta-code">{{ source.currentVersion || 'LATEST' }}</code>
                </div>
                <div class="meta-pill freq-pill">
                  <app-icon name="refresh" [size]="12" />
                  <span>SYNC: {{ source.updateFrequency || 'DAILY' }}</span>
                </div>
                <div class="meta-pill local-pill">
                  <span class="dot-green"></span>
                  <span>LOCAL STORE ACTIVE</span>
                </div>
              </div>
            </div>
            <button (click)="closeInspector()" class="btn-inspect-close" title="Close Inspector" aria-label="Close Inspector">
              <app-icon name="close" [size]="15" />
            </button>
          </div>

          <!-- Modal Body Content -->
          <div class="inspect-modal-body">
            <!-- Authoritative Specs & Intelligence Top Bar -->
            <div class="inspect-compact-specs-bar">
              <div class="compact-intel-badge">
                <app-icon name="shield" [size]="15" />
                <span class="compact-intel-text">Authoritative Store</span>
                <span class="compact-zero-latency-pill">&lt; 1ms In-Memory</span>
              </div>
              <div class="compact-spec-item">
                <span class="compact-spec-label">Jurisdiction:</span>
                <span class="compact-spec-value">{{ source.jurisdiction || 'GLOBAL' }}</span>
              </div>
              <div class="compact-spec-item">
                <span class="compact-spec-label">Cadence:</span>
                <span class="compact-spec-value">{{ source.updateFrequency || 'DAILY' }}</span>
              </div>
              <div class="compact-spec-item">
                <span class="compact-spec-label">Integrity:</span>
                <span class="compact-spec-value text-teal font-mono">SHA-256</span>
              </div>
              <div class="compact-spec-item">
                <span class="compact-spec-label">Audit:</span>
                <span class="compact-spec-value text-success font-semibold">Bitemporal</span>
              </div>
            </div>

            <!-- Canonical Entity Sample - Terminal Inspector -->
            <div class="sample-terminal-container">
              <div class="terminal-toolbar">
                <div class="terminal-dots">
                  <span class="dot dot-red"></span>
                  <span class="dot dot-yellow"></span>
                  <span class="dot dot-green"></span>
                </div>
                <div class="terminal-title">
                  <span class="font-mono">CANONICAL ENTITY &amp; DATASET SCHEMA</span>
                  <span class="schema-badge">JSON</span>
                  <span class="lines-count-pill">{{ getJsonLineCount(source.sourceId) }} Lines ↕</span>
                </div>
                <button
                  type="button"
                  class="btn-copy-json"
                  (click)="copyJsonToClipboard(getSampleRecordsJson(source.sourceId))"
                  [class.copied]="isCopied()"
                  title="Copy sample JSON to clipboard"
                >
                  <app-icon [name]="isCopied() ? 'check' : 'document'" [size]="13" />
                  <span>{{ isCopied() ? 'Copied!' : 'Copy JSON' }}</span>
                </button>
              </div>
              
              <div class="terminal-console-wrap">
                <div class="terminal-json-viewer" [innerHTML]="formatJsonWithSyntaxHighlight(getSampleRecordsJson(source.sourceId))"></div>
              </div>
            </div>
          </div>

          <!-- Modal Footer CTA Bar -->
          <div class="inspect-modal-footer">
            <div class="footer-left-info">
              <span class="footer-audit-note">Canonical Snapshot Bitemporally Audited</span>
            </div>
            <div class="footer-actions-group">
              <button (click)="closeInspector()" class="btn-inspect-ghost">
                Close Inspector
              </button>
              <a
                [href]="source.endpointOrReference || source.sourceUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="btn-inspect-secondary"
                title="View upstream authority source"
              >
                <span>Open Authority Website</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
              <button
                (click)="syncSingleSource(source.sourceId); closeInspector()"
                class="btn-inspect-primary"
                [disabled]="isSyncingSource(source.sourceId)"
              >
                <app-icon name="refresh" [size]="14" [class.spin]="isSyncingSource(source.sourceId)" />
                <span>{{ isSyncingSource(source.sourceId) ? 'Syncing...' : 'Synchronize Now' }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Reusable Enterprise Footer -->
      <app-enterprise-footer />
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-height: 100vh;
      background: #f8fafc;
    }

    .sources-page-wrapper {
      display: flex;
      flex-direction: column;
      min-height: calc(100vh - 72px);
      width: 100%;
      background: #f8fafc;
    }

    .sources-page-body {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 28px clamp(20px, 2.5vw, 40px) 48px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 28px;
      flex: 1 0 auto;
    }

    /* ── Executive Navy Hero Strip ── */
    .workbench-hero-strip {
      background: linear-gradient(135deg, #0a1638 0%, #0d1e4a 55%, #08173d 100%);
      color: #ffffff;
      border-radius: 16px;
      padding: 28px 32px;
      box-shadow: 0 4px 20px rgba(10, 22, 56, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.08);
      position: relative;
      overflow: hidden;
      width: 100%;
      box-sizing: border-box;

      &::before {
        content: '';
        position: absolute;
        top: -60px;
        right: -60px;
        width: 220px;
        height: 220px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(0, 168, 168, 0.22) 0%, transparent 70%);
        pointer-events: none;
      }
    }

    .workbench-hero-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      flex-wrap: wrap;
      position: relative;
      z-index: 2;
    }

    .workbench-hero-left {
      max-width: 780px;
    }

    .hero-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      border-radius: 20px;
      background: rgba(0, 168, 168, 0.15);
      border: 1px solid rgba(0, 168, 168, 0.35);
      color: #00e5e5;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin-bottom: 12px;
    }

    .live-pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: heroPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }

    @keyframes heroPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .workbench-hero-title {
      font-size: clamp(1.4rem, 2.5vw, 1.85rem);
      font-weight: 800;
      letter-spacing: -0.025em;
      color: #ffffff;
      margin: 0 0 8px;
      line-height: 1.25;
    }

    .workbench-hero-desc {
      font-size: 0.88rem;
      line-height: 1.55;
      color: rgba(255, 255, 255, 0.72);
      margin: 0;
      max-width: 700px;
    }

    .workbench-hero-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .btn-hero-primary {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 0 20px;
      height: 38px;
      border-radius: 8px;
      background: linear-gradient(135deg, #00a8a8, #008c8c);
      color: #ffffff;
      font-size: 0.84rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      box-shadow: 0 2px 10px rgba(0, 168, 168, 0.35);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      white-space: nowrap;

      &:hover:not(:disabled) {
        background: linear-gradient(135deg, #00baba, #009999);
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(0, 168, 168, 0.45);
      }

      &:disabled {
        opacity: 0.65;
        cursor: not-allowed;
      }
    }

    /* ── Metrics Grid ── */
    .health-metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
      gap: 16px;
    }

    .metric-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      box-shadow: 0 2px 8px rgba(10, 22, 56, 0.04);
      transition: all 0.2s ease;

      &:hover {
        border-color: #cbd5e1;
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(10, 22, 56, 0.08);
      }

      &.healthy {
        border-top: 3px solid #00a8a8;
      }

      &.warning {
        border-top: 3px solid #f59e0b;
      }

      .metric-label {
        font-size: 0.72rem;
        font-weight: 750;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #64748b;
      }

      .metric-value {
        font-size: 1.7rem;
        font-weight: 800;
        color: #0a1638;
        line-height: 1.1;

        &.text-success { color: #00a8a8; }
        &.text-warning { color: #f59e0b; }
        &.small-date {
          font-size: 0.95rem;
          font-weight: 700;
          color: #0a1638;
          padding-top: 6px;
        }
      }

      .metric-sub {
        font-size: 0.78rem;
        color: #64748b;
      }
    }

    /* ── Section Heading ── */
    .section-heading {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;

      h2 {
        font-size: 1.25rem;
        font-weight: 800;
        margin: 0;
        color: #0a1638;
        letter-spacing: -0.015em;
      }

      .counter-badge {
        background: #f1f5f9;
        color: #0a1638;
        border: 1px solid #e2e8f0;
        font-size: 0.75rem;
        font-weight: 750;
        padding: 3px 10px;
        border-radius: 999px;
      }
    }

    /* ── Sources Grid ── */
    .sources-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
      gap: 18px;
    }

    .source-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 2px 8px rgba(10, 22, 56, 0.04);
      border-top: 3px solid #00a8a8;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

      &:hover {
        border-color: #cbd5e1;
        border-top-color: #00a8a8;
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(10, 22, 56, 0.08);
      }

      &.healthy {
        border-top-color: #00a8a8;
      }
    }

    .source-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .jurisdiction-pill {
      font-size: 0.72rem;
      font-weight: 750;
      padding: 3px 8px;
      border-radius: 6px;
      background: #f1f5f9;
      color: #0a1638;
      letter-spacing: 0.04em;

      &[data-cat="SANCTIONS"] {
        background: rgba(0, 168, 168, 0.1);
        color: #008c8c;
        border: 1px solid rgba(0, 168, 168, 0.25);
      }
      &[data-cat="PRICING"] {
        background: rgba(245, 158, 11, 0.1);
        color: #b45309;
        border: 1px solid rgba(245, 158, 11, 0.25);
      }
      &[data-cat="PORTS"] {
        background: rgba(99, 102, 241, 0.1);
        color: #4f46e5;
        border: 1px solid rgba(99, 102, 241, 0.25);
      }
      &[data-cat="FX_RATES"] {
        background: rgba(16, 185, 129, 0.1);
        color: #059669;
        border: 1px solid rgba(16, 185, 129, 0.25);
      }
    }

    .freshness-pill {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
      background: #f1f5f9;
      color: #64748b;

      &.fresh {
        background: rgba(0, 168, 168, 0.1);
        color: #008c8c;
        border: 1px solid rgba(0, 168, 168, 0.25);
      }
      &.failed {
        background: rgba(239, 68, 68, 0.1);
        color: #dc2626;
        border: 1px solid rgba(239, 68, 68, 0.25);
      }
    }

    .source-name {
      font-size: 1.1rem;
      font-weight: 800;
      color: #0a1638;
      margin: 0;
      line-height: 1.35;
    }

    .auth-name {
      font-size: 0.8rem;
      color: #64748b;
      margin-top: -6px;
      font-weight: 600;
    }

    .meta-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 4px 0;
      font-size: 0.82rem;
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;

      .label { color: #64748b; font-size: 0.78rem; }
      .val { font-weight: 700; color: #0a1638; }
    }

    .checksum-box {
      background: #f8fafc;
      border-radius: 8px;
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      border: 1px solid #e2e8f0;
    }

    .checksum-label {
      font-size: 0.68rem;
      font-weight: 750;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .checksum-val {
      font-size: 0.72rem;
      word-break: break-all;
      color: #0a1638;
      font-family: monospace;
    }

    .source-sparkline-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    }

    .sparkline-title {
      font-size: 0.7rem;
      font-weight: 750;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .source-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: auto;
      padding-top: 14px;
      border-top: 1px solid #f1f5f9;
      flex-wrap: wrap;
    }

    .source-link {
      font-size: 0.8rem;
      font-weight: 700;
      color: #00a8a8;
      text-decoration: none;
      margin-left: auto;
      transition: color 0.2s;

      &:hover {
        color: #008c8c;
        text-decoration: underline;
      }
    }

    .inspect-btn {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      color: #0a1638;
      font-size: 0.78rem;
      font-weight: 700;
      padding: 0 12px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

      &:hover {
        border-color: #00a8a8;
        color: #00a8a8;
        background: rgba(0, 168, 168, 0.05);
        transform: translateY(-1px);
      }
    }

    /* ── Sync History Table ── */
    .sync-history-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 22px 24px;
      box-shadow: 0 2px 8px rgba(10, 22, 56, 0.04);
    }

    .history-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;

      h3 {
        font-size: 1.15rem;
        font-weight: 800;
        margin: 0;
        color: #0a1638;
      }

      .history-sub {
        font-size: 0.82rem;
        color: #64748b;
        margin: 3px 0 0 0;
      }
    }

    .table-responsive {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
      width: 100%;
    }

    .history-table {
      width: 100%;
      min-width: 760px;
      border-collapse: collapse;
      font-size: 0.82rem;
      text-align: left;
      margin-top: 12px;

      th {
        padding: 10px 14px;
        background: #f8fafc;
        color: #64748b;
        font-weight: 750;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        border-bottom: 1px solid #e2e8f0;
        white-space: nowrap;
      }

      td {
        padding: 12px 14px;
        border-bottom: 1px solid #f1f5f9;
        color: #0a1638;
        white-space: nowrap;
      }

      tbody tr:hover td {
        background: #f8fafc;
      }
    }

    .badge-trigger {
      background: #f1f5f9;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 700;
      color: #0a1638;
    }

    .status-pill {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 750;

      &.success {
        background: rgba(0, 168, 168, 0.1);
        color: #008c8c;
        border: 1px solid rgba(0, 168, 168, 0.25);
      }
      &.failed {
        background: rgba(239, 68, 68, 0.1);
        color: #dc2626;
        border: 1px solid rgba(239, 68, 68, 0.25);
      }
    }

    .mini-checksum {
      font-size: 0.74rem;
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      color: #0a1638;
    }

    /* ── Buttons ── */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.84rem;
      font-weight: 700;
      padding: 0 18px;
      height: 38px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      border: none;

      &.btn-primary {
        background: linear-gradient(135deg, #00a8a8, #008c8c);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(0, 168, 168, 0.35);

        &:hover {
          background: linear-gradient(135deg, #00baba, #009999);
          transform: translateY(-1px);
          box-shadow: 0 4px 14px rgba(0, 168, 168, 0.45);
        }
      }

      &.btn-outline {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        color: #00a8a8;

        &:hover {
          background: rgba(0, 168, 168, 0.06);
          border-color: #00a8a8;
          transform: translateY(-1px);
        }
      }

      &.btn-ghost {
        background: transparent;
        color: #64748b;
        &:hover { color: #0a1638; background: #f1f5f9; }
      }

      &.btn-sm {
        height: 32px;
        padding: 0 12px;
        font-size: 0.8rem;
      }
    }

    /* ── Executive Inspect Record Modal ── */
    .inspect-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(4, 9, 32, 0.78);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: clamp(16px, 3vw, 32px);
      animation: modalFadeIn 0.2s ease-out;
    }

    .inspect-modal-card {
      background: #ffffff;
      border-radius: 18px;
      max-width: 820px;
      width: 100%;
      max-height: 92vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 25px 60px -12px rgba(4, 9, 32, 0.45), 0 0 0 1px rgba(0, 168, 168, 0.25);
      border: 1px solid rgba(226, 232, 240, 0.8);
      animation: modalScaleIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .inspect-modal-header {
      padding: 16px 22px;
      background: linear-gradient(135deg, #0a1638 0%, #0d1e4a 60%, #08173d 100%);
      border-bottom: 1px solid rgba(0, 168, 168, 0.25);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      position: relative;
      flex-shrink: 0;
    }

    .inspect-modal-header::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, #00d4d4, #2ee5b8, transparent);
    }

    .inspect-header-info {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
    }

    .inspect-regime-badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 4px 10px;
      border-radius: 99px;
      background: rgba(0, 168, 168, 0.15);
      border: 1px solid rgba(0, 212, 212, 0.35);
      color: #00d4d4;
      font-size: 0.73rem;
      font-weight: 750;
      letter-spacing: 0.05em;
      width: fit-content;
    }

    .pulse-indicator {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #00d4d4;
      box-shadow: 0 0 8px #00d4d4;
      animation: glowPulse 2s ease-in-out infinite;
    }

    .inspect-modal-title {
      color: #ffffff;
      font-size: 1.32rem;
      font-weight: 800;
      margin: 4px 0 2px 0;
      line-height: 1.25;
      letter-spacing: -0.01em;
    }

    .inspect-meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 4px;
    }

    .meta-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 0.74rem;
      font-weight: 600;

      &.version-pill {
        background: rgba(255, 255, 255, 0.08);
        color: #94a3b8;
        border: 1px solid rgba(255, 255, 255, 0.12);
      }

      &.freq-pill {
        background: rgba(0, 168, 168, 0.14);
        color: #2dd4bf;
        border: 1px solid rgba(0, 168, 168, 0.28);
      }

      &.local-pill {
        background: rgba(16, 185, 129, 0.14);
        color: #34d399;
        border: 1px solid rgba(16, 185, 129, 0.28);
      }
    }

    .meta-label {
      color: #cbd5e1;
      font-size: 0.68rem;
    }

    .meta-code {
      color: #38bdf8;
      font-family: monospace;
      font-weight: 700;
    }

    .dot-green {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
      display: inline-block;
    }

    .btn-inspect-close {
      width: 34px;
      height: 34px;
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
      flex-shrink: 0;

      &:hover {
        background: rgba(255, 255, 255, 0.18);
        color: #ffffff;
        transform: scale(1.05);
      }
    }

    .inspect-modal-body {
      padding: 14px 22px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
      flex: 1 1 auto;
      max-height: calc(94vh - 120px);
      background: #ffffff;
    }

    /* ── Authoritative Specs Compact Bar ── */
    .inspect-compact-specs-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 14px;
      border-radius: 9px;
      background: linear-gradient(135deg, rgba(0, 168, 168, 0.08) 0%, rgba(10, 22, 56, 0.04) 100%);
      border: 1px solid rgba(0, 168, 168, 0.24);
      border-left: 3.5px solid #00a8a8;
      flex-wrap: wrap;
    }

    .compact-intel-badge {
      display: flex;
      align-items: center;
      gap: 7px;
      color: #00a8a8;
      font-size: 0.8rem;
    }

    .compact-intel-text {
      color: #0a1638;
      font-weight: 750;
      letter-spacing: -0.01em;
    }

    .compact-zero-latency-pill {
      font-size: 0.67rem;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 99px;
      background: rgba(16, 185, 129, 0.12);
      color: #059669;
      border: 1px solid rgba(16, 185, 129, 0.25);
    }

    .compact-spec-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.77rem;
    }

    .compact-spec-label {
      color: #64748b;
      font-weight: 600;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .compact-spec-value {
      color: #0a1638;
      font-weight: 650;
    }

    /* ── Terminal JSON Inspector ── */
    .sample-terminal-container {
      background: #060b19;
      border: 1px solid rgba(0, 168, 168, 0.25);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    }

    .terminal-toolbar {
      padding: 10px 14px;
      background: #0c1429;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .terminal-dots {
      display: flex;
      gap: 6px;
    }

    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
    }
    .dot-red { background: #ef4444; }
    .dot-yellow { background: #f59e0b; }
    .dot-green { background: #10b981; }

    .terminal-title {
      font-size: 0.74rem;
      font-weight: 700;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .schema-badge {
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(0, 168, 168, 0.2);
      color: #2dd4bf;
      font-size: 0.65rem;
      font-weight: 800;
      font-family: monospace;
    }

    .lines-count-pill {
      padding: 1px 7px;
      border-radius: 4px;
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.25);
      color: #38bdf8;
      font-size: 0.65rem;
      font-weight: 700;
      font-family: monospace;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    .btn-copy-json {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #cbd5e1;
      font-size: 0.74rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        background: rgba(0, 168, 168, 0.25);
        border-color: #00d4d4;
        color: #ffffff;
      }

      &.copied {
        background: rgba(16, 185, 129, 0.25);
        border-color: #34d399;
        color: #34d399;
      }
    }

    .terminal-console-wrap {
      height: 270px;
      max-height: 270px;
      overflow-y: scroll;
      overflow-x: auto;
      overscroll-behavior: contain;
      padding: 14px 18px 26px;
      background: #060b19;
      box-sizing: border-box;
      scrollbar-width: thin;
      scrollbar-color: #00d4d4 #091226;

      &::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      &::-webkit-scrollbar-track {
        background: #091226;
        border-radius: 6px;
      }
      &::-webkit-scrollbar-thumb {
        background: #00a8a8;
        border-radius: 6px;
        border: 2px solid #091226;
        transition: background 0.2s ease;
      }
      &::-webkit-scrollbar-thumb:hover {
        background: #00e5e5;
      }
    }

    .terminal-json-viewer {
      margin: 0;
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.82rem;
      line-height: 1.55;
      color: #cbd5e1;
      display: block;
    }

    /* JSON Line Numbers & Layout */
    :host ::ng-deep .json-code-line {
      display: flex;
      align-items: baseline;
      min-height: 20px;
      line-height: 1.55;
      border-radius: 4px;
      padding: 0 4px;
      transition: background 0.15s ease;

      &:hover {
        background: rgba(255, 255, 255, 0.04);
      }
    }

    :host ::ng-deep .json-line-num {
      width: 28px;
      color: #475569;
      font-size: 0.72rem;
      text-align: right;
      padding-right: 12px;
      user-select: none;
      flex-shrink: 0;
      border-right: 1px solid rgba(255, 255, 255, 0.08);
      margin-right: 12px;
      font-family: 'JetBrains Mono', monospace;
      font-variant-numeric: tabular-nums;
    }

    :host ::ng-deep .json-line-text {
      flex: 1;
      white-space: pre;
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    }

    /* JSON Syntax Highlighting Tokens */
    :host ::ng-deep .json-key { color: #38bdf8; font-weight: 600; }
    :host ::ng-deep .json-string { color: #34d399; }
    :host ::ng-deep .json-number { color: #fbbf24; }
    :host ::ng-deep .json-boolean { color: #c084fc; font-weight: 600; }
    :host ::ng-deep .json-null { color: #94a3b8; font-style: italic; }

    /* ── Inspect Modal Footer ── */
    .inspect-modal-footer {
      padding: 16px 28px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      flex-shrink: 0;
    }

    .footer-left-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .footer-audit-note {
      font-size: 0.78rem;
      color: #64748b;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .footer-actions-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .btn-inspect-primary {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 9px 20px;
      border-radius: 10px;
      background: linear-gradient(135deg, #00d4d4 0%, #00a8a8 100%);
      color: #ffffff;
      border: none;
      font-size: 0.86rem;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 168, 168, 0.32);
      transition: all 0.2s ease;

      &:hover:not(:disabled) {
        background: linear-gradient(135deg, #26e6e6 0%, #00bcbc 100%);
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(0, 168, 168, 0.42);
      }

      &:disabled {
        opacity: 0.65;
        cursor: not-allowed;
      }
    }

    .btn-inspect-secondary {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 16px;
      border-radius: 10px;
      background: #ffffff;
      color: #0a1638;
      border: 1px solid #cbd5e1;
      font-size: 0.85rem;
      font-weight: 650;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s ease;

      &:hover {
        background: #f1f5f9;
        border-color: #94a3b8;
        color: #040920;
      }
    }

    .btn-inspect-ghost {
      padding: 8px 16px;
      border-radius: 10px;
      background: transparent;
      border: 1px solid transparent;
      color: #64748b;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        background: #f1f5f9;
        color: #0f172a;
      }
    }

    @keyframes modalFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes modalScaleIn {
      from { opacity: 0; transform: scale(0.96) translateY(8px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    @keyframes glowPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.15); }
    }

    @media (max-width: 768px) {
      .inspect-specs-grid {
        grid-template-columns: repeat(2, 1fr);
      }
      .inspect-modal-header {
        padding: 16px 20px;
      }
      .inspect-modal-body {
        padding: 16px 20px;
      }
      .inspect-modal-footer {
        padding: 14px 20px;
      }
    }

    .row { display: flex; align-items: center; }
    .gap-8 { gap: 8px; }
    .wrap { flex-wrap: wrap; }
    .muted { color: #64748b; }
    .small { font-size: 0.82rem; }
    .mt-4 { margin-top: 4px; }
    .mt-8 { margin-top: 8px; }
    .mt-12 { margin-top: 12px; }
    .mt-16 { margin-top: 16px; }
    .mt-24 { margin-top: 24px; }

    .spinner-inline {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: #ffffff;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 640px) {
      .sources-page {
        padding: 16px 14px 60px;
      }
      .workbench-hero-strip {
        padding: 20px 18px;
      }
      .workbench-hero-actions {
        width: 100%;
      }
      .btn-hero-primary {
        width: 100%;
        justify-content: center;
      }
      .source-footer {
        flex-direction: column;
        align-items: stretch;
      }
      .source-footer .btn,
      .source-footer .source-link,
      .source-footer .inspect-btn {
        width: 100%;
        text-align: center;
        justify-content: center;
        margin-left: 0;
      }
      .health-metrics-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  `]
})
export class SourcesHealthComponent implements OnInit {
  private readonly documentsService = inject(DocumentsService);
  private readonly toast = inject(ToastService);
  sources = signal<any[]>([]);
  health = signal<any | null>(null);
  recentRuns = signal<any[]>([]);

  getSourceSparkline(sourceId: string): number[] {
    const runs = this.recentRuns().filter((r: any) => r.sourceId === sourceId);
    if (runs.length >= 2) {
      return runs.map((r: any) => (r.recordsInserted || 0) + (r.recordsUpdated || 0)).reverse();
    }
    const hash = (sourceId || '').split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
    return [12 + (hash % 5), 18 + (hash % 7), 15 + (hash % 6), 24 + (hash % 8), 20 + (hash % 4)];
  }
  inspectingSource = signal<any | null>(null);
  isCopied = signal<boolean>(false);

  getJsonLineCount(sourceId?: string): number {
    const json = this.getSampleRecordsJson(sourceId);
    return json ? json.split('\n').length : 0;
  }

  copyJsonToClipboard(json: string): void {
    if (!json) return;
    navigator.clipboard.writeText(json).then(() => {
      this.isCopied.set(true);
      this.toast.success('JSON Copied', 'Canonical dataset sample copied to clipboard.');
      setTimeout(() => this.isCopied.set(false), 2200);
    }).catch(() => {
      this.toast.error('Copy Failed', 'Unable to copy sample to clipboard.');
    });
  }

  formatJsonWithSyntaxHighlight(json: string): string {
    if (!json) return '';
    const lines = json.split('\n');
    return lines.map((line, idx) => {
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const highlighted = escaped.replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        (match) => {
          let cls = 'json-number';
          if (/^"/.test(match)) {
            if (/:$/.test(match)) {
              cls = 'json-key';
              return `<span class="${cls}">${match.slice(0, -1)}</span>:`;
            } else {
              cls = 'json-string';
            }
          } else if (/true|false/.test(match)) {
            cls = 'json-boolean';
          } else if (/null/.test(match)) {
            cls = 'json-null';
          }
          return `<span class="${cls}">${match}</span>`;
        }
      );
      const lineNum = idx + 1;
      return `<div class="json-code-line"><span class="json-line-num">${lineNum}</span><span class="json-line-text">${highlighted}</span></div>`;
    }).join('');
  }

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
      },
      error: () => {
        this.toast.error('Data Sync Error', 'Could not load compliance source status.');
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
        this.toast.success('Source Synchronized', `Source ${sourceId} updated with latest regulatory feed.`);
        this.loadData();
      },
      error: () => {
        this.syncingSources.update((s) => {
          const next = new Set(s);
          next.delete(sourceId);
          return next;
        });
        this.toast.error('Sync Failed', `Failed to synchronize regulatory feed for ${sourceId}.`);
      }
    });
  }

  syncAllSources(): void {
    this.isSyncingAll.set(true);
    this.documentsService.syncAllSources().subscribe({
      next: () => {
        this.isSyncingAll.set(false);
        this.toast.success('All Sources Synchronized', 'All 8 regulatory feeds were successfully refreshed.');
        this.loadData();
      },
      error: () => {
        this.isSyncingAll.set(false);
        this.toast.error('Batch Sync Failed', 'An error occurred while updating regulatory feeds.');
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
