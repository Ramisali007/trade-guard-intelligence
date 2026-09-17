import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ThemeService } from './services/theme.service';
import { DocumentsService } from './services/documents.service';
import { AuthService } from './services/auth.service';
import { BlogService } from './services/blog.service';
import type { HealthResponse } from './models/api.models';
import { Icon } from './shared/components/icon';
import { ToastContainer } from './shared/components/toast-container';
import { Chatbot } from './shared/components/chatbot';
import { LoginModalComponent } from './shared/components/login-modal.component';
import {
  StaggeredMenuComponent,
  type StaggeredMenuItem,
  type StaggeredMenuSocialItem,
} from './shared/components/staggered-menu';

export interface SearchItem {
  id: string;
  type: 'blog' | 'module';
  title: string;
  category: string;
  badge: string;
  description: string;
  tags?: string[];
  route: string;
  fragment?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    Icon,
    ToastContainer,
    Chatbot,
    StaggeredMenuComponent,
    LoginModalComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly themeService = inject(ThemeService);
  private readonly docsService = inject(DocumentsService);
  private readonly router = inject(Router);
  private readonly blogService = inject(BlogService);
  readonly auth = inject(AuthService);

  protected readonly health = signal<HealthResponse | null>(null);
  protected readonly headerScrolled = signal<boolean>(false);
  protected readonly currentUrl = signal<string>(this.router.url);

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe((e) => {
        this.currentUrl.set(e.urlAfterRedirects);
      });
  }

  /** Dynamic context pill header reflecting active page / menu destination */
  protected readonly currentRouteHeader = computed<{ category: string; title: string }>(() => {
    const rawUrl = this.currentUrl() || this.router.url || '';
    const cleanUrl = rawUrl.split('?')[0].split('#')[0];
    const normUrl = cleanUrl.replace(/\/+$/, '') || '/';

    if (normUrl === '/dashboard') {
      return { category: 'Trade Intelligence Operations', title: 'Compliance Workbench' };
    }
    if (normUrl === '/analytics' || normUrl.startsWith('/analytics/')) {
      return { category: 'Trade Intelligence Operations', title: 'Analytics & System Health' };
    }
    if (normUrl === '/compare' || normUrl.startsWith('/compare/')) {
      return { category: 'Trade Intelligence Operations', title: 'Reconciliation Studio' };
    }
    if (normUrl === '/auditor' || normUrl.startsWith('/auditor/')) {
      return { category: 'Trade Intelligence Operations', title: 'Regulatory Auditor' };
    }
    if (normUrl === '/customers' || normUrl.startsWith('/customers/')) {
      return { category: 'Trade Intelligence Operations', title: 'Customer 360' };
    }
    if (normUrl === '/import' || normUrl.startsWith('/import/')) {
      return { category: 'Trade Intelligence Operations', title: 'Master Import Center' };
    }
    if (normUrl === '/sources' || normUrl.startsWith('/sources/')) {
      return { category: 'Trade Intelligence Operations', title: 'Sanctions & Feeds SLA' };
    }
    if (normUrl.startsWith('/analysis')) {
      return { category: 'Trade Intelligence Operations', title: 'Document Analysis' };
    }
    if (normUrl.startsWith('/processing')) {
      return { category: 'Trade Intelligence Operations', title: 'Live Ingestion Engine' };
    }
    if (normUrl.startsWith('/blog')) {
      return { category: 'Trade Intelligence Operations', title: 'Regulatory Intelligence' };
    }
    if (normUrl === '/') {
      return { category: 'Trade Intelligence Operations', title: 'Platform Overview' };
    }

    return { category: 'Trade Intelligence Operations', title: 'Compliance Workbench' };
  });

  protected readonly navMenuItems: StaggeredMenuItem[] = [
    { label: 'Platform Overview', link: '/', ariaLabel: 'Go to TradeGuard Platform Overview' },
    { label: 'Compliance Workbench', link: '/dashboard', ariaLabel: 'Go to Trade Intelligence Dashboard' },
    { label: 'Analytics & System Health', link: '/analytics', ariaLabel: 'Real-time System Health & Telemetry Analytics' },
    { label: 'Reconciliation Studio', link: '/compare', ariaLabel: 'Cross-Document Reconciliation Studio' },
    { label: 'Regulatory Auditor', link: '/auditor', ariaLabel: 'Compliance & Audit Workflow' },
    { label: 'Customer 360', link: '/customers', ariaLabel: 'Customer Profiles & Risk History' },
    { label: 'Master Import Center', link: '/import', ariaLabel: 'Enterprise Import Center & Master Data Management' },
    { label: 'Sanctions & Feeds SLA', link: '/sources', ariaLabel: 'Intelligence Feeds & Sanctions Sync' },
  ];

  protected readonly navSocialItems: StaggeredMenuSocialItem[] = [
    { label: 'GitHub', link: 'https://github.com/Ramisali007/trade-guard-intelligence' },
    { label: 'ICC Rules', link: 'https://iccwbo.org' },
    { label: 'OFAC Sanctions', link: 'https://ofac.treasury.gov' },
    { label: 'Health API', link: '/api/health' },
  ];

  protected readonly menuColors = ['#38bdf8', '#0284c7', '#0369a1', '#0f172a'];

  /* ── Search State ── */
  protected readonly searchModalOpen = signal<boolean>(false);
  protected readonly searchQuery = signal<string>('');
  protected readonly selectedFilter = signal<'all' | 'articles' | 'modules'>('all');

  private readonly platformModules: SearchItem[] = [
    {
      id: 'mod-compliance',
      type: 'module',
      title: 'Compliance Workbench',
      category: 'Core Platform',
      badge: 'Workbench',
      description: 'AI document examination, automated discrepancy extraction, OCR validation, and LC compliance checking under UCP 600.',
      tags: ['UCP 600', 'OCR', 'Document Exam', 'Discrepancies', 'Letters of Credit'],
      route: '/dashboard',
    },
    {
      id: 'mod-analytics',
      type: 'module',
      title: 'Analytics & System Health',
      category: 'Telemetry & Ops',
      badge: 'Analytics',
      description: 'Real-time telemetry, volume trends, AI inference health, latency histograms, and multi-tier compliance risk analytics.',
      tags: ['Analytics', 'Health', 'Throughput', 'Telemetry', 'Latency', 'AI Model', 'SLA'],
      route: '/analytics',
    },
    {
      id: 'mod-reconciliation',
      type: 'module',
      title: 'Cross-Document Reconciliation Studio',
      category: 'Audit & Rules',
      badge: 'Reconciliation',
      description: 'Multi-document consistency check: Commercial Invoice vs Bill of Lading vs LC under ISBP 745 and UCP 600.',
      tags: ['ISBP 745', 'UCP 600', 'Discrepancy Check', 'Invoice', 'Bill of Lading'],
      route: '/compare',
    },
    {
      id: 'mod-auditor',
      type: 'module',
      title: 'Regulatory Auditor & Rule Engine',
      category: 'Regulatory',
      badge: 'Auditor',
      description: 'Regulatory audit trail, dual-use goods export control checks, rule violation reporting, and compliance verification.',
      tags: ['Audit Trail', 'Dual-Use', 'Export Control', 'Violations', 'Regulators'],
      route: '/auditor',
    },
    {
      id: 'mod-customer360',
      type: 'module',
      title: 'Customer 360 Risk Profiler',
      category: 'Risk Intelligence',
      badge: 'Customer 360',
      description: 'Counterparty entity risk scoring, PEP screening, watchlist hits, and historical transaction risk analytics.',
      tags: ['KYC', 'PEP', 'Watchlist', 'Counterparty', 'Risk Score'],
      route: '/customers',
    },
    {
      id: 'mod-import',
      type: 'module',
      title: 'Master Import Center',
      category: 'Data Management',
      badge: 'Import Center',
      description: 'Enterprise batch document ingestion, MT700/710 SWIFT translation into ISO 20022 schemas, and master data indexing.',
      tags: ['Batch Upload', 'MT700', 'ISO 20022', 'SWIFT MX', 'Ingestion'],
      route: '/import',
    },
    {
      id: 'mod-sources',
      type: 'module',
      title: 'Sanctions & Feeds SLA Monitor',
      category: 'Intelligence Feeds',
      badge: 'Feeds SLA',
      description: 'Real-time synchronization SLA and health tracking for OFAC, UN, EU, UK, and SBP sanctions feeds.',
      tags: ['OFAC', 'Sanctions', 'SBP', 'EU Lists', 'SLA Feeds'],
      route: '/sources',
    },
    {
      id: 'mod-solutions',
      type: 'module',
      title: 'TradeGuard Solutions Architecture',
      category: 'Overview',
      badge: 'Solutions',
      description: 'Complete architecture overview of TradeGuard intelligence: Digitization, TBML detection, and Core Banking APIs.',
      tags: ['Solutions', 'Architecture', 'Overview', 'Security', 'Finastra'],
      route: '/',
      fragment: 'solutions',
    },
    {
      id: 'mod-faq',
      type: 'module',
      title: 'Frequently Asked Questions',
      category: 'Support',
      badge: 'FAQ',
      description: 'Common questions on bank integration, UCP 600 discrepancy automation, security certifications, and AI accuracy.',
      tags: ['FAQ', 'Support', 'Integration', 'Questions', 'Security'],
      route: '/',
      fragment: 'faq',
    },
  ];

  private readonly allSearchItems = computed<SearchItem[]>(() => {
    const blogs: SearchItem[] = this.blogService.getBlogs().map((b) => ({
      id: b.id,
      type: 'blog',
      title: b.title,
      category: b.category,
      badge: 'Article',
      description: b.excerpt,
      tags: b.tags,
      route: `/blog/${b.id}`,
    }));
    return [...this.platformModules, ...blogs];
  });

  readonly allResultsCount = computed<number>(() => this.allSearchItems().length);
  readonly articlesCount = computed<number>(() => this.allSearchItems().filter((i) => i.type === 'blog').length);
  readonly modulesCount = computed<number>(() => this.allSearchItems().filter((i) => i.type === 'module').length);

  readonly filteredSearchResults = computed<SearchItem[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const filter = this.selectedFilter();
    let items = this.allSearchItems();

    if (filter === 'articles') {
      items = items.filter((i) => i.type === 'blog');
    } else if (filter === 'modules') {
      items = items.filter((i) => i.type === 'module');
    }

    if (!q) {
      return items.slice(0, 8);
    }

    return items.filter((i) => {
      const matchTitle = i.title.toLowerCase().includes(q);
      const matchDesc = i.description.toLowerCase().includes(q);
      const matchCat = i.category.toLowerCase().includes(q);
      const matchTags = i.tags?.some((t) => t.toLowerCase().includes(q)) ?? false;
      return matchTitle || matchDesc || matchCat || matchTags;
    });
  });

  ngOnInit(): void {
    this.docsService.health().subscribe({
      next: (h) => this.health.set(h),
      error: () => { },
    });
  }

  protected readonly activeDropdown = signal<string | null>(null);
  private closeTimeout: ReturnType<typeof setTimeout> | null = null;

  protected openDropdown(name: string): void {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = null;
    }
    this.activeDropdown.set(name);
  }

  protected scheduleClose(): void {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
    }
    this.closeTimeout = setTimeout(() => {
      this.activeDropdown.set(null);
      this.closeTimeout = null;
    }, 200);
  }

  protected cancelClose(): void {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = null;
    }
  }

  protected toggleDropdown(name: string): void {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = null;
    }
    this.activeDropdown.update((current) => (current === name ? null : name));
  }

  protected closeDropdown(): void {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = null;
    }
    this.activeDropdown.set(null);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.activeDropdown()) return;
    const target = event.target as HTMLElement | null;
    if (target && !target.closest('.nav-dropdown-item')) {
      this.closeDropdown();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.activeDropdown()) {
      this.closeDropdown();
    }
  }

  protected onWorkbenchAction(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
    } else {
      this.auth.openLoginModal();
    }
  }

  protected toggleSearchModal(): void {
    this.searchModalOpen.update((v) => !v);
  }

  protected openSearchModal(): void {
    this.searchModalOpen.set(true);
  }

  protected closeSearchModal(): void {
    this.searchModalOpen.set(false);
  }

  protected onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }

  protected clearSearchQuery(): void {
    this.searchQuery.set('');
  }

  protected setFilter(filter: 'all' | 'articles' | 'modules'): void {
    this.selectedFilter.set(filter);
  }

  protected setSearchQuery(query: string): void {
    this.searchQuery.set(query);
  }

  protected selectSearchResult(item: SearchItem): void {
    this.closeSearchModal();
    if (item.fragment) {
      this.router.navigate([item.route], { fragment: item.fragment }).then(() => {
        setTimeout(() => {
          const el = document.getElementById(item.fragment!);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth' });
          }
        }, 100);
      });
    } else {
      this.router.navigate([item.route]);
    }
  }

  @HostListener('window:keydown', ['$event'])
  protected onGlobalKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.toggleSearchModal();
    } else if (event.key === 'Escape' && this.searchModalOpen()) {
      this.closeSearchModal();
    }
  }

  @HostListener('window:scroll')
  protected onScroll(): void {
    this.headerScrolled.set(window.scrollY > 10);
  }

  protected onNotificationBell(): void {
    // Show a toast indicating no new notifications
    // (In production, this would open a notifications panel)
    const messages = [
      'No new compliance alerts at this time.',
      'All sanctions feed syncs are up to date.',
      'No pending document reviews.',
    ];
    const msg = messages[Math.floor(Math.random() * messages.length)];
    // Use a simple alert-style approach via DOM
    this.notificationMessage.set(msg);
    this.showNotificationPanel.update(v => !v);
  }

  protected readonly showNotificationPanel = signal<boolean>(false);
  protected readonly notificationMessage = signal<string>('');
}
