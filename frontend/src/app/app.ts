import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { ThemeService } from './services/theme.service';
import { DocumentsService } from './services/documents.service';
import type { HealthResponse } from './models/api.models';
import { Icon } from './shared/components/icon';
import { ToastContainer } from './shared/components/toast-container';
import { Chatbot } from './shared/components/chatbot';
import {
  StaggeredMenuComponent,
  type StaggeredMenuItem,
  type StaggeredMenuSocialItem,
} from './shared/components/staggered-menu';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    Icon,
    ToastContainer,
    Chatbot,
    StaggeredMenuComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly themeService = inject(ThemeService);
  private readonly docsService = inject(DocumentsService);

  protected readonly health = signal<HealthResponse | null>(null);

  protected readonly navMenuItems: StaggeredMenuItem[] = [
    { label: 'Dashboard', link: '/', ariaLabel: 'Go to Trade Intelligence Dashboard' },
    { label: 'Import Center', link: '/import', ariaLabel: 'Enterprise Import Center & Master Data Management' },
    { label: 'Customer 360', link: '/customers', ariaLabel: 'Customer Profiles & Risk History' },
    { label: 'Reconciliation', link: '/compare', ariaLabel: 'Cross-Document Reconciliation Studio' },
    { label: 'Auditor Workbench', link: '/auditor', ariaLabel: 'Compliance & Audit Workflow' },
    { label: 'Regulatory Feeds', link: '/sources', ariaLabel: 'Intelligence Feeds & Sanctions Sync' },
  ];

  protected readonly navSocialItems: StaggeredMenuSocialItem[] = [
    { label: 'GitHub', link: 'https://github.com/Ramisali007/trade-guard-intelligence' },
    { label: 'ICC Rules', link: 'https://iccwbo.org' },
    { label: 'OFAC Sanctions', link: 'https://ofac.treasury.gov' },
    { label: 'Health API', link: 'http://localhost:4000/api/health' },
  ];

  protected readonly menuColors = ['#38bdf8', '#0284c7', '#0369a1', '#0f172a'];

  ngOnInit(): void {
    this.docsService.health().subscribe({
      next: (h) => this.health.set(h),
      error: () => { },
    });
  }

  protected toggleTheme(): void {
    this.themeService.toggle();
  }
}

