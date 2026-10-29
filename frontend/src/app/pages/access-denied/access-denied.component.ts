import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Icon } from '../../shared/components/icon';

/** Shown instead of a screen the signed-in role may not open. Names no permission, reveals nothing. */
@Component({
  selector: 'app-access-denied',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <div class="page ad-page">
      <header class="page-head">
        <div>
          <h1>Not available for your role</h1>
          <p class="muted">{{ auth.roleLabel() }} does not have access to {{ from || 'this screen' }}.</p>
        </div>
        <a routerLink="/workspace" class="btn btn-primary">Go to my workspace</a>
        <section class="page-head-kpis" aria-label="Summary">
          <div class="kpi-tile">
            <span class="kpi-tile-label">Signed in as</span>
            <strong class="kpi-tile-value is-text">{{ auth.currentUser()?.name ?? '—' }}</strong>
            <span class="kpi-tile-note">{{ auth.currentUser()?.email }}</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Your role</span>
            <strong class="kpi-tile-value is-text">{{ auth.roleLabel() }}</strong>
            <span class="kpi-tile-note">what you can open depends on it</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Portal</span>
            <strong class="kpi-tile-value is-text">{{ auth.stage() === 'post' ? 'Post-shipment' : 'Pre-shipment' }}</strong>
            <span class="kpi-tile-note">the screens for your desk</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Screen asked for</span>
            <strong class="kpi-tile-value is-text" [class.is-warn]="true">{{ from || 'This screen' }}</strong>
            <span class="kpi-tile-note">not part of your role</span>
          </div>
        </section>
      </header>
      <div class="card calm-state" role="alert">
        <span class="calm-state-mark"><app-icon name="lock" [size]="28" /></span>
        <strong>This screen is not part of your role</strong>
        <span>If you need it, ask your administrator to raise an access request. A second administrator has to approve it before anything changes.</span>
      </div>
    </div>
  `,
  styles: [
    `
      .ad-page { display: flex; flex-direction: column; gap: 16px; }
    `,
  ],
})
export class AccessDeniedComponent {
  protected readonly auth = inject(AuthService);
  protected readonly from = inject(ActivatedRoute).snapshot.queryParamMap.get('from');
}
