import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent
      ),
  },
  {
    path: 'processing/:id',
    loadComponent: () =>
      import('./pages/processing/processing.component').then(
        (m) => m.ProcessingComponent
      ),
  },
  {
    path: 'analysis/:id',
    loadComponent: () =>
      import('./pages/analysis/analysis.component').then(
        (m) => m.AnalysisComponent
      ),
  },
  {
    path: 'compare',
    loadComponent: () =>
      import('./pages/comparison/comparison.component').then(
        (m) => m.ComparisonComponent
      ),
  },
  {
    path: 'auditor',
    loadComponent: () =>
      import('./pages/auditor/auditor.component').then(
        (m) => m.AuditorComponent
      ),
  },
  {
    path: 'sources',
    loadComponent: () =>
      import('./pages/sources/sources-health.component').then(
        (m) => m.SourcesHealthComponent
      ),
  },
  {
    path: 'customers',
    loadComponent: () =>
      import('./pages/customers/customers.component').then(
        (m) => m.CustomersComponent
      ),
  },
  {
    path: '**',

    redirectTo: '',
  },
];
