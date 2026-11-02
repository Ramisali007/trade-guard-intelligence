import { ChangeDetectionStrategy, Component, ElementRef, HostListener, ViewEncapsulation, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

export interface StaggeredMenuItem {
  label: string;
  link: string;
  ariaLabel?: string;
}

/**
 * The navigation menu: a Menu button that opens a plain panel with the screens this role may open.
 * No animation. The panel is inert while closed, so keyboard and screen-reader users never land in it.
 */
@Component({
  selector: 'app-staggered-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="staggered-menu-wrapper" [attr.data-position]="position()" [attr.data-open]="open() ? true : null">
      <button
        class="sm-toggle"
        type="button"
        [attr.aria-label]="open() ? 'Close menu' : 'Open menu'"
        [attr.aria-expanded]="open()"
        aria-controls="staggered-menu-panel"
        (click)="toggleMenu()"
      >
        <span class="sm-icon" aria-hidden="true"><span></span><span></span><span></span></span>
        <span class="sm-toggle-text">Menu</span>
      </button>

      <div class="sm-backdrop" [class.active]="open()" aria-hidden="true" (click)="closeMenu()"></div>

      <aside id="staggered-menu-panel" class="staggered-menu-panel" [attr.aria-hidden]="!open()" [attr.inert]="open() ? null : ''">
        <div class="sm-panel-header">
          <span class="sm-panel-title">Menu</span>
          <button type="button" class="sm-panel-close-btn" (click)="closeMenu()" aria-label="Close navigation menu">
            <span>Close</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <nav aria-label="Main navigation">
          <ul class="sm-panel-list" role="list">
            @for (it of items(); track it.link) {
              <li>
                <a class="sm-panel-item" [href]="it.link" [attr.aria-label]="it.ariaLabel || it.label" (click)="handleItemClick($event, it)">{{ it.label }}</a>
              </li>
            }
          </ul>
        </nav>
      </aside>
    </div>
  `,
  styleUrls: ['./staggered-menu.component.scss'],
})
export class StaggeredMenuComponent {
  readonly position = input<'left' | 'right'>('left');
  readonly items = input<StaggeredMenuItem[]>([]);

  readonly open = signal<boolean>(false);

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);

  constructor() {
    // Lock the page behind the open menu.
    effect(() => {
      const isOpen = this.open();
      document.documentElement.classList.toggle('nav-drawer-open', isOpen);
      document.body.classList.toggle('nav-drawer-open', isOpen);
    });
  }

  toggleMenu(): void {
    this.open.update((v) => !v);
  }

  closeMenu(): void {
    this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.open()) return;
    this.closeMenu();
    this.host.nativeElement.querySelector('.sm-toggle')?.focus();
  }

  handleItemClick(event: MouseEvent, item: StaggeredMenuItem): void {
    if (item.link.startsWith('/')) {
      event.preventDefault();
      this.closeMenu();
      void this.router.navigateByUrl(item.link);
    } else {
      this.closeMenu();
    }
  }
}
