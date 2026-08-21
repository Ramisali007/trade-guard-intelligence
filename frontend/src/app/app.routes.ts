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
    path: '**',
    redirectTo: '',
  },
];
