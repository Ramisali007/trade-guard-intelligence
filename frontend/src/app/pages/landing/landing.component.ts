import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { DocumentsService } from '../../services/documents.service';
import type { HealthResponse } from '../../models/api.models';
import { Icon } from '../../shared/components/icon';

/** The home page: the hero and nothing below it. */
@Component({
  selector: 'app-landing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="landing-page">
      <!-- TradeGuard Full-Width Edge-to-Edge Hero Section -->
      <section class="hero-tradeguard">
        <div class="hero-tradeguard-overlay"></div>

        <div class="hero-tradeguard-container">
          <div class="hero-tradeguard-content">
            <div class="hero-tradeguard-eyebrow">
              <span>AI-Native Trade Finance Operations, Compliance &amp; TBML Intelligence Platform</span>
            </div>

            <h1 class="hero-tradeguard-heading">
              Future-Proofing<br>Trade Compliance
            </h1>

            <p class="hero-tradeguard-subheading">
              Transform trade finance operations, compliance, and detect complex trade-based money laundering (TBML) patterns with explainable AI and LLM-driven intelligence.
            </p>

            <!-- Dual Pill Action Buttons -->
            <div class="hero-tradeguard-actions">
              <button type="button" class="btn-pill btn-teal" (click)="auth.goToWorkbench()">
                <span>{{ auth.isLoggedIn() ? 'Open Dashboard' : 'Login' }}</span>
                <app-icon name="arrowRight" [size]="15" />
              </button>
            </div>


            <!-- Feature Capability Badges -->
            <div class="hero-tradeguard-badges">
              <span class="badge-item">
                <app-icon name="shield" [size]="14" />
                <span>Sanctions Screening</span>
              </span>
              <span class="badge-item">
                <app-icon name="alert" [size]="14" />
                <span>TBML Detection</span>
              </span>
              <span class="badge-item">
                <app-icon name="scale" [size]="14" />
                <span>Dual-Use Export Controls</span>
              </span>
              <span class="badge-item">
                <app-icon name="check" [size]="14" />
                <span>UCP 600 Automated Audit</span>
              </span>
              <span class="badge-item">
                <app-icon name="sparkle" [size]="14" />
                <span>ISO 20022 Engine</span>
              </span>
            </div>
            <!-- Engine Status Pill -->
            @if (health()?.engine) {
              <div class="hero-engine-pill">
                <span class="engine-indicator"></span>
                <app-icon name="cpu" [size]="12" />
                <span>{{ health()?.engine?.provider }} · {{ health()?.engine?.model }}</span>
                <span class="engine-sep">|</span>
                <span>Sanctions Dataset: OFAC · UN · EU · UK · SBP</span>
              </div>
            }

          </div>
        </div>
      </section>
    </div>
  `,
  styleUrl: './landing.component.scss',
})
export class LandingComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly docsService = inject(DocumentsService);

  readonly health = signal<HealthResponse | null>(null);

  ngOnInit(): void {
    this.docsService.health().subscribe({
      next: (h: HealthResponse) => this.health.set(h),
      error: () => {},
    });
  }
}
