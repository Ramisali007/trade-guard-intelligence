import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-enterprise-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <!-- ================================================================= -->
    <!-- ENTERPRISE MULTI-COLUMN FOOTER (Matches Landing Page Theme)       -->
    <!-- ================================================================= -->
    <footer class="dashboard-enterprise-footer">
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
            <li><a routerLink="/" class="footer-link">Home</a></li>
            <li><a routerLink="/dashboard" class="footer-link">TradeGuard® Workbench <span class="external-arrow">&#8599;</span></a></li>
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
            <li><a (click)="scrollToWorkbench()" class="footer-link">Digitization &amp; OCR</a></li>
            <li><a routerLink="/dashboard" class="footer-link">TBML &amp; Compliance AI</a></li>
            <li><a routerLink="/dashboard" class="footer-link">Sanctions Screening</a></li>
            <li><a routerLink="/dashboard" class="footer-link">Document Exam</a></li>
            <li><a routerLink="/compare" class="footer-link">UCP 600 Reconciliation</a></li>
            <li><a routerLink="/customers" class="footer-link">Customer 360 &amp; KYC</a></li>
          </ul>
        </div>

        <!-- Column 4: Resources -->
        <div class="footer-col">
          <h4 class="footer-col-title">Resources</h4>
          <ul class="footer-links-list">
            <li><a routerLink="/auditor" class="footer-link">Point-in-Time Auditor</a></li>
            <li><a routerLink="/sources" class="footer-link">Sanctions Feeds SLA</a></li>
            <li><a routerLink="/import" class="footer-link">Master Reference Center</a></li>
            <li><a (click)="scrollToBlogs()" class="footer-link">PR &amp; White Papers</a></li>
            <li><a (click)="scrollToAbout()" class="footer-link">Expertise</a></li>
            <li><a href="https://infotechgroup.com/careers" target="_blank" rel="noopener noreferrer" class="footer-link">Careers</a></li>
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

    <!-- Teal Subfooter Bar -->
    <div class="dashboard-subfooter-bar">
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
              <p>All algorithm outputs, discrepancy matrices, and compliance decision audits remain the exclusive regulatory property of the executing institution under international trade banking regulations (ICC UCP 600 / ISBP 745).</p>
            }
          </div>
          <div class="legal-modal-footer">
            <button type="button" class="btn-legal-confirm" (click)="closeLegalModal()">Acknowledge</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      margin-top: auto;
    }

    /* ── Multi-Column Enterprise Footer ── */
    .dashboard-enterprise-footer {
      background: #040920;
      color: #cbd5e1;
      padding: 64px 0 48px;
      position: relative;
      overflow: hidden;
      border-top: 1px solid rgba(0, 168, 168, 0.25);
      width: 100%;
      box-sizing: border-box;
    }

    .footer-dot-backdrop {
      position: absolute;
      inset: 0;
      background-image: radial-gradient(rgba(0, 212, 212, 0.08) 1px, transparent 1px);
      background-size: 24px 24px;
      pointer-events: none;
    }

    .footer-container {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 0 clamp(20px, 2.5vw, 40px);
      box-sizing: border-box;
      position: relative;
      z-index: 2;
      display: grid;
      grid-template-columns: 1.4fr 1fr 1fr 1fr 1.35fr;
      gap: 36px;
    }

    .footer-col {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .footer-brand-logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-shield-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: rgba(0, 168, 168, 0.12);
      border: 1px solid rgba(0, 212, 212, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .brand-name {
      font-size: 1.3rem;
      font-weight: 800;
      color: #ffffff;
      display: block;
      line-height: 1.1;
    }

    .brand-tld {
      color: #00d4d4;
    }

    .brand-sub {
      font-size: 0.76rem;
      color: #94a3b8;
      display: block;
      letter-spacing: 0.2px;
    }

    .footer-brand-tagline {
      font-size: 0.95rem;
      font-weight: 600;
      color: #e2e8f0;
      margin: 0;
    }

    .footer-contact-link {
      font-size: 0.85rem;
      color: #00d4d4;
      text-decoration: none;
      transition: color 0.2s ease;
    }

    .footer-contact-link:hover {
      color: #5eead4;
      text-decoration: underline;
    }

    .footer-social-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 6px;
    }

    .social-circle-btn {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      transition: all 0.2s ease;
    }

    .social-circle-btn:hover {
      background: #00a8a8;
      color: #ffffff;
      border-color: #00d4d4;
      transform: translateY(-2px);
    }

    .footer-col-title {
      font-size: 0.92rem;
      font-weight: 750;
      color: #ffffff;
      margin: 0;
      letter-spacing: 0.3px;
    }

    .footer-links-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .footer-link {
      color: #94a3b8;
      font-size: 0.86rem;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .footer-link:hover {
      color: #00d4d4;
      padding-left: 3px;
    }

    .external-arrow {
      font-size: 0.75rem;
      color: #00d4d4;
      margin-left: 2px;
    }

    /* ── Office Tabs Switcher ── */
    .office-tabs-nav {
      display: flex;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 3px;
      gap: 4px;
    }

    .office-tab-btn {
      flex: 1;
      padding: 6px 0;
      border: none;
      background: transparent;
      color: #94a3b8;
      font-size: 0.72rem;
      font-weight: 750;
      letter-spacing: 0.4px;
      cursor: pointer;
      border-radius: 6px;
      transition: all 0.2s ease;
    }

    .office-tab-btn:hover {
      color: #ffffff;
    }

    .office-tab-btn.active {
      background: #00a8a8;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(0, 168, 168, 0.4);
    }

    .office-address-card {
      background: #ffffff;
      border-radius: 12px;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    }

    .office-branch-entry {
      border-left: 3px solid #00a8a8;
      padding-left: 10px;
    }

    .branch-name {
      font-size: 0.82rem;
      font-weight: 800;
      color: #040920;
      margin: 0 0 4px 0;
      letter-spacing: 0.3px;
    }

    .branch-address {
      font-size: 0.78rem;
      line-height: 1.45;
      color: #475569;
      margin: 0;
    }

    /* ── Subfooter Bar ── */
    .dashboard-subfooter-bar {
      background: #00a8a8;
      color: #ffffff;
      padding: 14px 32px;
      position: relative;
      font-size: 0.86rem;
      font-weight: 600;
      width: 100%;
      box-sizing: border-box;
    }

    .subfooter-container {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 0 clamp(20px, 2.5vw, 40px);
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }

    .subfooter-links-left {
      display: flex;
      align-items: center;
      gap: 24px;
    }

    .subfooter-link {
      color: #ffffff;
      text-decoration: none;
      cursor: pointer;
      transition: opacity 0.2s ease;
    }

    .subfooter-link:hover {
      opacity: 0.82;
      text-decoration: underline;
    }

    .subfooter-copy-right {
      color: #ffffff;
      font-size: 0.84rem;
    }

    .btn-floating-scrolltop {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #00a8a8;
      color: #ffffff;
      border: 2px solid rgba(255, 255, 255, 0.45);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 999;
      transition: all 0.25s ease;
    }

    .btn-floating-scrolltop:hover {
      background: #008888;
      transform: translateY(-3px);
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
    }

    /* ── Legal Modal Dialog ── */
    .legal-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(4, 9, 32, 0.75);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
    }

    .legal-modal-card {
      background: #ffffff;
      border-radius: 16px;
      width: 100%;
      max-width: 600px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .legal-modal-header {
      padding: 20px 24px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .legal-modal-header h3 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 700;
      color: #040920;
    }

    .btn-legal-close {
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: #64748b;
      line-height: 1;
    }

    .btn-legal-close:hover {
      color: #0f172a;
    }

    .legal-modal-body {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .legal-modal-body p {
      margin: 0;
      font-size: 0.92rem;
      line-height: 1.6;
      color: #334155;
    }

    .legal-modal-footer {
      padding: 16px 24px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: flex-end;
    }

    .btn-legal-confirm {
      padding: 9px 22px;
      border-radius: 999px;
      background: #00a8a8;
      color: #ffffff;
      font-size: 0.88rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-legal-confirm:hover {
      background: #008888;
    }

    @media (max-width: 992px) {
      .footer-container {
        grid-template-columns: 1fr 1fr;
        gap: 32px;
      }
      .footer-col-offices {
        grid-column: span 2;
      }
    }

    @media (max-width: 640px) {
      .footer-container {
        grid-template-columns: 1fr;
      }
      .footer-col-offices {
        grid-column: span 1;
      }
      .subfooter-container {
        flex-direction: column;
        text-align: center;
      }
      .subfooter-links-left {
        justify-content: center;
      }
    }
  `]
})
export class EnterpriseFooterComponent {
  private readonly router = inject(Router);

  protected readonly activeOfficeTab = signal<'usa' | 'pakistan' | 'uae'>('pakistan');
  protected readonly selectedLegalModal = signal<'privacy' | 'eula' | null>(null);

  openLegalModal(type: 'privacy' | 'eula'): void {
    this.selectedLegalModal.set(type);
  }

  closeLegalModal(): void {
    this.selectedLegalModal.set(null);
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  scrollToSolutions(): void {
    this.router.navigate(['/'], { fragment: 'solutions' }).then(() => {
      setTimeout(() => {
        const el = document.getElementById('solutions');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    });
  }

  scrollToBlogs(): void {
    this.router.navigate(['/'], { fragment: 'insights' }).then(() => {
      setTimeout(() => {
        const el = document.getElementById('insights') || document.getElementById('blog');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    });
  }

  scrollToAbout(): void {
    this.router.navigate(['/'], { fragment: 'about' }).then(() => {
      setTimeout(() => {
        const el = document.getElementById('about');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    });
  }

  scrollToFaq(): void {
    this.router.navigate(['/'], { fragment: 'faq' }).then(() => {
      setTimeout(() => {
        const el = document.getElementById('faq');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    });
  }

  scrollToWorkbench(): void {
    this.router.navigate(['/dashboard']);
  }
}
