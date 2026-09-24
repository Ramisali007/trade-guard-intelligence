import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { jsPDF } from 'jspdf';
import { BlogService, type BlogPost } from '../../services/blog.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { Icon } from '../../shared/components/icon';

@Component({
  selector: 'app-blog-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, Icon],
  template: `
    <div class="blog-detail-page">
      <!-- Minimalist Breadcrumb / Back Bar (Replaces Top Header) -->
      <div class="blog-top-bar">
        <div class="landing-container top-bar-inner">
          <a routerLink="/" fragment="blogs" class="btn-top-back" title="Return to Resource Hub">
            <app-icon name="arrowLeft" [size]="16" />
            <span>Back to Resource Hub</span>
          </a>
          <div class="top-bar-brand">
            <span class="top-brand-name">TradeGuard<span class="text-teal">®</span></span>
            <span class="top-brand-sub">by InfoTech Group</span>
          </div>
        </div>
      </div>

      @if (blog(); as b) {
        <main class="blog-main-content">
          <div class="landing-container">
            <!-- ============================================================= -->
            <!-- HERO BANNER WITH SPECIFIC BLOG TOPIC PHOTO                    -->
            <!-- ============================================================= -->
            <section class="blog-hero-banner">
              <!-- Ambient Background Blur Overlay -->
              <div class="hero-banner-bg"></div>

              <div class="hero-banner-content">
                <!-- Left Details Area -->
                <div class="hero-banner-left">
                  <!-- TradeGuard Brand Tagline -->
                  <div class="banner-top-brand">
                    <span class="brand-shield-icon">🛡️</span>
                    <span class="brand-name">TradeGuard<span class="brand-teal">®</span></span>
                    <span class="brand-tagline">Intelligence Research Series</span>
                  </div>

                  <!-- Dynamic Split Main Title -->
                  <div class="hero-banner-titles">
                    <span class="banner-category-badge">{{ b.category }}</span>
                    <h1 class="banner-main-title">FUTURE-PROOFING TRADE FINANCE</h1>
                    <h2 class="banner-highlight-title">
                      {{ b.headlineHighlight || b.title }}
                    </h2>
                  </div>

                  <!-- Author Signature Tag -->
                  <div class="banner-author-tag">
                    <span class="author-name-tag">- {{ b.author.toUpperCase() }}</span>
                    <span class="author-role-sub">({{ b.authorRole }})</span>
                  </div>
                </div>

                <!-- Right Topic Photo Area (Each blog uses its own unique photo) -->
                <div class="hero-banner-right">
                  <div class="topic-banner-photo-wrapper">
                    <img
                      [src]="b.imageUrl"
                      [alt]="b.title"
                      class="topic-banner-img"
                    />
                    <div class="topic-photo-badge">
                      <span class="badge-dot-live"></span>
                      <span>{{ b.category }}</span>
                      <span class="badge-dot-sep">•</span>
                      <span>{{ b.readTime }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- ============================================================= -->
            <!-- ARTICLE BODY & EXECUTIVE SUMMARY                              -->
            <!-- ============================================================= -->
            <section class="article-body-section">
              <h2 class="article-exec-heading">Executive Summary</h2>

              <div class="article-paragraphs-flow">
                @for (p of b.executiveSummary || b.content; track $index) {
                  <p class="article-exec-p">{{ p }}</p>
                }

                @if (b.content && b.executiveSummary) {
                  <div class="article-deep-dive mt-24">
                    <h3 class="article-subheading">Technical Analysis &amp; Regulatory Alignment</h3>
                    @for (p of b.content; track $index) {
                      <p class="article-exec-p">{{ p }}</p>
                    }
                  </div>
                }
              </div>

              <!-- DOWNLOAD ARTICLE ACTION (Clicking directly downloads PDF) -->
              <div class="download-action-box">
                <a
                  class="download-prompt-link"
                  (click)="downloadPdf(b)"
                  role="button"
                  tabindex="0"
                  title="Click to download full article PDF"
                >
                  <span class="download-prompt-text">Click below to download the full article</span>
                  <span class="download-pdf-badge">
                    <app-icon name="download" [size]="15" />
                    <span>Download PDF</span>
                  </span>
                </a>
              </div>

              <!-- POST TAGS & SOCIAL SHARE BAR -->
              <div class="article-meta-footer">
                <div class="meta-tags-left">
                  <span class="tags-label">Post Tags :</span>
                  <div class="tags-list">
                    @for (t of b.tags; track t; let last = $last) {
                      <span class="tag-teal-link" (click)="filterByTag(t)">{{ t }}</span>
                      @if (!last) {
                        <span class="tag-comma">,</span>
                      }
                    }
                  </div>
                </div>

                <div class="meta-share-right">
                  <span class="share-label">Share :</span>
                  <div class="share-buttons-group">
                    <button type="button" class="btn-share-circle" (click)="shareOnTwitter(b)" title="Share on X / Twitter">
                      <span class="share-icon-x">𝕏</span>
                    </button>
                    <button type="button" class="btn-share-circle" (click)="shareOnLinkedIn(b)" title="Share on LinkedIn">
                      <span class="share-icon-in">in</span>
                    </button>
                    <button type="button" class="btn-share-circle" (click)="copyArticleLink()" title="Copy Link">
                      <app-icon name="copy" [size]="13" />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <!-- ============================================================= -->
          <!-- CONTACT US / SEE AI IN ACTION                                 -->
          <!-- ============================================================= -->
          <section class="contact-cta-section" id="contact">
            <div class="contact-cta-bg-overlay"></div>
            <div class="landing-container">
              <div class="contact-cta-container">
                <!-- Left Column -->
                <div class="contact-cta-left">
                  <span class="contact-eyebrow">Contact Us</span>
                  <h2 class="contact-headline">See AI in Action</h2>
                  <p class="contact-subtext">
                    Discover how TradeGuard® processes trade transactions end-to-end,
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

                <!-- Right Column: Interactive Form -->
                <div class="contact-cta-right">
                  <form class="contact-glass-form" (submit)="submitContact($event)">
                    @if (contactSubmitted()) {
                      <div class="contact-success-box">
                        <div class="success-icon-badge">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00a8a8" stroke-width="2.5">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                          </svg>
                        </div>
                        <h4 class="success-title">Inquiry Sent Successfully!</h4>
                        <p class="success-desc">
                          Thank you for reaching out. Our trade finance advisory team will contact you within 24 hours.
                        </p>
                        <button type="button" class="btn-reset-contact" (click)="contactSubmitted.set(false)">
                          <span>Send Another Inquiry</span>
                        </button>
                      </div>
                    } @else {
                      <div class="form-group-pill">
                        <input
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

                      <!-- reCAPTCHA Checkbox -->
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
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00a8a8" stroke-width="3">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            }
                          </span>
                          <span class="recaptcha-label-text">I'm not a robot</span>
                        </label>
                        <div class="recaptcha-branding">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4285f4" stroke-width="2">
                            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"></path>
                          </svg>
                          <span class="re-text">reCAPTCHA</span>
                        </div>
                      </div>

                      @if (contactError()) {
                        <p class="contact-error-msg">{{ contactError() }}</p>
                      }

                      <button type="submit" class="btn-send-pill">
                        <span>Send</span>
                      </button>
                    }
                  </form>
                </div>
              </div>
            </div>
          </section>

          <!-- ============================================================= -->
          <!-- ENTERPRISE GLOBAL FOOTER                                      -->
          <!-- ============================================================= -->
          <footer class="enterprise-footer">
            <div class="landing-container">
              <div class="footer-grid">
                <!-- Col 1: Brand & Socials -->
                <div class="footer-col-brand">
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
                  <p class="footer-slogan">Future-Proof Trade Finance Operations &amp; Intelligence</p>
                  <p class="footer-email">Email: <a href="mailto:contact@tradeguard.infotechgroup.com">contact&#64;tradeguard.infotechgroup.com</a></p>

                  <div class="footer-social-row">
                    <a (click)="copyArticleLink()" class="footer-social-btn" title="Copy Article Link">
                      <app-icon name="copy" [size]="14" />
                    </a>
                    <a (click)="shareOnLinkedIn(b)" class="footer-social-btn" title="Share on LinkedIn">
                      <span class="font-bold text-xs">in</span>
                    </a>
                    <a (click)="shareOnTwitter(b)" class="footer-social-btn" title="Share on X">
                      <span class="font-bold text-xs">𝕏</span>
                    </a>
                  </div>
                </div>

                <!-- Col 2: Company -->
                <div class="footer-col">
                  <h4 class="footer-heading">Company</h4>
                  <ul class="footer-nav-list">
                    <li><a routerLink="/">Home</a></li>
                    <li><a routerLink="/" fragment="solutions">TradeGuard® Platform</a></li>
                    <li><a routerLink="/" fragment="solutions">Solutions</a></li>
                    <li><a routerLink="/" fragment="blogs">Blogs &amp; Research</a></li>
                    <li><a routerLink="/" fragment="about">About Us</a></li>
                    <li><a routerLink="/" fragment="faq">FAQ</a></li>
                  </ul>
                </div>

                <!-- Col 3: Solutions -->
                <div class="footer-col">
                  <h4 class="footer-heading">Solutions</h4>
                  <ul class="footer-nav-list">
                    <li><a routerLink="/" fragment="solutions">Digitization &amp; OCR</a></li>
                    <li><a routerLink="/" fragment="solutions">TBML &amp; Compliance AI</a></li>
                    <li><a routerLink="/" fragment="solutions">Sanctions Screening</a></li>
                    <li><a routerLink="/" fragment="solutions">Document Exam (UCP 600)</a></li>
                    <li><a routerLink="/" fragment="solutions">Undertakings &amp; SBLC</a></li>
                    <li><a (click)="auth.openLoginModal()">Customer Portal</a></li>
                  </ul>
                </div>

                <!-- Col 4: Resources -->
                <div class="footer-col">
                  <h4 class="footer-heading">Resources</h4>
                  <ul class="footer-nav-list">
                    <li><a routerLink="/" fragment="blogs">Industry White Papers</a></li>
                    <li><a routerLink="/" fragment="blogs">Regulatory Standards</a></li>
                    <li><a routerLink="/" fragment="awards">Awards &amp; Recognition</a></li>
                    <li><a routerLink="/" fragment="blogs">Press &amp; Updates</a></li>
                    <li><a routerLink="/" fragment="solutions">Technical Architecture</a></li>
                    <li><a routerLink="/" fragment="contact">Support &amp; Inquiries</a></li>
                  </ul>
                </div>

                <!-- Col 5: Location Tabs -->
                <div class="footer-col-location">
                  <div class="location-tabs-bar">
                    <button
                      type="button"
                      class="loc-tab-btn"
                      [class.active]="activeOfficeTab() === 'usa'"
                      (click)="activeOfficeTab.set('usa')"
                    >
                      USA
                    </button>
                    <button
                      type="button"
                      class="loc-tab-btn"
                      [class.active]="activeOfficeTab() === 'pakistan'"
                      (click)="activeOfficeTab.set('pakistan')"
                    >
                      PAKISTAN
                    </button>
                    <button
                      type="button"
                      class="loc-tab-btn"
                      [class.active]="activeOfficeTab() === 'uae'"
                      (click)="activeOfficeTab.set('uae')"
                    >
                      UAE
                    </button>
                  </div>

                  <div class="location-card-content">
                    @if (activeOfficeTab() === 'usa') {
                      <div class="loc-address-group">
                        <strong class="loc-company-title">INFOTECH NORTH AMERICA</strong>
                        <p class="loc-address-line">1177 Avenue of the Americas,</p>
                        <p class="loc-address-line">5th Floor, New York, NY 10036</p>
                      </div>
                    } @else if (activeOfficeTab() === 'pakistan') {
                      <div class="loc-address-group">
                        <strong class="loc-company-title">INFOTECH GROUP HQ</strong>
                        <p class="loc-address-line">InfoTech Tower, 16-A, Block L,</p>
                        <p class="loc-address-line">Gulberg III, Lahore, Pakistan</p>
                      </div>
                    } @else {
                      <div class="loc-address-group">
                        <strong class="loc-company-title">INFOTECH MIDDLE EAST FZ-LLC</strong>
                        <p class="loc-address-line">Dubai Internet City, Building 14,</p>
                        <p class="loc-address-line">Dubai, United Arab Emirates</p>
                      </div>
                    }
                  </div>
                </div>
              </div>

              <!-- Bottom Subfooter Bar -->
              <div class="footer-bottom-bar">
                <div class="footer-legal-links">
                  <a routerLink="/" class="legal-link">Privacy Policy</a>
                  <span class="legal-sep">|</span>
                  <a routerLink="/" class="legal-link">TradeGuard EULA</a>
                  <span class="legal-sep">|</span>
                  <a routerLink="/" class="legal-link">ISO 20022 Compliance</a>
                </div>
                <div class="footer-copyright">
                  2026 &copy; All Rights Reserved by InfoTech Group
                </div>
              </div>
            </div>

            <!-- Floating Scroll-To-Top Button -->
            <button type="button" class="btn-floating-top" (click)="scrollToTop()" aria-label="Scroll to top">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6">
                <polyline points="18 15 12 9 6 15"></polyline>
              </svg>
            </button>
          </footer>
        </main>
      } @else {
        <div class="not-found-container card card-pad text-center">
          <h2>Article Not Found</h2>
          <p class="text-muted mt-8">The requested trade compliance white paper could not be found.</p>
          <a routerLink="/" class="btn-pill-navy mt-16 inline-block">Return to Landing Page</a>
        </div>
      }
    </div>
  `,
  styles: [`
    /* ── Page Layout ── */
    .blog-detail-page {
      min-height: 100vh;
      background: #ffffff;
      color: #1e293b;
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    }

    [data-theme='dark'] .blog-detail-page {
      background: #060d24;
      color: #f1f5f9;

      .article-exec-heading, .article-subheading {
        color: #ffffff;
      }

      .article-exec-p {
        color: #cbd5e1;
      }

      .article-meta-footer {
        border-color: rgba(255, 255, 255, 0.1);
      }

      .tags-label, .share-label {
        color: #94a3b8;
      }
    }

    .landing-container {
      max-width: 1240px;
      margin: 0 auto;
      padding: 0 24px;
    }

    /* ── Minimalist Top Back Bar ── */
    .blog-top-bar {
      padding: 16px 0;
      border-bottom: 1px solid #e2e8f0;
      background: #ffffff;

      .top-bar-inner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }
    }

    [data-theme='dark'] .blog-top-bar {
      background: #070e28;
      border-bottom-color: rgba(255, 255, 255, 0.08);
    }

    .btn-top-back {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 18px;
      border-radius: 999px;
      background: #f1f5f9;
      color: #334155;
      font-size: 0.88rem;
      font-weight: 650;
      text-decoration: none;
      transition: all 0.2s ease;

      &:hover {
        background: #00a8a8;
        color: #ffffff;
        transform: translateX(-3px);
      }
    }

    [data-theme='dark'] .btn-top-back {
      background: rgba(255, 255, 255, 0.08);
      color: #cbd5e1;

      &:hover {
        background: #00a8a8;
        color: #ffffff;
      }
    }

    .top-bar-brand {
      display: flex;
      align-items: center;
      gap: 8px;

      .top-brand-name {
        font-size: 1.15rem;
        font-weight: 800;
        color: #0b132b;
        letter-spacing: -0.02em;

        .text-teal {
          color: #00a8a8;
        }
      }

      .top-brand-sub {
        font-size: 0.78rem;
        color: #64748b;
        font-weight: 500;
        padding-left: 8px;
        border-left: 1px solid #cbd5e1;

        @media (max-width: 640px) {
          display: none;
        }
      }
    }

    [data-theme='dark'] .top-bar-brand .top-brand-name {
      color: #ffffff;
    }

    /* ── HERO BANNER DESIGN WITH TOPIC PHOTO ── */
    .blog-hero-banner {
      margin-top: 32px;
      margin-bottom: 48px;
      border-radius: 24px;
      background: linear-gradient(135deg, #050b24 0%, #0d1a45 55%, #081130 100%);
      border: 1px solid rgba(255, 255, 255, 0.12);
      position: relative;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(5, 11, 36, 0.4);
    }

    .hero-banner-bg {
      position: absolute;
      inset: 0;
      background-image:
        radial-gradient(circle at 20% 30%, rgba(0, 168, 168, 0.22) 0%, transparent 55%),
        radial-gradient(circle at 85% 70%, rgba(2, 128, 144, 0.18) 0%, transparent 60%);
      pointer-events: none;
    }

    .hero-banner-content {
      position: relative;
      z-index: 2;
      display: flex;
      align-items: stretch;
      justify-content: space-between;
      min-height: 380px;

      @media (max-width: 960px) {
        flex-direction: column;
        min-height: auto;
      }
    }

    .hero-banner-left {
      flex: 1.2;
      padding: clamp(32px, 4.5vw, 52px);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 24px;
    }

    .banner-top-brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;

      .brand-shield-icon {
        font-size: 1.15rem;
      }

      .brand-name {
        font-size: 1.35rem;
        font-weight: 850;
        color: #ffffff;
        letter-spacing: -0.02em;

        .brand-teal {
          color: #00d4d4;
        }
      }

      .brand-tagline {
        font-size: 0.72rem;
        color: #94a3b8;
        margin-left: 6px;
        padding-left: 8px;
        border-left: 1px solid rgba(255, 255, 255, 0.2);
        letter-spacing: 0.03em;
        text-transform: uppercase;
        font-weight: 600;
      }
    }

    .hero-banner-titles {
      display: flex;
      flex-direction: column;
      gap: 8px;

      .banner-category-badge {
        align-self: flex-start;
        padding: 4px 12px;
        border-radius: 999px;
        background: rgba(0, 212, 212, 0.16);
        border: 1px solid rgba(0, 212, 212, 0.35);
        color: #00d4d4;
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }

      .banner-main-title {
        font-size: clamp(1.5rem, 2.5vw, 2.2rem);
        font-weight: 850;
        color: #ffffff;
        letter-spacing: -0.02em;
        line-height: 1.2;
        margin: 0;
        text-transform: uppercase;
      }

      .banner-highlight-title {
        font-size: clamp(1.15rem, 1.9vw, 1.65rem);
        font-weight: 800;
        color: #00d4d4;
        letter-spacing: -0.015em;
        line-height: 1.28;
        margin: 0;
        text-transform: uppercase;
      }
    }

    .banner-author-tag {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      align-self: flex-start;
      padding: 7px 18px;
      border-radius: 999px;
      background: #022934;
      border: 1px solid #00a8a8;
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(0, 168, 168, 0.25);
      flex-wrap: wrap;

      .author-name-tag {
        font-size: 0.88rem;
        font-weight: 750;
        letter-spacing: 0.04em;
      }

      .author-role-sub {
        font-size: 0.78rem;
        color: #94a3b8;
        font-weight: 500;
      }
    }

    .hero-banner-right {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: clamp(20px, 3.5vw, 40px);

      @media (max-width: 960px) {
        padding-top: 0;
      }
    }

    .topic-banner-photo-wrapper {
      position: relative;
      width: 100%;
      max-width: 500px;
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.16);

      .topic-banner-img {
        width: 100%;
        height: 290px;
        object-fit: cover;
        object-position: center;
        display: block;
        transition: transform 0.4s ease, filter 0.3s ease;

        &:hover {
          transform: scale(1.04);
          filter: brightness(1.06);
        }
      }

      .topic-photo-badge {
        position: absolute;
        bottom: 14px;
        left: 14px;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 6px 14px;
        border-radius: 999px;
        background: rgba(4, 9, 26, 0.86);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(0, 212, 212, 0.45);
        font-size: 0.74rem;
        font-weight: 700;
        color: #00d4d4;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);

        .badge-dot-live {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #00d4d4;
          animation: pulse-glow 2s infinite;
        }

        .badge-dot-sep {
          color: rgba(255, 255, 255, 0.4);
        }
      }
    }

    @keyframes pulse-glow {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    /* ── ARTICLE BODY & EXECUTIVE SUMMARY ── */
    .article-body-section {
      max-width: 960px;
      margin: 0 auto 64px auto;
      padding: 0 8px;
    }

    .article-exec-heading {
      font-size: clamp(1.8rem, 2.5vw, 2.25rem);
      font-weight: 800;
      color: #0a1638;
      letter-spacing: -0.02em;
      margin: 0 0 24px 0;
    }

    .article-subheading {
      font-size: 1.35rem;
      font-weight: 750;
      color: #0b1536;
      margin: 28px 0 16px 0;
      letter-spacing: -0.015em;
    }

    .article-paragraphs-flow {
      .article-exec-p {
        font-size: 1.05rem;
        line-height: 1.8;
        color: #334155;
        margin-bottom: 20px;
      }
    }

    /* ── DOWNLOAD ARTICLE (Direct PDF trigger) ── */
    .download-action-box {
      margin: 36px 0;

      .download-prompt-link {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        text-decoration: none;
        cursor: pointer;
        padding: 6px 0;
        transition: all 0.2s ease;

        &:hover {
          transform: translateX(4px);

          .download-prompt-text {
            color: #008080;
            text-decoration: underline;
          }

          .download-pdf-badge {
            background: #00a8a8;
            color: #ffffff;
            border-color: #00a8a8;
            box-shadow: 0 4px 14px rgba(0, 168, 168, 0.35);
          }
        }

        .download-prompt-text {
          font-size: 1rem;
          font-weight: 600;
          color: #00a8a8;
          transition: color 0.18s ease;
        }

        .download-pdf-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 999px;
          background: rgba(0, 168, 168, 0.12);
          color: #00a8a8;
          font-size: 0.8rem;
          font-weight: 750;
          letter-spacing: 0.04em;
          border: 1px solid rgba(0, 168, 168, 0.3);
          transition: all 0.2s ease;
        }
      }
    }

    /* ── META TAGS & SHARE BAR ── */
    .article-meta-footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      flex-wrap: wrap;

      .meta-tags-left {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;

        .tags-label {
          font-size: 0.92rem;
          color: #64748b;
          font-weight: 600;
        }

        .tags-list {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;

          .tag-teal-link {
            font-size: 0.92rem;
            color: #00a8a8;
            font-weight: 600;
            cursor: pointer;
            transition: color 0.18s ease;

            &:hover {
              color: #007979;
              text-decoration: underline;
            }
          }

          .tag-comma {
            color: #94a3b8;
          }
        }
      }

      .meta-share-right {
        display: flex;
        align-items: center;
        gap: 12px;

        .share-label {
          font-size: 0.92rem;
          color: #64748b;
          font-weight: 600;
        }

        .share-buttons-group {
          display: flex;
          align-items: center;
          gap: 8px;

          .btn-share-circle {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #00a8a8;
            color: #ffffff;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.85rem;
            font-weight: 700;
            transition: all 0.2s ease;

            &:hover {
              background: #008f8f;
              transform: scale(1.1);
            }

            .share-icon-x {
              font-family: serif;
              font-size: 0.9rem;
            }

            .share-icon-in {
              font-size: 0.75rem;
            }
          }
        }
      }
    }

    /* ── CONTACT SECTION (SEE AI IN ACTION) ── */
    .contact-cta-section {
      position: relative;
      background: #008888 url('/images/cargo-ship-hero.jpg') center center / cover no-repeat;
      padding: 96px 32px;
      color: #ffffff;
      overflow: hidden;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    .contact-cta-bg-overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(105deg, rgba(0, 168, 168, 0.94) 0%, rgba(0, 140, 145, 0.90) 55%, rgba(0, 110, 120, 0.85) 100%);
      z-index: 1;
    }

    .contact-cta-container {
      position: relative;
      z-index: 2;
      max-width: 1240px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 64px;

      @media (max-width: 992px) {
        flex-direction: column;
        text-align: center;
      }
    }

    .contact-cta-left {
      flex: 1;
      max-width: 540px;

      .contact-eyebrow {
        font-size: 0.95rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.85);
        display: block;
        margin-bottom: 12px;
      }

      .contact-headline {
        font-size: clamp(2.2rem, 3.5vw, 3rem);
        font-weight: 750;
        line-height: 1.15;
        letter-spacing: -0.025em;
        margin: 0 0 18px 0;
      }

      .contact-subtext {
        font-size: 1.05rem;
        line-height: 1.65;
        color: rgba(255, 255, 255, 0.9);
        margin-bottom: 32px;
      }
    }

    .contact-cta-actions {
      display: flex;
      align-items: center;
      gap: 16px;

      @media (max-width: 992px) {
        justify-content: center;
      }
    }

    .btn-pill-navy {
      padding: 13px 32px;
      border-radius: 999px;
      background: #060d26;
      color: #ffffff;
      font-size: 0.95rem;
      font-weight: 700;
      border: 1px solid rgba(255, 255, 255, 0.15);
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
      transition: all 0.22s ease;

      &:hover {
        background: #0b1740;
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      }
    }

    .btn-pill-white {
      padding: 13px 32px;
      border-radius: 999px;
      background: #ffffff;
      color: #040920;
      font-size: 0.95rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      transition: all 0.22s ease;

      &:hover {
        background: #f1f5f9;
        transform: translateY(-2px);
      }
    }

    .contact-cta-right {
      flex: 1;
      max-width: 520px;
      width: 100%;
    }

    .contact-glass-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .form-group-pill {
      width: 100%;
    }

    .pill-input {
      width: 100%;
      height: 54px;
      padding: 0 24px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.12);
      border: 1.5px solid rgba(255, 255, 255, 0.45);
      color: #ffffff;
      font-size: 0.96rem;
      outline: none;
      transition: all 0.22s ease;

      &::placeholder {
        color: rgba(255, 255, 255, 0.7);
      }

      &:focus {
        border-color: #ffffff;
        background: rgba(255, 255, 255, 0.2);
        box-shadow: 0 0 16px rgba(255, 255, 255, 0.3);
      }
    }

    .pill-textarea {
      width: 100%;
      padding: 18px 24px;
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.12);
      border: 1.5px solid rgba(255, 255, 255, 0.45);
      color: #ffffff;
      font-size: 0.96rem;
      outline: none;
      resize: none;
      font-family: inherit;
      transition: all 0.22s ease;

      &::placeholder {
        color: rgba(255, 255, 255, 0.7);
      }

      &:focus {
        border-color: #ffffff;
        background: rgba(255, 255, 255, 0.2);
        box-shadow: 0 0 16px rgba(255, 255, 255, 0.3);
      }
    }

    .recaptcha-card {
      background: #f9f9f9;
      border: 1px solid #d3d3d3;
      border-radius: 4px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      max-width: 290px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);

      .recaptcha-checkbox-label {
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
      }

      .recaptcha-native-checkbox {
        display: none;
      }

      .recaptcha-custom-box {
        width: 24px;
        height: 24px;
        border-radius: 3px;
        border: 2px solid #c1c1c1;
        background: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: border-color 0.2s ease;

        &.checked {
          border-color: #00a8a8;
        }
      }

      .recaptcha-label-text {
        font-size: 0.88rem;
        color: #282727;
        font-weight: 500;
      }

      .recaptcha-branding {
        display: flex;
        flex-direction: column;
        align-items: center;

        .re-text {
          font-size: 0.58rem;
          color: #555555;
          margin-top: 2px;
        }
      }
    }

    .contact-error-msg {
      font-size: 0.85rem;
      color: #ffd2d2;
      background: rgba(220, 38, 38, 0.35);
      border: 1px solid rgba(239, 68, 68, 0.6);
      padding: 8px 16px;
      border-radius: 8px;
      margin: 0;
    }

    .btn-send-pill {
      width: 100%;
      height: 52px;
      border-radius: 999px;
      background: #ffffff;
      color: #008888;
      font-size: 1rem;
      font-weight: 750;
      border: none;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
      transition: all 0.22s ease;

      &:hover {
        background: #f0fdfa;
        transform: translateY(-2px);
        box-shadow: 0 8px 26px rgba(0, 0, 0, 0.3);
      }
    }

    .contact-success-box {
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.4);
      border-radius: 20px;
      padding: 36px 28px;
      text-align: center;
      backdrop-filter: blur(10px);

      .success-icon-badge {
        width: 54px;
        height: 54px;
        border-radius: 50%;
        background: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 16px;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
      }

      .success-title {
        font-size: 1.35rem;
        font-weight: 750;
        margin: 0 0 8px 0;
        color: #ffffff;
      }

      .success-desc {
        font-size: 0.95rem;
        color: rgba(255, 255, 255, 0.88);
        line-height: 1.6;
        margin: 0 0 20px 0;
      }

      .btn-reset-contact {
        padding: 10px 24px;
        border-radius: 999px;
        background: #ffffff;
        color: #008888;
        font-size: 0.9rem;
        font-weight: 700;
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;

        &:hover {
          background: #f0fdfa;
        }
      }
    }

    /* ── ENTERPRISE GLOBAL FOOTER ── */
    .enterprise-footer {
      background: #070e28;
      color: #cbd5e1;
      padding: 80px 0 36px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      position: relative;
    }

    .footer-grid {
      display: grid;
      grid-template-columns: 2fr 1fr 1.2fr 1.2fr 2fr;
      gap: 36px;
      margin-bottom: 60px;

      @media (max-width: 1100px) {
        grid-template-columns: 1fr 1fr;
        gap: 32px;
      }

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .footer-col-brand {
      .footer-brand-logo {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 14px;
      }

      .brand-shield-icon {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 212, 212, 0.12);
        border: 1px solid rgba(0, 212, 212, 0.3);
        border-radius: 10px;
        flex-shrink: 0;
      }

      .brand-text-wrap {
        display: flex;
        flex-direction: column;
      }

      .brand-name {
        font-size: 1.45rem;
        font-weight: 800;
        color: #ffffff;
        letter-spacing: -0.3px;
        line-height: 1.1;
      }

      .brand-tld {
        color: #00d4d4;
      }

      .brand-sub {
        display: block;
        font-size: 0.74rem;
        color: #94a3b8;
        font-weight: 500;
        letter-spacing: 0.02em;
        margin-top: 2px;
      }

      .footer-slogan {
        font-size: 0.95rem;
        color: #94a3b8;
        line-height: 1.5;
        margin: 0 0 10px 0;
      }

      .footer-email {
        font-size: 0.88rem;
        color: #cbd5e1;
        margin-bottom: 22px;

        a {
          color: #00d4d4;
          text-decoration: none;
          &:hover { text-decoration: underline; }
        }
      }

      .footer-social-row {
        display: flex;
        align-items: center;
        gap: 10px;

        .footer-social-btn {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: #00a8a8;
          color: #050b24;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.22s ease;

          &:hover {
            background: #00d4d4;
            transform: translateY(-2px);
          }
        }
      }
    }

    .footer-heading {
      font-size: 1.05rem;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 18px 0;
      letter-spacing: 0.02em;
    }

    .footer-nav-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;

      li a {
        color: #94a3b8;
        font-size: 0.9rem;
        text-decoration: none;
        cursor: pointer;
        transition: color 0.18s ease;

        &:hover {
          color: #00d4d4;
        }
      }
    }

    .footer-col-location {
      @media (max-width: 1100px) {
        grid-column: span 2;
      }
      @media (max-width: 640px) {
        grid-column: span 1;
      }

      .location-tabs-bar {
        display: flex;
        gap: 4px;
        margin-bottom: 0;
      }

      .loc-tab-btn {
        padding: 8px 18px;
        font-size: 0.82rem;
        font-weight: 750;
        border-radius: 8px 8px 0 0;
        border: none;
        background: #111a3b;
        color: #94a3b8;
        cursor: pointer;
        transition: all 0.2s ease;
        text-transform: uppercase;

        &.active {
          background: #ffffff;
          color: #050b24;
        }
      }

      .location-card-content {
        background: #ffffff;
        border-radius: 0 8px 8px 8px;
        padding: 20px 22px;
        color: #1e293b;
        min-height: 120px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);

        .loc-company-title {
          display: block;
          font-size: 0.85rem;
          font-weight: 800;
          color: #050b24;
          letter-spacing: 0.03em;
          margin-bottom: 4px;
        }

        .loc-address-line {
          font-size: 0.82rem;
          color: #64748b;
          line-height: 1.5;
          margin: 0;
        }
      }
    }

    .footer-bottom-bar {
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-top: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;

      .footer-legal-links {
        display: flex;
        align-items: center;
        gap: 12px;

        .legal-link {
          color: #94a3b8;
          font-size: 0.85rem;
          text-decoration: none;
          &:hover { color: #00d4d4; }
        }

        .legal-sep {
          color: rgba(255, 255, 255, 0.2);
        }
      }

      .footer-copyright {
        font-size: 0.82rem;
        color: #64748b;
      }
    }

    .btn-floating-top {
      position: fixed;
      bottom: 28px;
      right: 28px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #00a8a8;
      color: #ffffff;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 20px rgba(0, 168, 168, 0.4);
      transition: all 0.25s ease;
      z-index: 90;

      &:hover {
        background: #008f8f;
        transform: translateY(-3px);
      }
    }

    .not-found-container {
      max-width: 600px;
      margin: 120px auto;
      padding: 48px;
      text-align: center;
    }
  `],
})
export class BlogDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly blogService = inject(BlogService);
  readonly auth = inject(AuthService);
  private readonly toastService = inject(ToastService);

  readonly blogId = signal<string>('');
  readonly blog = computed<BlogPost | undefined>(() =>
    this.blogService.getBlogById(this.blogId())
  );

  readonly activeOfficeTab = signal<'usa' | 'pakistan' | 'uae'>('usa');
  readonly contactEmail = signal<string>('');
  readonly contactMessage = signal<string>('');
  readonly isCaptchaChecked = signal<boolean>(false);
  readonly contactSubmitted = signal<boolean>(false);
  readonly contactError = signal<string>('');

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id') || '';
      this.blogId.set(id);
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  }

  async downloadPdf(b: BlogPost): Promise<void> {
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      let y = margin;

      // ── Header Background Bar ──
      doc.setFillColor(11, 19, 43); // Deep TradeGuard Navy #0B132B
      doc.rect(0, 0, pageWidth, 26, 'F');

      // ── Header Branding Text ──
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('TradeGuard® Intelligence', margin, 12);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(0, 212, 212); // Teal
      doc.text('Bank-Grade Trade Finance Compliance & Document AI', margin, 19);

      doc.setTextColor(180, 200, 215);
      doc.setFontSize(8);
      doc.text('InfoTech Group White Paper', pageWidth - margin - 42, 15);

      y = 36;

      // ── Category Pill ──
      doc.setFillColor(230, 248, 246);
      doc.roundedRect(margin, y, Math.min(contentWidth, 75), 6.5, 2, 2, 'F');
      doc.setTextColor(2, 128, 144);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(b.category.toUpperCase(), margin + 3.5, y + 4.5);

      y += 12;

      // ── Document Title ──
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14.5);
      doc.setTextColor(15, 23, 42);
      const titleLines = doc.splitTextToSize(b.title, contentWidth);
      doc.text(titleLines, margin, y);
      y += titleLines.length * 6.2 + 4;

      // ── Meta Details ──
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`${b.date}   •   ${b.readTime}   •   Author: ${b.author} (${b.authorRole})`, margin, y);
      y += 4;

      // ── Horizontal Rule ──
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.4);
      doc.line(margin, y, pageWidth - margin, y);
      y += 9;

      // ── Section 1: Executive Summary ──
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor(11, 19, 43);
      doc.text('Executive Summary', margin, y);
      y += 6.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(51, 65, 85);

      const summaryParagraphs = b.executiveSummary || b.content;
      for (const para of summaryParagraphs) {
        const lines = doc.splitTextToSize(para, contentWidth);
        if (y + lines.length * 5 > pageHeight - 24) {
          doc.addPage();
          y = margin;
        }
        doc.text(lines, margin, y);
        y += lines.length * 5 + 3.5;
      }

      // ── Section 2: In-Depth Operational Analysis ──
      if (b.content && b.executiveSummary) {
        y += 3;
        if (y > pageHeight - 35) {
          doc.addPage();
          y = margin;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(11, 19, 43);
        doc.text('Technical Analysis & Regulatory Citations', margin, y);
        y += 6.5;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 65, 85);

        for (const para of b.content) {
          const lines = doc.splitTextToSize(para, contentWidth);
          if (y + lines.length * 5 > pageHeight - 24) {
            doc.addPage();
            y = margin;
          }
          doc.text(lines, margin, y);
          y += lines.length * 5 + 3.5;
        }
      }

      // ── Section 3: Topic Keywords ──
      if (b.tags && b.tags.length > 0) {
        y += 3;
        if (y > pageHeight - 24) {
          doc.addPage();
          y = margin;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(100, 116, 139);
        doc.text('Document Keywords: ' + b.tags.join('  |  '), margin, y);
        y += 6;
      }

      // ── Page Footers ──
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text(
          'TradeGuard® Intelligence by InfoTech Group • Confidential Research Series',
          margin,
          pageHeight - 7.5
        );
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 16, pageHeight - 7.5);
      }

      const safeTitle = b.title.slice(0, 35).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      doc.save(`${b.id}_${safeTitle}.pdf`);
      this.toastService.success('Article PDF downloaded successfully!');
    } catch (err) {
      console.error('PDF generation error', err);
      this.toastService.error('Failed to generate PDF. Please try again.');
    }
  }

  filterByTag(tag: string): void {
    this.toastService.info(`Viewing topic: ${tag}`);
  }

  shareOnTwitter(b: BlogPost): void {
    const text = encodeURIComponent(`Read "${b.title}" via TradeGuard Intelligence by InfoTech Group`);
    const url = encodeURIComponent(window.location.href);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
  }

  shareOnLinkedIn(b: BlogPost): void {
    const url = encodeURIComponent(window.location.href);
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`, '_blank');
  }

  copyArticleLink(): void {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(window.location.href).then(() => {
        this.toastService.success('Article URL copied to clipboard!');
      }).catch(() => {
        this.toastService.info(`Article link: ${window.location.href}`);
      });
    } else {
      this.toastService.info(`Article link: ${window.location.href}`);
    }
  }

  scrollToContact(): void {
    const el = document.getElementById('contact');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }

  focusContactForm(): void {
    this.scrollToContact();
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.pill-input');
      if (input) input.focus();
    }, 400);
  }

  toggleCaptcha(): void {
    this.isCaptchaChecked.update((v) => !v);
    this.contactError.set('');
  }

  submitContact(event: Event): void {
    event.preventDefault();
    const email = this.contactEmail().trim();
    const msg = this.contactMessage().trim();

    if (!email || !email.includes('@')) {
      this.contactError.set('Please provide a valid business email address.');
      return;
    }
    if (!msg) {
      this.contactError.set('Please provide your project message.');
      return;
    }
    if (!this.isCaptchaChecked()) {
      this.contactError.set('Please check the verification box to proceed.');
      return;
    }

    this.contactSubmitted.set(true);
    this.contactError.set('');
    this.toastService.success('Your trade inquiry has been dispatched to the compliance desk!');
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
