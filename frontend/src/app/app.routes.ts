import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

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
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent
      ),
  },
  {
    path: 'analytics',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/analytics/analytics.component').then(
        (m) => m.AnalyticsComponent
      ),
  },
  {
    path: 'processing/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/processing/processing.component').then(
        (m) => m.ProcessingComponent
      ),
  },
  {
    path: 'analysis/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/analysis/analysis.component').then(
        (m) => m.AnalysisComponent
      ),
  },
  {
    path: 'compare',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/comparison/comparison.component').then(
        (m) => m.ComparisonComponent
      ),
  },
  {
    path: 'auditor',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/auditor/auditor.component').then(
        (m) => m.AuditorComponent
      ),
  },
  {
    path: 'sources',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/sources/sources-health.component').then(
        (m) => m.SourcesHealthComponent
      ),
  },
  {
    path: 'customers',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/customers/customers.component').then(
        (m) => m.CustomersComponent
      ),
  },
  {
    path: 'import',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/import/import-center.component').then(
        (m) => m.ImportCenterComponent
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
