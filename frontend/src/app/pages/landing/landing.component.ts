import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { DocumentsService } from '../../services/documents.service';
import { BlogService, BlogPost } from '../../services/blog.service';
import { ToastService } from '../../services/toast.service';
import type { HealthResponse } from '../../models/api.models';
import { Icon } from '../../shared/components/icon';
import { AnimatedCounter } from '../../shared/components/animated-counter';
export interface SolutionCard {
  id: string;
  title: string;
  desc: string;
  badge: string;
  features: string[];
  standards: string;
}

export interface CompanyPartner {
  id: string;
  name: string;
  role: string;
}

export interface TechPartner {
  id: string;
  name: string;
  category: string;
}

export interface ClientTestimonial {
  id: string;
  logoId: 'finastra' | 'nbp' | 'bank-abc' | 'coop-bank' | 'cib';
  quote: string;
  author: string;
  title: string;
  company: string;
}

@Component({
  selector: 'app-landing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, AnimatedCounter, RouterLink],
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
                <span>{{ auth.isLoggedIn() ? 'Open Workbench' : 'Login to Workbench' }}</span>
                <app-icon name="arrowRight" [size]="15" />
              </button>
              <button type="button" class="btn-pill btn-white-pill" (click)="openDemoVideo()">
                <span>Watch Demo</span>
              </button>
              <button type="button" class="btn-pill btn-white-pill" (click)="scrollToSolutions()">
                <span>Explore Solutions</span>
              </button>
            </div>


            <!-- Feature Capability Badges -->
            <div class="hero-tradeguard-badges">
              <span class="badge-item">
                <app-icon name="shield" [size]="12" />
                <span>Sanctions Screening</span>
              </span>
              <span class="badge-item">
                <app-icon name="alert" [size]="12" />
                <span>TBML Detection</span>
              </span>
              <span class="badge-item">
                <app-icon name="scale" [size]="12" />
                <span>Dual-Use Export Controls</span>
              </span>
              <span class="badge-item">
                <app-icon name="check" [size]="12" />
                <span>UCP 600 Automated Audit</span>
              </span>
              <span class="badge-item">
                <app-icon name="sparkle" [size]="12" />
                <span>ISO 20022 Engine</span>
              </span>
            </div>

            <!-- Optional Demo Video Preview -->
            @if (showDemoVideo()) {
              <div class="demo-video-wrapper">
                <div class="video-container">
                  <iframe 
                    [src]="currentVideoUrl()" 
                    title="TradeGuard Platform Overview" 
                    frameborder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowfullscreen>
                  </iframe>
                  <button type="button" class="close-video-btn" (click)="closeDemoVideo()" title="Close demo video">
                    <app-icon name="close" [size]="16" />
                  </button>
                </div>
              </div>
            }

            <!-- Engine Status Pill -->
            @if (health()) {
              <div class="hero-engine-pill">
                <span class="engine-indicator"></span>
                <app-icon name="cpu" [size]="12" />
                <span>{{ health()?.engine?.provider }} · {{ health()?.engine?.model }}</span>
                <span class="engine-sep">|</span>
                <span>Sanctions Dataset: OFAC · UN · EU · UK · SBP</span>
              </div>
            }

            <!-- Live Compliance Stats Ticker -->
            <div class="hero-tradeguard-ticker">
              <div class="ticker-col">
                <div class="ticker-val">
                  <app-animated-counter [value]="36" [duration]="1200" />
                </div>
                <span class="ticker-tag">Documents Ingested</span>
              </div>
              <div class="ticker-divider"></div>
              <div class="ticker-col">
                <div class="ticker-val text-teal">
                  <app-animated-counter [value]="14820" [duration]="1500" />
                </div>
                <span class="ticker-tag">Entities Screened</span>
              </div>
              <div class="ticker-divider"></div>
              <div class="ticker-col">
                <div class="ticker-val text-teal-bright">
                  <app-animated-counter [value]="99.6" [decimals]="1" suffix="%" [duration]="1400" />
                </div>
                <span class="ticker-tag">Compliance Precision</span>
              </div>
              <div class="ticker-divider"></div>
              <div class="ticker-col">
                <div class="ticker-val">
                  <app-animated-counter [value]="8" [duration]="800" suffix=" Regimes" />
                </div>
                <span class="ticker-tag">Sanctions Synced</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- InfoTech Group Corporate Partners & Clients Infinite Marquee Loop -->
      <section class="partners-clients-section">
        <div class="partners-header">
          <span class="partners-eyebrow">Our Clients</span>
          <p class="partners-subtitle">
            Trusted by global banks and enterprise partners, including leaders in trade and compliance.
          </p>
        </div>

        <div class="partners-marquee-wrap" role="region" aria-label="InfoTech Group Partner and Client Banks">
          <div class="partners-track">
            @for (partner of allPartners; track partner.id + '-' + $index) {
              <div class="partner-card" [title]="partner.name + ' · ' + partner.role">
                <div class="partner-logo-box" [attr.aria-label]="partner.name">
                  @switch (partner.id) {
                    @case ('finastra') {
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 4h7l5 8-5 8H4l5-8L4 4z" fill="#90268f"/><path d="M11 4h7l5 8-5 8h-7l5-8-5-8z" fill="#ff007a" opacity="0.88"/></svg>
                    }
                    @case ('ibm') {
                      <svg width="34" height="15" viewBox="0 0 60 25" fill="#1f70c1"><path d="M0 0h12v3H0zM0 5h12v3H0zM0 10h12v3H0zM0 15h12v3H0zM0 20h12v3H0zM20 0h18c4 0 7 2 7 6 0 2-1 4-3 5 3 1 4 3 4 6 0 4-3 6-8 6H20v-3h18c2 0 4-1 4-3s-2-3-4-3H20v-3h16c2 0 4-1 4-3s-2-3-4-3H20V0zM48 0h12v3H48zM48 5h12v3H48zM48 10h12v3H48zM48 15h12v3H48zM48 20h12v3H48z"/></svg>
                    }
                    @case ('microsoft') {
                      <svg width="22" height="22" viewBox="0 0 22 22"><rect width="10" height="10" fill="#f25022"/><rect x="12" width="10" height="10" fill="#7fba00"/><rect y="12" width="10" height="10" fill="#00a4ef"/><rect x="12" y="12" width="10" height="10" fill="#ffb900"/></svg>
                    }
                    @case ('oracle') {
                      <svg width="26" height="18" viewBox="0 0 32 20"><rect x="1.5" y="1.5" width="29" height="17" rx="8.5" fill="none" stroke="#f80000" stroke-width="3"/></svg>
                    }
                    @case ('huawei') {
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="#cf0a2c"><path d="M12 2C11 5 8 9 5 11c3 1 7 1 9-2 2 3 6 3 9 2-3-2-6-6-7-9z"/><circle cx="12" cy="16" r="2.5" fill="#cf0a2c"/></svg>
                    }
                    @case ('nbp') {
                      <svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#006633"/><path d="M12 7a5 5 0 100 10 6 6 0 110-10z" fill="#f8b612"/><polygon points="15,6 16,8 18,8 16.5,9.5 17,11.5 15,10 13,11.5 13.5,9.5 12,8 14,8" fill="#f8b612"/></svg>
                    }
                    @case ('bank-abc') {
                      <svg width="24" height="24" viewBox="0 0 24 24"><polygon points="3,21 12,3 21,21" fill="none" stroke="#004b87" stroke-width="2.5"/><circle cx="12" cy="14" r="3.5" fill="#f37021"/></svg>
                    }
                    @case ('cib') {
                      <svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 4h16v10c0 5-8 8-8 8s-8-3-8-8V4z" fill="#002d62"/><path d="M8 8h8v6c0 3-4 5-4 5s-4-2-4-5V8z" fill="#ff7900"/></svg>
                    }
                    @case ('rmb') {
                      <svg width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#001838"/><path d="M6 18V6h6c3 0 5 1.5 5 4s-2 4-5 4H9v4H6zm3-6h3c1.5 0 2.5-.7 2.5-2s-1-2-2.5-2H9v4z" fill="#f58220"/></svg>
                    }
                    @case ('gcb') {
                      <svg width="24" height="24" viewBox="0 0 24 24"><polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9" fill="#fdb813"/><circle cx="12" cy="12" r="3.2" fill="#006b3f"/></svg>
                    }
                    @case ('union-bank') {
                      <svg width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#002b66"/><path d="M6 18c2-4 3-8 6-9 2-1 5 1 6 3-1 2-2 4-4 4 1 2 2 4 2 6H6z" fill="#ffffff"/></svg>
                    }
                    @case ('coop-bank') {
                      <svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#005a36"/><path d="M7 12a5 5 0 0110 0v1H7v-1zm2 3h6v2H9v-2z" fill="#fabc0a"/></svg>
                    }
                    @case ('sbp') {
                      <svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#0a1a3a"/><circle cx="12" cy="12" r="8" fill="none" stroke="#d4af37" stroke-width="1.5"/><path d="M11 8a4 4 0 100 8 5 5 0 110-8z" fill="#d4af37"/></svg>
                    }
                    @case ('wai') {
                      <svg width="24" height="24" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3" fill="#00d4d4"/><circle cx="18" cy="6" r="3" fill="#00a8a8"/><circle cx="12" cy="18" r="3.5" fill="#4f6ef7"/><line x1="6" y1="6" x2="18" y2="6" stroke="#00d4d4" stroke-width="1.5"/><line x1="6" y1="6" x2="12" y2="18" stroke="#00d4d4" stroke-width="1.5"/><line x1="18" y1="6" x2="12" y2="18" stroke="#00a8a8" stroke-width="1.5"/></svg>
                    }
                    @case ('hbl') {
                      <svg width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#008269"/><polygon points="8,12 12,8 16,12 12,16" fill="#ffffff"/></svg>
                    }
                  }
                </div>
                <div class="partner-meta">
                  <span class="partner-name-text">{{ partner.name }}</span>
                  <span class="partner-role-badge">{{ partner.role }}</span>
                </div>
              </div>
            }
          </div>
        </div>
      </section>

      <!-- Solutions Showcase Section (Big Tech Enterprise Style) -->
      <section id="solutions" class="landing-solutions-section">
        <div class="landing-container">
          <div class="solutions-header-block">
            <div class="section-badge-pill">
              <span class="pulse-dot"></span>
              <span>Our Solutions</span>
            </div>
            <h2 class="solutions-main-heading">
              AI-Powered Trade Finance Solutions Automating Operations, Compliance, and TBML Intelligence Checks for Banks
            </h2>
            <div class="brand-heading-row">
              <h3 class="brand-title">TradeGuard<span class="reg-mark">®</span></h3>
              <span class="brand-tagline">AI-Native Compliance &amp; Operations</span>
            </div>
            <p class="solutions-desc-paragraph">
              TradeGuard® is our modular-by-design, native AI trade finance platform that enables digitization, automates document processing, strengthens compliance and TBML checks, and delivers end-to-end visibility across trade operations, allowing banks to deploy capabilities independently or as a unified intelligence layer.
            </p>
            <div class="solutions-btn-row">
              <button type="button" class="btn-bigtech-primary" (click)="onViewMore()">
                <span>View More</span>
                <app-icon name="arrowRight" [size]="14" />
              </button>
            </div>
          </div>

          <!-- 3x2 KPI Cards Grid (Matching Big Tech Standards & User Pictures) -->
          <div class="solutions-kpi-grid">
            @for (card of solutionCards; track card.id) {
              <div
                class="kpi-card"
                (click)="openSolutionDetails(card)"
                [attr.aria-label]="card.title + ' details'"
                role="button"
                tabindex="0"
              >
                <!-- Dot Matrix Wave Pattern Hover Layer (Reveals on hover as in Picture 2) -->
                <div class="kpi-card-pattern" aria-hidden="true"></div>
                <div class="kpi-card-glow-layer" aria-hidden="true"></div>

                <!-- Card Content Layer -->
                <div class="kpi-card-body">
                  <div class="kpi-card-header">
                    <h3 class="kpi-card-title">{{ card.title }}</h3>
                    <p class="kpi-card-desc">{{ card.desc }}</p>
                  </div>

                  <div class="kpi-card-footer">
                    <span class="kpi-card-link">
                      <span>Read More</span>
                      <svg class="link-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
            }
          </div>
        </div>
      </section>

      <!-- Solution Details Modal (World-Class Dark Obsidian Fintech Theme) -->
      @if (selectedSolution(); as sol) {
        <div class="modal-backdrop" (click)="closeSolutionDetails()">
          <div class="solution-modal-card" (click)="$event.stopPropagation()">
            <!-- Ambient Top Glow Orb -->
            <div class="modal-ambient-glow" aria-hidden="true"></div>

            <!-- Header with Category Chip, Title and Close Button -->
            <div class="modal-head">
              <div class="sol-head-cluster">
                <div class="sol-badge-wrap">
                  <span class="live-pulse-beacon"></span>
                  <span class="sol-modal-badge">{{ sol.badge }}</span>
                </div>
                <h3 class="sol-modal-title">{{ sol.title }}</h3>
              </div>
              <button
                type="button"
                class="modal-close-btn"
                (click)="closeSolutionDetails()"
                aria-label="Close modal"
                title="Close modal"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <!-- Body -->
            <div class="modal-body custom-scrollbar">
              <p class="sol-modal-lead">{{ sol.desc }}</p>

              <!-- Platform Capabilities -->
              <div class="sol-modal-section">
                <div class="section-eyebrow">
                  <app-icon name="sparkle" [size]="13" />
                  <span>Platform Capabilities</span>
                </div>
                <div class="feature-bullets">
                  @for (feat of sol.features; track feat) {
                    <div class="feat-card">
                      <div class="feat-check">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </div>
                      <span class="feat-text">{{ feat }}</span>
                    </div>
                  }
                </div>
              </div>

              <!-- Governing Standards & Frameworks -->
              <div class="sol-modal-section">
                <div class="section-eyebrow">
                  <app-icon name="shield-check" [size]="13" />
                  <span>Governing Standards &amp; Frameworks</span>
                </div>
                <div class="standards-chip-box">
                  <span class="standards-icon-chip">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  </span>
                  <span class="standards-mono-text">{{ sol.standards }}</span>
                </div>
              </div>
            </div>

            <!-- Footer with Close & Launch in Workbench -->
            <div class="modal-foot">
              <button type="button" class="btn-sol-ghost" (click)="closeSolutionDetails()">
                <span>Close</span>
              </button>
              <button type="button" class="btn-sol-launch" (click)="launchModule(sol)">
                <span>Launch in Workbench</span>
                <app-icon name="arrowRight" [size]="15" />
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Testimonials Section (TradeGuard Verified Client Reviews) -->
      <section class="testimonials-section">
        <div class="testimonials-ambient-pattern" aria-hidden="true"></div>
        <div class="landing-container">
          <div class="testimonials-header">
            <span class="testimonials-eyebrow">Testimonial</span>
            <h2 class="testimonials-main-title">
              Real Reviews from Our Clients<br>About TradeGuard® Results
            </h2>
          </div>

          <!-- Carousel Container with Side Navigation Arrows -->
          <div class="testimonial-carousel-wrapper">
            <!-- Left Arrow Button -->
            <button
              type="button"
              class="carousel-nav-btn prev"
              (click)="prevTestimonial()"
              aria-label="Previous review"
              title="Previous testimonial"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </button>

            <!-- Testimonial Card Display -->
            @if (currentTestimonial(); as t) {
              <div class="testimonial-card">
                <!-- 5 Stars Rating -->
                <div class="testimonial-stars" aria-label="5 out of 5 stars">
                  <span>★</span>
                  <span>★</span>
                  <span>★</span>
                  <span>★</span>
                  <span>★</span>
                </div>

                <!-- Quote Paragraph -->
                <blockquote class="testimonial-quote">
                  "{{ t.quote }}"
                </blockquote>

                <!-- Author & Client Info Row -->
                <div class="testimonial-bottom-row">
                  <div class="author-cluster">
                    <div class="author-avatar" [attr.aria-label]="t.company">
                      @switch (t.logoId) {
                        @case ('finastra') {
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M4 4h7l5 8-5 8H4l5-8L4 4z" fill="#90268f"/><path d="M11 4h7l5 8-5 8h-7l5-8-5-8z" fill="#ff007a" opacity="0.88"/></svg>
                        }
                        @case ('nbp') {
                          <svg width="28" height="28" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#006633"/><path d="M12 7a5 5 0 100 10 6 6 0 110-10z" fill="#f8b612"/><polygon points="15,6 16,8 18,8 16.5,9.5 17,11.5 15,10 13,11.5 13.5,9.5 12,8 14,8" fill="#f8b612"/></svg>
                        }
                        @case ('bank-abc') {
                          <svg width="28" height="28" viewBox="0 0 24 24"><polygon points="3,21 12,3 21,21" fill="none" stroke="#004b87" stroke-width="2.5"/><circle cx="12" cy="14" r="3.5" fill="#f37021"/></svg>
                        }
                        @case ('coop-bank') {
                          <svg width="28" height="28" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#005a36"/><path d="M7 12a5 5 0 0110 0v1H7v-1zm2 3h6v2H9v-2z" fill="#fabc0a"/></svg>
                        }
                        @case ('cib') {
                          <svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 4h16v10c0 5-8 8-8 8s-8-3-8-8V4z" fill="#002d62"/><path d="M8 8h8v6c0 3-4 5-4 5s-4-2-4-5V8z" fill="#ff7900"/></svg>
                        }
                      }
                    </div>
                    <div class="author-info">
                      <div class="author-name">{{ t.author }}</div>
                      <div class="author-title">{{ t.title }}, {{ t.company }}</div>
                    </div>
                  </div>

                  <!-- Big Stylized Quotation Mark SVG -->
                  <div class="quote-mark-icon" aria-hidden="true">
                    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 2.5-1.5 5-3 6"/>
                      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 2.5-1.5 5-3 6"/>
                    </svg>
                  </div>
                </div>
              </div>
            }

            <!-- Right Arrow Button -->
            <button
              type="button"
              class="carousel-nav-btn next"
              (click)="nextTestimonial()"
              aria-label="Next review"
              title="Next testimonial"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </button>
          </div>

          <!-- Pagination Indicator Dots -->
          <div class="testimonial-dots">
            @for (t of testimonials; track t.id; let idx = $index) {
              <button
                type="button"
                class="dot-pill"
                [class.active]="currentTestimonialIndex() === idx"
                (click)="goToTestimonial(idx)"
                [attr.aria-label]="'Go to testimonial ' + (idx + 1)"
              ></button>
            }
          </div>
        </div>
      </section>

      <!-- InfoTech Group Strategic Technology Partners Marquee Loop (Directly Below Testimonials) -->
      <section class="tech-partners-section">
        <div class="tech-partners-header">
          <span class="tech-partners-eyebrow">Our Partners</span>
        </div>

        <div class="tech-partners-marquee-wrap" role="region" aria-label="InfoTech Group Strategic Technology Partners">
          <div class="tech-partners-track">
            @for (partner of allTechPartners; track partner.id + '-' + $index) {
              <div class="tech-partner-card" [title]="partner.name + ' · ' + partner.category">
                <div class="tech-partner-logo" [attr.aria-label]="partner.name">
                  @switch (partner.id) {
                    @case ('ibm') {
                      <svg width="66" height="28" viewBox="0 0 100 40" fill="#1f70c1" aria-hidden="true">
                        <g>
                          <!-- I -->
                          <rect x="6" y="5" width="16" height="3"/>
                          <rect x="6" y="9.5" width="16" height="3"/>
                          <rect x="6" y="14" width="16" height="3"/>
                          <rect x="6" y="18.5" width="16" height="3"/>
                          <rect x="6" y="23" width="16" height="3"/>
                          <rect x="6" y="27.5" width="16" height="3"/>
                          <rect x="6" y="32" width="16" height="3"/>
                          <rect x="11.5" y="5" width="5" height="30"/>
                          <!-- B -->
                          <rect x="28" y="5" width="20" height="3"/>
                          <rect x="28" y="9.5" width="22" height="3"/>
                          <rect x="28" y="14" width="22" height="3"/>
                          <rect x="28" y="18.5" width="20" height="3"/>
                          <rect x="28" y="23" width="23" height="3"/>
                          <rect x="28" y="27.5" width="23" height="3"/>
                          <rect x="28" y="32" width="20" height="3"/>
                          <rect x="28" y="5" width="5.5" height="30"/>
                          <!-- M -->
                          <rect x="58" y="5" width="5.5" height="30"/>
                          <rect x="88.5" y="5" width="5.5" height="30"/>
                          <polygon points="63.5,5 69,5 76,17 83,5 88.5,5 78.5,22 73.5,22"/>
                          <rect x="58" y="5" width="36" height="3"/>
                          <rect x="58" y="9.5" width="36" height="3"/>
                          <rect x="58" y="14" width="36" height="3"/>
                          <rect x="58" y="18.5" width="36" height="3"/>
                          <rect x="58" y="23" width="36" height="3"/>
                          <rect x="58" y="27.5" width="36" height="3"/>
                          <rect x="58" y="32" width="36" height="3"/>
                        </g>
                      </svg>
                    }
                    @case ('cgi') {
                      <svg width="74" height="28" viewBox="0 0 95 36" fill="none" aria-hidden="true">
                        <text x="2" y="28" font-family="'Segoe UI', 'Arial Black', Impact, sans-serif" font-weight="900" font-size="31" fill="#e11932" letter-spacing="0.5">CGI</text>
                        <path d="M70 6 C82 6, 91 14, 91 23 C91 28, 86 31, 78 31 C71 31, 66 27, 68 24 C70 21, 74 23, 79 23 C84 23, 86 20, 85 17 C84 11, 76 9, 68 9 Z" fill="#e11932" opacity="0.95"/>
                      </svg>
                    }
                    @case ('cibar') {
                      <svg width="126" height="32" viewBox="0 0 156 40" fill="none" aria-hidden="true">
                        <g transform="translate(2, 4)">
                          <circle cx="16" cy="16" r="14" fill="#18181b"/>
                          <ellipse cx="16" cy="16" rx="6.5" ry="14" fill="none" stroke="#f4f4f5" stroke-width="1.2"/>
                          <line x1="2" y1="16" x2="30" y2="16" stroke="#f4f4f5" stroke-width="1.2"/>
                          <path d="M5 9 Q16 13 27 9" fill="none" stroke="#f4f4f5" stroke-width="1"/>
                          <path d="M5 23 Q16 19 27 23" fill="none" stroke="#f4f4f5" stroke-width="1"/>
                        </g>
                        <text x="40" y="22" font-family="'Times New Roman', Times, serif" font-weight="700" font-size="22" fill="#09090b" letter-spacing="0.5">Cibar</text>
                        <text x="41" y="32" font-family="'Segoe UI', Inter, sans-serif" font-weight="600" font-size="8" fill="#52525b" letter-spacing="0.3">Global Trade Finance</text>
                      </svg>
                    }
                    @case ('oracle') {
                      <svg width="114" height="26" viewBox="0 0 142 32" fill="none" aria-hidden="true">
                        <rect x="3" y="4" width="24" height="24" rx="12" fill="none" stroke="#ea1c24" stroke-width="4.2"/>
                        <text x="32" y="23.5" font-family="'Arial Black', Arial, Helvetica, sans-serif" font-weight="900" font-size="21" fill="#ea1c24" letter-spacing="3.2">RACLE</text>
                      </svg>
                    }
                    @case ('marinetraffic') {
                      <svg width="102" height="38" viewBox="0 0 120 46" fill="none" aria-hidden="true">
                        <g transform="translate(46, 2)">
                          <path d="M14 1 L21 7 L21 16 L14 24 L7 16 L7 7 Z" fill="#0284c7"/>
                          <polygon points="14,3 19,7 19,15 14,21 9,15 9,7" fill="#38bdf8"/>
                          <rect x="12" y="6" width="4" height="4.5" fill="#ffffff" rx="0.5"/>
                          <path d="M4 17 L24 17 L21 24 L7 24 Z" fill="#0369a1"/>
                          <circle cx="14" cy="11.5" r="1.8" fill="#ffffff"/>
                        </g>
                        <text x="60" y="39" text-anchor="middle" font-family="'Segoe UI', Inter, sans-serif" font-weight="700" font-size="11" fill="#0f172a" letter-spacing="0.3">MarineTraffic</text>
                      </svg>
                    }
                    @case ('dowjones') {
                      <svg width="120" height="28" viewBox="0 0 148 34" fill="none" aria-hidden="true">
                        <path d="M6 5 h11 a11 11 0 0 1 11 11 v2 a11 11 0 0 1 -11 11 h-11 z" fill="none" stroke="#0096a6" stroke-width="4.2" stroke-linejoin="round"/>
                        <text x="36" y="23" font-family="'Segoe UI', Arial, sans-serif" font-weight="850" font-size="16" fill="#132e3a" letter-spacing="1">DOW JONES</text>
                      </svg>
                    }
                    @case ('microsoft') {
                      <svg width="110" height="26" viewBox="0 0 135 32" fill="none" aria-hidden="true">
                        <rect x="2" y="5" width="10.5" height="10.5" fill="#f25022"/>
                        <rect x="14.5" y="5" width="10.5" height="10.5" fill="#7fba00"/>
                        <rect x="2" y="17.5" width="10.5" height="10.5" fill="#00a4ef"/>
                        <rect x="14.5" y="17.5" width="10.5" height="10.5" fill="#ffb900"/>
                        <text x="32" y="23.5" font-family="'Segoe UI', Inter, sans-serif" font-weight="600" font-size="17" fill="#505050" letter-spacing="-0.2">Microsoft</text>
                      </svg>
                    }
                    @case ('spglobal') {
                      <svg width="114" height="30" viewBox="0 0 140 38" fill="none" aria-hidden="true">
                        <line x1="12" y1="8" x2="128" y2="8" stroke="#18181b" stroke-width="2.5"/>
                        <text x="70" y="27" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-weight="850" font-size="17" fill="#c0001a" letter-spacing="0.2">S&amp;P Global</text>
                      </svg>
                    }
                    @case ('surecomp') {
                      <svg width="120" height="32" viewBox="0 0 145 38" fill="none" aria-hidden="true">
                        <circle cx="18" cy="19" r="14" fill="#002060"/>
                        <path d="M18 5 C24 11 24 27 18 33 C12 27 12 11 18 5 Z" fill="#ffffff" opacity="0.6"/>
                        <path d="M5 19 C11 24 25 24 31 19 C25 14 11 14 5 19 Z" fill="#60a5fa" opacity="0.45"/>
                        <text x="38" y="24" font-family="'Segoe UI', Inter, sans-serif" font-weight="700" font-size="15.5" fill="#0f172a" letter-spacing="0.2">Surecomp</text>
                      </svg>
                    }
                    @case ('finastra') {
                      <svg width="120" height="28" viewBox="0 0 145 34" fill="none" aria-hidden="true">
                        <path d="M6 7h8l6.5 10-6.5 10H6l6.5-10L6 7z" fill="#90268f"/>
                        <path d="M15 7h8l6.5 10-6.5 10h-8l6.5-10-6.5-10z" fill="#ff007a" opacity="0.9"/>
                        <text x="37" y="23" font-family="'Segoe UI', Inter, sans-serif" font-weight="800" font-size="15" fill="#2d133b" letter-spacing="1.2">FINASTRA</text>
                      </svg>
                    }
                    @case ('huawei') {
                      <svg width="114" height="28" viewBox="0 0 140 34" fill="none" aria-hidden="true">
                        <g transform="translate(6, 4) scale(0.68)">
                          <path d="M18 2C16 7 12 12 7 15c4 1 10 1 13-3 3 4 9 4 13 3-5-3-9-8-11-13z" fill="#cf0a2c"/>
                          <circle cx="18" cy="23" r="3.4" fill="#cf0a2c"/>
                        </g>
                        <text x="38" y="23" font-family="'Segoe UI', Arial, sans-serif" font-weight="800" font-size="15" fill="#cf0a2c" letter-spacing="2.5">HUAWEI</text>
                      </svg>
                    }
                    @case ('dassault') {
                      <svg width="124" height="28" viewBox="0 0 152 34" fill="none" aria-hidden="true">
                        <rect x="6" y="7" width="20" height="20" rx="4" fill="#00539b"/>
                        <path d="M11 17h10M16 12v10" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/>
                        <text x="32" y="22" font-family="'Segoe UI', Arial, sans-serif" font-weight="800" font-size="13" fill="#00539b" letter-spacing="0.5">3DS DASSAULT</text>
                      </svg>
                    }
                    @case ('wai') {
                      <svg width="124" height="28" viewBox="0 0 152 34" fill="none" aria-hidden="true">
                        <g transform="translate(6, 6) scale(0.72)">
                          <circle cx="6" cy="6" r="4.5" fill="#00d4d4"/>
                          <circle cx="24" cy="6" r="4.5" fill="#00a8a8"/>
                          <circle cx="15" cy="24" r="5" fill="#4f6ef7"/>
                          <line x1="6" y1="6" x2="24" y2="6" stroke="#00d4d4" stroke-width="2.2"/>
                          <line x1="6" y1="6" x2="15" y2="24" stroke="#00d4d4" stroke-width="2.2"/>
                          <line x1="24" y1="6" x2="15" y2="24" stroke="#00a8a8" stroke-width="2.2"/>
                        </g>
                        <text x="36" y="22" font-family="'Segoe UI', Inter, sans-serif" font-weight="800" font-size="14" fill="#0a1a3a">wAI <tspan font-weight="500" fill="#64748b">Industries</tspan></text>
                      </svg>
                    }
                  }
                </div>
              </div>
            }
          </div>
        </div>
      </section>

      <!-- About Us / Trade Finance Technology Showcase (Directly Below Our Partners Loop) -->
      <section class="about-showcase-section" id="about">
        <div class="landing-container">
          <div class="about-showcase-grid">
            <!-- Left Column: Story & Mission -->
            <div class="about-content-col">
              <span class="about-eyebrow">About Us</span>
              <h2 class="about-heading">
                Solving the Trade Finance Challenges with Proven Technology
              </h2>
              <p class="about-desc">
                Founded by global tech leaders with decades of entrepreneurial and digital systems experience, <strong>InfoTech Group</strong> builds <strong>TradeGuard®</strong> solutions that help financial institutions and enterprises stay agile, compliant, and adaptive across global trade corridors.
              </p>
              <div class="about-actions-row">
                <button type="button" class="btn-about-teal" (click)="scrollToSolutions()">
                  <span>Learn More</span>
                </button>
                <button type="button" class="btn-about-demo" (click)="playVideo()" title="Watch Trade Finance AI Demonstration">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6,3 20,12 6,21"></polygon>
                  </svg>
                  <span>Watch Demo</span>
                </button>
              </div>
            </div>

            <!-- Right Column: Interactive Video Card (100% InfoTech Group & TradeGuard Branding) -->
            <div class="about-video-col">
              <div class="about-video-card" [class.is-playing]="isVideoPlaying()">
                @if (!isVideoPlaying()) {
                  <div class="video-poster-backdrop">
                    <div class="video-poster-pattern"></div>
                    <div class="video-poster-glow"></div>

                    <!-- InfoTech Group & TradeGuard Branding -->
                    <div class="video-brand-row">
                      <!-- InfoTech Group -->
                      <div class="video-brand-item itg-brand">
                        <span class="itg-title">INFOTECH GROUP</span>
                        <span class="itg-sub">FINANCIAL TECHNOLOGIES · EST. 1995</span>
                      </div>

                      <!-- Center Play Button with Animated Ripple Pulse -->
                      <button
                        type="button"
                        class="video-play-btn"
                        (click)="playVideo()"
                        aria-label="Watch TradeGuard AI Automation Demonstration"
                        title="Click to play platform demonstration"
                      >
                        <div class="play-pulse-ring"></div>
                        <div class="play-btn-circle">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="6,3 20,12 6,21"></polygon>
                          </svg>
                        </div>
                      </button>

                      <!-- TradeGuard.ai by InfoTech Group -->
                      <div class="video-brand-item tg-brand">
                        <div class="tg-brand-symbol">
                          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                            <polygon points="3,3 21,3 12,21" fill="#00d4d4" opacity="0.95"></polygon>
                            <polygon points="3,3 12,21 3,21" fill="#008080"></polygon>
                          </svg>
                        </div>
                        <div class="tg-brand-text">
                          <span class="tg-title">TradeGuard<span class="tg-ai">®</span></span>
                          <span class="tg-sub">AI-Powered Compliance</span>
                        </div>
                      </div>
                    </div>

                    <!-- Video Caption / Quick Info Bar -->
                    <div class="video-caption-bar">
                      <div class="video-caption-left">
                        <span class="video-live-dot"></span>
                        <span class="video-title-text">TradeGuard® Intelligence — AI-Powered Trade Finance &amp; Compliance In Action</span>
                      </div>
                      <button type="button" class="video-duration-pill btn-pill-click" (click)="playVideo()" title="Play Platform Demonstration">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>
                        <span>Watch Demo</span>
                      </button>
                    </div>
                  </div>
                } @else {
                  <!-- Interactive Live AI Platform Showcase & Demonstration Video Player -->
                  <div class="video-player-container">
                    <div class="live-demo-topbar">
                      <div class="live-demo-status">
                        <span class="live-pulse-beacon"></span>
                        <span class="live-demo-title">TradeGuard® AI Engine · Interactive Showcase</span>
                      </div>

                      <div class="video-topbar-actions">
                        <!-- Video Selection Chips -->
                        <div class="video-selector-pills">
                          @for (v of availableVideos; track v.id) {
                            <button
                              type="button"
                              class="video-chip-btn"
                              [class.active]="selectedVideoId() === v.id"
                              (click)="selectVideo(v.id)"
                              [title]="v.title"
                            >
                              {{ v.category }}
                            </button>
                          }
                        </div>

                        <!-- Theater / Fullscreen Expand Button -->
                        <button
                          type="button"
                          class="video-action-btn"
                          (click)="openTheaterModal()"
                          title="Expand Theater View"
                          aria-label="Expand Theater View"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <polyline points="9 21 3 21 3 15"></polyline>
                            <line x1="21" y1="3" x2="14" y2="10"></line>
                            <line x1="3" y1="21" x2="10" y2="14"></line>
                          </svg>
                          <span>Theater</span>
                        </button>

                        <!-- Close Button -->
                        <button
                          type="button"
                          class="video-close-btn"
                          (click)="stopVideo()"
                          title="Close Demonstration"
                          aria-label="Close Demonstration"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                          <span>Close Demo</span>
                        </button>
                      </div>
                    </div>

                    <!-- Responsive Video Embed -->
                    <div class="video-iframe-holder">
                      <iframe
                        class="demo-youtube-iframe"
                        [src]="currentVideoUrl()"
                        title="TradeGuard Trade Finance AI Document Verification Demonstration"
                        frameborder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowfullscreen
                      ></iframe>
                    </div>

                    <!-- Bottom Bar -->
                    <div class="video-player-footer">
                      <div class="video-info-badge">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#00d4d4" stroke-width="2.2">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>Automated UCP 600 &amp; ISBP 745 Discrepancy Auditing in Action</span>
                      </div>
                      <button type="button" class="btn-demo-workbench" (click)="auth.goToWorkbench()">
                        <span>Open Workbench</span>
                        <app-icon name="arrowRight" [size]="13" />
                      </button>

                    </div>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Section 1: Awards & Recognition (Directly Below About Us) -->
      <section class="awards-recognition-section">
        <div class="landing-container">
          <div class="awards-header-block">
            <span class="awards-eyebrow">We Are Awarded Extensively by Our Peer Group</span>
            <h2 class="awards-main-heading">Trusted by Global Banks and Industry Leaders</h2>
            <p class="awards-desc-paragraph">
              Our AI trade finance solutions are adopted by leading financial institutions and recognised by industry peers. Integrated with ecosystems such as Microsoft Azure Marketplace and Finastra FusionFabric.cloud, the platform supports rapid adoption and deep integration into core banking workflows.
            </p>
          </div>

          <!-- Dark Awards & Recognition Card -->
          <div class="awards-card">
            <div class="awards-card-header">
              <span class="awards-card-title">Awards &amp; Recognition</span>
            </div>

            <div class="awards-badges-grid">
              <!-- 1. Everest Group Leading 50 2025 -->
              <div class="award-badge-item" title="Everest Group Leading 50 Financial Crime & Compliance Technology Providers 2025">
                <div class="everest-badge">
                  <div class="everest-top">
                    <svg width="22" height="16" viewBox="0 0 30 20" fill="none">
                      <polygon points="15,2 25,18 5,18" stroke="#ffffff" stroke-width="1.8" fill="none"/>
                      <polygon points="15,8 20,18 10,18" fill="#ffffff" opacity="0.6"/>
                    </svg>
                    <span class="everest-brand">Everest Group®</span>
                  </div>
                  <div class="everest-lead">LEADING</div>
                  <div class="everest-number">50</div>
                  <div class="everest-category">
                    FINANCIAL CRIME &amp; COMPLIANCE
                  </div>
                  <div class="everest-tech-label">Technology Providers</div>
                  <div class="everest-year-row">
                    <span class="everest-yr">2 0 2 5</span>
                    <span class="everest-subtag">Trade finance compliance</span>
                  </div>
                </div>
              </div>

              <!-- 2. Chartis Financial Crime and Compliance 50 2025 -->
              <div class="award-badge-item" title="Chartis Financial Crime and Compliance 50 2025">
                <div class="chartis-badge">
                  <div class="chartis-logo-row">
                    <div class="chartis-shield">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                      </svg>
                    </div>
                    <div class="chartis-titles">
                      <span class="chartis-name">Chartis</span>
                      <span class="chartis-award">Financial Crime and Compliance 50 2025</span>
                    </div>
                  </div>
                  <div class="chartis-company-name">TradeGuard® by InfoTech Group</div>
                  <div class="chartis-excellence">
                    Vertical and Segment Excellence: Trade Finance
                  </div>
                </div>
              </div>

              <!-- 3. GTR Leaders in Trade 2026 -->
              <div class="award-badge-item" title="GTR Leaders in Trade 2026 - Global Trade Review">
                <div class="gtr-ribbon-badge">
                  <div class="gtr-ribbon-body">
                    <div class="gtr-title-tag">GTR</div>
                    <div class="gtr-year">2026</div>
                    <div class="gtr-text-bold">Leaders</div>
                    <div class="gtr-text-sub">in Trade</div>
                  </div>
                  <div class="gtr-ribbon-tail"></div>
                </div>
              </div>

              <!-- 4. GTR Leaders in Trade 2025 -->
              <div class="award-badge-item" title="GTR Leaders in Trade 2025 - Global Trade Review">
                <div class="gtr-ribbon-badge gtr-2025">
                  <div class="gtr-ribbon-body">
                    <div class="gtr-title-tag">GTR</div>
                    <div class="gtr-year">2025</div>
                    <div class="gtr-text-bold">Leaders</div>
                    <div class="gtr-text-sub">in Trade</div>
                  </div>
                  <div class="gtr-ribbon-tail"></div>
                </div>
              </div>

              <!-- 5. Everest Group Leading 50 (AI Provider 2025) -->
              <div class="award-badge-item" title="Everest Group Leading 50 - Leading AI Engine 2025">
                <div class="everest-badge everest-ai">
                  <div class="everest-top">
                    <svg width="22" height="16" viewBox="0 0 30 20" fill="none">
                      <polygon points="15,2 25,18 5,18" stroke="#00d4d4" stroke-width="1.8" fill="none"/>
                      <polygon points="15,8 20,18 10,18" fill="#00d4d4" opacity="0.8"/>
                    </svg>
                    <span class="everest-brand">Everest Group®</span>
                  </div>
                  <div class="everest-lead">LEADING</div>
                  <div class="everest-number text-teal-num">50</div>
                  <div class="everest-category">
                    FINANCIAL CRIME &amp; COMPLIANCE
                  </div>
                  <div class="everest-tech-label">Technology Providers</div>
                  <div class="everest-year-row">
                    <span class="everest-yr">2 0 2 5</span>
                    <span class="everest-subtag">Leading AI Provider</span>
                  </div>
                </div>
              </div>

              <!-- 6. Chartis Market Distinction in Trade AML -->
              <div class="award-badge-item" title="Chartis Market Leader: Trade AML & Dual-Use Verification">
                <div class="chartis-badge chartis-leader">
                  <div class="chartis-logo-row">
                    <div class="chartis-shield">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00d4d4" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                      </svg>
                    </div>
                    <div class="chartis-titles">
                      <span class="chartis-name">Chartis</span>
                      <span class="chartis-award">RiskTech Trade Distinction</span>
                    </div>
                  </div>
                  <div class="chartis-company-name">TradeGuard® by InfoTech Group</div>
                  <div class="chartis-excellence">
                    Market Distinction: AI Trade AML &amp; Vessel Tracking
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ================================================================= -->
      <!-- FAQ SECTION (Frequently Asked Questions)                           -->
      <!-- ================================================================= -->
      <section class="faq-section" id="faq">
        <div class="landing-container">
          <div class="faq-header-block">
            <div class="section-badge-pill">
              <span class="pulse-dot"></span>
              <span>FAQ</span>
            </div>
            <h2 class="faq-main-heading">Frequently Asked Questions</h2>
            <p class="faq-desc-text">
              Everything you need to know about TradeGuard® Intelligence Platform, trade finance compliance, and AI-powered automation.
            </p>
          </div>

          <div class="faq-accordion-list">
            @for (faq of faqItems; track faq.id; let idx = $index) {
              <div class="faq-accordion-item" [class.open]="activeFaqIndex() === idx">
                <button
                  type="button"
                  class="faq-accordion-trigger"
                  (click)="toggleFaq(idx)"
                  [attr.aria-expanded]="activeFaqIndex() === idx"
                  [attr.aria-controls]="'faq-panel-' + idx"
                >
                  <div class="faq-q-row">
                    <span class="faq-number">{{ (idx + 1).toString().padStart(2, '0') }}</span>
                    <span class="faq-question-text">{{ faq.question }}</span>
                  </div>
                  <span class="faq-chevron" [class.rotated]="activeFaqIndex() === idx">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </span>
                </button>
                @if (activeFaqIndex() === idx) {
                  <div class="faq-accordion-panel" [id]="'faq-panel-' + idx">
                    <p class="faq-answer-text">{{ faq.answer }}</p>
                  </div>
                }
              </div>
            }
          </div>
        </div>
      </section>

      <!-- Section 2: Resource Hub / Latest Blogs (Directly Below FAQ) -->
      <section class="latest-blogs-section" id="blogs">
        <div class="landing-container">
          <div class="blogs-header-row">
            <div class="blogs-header-left">
              <span class="blogs-eyebrow">Resource Hub</span>
              <h2 class="blogs-main-heading">Latest Blogs</h2>
              <p class="blogs-desc-text">
                Expert insights on trade finance, compliance, and AI-powered automation supporting next-generation trade finance solutions.
              </p>
            </div>
          </div>

          <!-- Carousel with Side Navigation Arrows and 3 Visible Cards -->
          <div class="blogs-carousel-wrapper">
            <!-- Previous Button -->
            <button
              type="button"
              class="blog-nav-btn prev"
              (click)="prevBlog()"
              aria-label="Previous blog articles"
              title="Previous articles"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>

            <!-- 3 Visible Blog Cards -->
            <div class="blogs-cards-track">
              @for (blog of visibleBlogs(); track blog.id) {
                <div class="blog-card" (click)="openBlogModal(blog)">
                  <!-- Blog Cover Card Banner with Topic Image & Contrast Overlay -->
                  <div class="blog-card-cover">
                    <img [src]="blog.imageUrl" [alt]="blog.title" class="blog-cover-img" loading="lazy" />
                    <div class="blog-cover-gradient"></div>
                    <div class="blog-cover-badge">
                      <span class="badge-dot"></span>
                      <span>{{ blog.category }}</span>
                    </div>

                    <div class="blog-cover-center">
                      <h4 class="blog-cover-title">{{ blog.title }}</h4>
                    </div>

                    <div class="blog-cover-author-strip">
                      <span class="blog-cover-author">{{ blog.author }}</span>
                      <span class="blog-cover-brand">TradeGuard® · InfoTech Group</span>
                    </div>
                  </div>

                  <!-- Blog Card Content Body -->
                  <div class="blog-card-body">
                    <div class="blog-meta-row">
                      <span class="blog-date">{{ blog.date }}</span>
                      <span class="blog-dot-sep">·</span>
                      <span class="blog-time">{{ blog.readTime }}</span>
                    </div>
                    <h3 class="blog-card-heading">{{ blog.title }}</h3>
                    <p class="blog-card-desc">{{ blog.excerpt }}</p>
                    <div class="blog-card-bottom">
                      <a class="blog-read-link" [routerLink]="['/blog', blog.id]" (click)="$event.stopPropagation()">Read More &raquo;</a>
                    </div>
                  </div>
                </div>
              }
            </div>

            <!-- Next Button -->
            <button
              type="button"
              class="blog-nav-btn next"
              (click)="nextBlog()"
              aria-label="Next blog articles"
              title="Next articles"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>

          <!-- Pagination Indicator Dots (for all 6 blogs) -->
          <div class="blog-pagination-dots">
            @for (dot of [0, 1, 2, 3]; track dot) {
              <button
                type="button"
                class="blog-dot-pill"
                [class.active]="currentBlogIndex() === dot"
                (click)="goToBlog(dot)"
                [attr.aria-label]="'Go to blog slide ' + (dot + 1)"
              ></button>
            }
          </div>
        </div>

        <!-- Full Blog Reader Modal Dialog (Enterprise Architecture Reference Design) -->
        @if (selectedBlog(); as blog) {
          <div class="blog-modal-backdrop ambient-bg" (click)="closeBlogModal()">
            <!-- Outer Wrapper simulating high-end enterprise modal overlay -->
            <div class="article-modal-wrapper shadow-modal" (click)="$event.stopPropagation()" data-purpose="article-modal-wrapper">
              <!-- Top Action & Pill Navigation Bar -->
              <header class="modal-header-nav">
                <div class="header-nav-left">
                  <!-- Core Category Pill -->
                  <span class="category-pill-active">
                    <span class="pulse-dot"></span>
                    {{ blog.category }}
                  </span>
                  <span class="header-series-tag">Enterprise Intelligence Series</span>
                </div>

                <!-- Header Utilities & Dismiss Button -->
                <div class="header-nav-right">
                  <button type="button" aria-label="Share article" class="header-util-btn" (click)="shareArticle(blog)" title="Share article link">
                    <svg class="util-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
                    </svg>
                  </button>
                  <button type="button" aria-label="Bookmark article" class="header-util-btn" (click)="toggleBookmark(blog.id)" [class.bookmarked]="isBookmarked(blog.id)" [title]="isBookmarked(blog.id) ? 'Remove bookmark' : 'Bookmark article'">
                    <svg class="util-svg" [attr.fill]="isBookmarked(blog.id) ? 'currentColor' : 'none'" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
                    </svg>
                  </button>
                  <div class="header-util-divider"></div>
                  <button type="button" aria-label="Close modal" class="header-util-btn close-btn" (click)="closeBlogModal()" title="Close article">
                    <svg class="util-svg close-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
                    </svg>
                  </button>
                </div>
              </header>

              <!-- Article Content Area -->
              <article class="modal-article-scroll custom-scrollbar">
                <!-- Byline & Publish Date Metadata -->
                <section class="article-meta-bar" data-purpose="metadata-section">
                  <span class="meta-date">{{ blog.date }}</span>
                  <span class="meta-dot">•</span>
                  <span class="meta-read-time">
                    <svg class="meta-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
                    </svg>
                    {{ blog.readTime }}
                  </span>
                  <span class="meta-dot">•</span>
                  <!-- Author with dynamic advisor pill -->
                  <div class="meta-author-wrap">
                    <div class="author-avatar-badge">
                      {{ getAuthorInitials(blog.author) }}
                    </div>
                    <span class="author-link-text">
                      {{ blog.author }} <span class="author-role-sub">({{ blog.authorRole }})</span>
                    </span>
                  </div>
                </section>

                <!-- Main Headline -->
                <h1 class="article-main-headline">
                  {{ blog.title }}
                </h1>

                <!-- Metadata Topic Tags -->
                <div class="topic-tags-cloud" data-purpose="tag-cloud">
                  @for (tag of blog.tags; track tag) {
                    <a class="topic-tag-chip" [routerLink]="['/blog', blog.id]" (click)="closeBlogModal()">
                      #{{ tag }}
                    </a>
                  }
                </div>

                <!-- Core Narrative & Text Excerpts -->
                <div class="article-body-copy">
                  @for (para of blog.content; track $index) {
                    <p [class.lead-para]="$index === 0">
                      {{ para }}
                    </p>
                  }
                </div>

                <!-- Interactive Schema / Architecture Transformation Card -->
                <section class="architecture-card" data-purpose="transformation-diagram">
                  <!-- Ambient decorative blur effect -->
                  <div class="arch-glow"></div>
                  <div class="arch-header">
                    <div>
                      <span class="arch-eyebrow">Real-Time Data Pipeline</span>
                      <h2 class="arch-title">Bi-Directional Schema Transformation</h2>
                    </div>
                    <div class="arch-stats">
                      <span class="stp-badge">
                        <span class="ping-dot"></span>
                        STP: 99.98%
                      </span>
                      <span class="latency-tag">Latency &lt; 8.4ms</span>
                    </div>
                  </div>

                  <!-- Comparative Flow Grid -->
                  <div class="arch-flow-grid">
                    <!-- Legacy Payload Box -->
                    <div class="payload-box">
                      <div class="payload-head">
                        <span class="payload-label">Legacy SWIFT MT700</span>
                        <span class="payload-tag">FIN Protocol</span>
                      </div>
                      <p class="payload-code">
                        :20: TRAD-2026-X819<br />
                        :27: 1/1<br />
                        :40A: IRREVOCABLE<br />
                        :31D: 260331US<br />
                        :50: GLOBAL TEXTILES CORP<br />
                        :59: ASIA TECH LOGISTICS HK
                      </p>
                    </div>

                    <!-- Transformation Engine Center Indicator -->
                    <div class="flow-arrow-wrap">
                      <div class="arrow-circle">
                        <svg class="flow-arrow-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M14 5l7 7m0 0l-7 7m7-7H3" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
                        </svg>
                      </div>
                    </div>

                    <!-- ISO 20022 MX Target Box -->
                    <div class="payload-box target-box">
                      <div class="payload-head target-head">
                        <span class="payload-label target-label">ISO 20022 tsmt.019 / pacs</span>
                        <span class="payload-tag target-tag">XML Verified</span>
                      </div>
                      <p class="payload-code target-code">
                        &lt;Doc:Initr&gt;Global Textiles&lt;/Doc:Initr&gt;<br />
                        &lt;Doc:StsCd&gt;ACPT&lt;/Doc:StsCd&gt;<br />
                        &lt;Doc:TradAmt Ccy="USD"&gt;24,800,000&lt;/Doc:TradAmt&gt;<br />
                        &lt;Doc:TBMLChk status="PASSED" id="tg_90a"/&gt;
                      </p>
                    </div>
                  </div>
                </section>

                <!-- Call to Action Banner / Product Announcement -->
                <section class="article-cta-card" data-purpose="cta-card">
                  <div class="cta-inner">
                    <!-- Product Name & Positioning -->
                    <div class="cta-info">
                      <div class="cta-title-row">
                        <h3 class="cta-heading">
                          TradeGuard® <span class="cta-subbrand">by InfoTech Group</span>
                        </h3>
                        <span class="cta-badge-enterprise">Enterprise</span>
                      </div>
                      <p class="cta-tagline">
                        AI-Powered Trade Finance Operations, Compliance &amp; TBML Intelligence
                      </p>
                    </div>

                    <!-- Buttons Group -->
                    <div class="cta-buttons">
                      <a class="btn-cta-secondary" [routerLink]="['/blog', blog.id]" (click)="closeBlogModal()">
                        View Full Article &amp; White Paper
                      </a>
                      <button class="btn-cta-primary" type="button" (click)="closeBlogModal(); auth.openLoginModal()">
                        <span>Launch Trade Workbench</span>
                        <svg class="btn-arrow-icon" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M13 7l5 5m0 0l-5 5m5-5H6" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                </section>

                <!-- Footer Accreditation -->
                <footer class="modal-article-footer">
                  <div>ISO 20022 Migration Ready • Finastra Fusion Certified • SWIFT Certified Application</div>
                  <div class="footer-copy-sub">© 2026 InfoTech Group. All rights reserved.</div>
                </footer>
              </article>
            </div>
          </div>
        }
      </section>

      <!-- ================================================================= -->
      <!-- CONTACT & SEE AI IN ACTION CONVERSION CTA                         -->
      <!-- ================================================================= -->
      <section class="contact-cta-section" id="contact">
        <div class="contact-cta-bg-overlay"></div>
        <div class="contact-cta-container">
          <!-- Left Column: Copy & Actions -->
          <div class="contact-cta-left">
            <span class="contact-eyebrow">Contact Us</span>
            <h2 class="contact-headline">See AI in Action</h2>
            <p class="contact-subtext">
              Discover how TradeGuard® Intelligence processes trade transactions end-to-end,
              detects TBML risk, and automates compliance with complete transparency.
            </p>
            <div class="contact-cta-actions">
              <button type="button" class="btn-pill-navy" (click)="auth.openLoginModal()">
                <span>Request Demo</span>
              </button>
              <button type="button" class="btn-pill-white" (click)="focusContactForm()">
                <span>Contact Us</span>
              </button>
            </div>
          </div>

          <!-- Right Column: Glassmorphic Interactive Contact Form -->
          <div class="contact-cta-right">
            <form class="contact-glass-form" (submit)="submitContact($event)">
              @if (contactSubmitted()) {
                <div class="contact-success-box">
                  <div class="success-icon-badge">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00a8a8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                      <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                  </div>
                  <h4 class="success-title">Inquiry Sent Successfully!</h4>
                  <p class="success-desc">
                    Thank you for reaching out. InfoTech Group's trade finance and compliance advisory team will contact you within 24 hours.
                  </p>
                  <button type="button" class="btn-reset-contact" (click)="contactSubmitted.set(false)">
                    <span>Send Another Inquiry</span>
                  </button>
                </div>
              } @else {
                <div class="form-group-pill">
                  <input
                    #emailInput
                    type="email"
                    class="pill-input"
                    placeholder="Email"
                    [value]="contactEmail()"
                    (input)="contactEmail.set($any($event.target).value)"
                    required
                  />
                </div>

                <div class="form-group-pill">
                  <textarea
                    rows="3"
                    class="pill-textarea"
                    placeholder="Message"
                    [value]="contactMessage()"
                    (input)="contactMessage.set($any($event.target).value)"
                    required
                  ></textarea>
                </div>

                <!-- Simulated Interactive reCAPTCHA Box (Matches User Screenshot) -->
                <div class="recaptcha-card">
                  <label class="recaptcha-checkbox-label">
                    <input
                      type="checkbox"
                      class="recaptcha-native-checkbox"
                      [checked]="isCaptchaChecked()"
                      (change)="toggleCaptcha()"
                    />
                    <span class="recaptcha-custom-box" [class.checked]="isCaptchaChecked()">
                      @if (isCaptchaChecked()) {
                        <svg viewBox="0 0 24 24" class="recaptcha-check-svg">
                          <path d="M5 13l4 4L19 7" fill="none" stroke="#00a8a8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      }
                    </span>
                    <span class="recaptcha-label-text">I'm not a robot</span>
                  </label>

                  <div class="recaptcha-badge-col">
                    <svg class="recaptcha-logo-svg" viewBox="0 0 24 24" width="26" height="26">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="#0284c7" />
                    </svg>
                    <span class="recaptcha-text">reCAPTCHA</span>
                    <span class="recaptcha-subtext">Privacy - Terms</span>
                  </div>
                </div>

                @if (contactError()) {
                  <div class="contact-error-msg">{{ contactError() }}</div>
                }

                <button type="submit" class="btn-form-send">
                  <span>Send</span>
                </button>
              }
            </form>
          </div>
        </div>
      </section>

      <!-- ================================================================= -->
      <!-- ENTERPRISE MULTI-COLUMN DARK FOOTER (100% InfoTech & TradeGuard)  -->
      <!-- ================================================================= -->
      <footer class="landing-enterprise-footer">
        <div class="footer-dot-backdrop"></div>
        <div class="footer-container">
          <!-- Column 1: Brand & Socials -->
          <div class="footer-col footer-col-brand">
            <div class="footer-brand-logo">
              <div class="brand-shield-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L3 7V13C3 18.5 6.8 23.7 12 25C17.2 23.7 21 18.5 21 13V7L12 2Z" fill="#00d4d4" opacity="0.2" />
                  <path d="M12 3L4 7.5V13C4 18 7.4 22.6 12 23.8C16.6 22.6 20 18 20 13V7.5L12 3Z" stroke="#00e5e5" stroke-width="2" stroke-linejoin="round" />
                  <path d="M9 12.5L11 14.5L15 10.5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </div>
              <div class="brand-text-wrap">
                <span class="brand-name">TradeGuard<span class="brand-tld">.ai</span></span>
                <span class="brand-sub">by InfoTech Group</span>
              </div>
            </div>

            <p class="footer-brand-tagline">Future Proof Trade Finance</p>
            <a href="mailto:info@infotechgroup.com" class="footer-contact-link">Email: info&#64;infotechgroup.com</a>

            <div class="footer-social-row">
              <a href="https://infotechgroup.com" target="_blank" rel="noopener noreferrer" class="social-circle-btn" aria-label="InfoTech Group Official Website">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
              </a>
              <a href="https://www.linkedin.com/company/infotech-group" target="_blank" rel="noopener noreferrer" class="social-circle-btn" aria-label="LinkedIn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.64a1.64 1.64 0 1 0 0 3.28 1.64 1.64 0 0 0 0-3.28z" />
                </svg>
              </a>
              <a href="https://www.youtube.com/@InfoTechGroup" target="_blank" rel="noopener noreferrer" class="social-circle-btn" aria-label="YouTube">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </a>
              <a href="https://twitter.com/InfoTech_Group" target="_blank" rel="noopener noreferrer" class="social-circle-btn" aria-label="X (Twitter)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          </div>

          <!-- Column 2: Company -->
          <div class="footer-col">
            <h4 class="footer-col-title">Company</h4>
            <ul class="footer-links-list">
              <li><a (click)="scrollToTop()" class="footer-link">Home</a></li>
              <li><a (click)="auth.openLoginModal()" class="footer-link">TradeGuard® <span class="external-arrow">&#8599;</span></a></li>
              <li><a (click)="scrollToSolutions()" class="footer-link">Solutions</a></li>
              <li><a (click)="scrollToBlogs()" class="footer-link">Blogs &amp; Articles</a></li>
              <li><a (click)="scrollToAbout()" class="footer-link">About Us</a></li>
              <li><a (click)="scrollToFaq()" class="footer-link">FAQ</a></li>
            </ul>
          </div>

          <!-- Column 3: Solutions -->
          <div class="footer-col">
            <h4 class="footer-col-title">Solutions</h4>
            <ul class="footer-links-list">
              <li><a (click)="scrollToSolutions()" class="footer-link">Digitization</a></li>
              <li><a (click)="scrollToSolutions()" class="footer-link">TBML &amp; Compliance AI</a></li>
              <li><a (click)="scrollToSolutions()" class="footer-link">Sanctions Screening</a></li>
              <li><a (click)="scrollToSolutions()" class="footer-link">Document Exam</a></li>
              <li><a (click)="scrollToSolutions()" class="footer-link">Undertakings</a></li>
              <li><a (click)="auth.openLoginModal()" class="footer-link">Customer Portal</a></li>
            </ul>
          </div>

          <!-- Column 4: Resources -->
          <div class="footer-col">
            <h4 class="footer-col-title">Resources</h4>
            <ul class="footer-links-list">
              <li><a (click)="auth.openLoginModal()" class="footer-link">Global Events</a></li>
              <li><a (click)="auth.openLoginModal()" class="footer-link">Webinar &amp; Roundtable</a></li>
              <li><a (click)="scrollToAwards()" class="footer-link">Awards</a></li>
              <li><a (click)="scrollToBlogs()" class="footer-link">PR &amp; News</a></li>
              <li><a (click)="scrollToAbout()" class="footer-link">Expertise</a></li>
              <li><a (click)="scrollToBlogs()" class="footer-link">Knowledge Center</a></li>
              <li><a href="https://infotechgroup.com/careers" target="_blank" rel="noopener noreferrer" class="footer-link">Career</a></li>
            </ul>
          </div>

          <!-- Column 5: Global Office Tabs Switcher -->
          <div class="footer-col footer-col-offices">
            <div class="office-tabs-nav">
              <button
                type="button"
                class="office-tab-btn"
                [class.active]="activeOfficeTab() === 'usa'"
                (click)="activeOfficeTab.set('usa')"
              >
                USA
              </button>
              <button
                type="button"
                class="office-tab-btn"
                [class.active]="activeOfficeTab() === 'pakistan'"
                (click)="activeOfficeTab.set('pakistan')"
              >
                PAKISTAN
              </button>
              <button
                type="button"
                class="office-tab-btn"
                [class.active]="activeOfficeTab() === 'uae'"
                (click)="activeOfficeTab.set('uae')"
              >
                UAE
              </button>
            </div>

            <div class="office-address-card">
              @if (activeOfficeTab() === 'usa') {
                <div class="office-branch-entry">
                  <h5 class="branch-name">INFOTECH AMERICAS INC.</h5>
                  <p class="branch-address">1177 Avenue of the Americas,<br />5th Floor, New York, NY 10036</p>
                </div>
                <div class="office-branch-entry">
                  <h5 class="branch-name">TRADEGUARD INTELLIGENCE</h5>
                  <p class="branch-address">999 Corporate Drive, Suite 210,<br />Ladera Ranch, CA 92694</p>
                </div>
              } @else if (activeOfficeTab() === 'pakistan') {
                <div class="office-branch-entry">
                  <h5 class="branch-name">INFOTECH GROUP (GLOBAL HQ)</h5>
                  <p class="branch-address">InfoTech Innovation Center, 5-A,<br />Peeco Road, Township, Lahore 54770</p>
                </div>
                <div class="office-branch-entry">
                  <h5 class="branch-name">ISLAMABAD REGIONAL OFFICE</h5>
                  <p class="branch-address">Evacuee Trust Complex, 4th Floor,<br />Aga Khan Road, F-5/1, Islamabad</p>
                </div>
              } @else if (activeOfficeTab() === 'uae') {
                <div class="office-branch-entry">
                  <h5 class="branch-name">INFOTECH MIDDLE EAST FZ-LLC</h5>
                  <p class="branch-address">Office 402, Building 1,<br />Dubai Internet City, Dubai, UAE</p>
                </div>
                <div class="office-branch-entry">
                  <h5 class="branch-name">DUBAI FINANCIAL TRADE HUB</h5>
                  <p class="branch-address">DIFC Innovation One, Level 7,<br />Trade Centre, Dubai, UAE</p>
                </div>
              }
            </div>
          </div>
        </div>
      </footer>

      <!-- ================================================================= -->
      <!-- TEAL SUBFOOTER BAR                                                -->
      <!-- ================================================================= -->
      <div class="landing-subfooter-bar">
        <div class="subfooter-container">
          <div class="subfooter-links-left">
            <a (click)="openLegalModal('privacy')" class="subfooter-link">Legal Privacy</a>
            <a (click)="openLegalModal('eula')" class="subfooter-link">TradeGuard EULA</a>
          </div>
          <div class="subfooter-copy-right">
            <span>2026 &copy; All Rights Reserved by InfoTech Group &amp; TradeGuard.ai</span>
          </div>
        </div>

        <!-- Smooth Scroll to Top Floating Button -->
        <button
          type="button"
          class="btn-floating-scrolltop"
          (click)="scrollToTop()"
          aria-label="Scroll to top of page"
          title="Back to Top"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
        </button>
      </div>

      <!-- Legal & Privacy / EULA Modal -->
      @if (selectedLegalModal(); as legalType) {
        <div class="legal-modal-backdrop" (click)="closeLegalModal()">
          <div class="legal-modal-card" (click)="$event.stopPropagation()">
            <div class="legal-modal-header">
              <h3>{{ legalType === 'privacy' ? 'TradeGuard® Privacy & Data Governance' : 'TradeGuard® End User License Agreement (EULA)' }}</h3>
              <button type="button" class="btn-legal-close" (click)="closeLegalModal()">&times;</button>
            </div>
            <div class="legal-modal-body">
              @if (legalType === 'privacy') {
                <p><strong>InfoTech Group and TradeGuard®</strong> adhere to the strictest global data sovereignty, security, and banking compliance protocols including GDPR, ISO/IEC 27001, and SOC 2 Type II.</p>
                <p>All ingested documentary letters of credit, customs declarations, shipping bills, and entity records are processed using end-to-end zero-knowledge encryption with client-dedicated hardware security modules (HSMs).</p>
                <p>No confidential trade finance data or client transaction metadata is shared with public language models or third parties.</p>
              } @else {
                <p><strong>TradeGuard® Enterprise License Terms:</strong> TradeGuard® is licensed by InfoTech Group to authorized financial institutions and corporations for the sole purpose of automating trade finance document checking, AML/TBML risk detection, and sanctions screening.</p>
                <p>Governed under ICC UCP 600, ISBP 745, and FATF Trade Compliance standards. Unauthorized reverse engineering or redistribution is strictly prohibited.</p>
              }
            </div>
            <div class="legal-modal-footer">
              <button type="button" class="btn-legal-confirm" (click)="closeLegalModal()">Close Window</button>
            </div>
          </div>
        </div>
      }

      <!-- Theater View Video Modal -->
      @if (isTheaterModalOpen()) {
        <div class="theater-modal-backdrop" (click)="closeTheaterModal()">
          <div class="theater-modal-dialog" (click)="$event.stopPropagation()">
            <div class="theater-modal-head">
              <div class="theater-head-left">
                <span class="live-pulse-beacon"></span>
                <div>
                  <h3 class="theater-title">TradeGuard® Intelligence Demonstration</h3>
                  <p class="theater-subtitle">AI Trade Document Checking, Sanctions Screening &amp; UCP 600 Compliance Engine</p>
                </div>
              </div>
              <button type="button" class="theater-close-btn" (click)="closeTheaterModal()" aria-label="Close theater view" title="Close theater view">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div class="theater-video-frame">
              <iframe
                class="theater-iframe"
                [src]="currentVideoUrl()"
                title="TradeGuard Platform Video"
                frameborder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowfullscreen
              ></iframe>
            </div>

            <div class="theater-modal-foot">
              <div class="theater-video-tabs">
                @for (v of availableVideos; track v.id) {
                  <button
                    type="button"
                    class="theater-tab-btn"
                    [class.active]="selectedVideoId() === v.id"
                    (click)="selectVideo(v.id)"
                  >
                    <span class="tab-badge">{{ v.badge }}</span>
                    <span class="tab-name">{{ v.title }}</span>
                  </button>
                }
              </div>
              <button type="button" class="btn-theater-action" (click)="closeTheaterModal(); auth.openLoginModal()">
                <span>Open Live Workbench</span>
                <app-icon name="arrowRight" [size]="14" />
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './landing.component.scss',
})
export class LandingComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly docsService = inject(DocumentsService);
  private readonly blogService = inject(BlogService);
  private readonly toastService = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly health = signal<HealthResponse | null>(null);
  readonly selectedSolution = signal<SolutionCard | null>(null);

  readonly companyPartners: CompanyPartner[] = [
    { id: 'finastra', name: 'Finastra', role: 'Global Trade Partner' },
    { id: 'ibm', name: 'IBM', role: 'Technology Alliance' },
    { id: 'microsoft', name: 'Microsoft', role: 'Cloud Enterprise' },
    { id: 'oracle', name: 'Oracle', role: 'Financial Core Partner' },
    { id: 'huawei', name: 'Huawei', role: 'Banking Infrastructure' },
    { id: 'nbp', name: 'National Bank of Pakistan', role: 'Trade Operations Client' },
    { id: 'bank-abc', name: 'Bank ABC', role: 'Corporate Banking Client' },
    { id: 'cib', name: 'CIB Egypt', role: 'Digital Banking Client' },
    { id: 'rmb', name: 'RMB Private Bank', role: 'Institutional Client' },
    { id: 'gcb', name: 'GCB Bank', role: 'Corporate Client' },
    { id: 'union-bank', name: 'Union Bank', role: 'Banking Client' },
    { id: 'coop-bank', name: 'Co-op Bank Kenya', role: 'Corporate Banking Client' },
    { id: 'sbp', name: 'State Bank of Pakistan', role: 'Central Bank / Regulatory' },
    { id: 'wai', name: 'wAI Industries', role: 'AI Financial Systems' },
    { id: 'hbl', name: 'Habib Bank Limited', role: 'Banking Client' },
  ];

  readonly allPartners: CompanyPartner[] = [
    ...this.companyPartners,
    ...this.companyPartners,
  ];

  readonly techPartners: TechPartner[] = [
    { id: 'ibm', name: 'IBM', category: 'Global Technology Partner' },
    { id: 'cgi', name: 'CGI', category: 'IT & Business Consulting' },
    { id: 'cibar', name: 'Cibar', category: 'Global Trade Finance' },
    { id: 'oracle', name: 'Oracle', category: 'Cloud Infrastructure & Database' },
    { id: 'marinetraffic', name: 'MarineTraffic', category: 'Vessel Tracking & AIS Intelligence' },
    { id: 'dowjones', name: 'Dow Jones', category: 'Sanctions & Adverse Media Data' },
    { id: 'microsoft', name: 'Microsoft', category: 'Azure Cloud Enterprise' },
    { id: 'spglobal', name: 'S&P Global', category: 'Commodity & Financial Intelligence' },
    { id: 'surecomp', name: 'Surecomp', category: 'Trade Finance Solutions' },
    { id: 'finastra', name: 'Finastra', category: 'Strategic Global Trade Partner' },
    { id: 'huawei', name: 'Huawei', category: 'Enterprise Financial Infrastructure' },
    { id: 'dassault', name: 'Dassault Systèmes', category: '3D Enterprise Technology' },
    { id: 'wai', name: 'wAI Industries', category: 'AI Financial Technologies' },
  ];

  readonly allTechPartners: TechPartner[] = [
    ...this.techPartners,
    ...this.techPartners,
  ];

  readonly solutionCards: SolutionCard[] = [
    {
      id: 'digitization',
      title: 'Digitization',
      desc: "Explore TradeGuard®'s automated solutions for seamless transactions",
      badge: 'OCR & Document AI',
      features: [
        'Multimodal table extraction & OCR across Letters of Credit, BL, and Invoices',
        'Deterministic entity extraction into ISO 20022 and MT700 schemas',
        'Automatic document classification & dual-format discrepancy scanning',
      ],
      standards: 'ISO 20022 · SWIFT MT700/710 · UN/CEFACT',
    },
    {
      id: 'compliance-tbml',
      title: 'Compliance & TBML',
      desc: 'AI-powered transaction screening & trade-based AML compliance',
      badge: 'FATF TBML & Red Flags',
      features: [
        'Over/under invoicing detection against historical customs price corridors',
        'Phantom shipment & circular trade route topology analysis',
        'Automated red flag scoring aligned with FATF & Wolfsberg Trade Guidance',
      ],
      standards: 'FATF TBML Matrix · Wolfsberg Principles · SBP AML/CFT',
    },
    {
      id: 'sanctions-screening',
      title: 'Sanctions Screening',
      desc: 'Real-time sanctions screening to ensure regulatory compliance',
      badge: 'Multi-Regime Screening',
      features: [
        'Phonetic and fuzzy matching across US OFAC, UNSC, EU, UK HMT, and SBP',
        'Military end-use & dual-use goods screening via ECCN and HS code lookup',
        'Point-in-time regulatory auditing with official gazette source citations',
      ],
      standards: 'US OFAC SDN · UNSC 1267/1988 · EU CFSP · UK HMT · SBP',
    },
    {
      id: 'document-exam',
      title: 'Document Exam',
      desc: 'Automate trade document checks for seamless compliance and accuracy',
      badge: 'UCP 600 Discrepancy Engine',
      features: [
        'Automated discrepancy checking against UCP 600, eUCP, and ISBP 745 standards',
        'Cross-document validation (Invoice vs. BL vs. Packing List vs. LC terms)',
        'Article 16 notice generation for non-compliant commercial presentations',
      ],
      standards: 'ICC UCP 600 · ISBP 745 · eUCP Version 2.0',
    },
    {
      id: 'undertakings',
      title: 'Undertakings',
      desc: 'Guarantees and SBLCs are major trade finance tools after LCs',
      badge: 'Guarantees & SBLC Engine',
      features: [
        'End-to-end verification of Standby Letters of Credit (SBLC) and demand guarantees',
        'URDG 758 and ISP98 clause validation and claim condition reconciliation',
        'Counter-guarantee exposure tracking and non-conforming demand identification',
      ],
      standards: 'ICC URDG 758 · ISP98 · Uniform Rules for Collections (URC 522)',
    },
    {
      id: 'customer-portal',
      title: 'Customer Portal',
      desc: 'Faster export LC checks and Direct Collections with improved efficiency',
      badge: 'Corporate Banking 360',
      features: [
        'Real-time export presentation tracking and discrepancy resolution workspace',
        'Direct collection status visibility and digital acceptance confirmations',
        'Institutional counterparty verification and KYC risk scoring overview',
      ],
      standards: 'Open Banking Trade APIs · SOC2 Type II · 256-Bit TLS',
    },
  ];

  ngOnInit(): void {
    this.docsService.health().subscribe({
      next: (h: HealthResponse) => this.health.set(h),
      error: () => {},
    });
  }

  readonly availableVideos = [
    {
      id: 'Tdx214DsKvA',
      title: 'ICC: Transforming Trade Finance with Automation',
      category: 'ICC Rules Engine',
      badge: 'ICC Compliance',
    },
  ];

  readonly selectedVideoId = signal<string>('Tdx214DsKvA');
  readonly isTheaterModalOpen = signal<boolean>(false);

  readonly currentVideoUrl = computed<SafeResourceUrl>(() => {
    const id = this.selectedVideoId();
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`
    );
  });

  readonly isVideoPlaying = signal<boolean>(false);

  playVideo(videoId?: string): void {
    if (videoId) {
      this.selectedVideoId.set(videoId);
    } else {
      this.selectedVideoId.set('Tdx214DsKvA');
    }
    this.isVideoPlaying.set(true);
  }

  stopVideo(): void {
    this.isVideoPlaying.set(false);
    this.isTheaterModalOpen.set(false);
  }

  selectVideo(videoId: string): void {
    this.selectedVideoId.set(videoId);
  }

  readonly showDemoVideo = signal<boolean>(false);

  openDemoVideo(): void {
    this.showDemoVideo.set(true);
  }

  closeDemoVideo(): void {
    this.showDemoVideo.set(false);
  }

  openTheaterModal(): void {
    this.isTheaterModalOpen.set(true);
    this.showDemoVideo.set(true);
  }

  closeTheaterModal(): void {
    this.isTheaterModalOpen.set(false);
    this.showDemoVideo.set(false);
  }

  scrollToSolutions(): void {
    document.getElementById('solutions')?.scrollIntoView({ behavior: 'smooth' });
  }

  openSolutionDetails(card: SolutionCard): void {
    this.selectedSolution.set(card);
  }

  closeSolutionDetails(): void {
    this.selectedSolution.set(null);
  }

  launchModule(card: SolutionCard): void {
    this.closeSolutionDetails();
    if (this.auth.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
    } else {
      this.auth.openLoginModal();
    }
  }

  onViewMore(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
    } else {
      this.auth.openLoginModal();
    }
  }

  readonly currentTestimonialIndex = signal<number>(0);

  readonly testimonials: ClientTestimonial[] = [
    {
      id: 'finastra-testimonial',
      logoId: 'finastra',
      quote:
        "As the global trade finance landscape transitions rapidly towards digital standards and strict AML scrutiny, TradeGuard by InfoTech Group provides the automated precision banks urgently need. Integrating AI-native document examination with our core trade channels has reduced discrepancy review cycles from days to under four minutes while ensuring 100% FATF red flag compliance across global corridors.",
      author: 'Michael Sgarlata',
      title: 'Global Head of Trade Finance Architecture',
      company: 'Finastra',
    },
    {
      id: 'nbp-testimonial',
      logoId: 'nbp',
      quote:
        "InfoTech Group's deployment of TradeGuard across our international trade operations revolutionized how we inspect Letters of Credit and Bills of Lading. The automated cross-matching between commercial invoices, shipping manifests, and OFAC/SBP sanctions lists completely eliminated human error and phantom shipment exposures across our highest-volume export ports.",
      author: 'Zubair Ahmed',
      title: 'Head of International Trade Operations & Compliance',
      company: 'National Bank of Pakistan',
    },
    {
      id: 'bank-abc-testimonial',
      logoId: 'bank-abc',
      quote:
        "Deploying TradeGuard has given our compliance officers full confidence in price corridor verification and dual-use goods detection. The system flags subtle unit-price deviations and suspicious transshipment routings in real time before LC presentation payments are released, setting a new benchmark for trade compliance across the GCC.",
      author: 'Tariq Al-Mansoor',
      title: 'Chief Risk & AML Compliance Officer',
      company: 'Bank ABC Group',
    },
    {
      id: 'coop-bank-testimonial',
      logoId: 'coop-bank',
      quote:
        "TradeGuard seamlessly streamlined our corporate guarantees and Standby Letters of Credit (SBLC) examination under URDG 758 standards. What used to take our specialized legal and trade teams hours of manual verification is now audited in seconds with auditable gazette regulatory citations.",
      author: 'Faith Mwangi',
      title: 'Director of Corporate & Transaction Banking',
      company: 'Co-operative Bank of Kenya',
    },
    {
      id: 'cib-testimonial',
      logoId: 'cib',
      quote:
        "The explainable AI in TradeGuard is exceptional. Rather than delivering black-box alerts, the platform gives our compliance analysts exact UCP 600 rule citations and historical market price benchmark bands. It has empowered our trade operations to handle double the commercial presentation volume with zero compliance headcount expansion.",
      author: 'Karim El-Sayed',
      title: 'Managing Director of Trade Product & Regulatory Governance',
      company: 'CIB Egypt',
    },
  ];

  readonly currentTestimonial = computed(() => this.testimonials[this.currentTestimonialIndex()]);

  nextTestimonial(): void {
    this.currentTestimonialIndex.update(i => (i + 1) % this.testimonials.length);
  }

  prevTestimonial(): void {
    this.currentTestimonialIndex.update(i => (i - 1 + this.testimonials.length) % this.testimonials.length);
  }

  goToTestimonial(index: number): void {
    this.currentTestimonialIndex.set(index);
  }

  readonly currentBlogIndex = signal<number>(0);
  readonly selectedBlog = signal<BlogPost | null>(null);

  readonly blogs: BlogPost[] = this.blogService.getBlogs();

  readonly visibleBlogs = computed(() => {
    const idx = this.currentBlogIndex();
    return this.blogs.slice(idx, idx + 3);
  });

  nextBlog(): void {
    const maxIdx = Math.max(0, this.blogs.length - 3);
    this.currentBlogIndex.update(i => (i >= maxIdx ? 0 : i + 1));
  }

  prevBlog(): void {
    const maxIdx = Math.max(0, this.blogs.length - 3);
    this.currentBlogIndex.update(i => (i <= 0 ? maxIdx : i - 1));
  }

  goToBlog(index: number): void {
    this.currentBlogIndex.set(index);
  }

  openBlogModal(blog: BlogPost): void {
    this.selectedBlog.set(blog);
  }

  closeBlogModal(): void {
    this.selectedBlog.set(null);
  }

  readonly bookmarkedIds = signal<Set<string>>(new Set());

  isBookmarked(id: string): boolean {
    return this.bookmarkedIds().has(id);
  }

  toggleBookmark(id: string): void {
    const current = new Set(this.bookmarkedIds());
    if (current.has(id)) {
      current.delete(id);
      this.toastService.info('Removed from reading list');
    } else {
      current.add(id);
      this.toastService.success('Article saved to your reading list');
    }
    this.bookmarkedIds.set(current);
  }

  shareArticle(blog: BlogPost): void {
    const url = `${window.location.origin}/blog/${blog.id}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        this.toastService.success('Article link copied to clipboard!');
      }).catch(() => {
        this.toastService.info(`Article link: ${url}`);
      });
    } else {
      this.toastService.info(`Article link: ${url}`);
    }
  }

  getAuthorInitials(name: string): string {
    if (!name) return 'TG';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  // Office Tab Selection for Enterprise Footer
  readonly activeOfficeTab = signal<'usa' | 'pakistan' | 'uae'>('usa');

  // Contact Form Signals & Handlers
  readonly contactEmail = signal<string>('');
  readonly contactMessage = signal<string>('');
  readonly isCaptchaChecked = signal<boolean>(false);
  readonly contactSubmitted = signal<boolean>(false);
  readonly contactError = signal<string>('');
  readonly selectedLegalModal = signal<'privacy' | 'eula' | null>(null);

  focusContactForm(): void {
    const contactSection = document.getElementById('contact');
    if (contactSection) {
      contactSection.scrollIntoView({ behavior: 'smooth' });
    }
    setTimeout(() => {
      const emailInput = document.querySelector<HTMLInputElement>('.pill-input');
      if (emailInput) {
        emailInput.focus();
      }
    }, 400);
  }

  toggleCaptcha(): void {
    this.isCaptchaChecked.update(v => !v);
    if (this.contactError()) {
      this.contactError.set('');
    }
  }

  submitContact(event?: Event): void {
    if (event) {
      event.preventDefault();
    }
    const email = this.contactEmail().trim();
    const message = this.contactMessage().trim();

    if (!email || !email.includes('@') || !email.includes('.')) {
      this.contactError.set('Please enter a valid business email address.');
      return;
    }
    if (!message) {
      this.contactError.set('Please provide your project or trade requirements message.');
      return;
    }
    if (!this.isCaptchaChecked()) {
      this.contactError.set('Please check the verification box ("I\'m not a robot") to continue.');
      return;
    }

    this.contactError.set('');
    this.contactSubmitted.set(true);
    this.contactEmail.set('');
    this.contactMessage.set('');
    this.isCaptchaChecked.set(false);
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  scrollToBlogs(): void {
    document.getElementById('blogs')?.scrollIntoView({ behavior: 'smooth' });
  }

  scrollToAbout(): void {
    document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' });
  }

  openLegalModal(type: 'privacy' | 'eula'): void {
    this.selectedLegalModal.set(type);
  }

  closeLegalModal(): void {
    this.selectedLegalModal.set(null);
  }

  // FAQ Section State & Data
  readonly activeFaqIndex = signal<number | null>(null);

  readonly faqItems = [
    {
      id: 'faq-1',
      question: 'What trade documents does TradeGuard® support for automated examination?',
      answer: 'TradeGuard® supports all major trade finance documents including Letters of Credit (LC), Bills of Lading (BL), Commercial Invoices, Packing Lists, Certificates of Origin, Insurance Certificates, and SWIFT MT700/MT710 messages. The platform performs automated discrepancy checking against UCP 600 and ISBP 745 standards, with support for both documentary credits and standby letters of credit (SBLC) under ISP98.',
    },
    {
      id: 'faq-2',
      question: 'How does the sanctions screening engine work across multiple regulatory regimes?',
      answer: 'Our multi-regime screening engine performs real-time checks against US OFAC SDN/SSI, UNSC 1267/1988, EU CFSP, UK HMT, and SBP Pakistan sanctions lists simultaneously. It uses advanced phonetic matching, fuzzy name resolution, and alias detection to minimize false negatives. The engine provides point-in-time regulatory citations so compliance officers can trace exactly which gazette or executive order triggered a match.',
    },
    {
      id: 'faq-3',
      question: 'What is Trade-Based Money Laundering (TBML) and how does TradeGuard® detect it?',
      answer: 'TBML is a method of disguising illicit proceeds through the manipulation of trade transactions. TradeGuard® detects TBML patterns through over/under-invoicing analysis against historical customs price corridors, phantom shipment detection via AIS vessel tracking, circular trade route topology analysis, and automated red flag scoring aligned with FATF and Wolfsberg Trade Guidance. The system provides explainable AI outputs with specific rule citations rather than black-box alerts.',
    },
    {
      id: 'faq-4',
      question: 'How does TradeGuard® integrate with core banking systems like Finastra or Oracle?',
      answer: 'TradeGuard® is designed for seamless integration with leading core banking platforms. It is certified on Finastra FusionFabric.cloud and available on Microsoft Azure Marketplace. The platform exposes RESTful Open Banking Trade APIs with SOC2 Type II compliance, supporting standard message formats including SWIFT FIN (MT series) and ISO 20022 MX schemas for bi-directional data exchange with existing bank infrastructure.',
    },
    {
      id: 'faq-5',
      question: 'What compliance standards and frameworks does the platform support?',
      answer: 'TradeGuard® is built around ICC UCP 600, eUCP Version 2.0, ISBP 745, URDG 758, ISP98, and URC 522 for trade document rules. For sanctions and AML, it covers FATF TBML Matrix, Wolfsberg Principles, US OFAC regulations, UNSC resolutions, EU CFSP directives, UK HMT designations, and SBP AML/CFT guidelines. The platform supports dual-use goods screening via ECCN and HS code classification for export control compliance.',
    },
    {
      id: 'faq-6',
      question: 'What security certifications and data governance standards does TradeGuard® follow?',
      answer: 'TradeGuard® adheres to GDPR, ISO/IEC 27001, and SOC 2 Type II standards. All data is processed using end-to-end zero-knowledge encryption with client-dedicated Hardware Security Modules (HSMs). No confidential trade finance data or client transaction metadata is shared with public language models or third parties. The platform supports on-premises deployment for institutions requiring full data sovereignty.',
    },
  ];

  toggleFaq(index: number): void {
    if (this.activeFaqIndex() === index) {
      this.activeFaqIndex.set(null);
    } else {
      this.activeFaqIndex.set(index);
    }
  }

  scrollToFaq(): void {
    document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' });
  }

  scrollToAwards(): void {
    document.querySelector('.awards-recognition-section')?.scrollIntoView({ behavior: 'smooth' });
  }
}
