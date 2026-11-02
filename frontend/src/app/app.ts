import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { ThemeService } from './services/theme.service';
import { AuthService } from './services/auth.service';
import { RouteAccess } from './services/route-access';
import { Icon } from './shared/components/icon';
import { ToastContainer } from './shared/components/toast-container';
import { Chatbot } from './shared/components/chatbot';
import { LoginModalComponent } from './shared/components/login-modal.component';
import { linkInStage } from './shared/stage';
import { describeKpiOnHover } from './shared/kpi-tooltip';
import { StaggeredMenuComponent, type StaggeredMenuItem } from './shared/components/staggered-menu';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    DatePipe,
    Icon,
    ToastContainer,
    Chatbot,
    StaggeredMenuComponent,
    LoginModalComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly themeService = inject(ThemeService);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  private readonly routeAccess = inject(RouteAccess);

  protected readonly headerScrolled = signal<boolean>(false);
  /** The drawer lists only the screens this role may open (same permissions as the route guards). */
  private readonly allNavItems: Array<StaggeredMenuItem & { anyOf: string[] }> = [
    { label: 'Dashboard', link: '/workspace', ariaLabel: 'Dashboard: your pending work and screens', anyOf: [] },
    { label: 'Pre-Shipment', link: '/trade-cases', ariaLabel: 'Pre-Shipment: import LC requests from application to closure', anyOf: ['tradecase.view.own', 'tradecase.view.assigned', 'tradecase.view.all'] },
    { label: 'Post-Shipment', link: '/post-shipment', ariaLabel: 'Send the shipping documents for an approved request', anyOf: ['tradecase.postshipment.apply'] },
    { label: 'Verification Controls', link: '/verification', ariaLabel: 'Which checks against official sources are bank controls, and the state of each source', anyOf: ['tradecase.verification.view'] },
    { label: 'Compliance Workbench', link: '/dashboard', ariaLabel: 'Go to Trade Intelligence Dashboard', anyOf: ['documents.read'] },
    { label: 'Analytics & System Health', link: '/analytics', ariaLabel: 'Real-time System Health & Telemetry Analytics', anyOf: ['analytics.read'] },
    { label: 'Reconciliation Studio', link: '/compare', ariaLabel: 'Cross-Document Reconciliation Studio', anyOf: ['documents.read'] },
    { label: 'Regulatory Auditor', link: '/auditor', ariaLabel: 'Compliance & Audit Workflow', anyOf: ['documents.read'] },
    { label: 'Customer 360', link: '/customers', ariaLabel: 'Customer Profiles & Risk History', anyOf: ['customers360.read'] },
    { label: 'Master Import Center', link: '/import', ariaLabel: 'Enterprise Import Center & Master Data Management', anyOf: ['masterdata.read'] },
    { label: 'Sanctions & Feeds SLA', link: '/sources', ariaLabel: 'Intelligence Feeds & Sanctions Sync', anyOf: ['compliance.sources.read'] },
    { label: 'Audit Explorer', link: '/audit', ariaLabel: 'Audit trails and hash-chain verification', anyOf: ['audit.overview'] },
    { label: 'Administration', link: '/admin', ariaLabel: 'Accounts, access requests and platform health', anyOf: ['admin.users.view', 'admin.rbac.view', 'system.health.view'] },
    { label: 'Platform Overview', link: '/', ariaLabel: 'Go to TradeGuard Platform Overview', anyOf: [] },
  ];

  protected readonly navMenuItems = computed<StaggeredMenuItem[]>(() => {
    this.auth.currentUser();
    const stage = this.auth.stage();
    return this.allNavItems
      .filter((i) => (i.anyOf.length === 0 || this.auth.canAny(...i.anyOf)) && linkInStage(i.link, stage))
      .map(({ anyOf: _anyOf, ...item }) => item);
  });

  protected onWorkbenchAction(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigate([this.routeAccess.canOpen('/dashboard') ? '/dashboard' : this.auth.homeRoute()]);
    } else {
      this.auth.openLoginModal();
    }
  }

  /** Hovering any headline box shows what it is (see kpi-tooltip.ts); boxes that lead somewhere keep their own wording. */
  @HostListener('document:mouseover', ['$event'])
  protected onHover(event: MouseEvent): void {
    describeKpiOnHover(event.target);
  }

  @HostListener('window:scroll')
  protected onScroll(): void {
    this.headerScrolled.set(window.scrollY > 10);
  }

}
