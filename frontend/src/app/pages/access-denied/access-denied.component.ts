import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

/** Shown instead of a screen the signed-in role may not open. Names no permission, reveals nothing. */
@Component({
  selector: 'app-access-denied',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="page ad-page">
      <div class="card card-pad ad-card" role="alert">
        <h1>Not available for your role</h1>
        <p class="muted">
          {{ auth.roleLabel() }} does not have access to {{ from || 'this screen' }}. If you need it, ask your
          administrator to raise an access request; a second administrator has to approve it.
        </p>
        <a routerLink="/workspace" class="btn btn-primary">Go to my workspace</a>
      </div>
    </div>
  `,
  styles: [
    `
      .ad-page { padding-top: 120px; display: flex; justify-content: center; }
      .ad-card { max-width: 560px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
      .ad-card h1 { font-size: 1.3rem; margin: 0; }
    `,
  ],
})
export class AccessDeniedComponent {
  protected readonly auth = inject(AuthService);
  protected readonly from = inject(ActivatedRoute).snapshot.queryParamMap.get('from');
}
