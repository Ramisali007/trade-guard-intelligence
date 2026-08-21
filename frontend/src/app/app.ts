import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeService } from './services/theme.service';
import { DocumentsService } from './services/documents.service';
import type { HealthResponse } from './models/api.models';
import { Icon } from './shared/components/icon';
import { ToastContainer } from './shared/components/toast-container';
import { Chatbot } from './shared/components/chatbot';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, ToastContainer, Chatbot],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly themeService = inject(ThemeService);
  private readonly docsService = inject(DocumentsService);

  protected readonly health = signal<HealthResponse | null>(null);

  ngOnInit(): void {
    this.docsService.health().subscribe({
      next: (h) => this.health.set(h),
      error: () => {},
    });
  }

  protected toggleTheme(): void {
    this.themeService.toggle();
  }
}
