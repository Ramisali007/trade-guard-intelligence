import { Routes } from '@angular/router';
import { authGuard, permissionGuard } from './guards/auth.guard';

const CASE_VIEW = ['tradecase.view.own', 'tradecase.view.assigned', 'tradecase.view.all'];

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/landing/landing.component').then(
        (m) => m.LandingComponent
      ),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['documents.read'] },
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent
      ),
  },
  {
    path: 'analytics',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['analytics.read'] },
    loadComponent: () =>
      import('./pages/analytics/analytics.component').then(
        (m) => m.AnalyticsComponent
      ),
  },
  {
    path: 'processing/:id',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['documents.read'] },
    loadComponent: () =>
      import('./pages/processing/processing.component').then(
        (m) => m.ProcessingComponent
      ),
  },
  {
    path: 'analysis/:id',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['documents.read'] },
    loadComponent: () =>
      import('./pages/analysis/analysis.component').then(
        (m) => m.AnalysisComponent
      ),
  },
  {
    path: 'compare',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['documents.read'] },
    loadComponent: () =>
      import('./pages/comparison/comparison.component').then(
        (m) => m.ComparisonComponent
      ),
  },
  {
    path: 'auditor',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['documents.read'] },
    loadComponent: () =>
      import('./pages/auditor/auditor.component').then(
        (m) => m.AuditorComponent
      ),
  },
  {
    path: 'sources',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['compliance.sources.read'] },
    loadComponent: () =>
      import('./pages/sources/sources-health.component').then(
        (m) => m.SourcesHealthComponent
      ),
  },
  {
    path: 'customers',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['customers360.read'] },
    loadComponent: () =>
      import('./pages/customers/customers.component').then(
        (m) => m.CustomersComponent
      ),
  },
  {
    path: 'import',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['masterdata.read'] },
    loadComponent: () =>
      import('./pages/import/import-center.component').then(
        (m) => m.ImportCenterComponent
      ),
  },
  {
    path: 'verification',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['tradecase.verification.view'] },
    loadComponent: () =>
      import('./pages/verification/verification-governance.component').then(
        (m) => m.VerificationGovernanceComponent
      ),
  },
  {
    path: 'trade-cases',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: CASE_VIEW },
    loadComponent: () =>
      import('./pages/trade-cases/trade-cases.component').then(
        (m) => m.TradeCasesComponent
      ),
  },
  {
    path: 'trade-cases/new',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['tradecase.create'] },
    loadComponent: () =>
      import('./pages/trade-cases/new-trade-case.component').then(
        (m) => m.NewTradeCaseComponent
      ),
  },
  {
    path: 'post-shipment',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['tradecase.postshipment.apply'] },
    loadComponent: () =>
      import('./pages/post-shipment/post-shipment-list.component').then(
        (m) => m.PostShipmentListComponent
      ),
  },
  {
    path: 'post-shipment/:id',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['tradecase.postshipment.apply'] },
    loadComponent: () =>
      import('./pages/post-shipment/post-shipment-application.component').then(
        (m) => m.PostShipmentApplicationComponent
      ),
  },
  {
    path: 'trade-cases/:id/post-shipment',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['tradecase.findings.internal.view'] },
    loadComponent: () =>
      import('./pages/post-shipment/post-shipment-review.component').then(
        (m) => m.PostShipmentReviewComponent
      ),
  },
  {
    path: 'trade-cases/:id/scrutiny',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['tradecase.revalidate', 'tradecase.review.trade_ops', 'tradecase.review.compliance', 'tradecase.audit.view'] },
    loadComponent: () =>
      import('./pages/trade-cases/pre-shipment-scrutiny.component').then(
        (m) => m.PreShipmentScrutinyComponent
      ),
  },
  {
    path: 'trade-cases/:id',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: CASE_VIEW },
    loadComponent: () =>
      import('./pages/trade-cases/trade-case-workspace.component').then(
        (m) => m.TradeCaseWorkspaceComponent
      ),
  },
  {
    path: 'workspace',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/workspace/workspace.component').then(
        (m) => m.WorkspaceComponent
      ),
  },
  {
    path: 'audit',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['audit.overview'] },
    loadComponent: () =>
      import('./pages/audit-explorer/audit-explorer.component').then(
        (m) => m.AuditExplorerComponent
      ),
  },
  {
    path: 'admin',
    canActivate: [authGuard, permissionGuard],
    data: { anyOf: ['admin.users.view', 'admin.rbac.view', 'system.health.view'] },
    loadComponent: () =>
      import('./pages/admin/admin.component').then(
        (m) => m.AdminComponent
      ),
  },
  {
    path: 'access-denied',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/access-denied/access-denied.component').then(
        (m) => m.AccessDeniedComponent
      ),
  },
  {
    path: 'blog/:id',
    loadComponent: () =>
      import('./pages/blog-detail/blog-detail.component').then(
        (m) => m.BlogDetailComponent
      ),
  },
  {
    path: 'blogs/:id',
    redirectTo: 'blog/:id',
  },
  {
    path: '**',
    redirectTo: '',
  },
];
