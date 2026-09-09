import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { gsap } from 'gsap';

export interface StaggeredMenuItem {
  label: string;
  link: string;
  ariaLabel?: string;
  external?: boolean;
}

export interface StaggeredMenuSocialItem {
  label: string;
  link: string;
}

@Component({
  selector: 'app-staggered-menu',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      class="staggered-menu-wrapper"
      [class.fixed-wrapper]="isFixed()"
      [class.inline-wrapper]="!isFixed()"
      [class]="className()"
      [style.--sm-accent]="accentColor()"
      [attr.data-position]="position()"
      [attr.data-open]="open() ? true : null"
    >
      <!-- Staggered Underlay Layers -->
      <div #preLayersRef class="sm-prelayers" aria-hidden="true">
        @for (color of computedLayers(); track $index) {
          <div class="sm-prelayer" [style.background]="color"></div>
        }
      </div>

      <!-- Trigger Button & Header: Either Fixed Standalone Header or Inline Button -->
      @if (isFixed()) {
        <header class="staggered-menu-header" aria-label="Main navigation header">
          @if (showLogo()) {
            <div class="sm-logo" aria-label="Logo">
              @if (logoUrl()) {
                <img
                  [src]="logoUrl()"
                  alt="Logo"
                  class="sm-logo-img"
                  draggable="false"
                  width="110"
                  height="32"
                />
              } @else {
                <div class="sm-logo-fallback">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
                    <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
                  </svg>
                  <span>TradeGuard</span>
                </div>
              }
            </div>
          } @else {
            <div></div>
          }

          <ng-container *ngTemplateOutlet="toggleButtonTpl"></ng-container>
        </header>
      } @else {
        <ng-container *ngTemplateOutlet="toggleButtonTpl"></ng-container>
      }

      <ng-template #toggleButtonTpl>
        <button
          #toggleBtnRef
          class="sm-toggle"
          [attr.aria-label]="open() ? 'Close menu' : 'Open menu'"
          [attr.aria-expanded]="open()"
          aria-controls="staggered-menu-panel"
          (click)="toggleMenu()"
          type="button"
        >
          <span #textWrapRef class="sm-toggle-textWrap" aria-hidden="true">
            <span #textInnerRef class="sm-toggle-textInner">
              @for (line of textLines(); track $index) {
                <span class="sm-toggle-line">{{ line }}</span>
              }
            </span>
          </span>
          <span #iconRef class="sm-icon" aria-hidden="true">
            <span #plusHRef class="sm-icon-line"></span>
            <span #plusVRef class="sm-icon-line sm-icon-line-v"></span>
          </span>
        </button>
      </ng-template>

      <!-- Main Staggered Flyout Drawer Panel -->
      <aside
        id="staggered-menu-panel"
        #panelRef
        class="staggered-menu-panel"
        [attr.aria-hidden]="!open()"
      >
        <div class="sm-panel-inner">
          <ul class="sm-panel-list" role="list" [attr.data-numbering]="displayItemNumbering() ? true : null">
            @if (items().length > 0) {
              @for (it of items(); track it.label + $index; let idx = $index) {
                <li class="sm-panel-itemWrap">
                  <a
                    class="sm-panel-item"
                    [href]="it.link"
                    [attr.aria-label]="it.ariaLabel || it.label"
                    [attr.data-index]="idx + 1"
                    (click)="handleItemClick($event, it)"
                  >
                    <span class="sm-panel-itemLabel">{{ it.label }}</span>
                  </a>
                </li>
              }
            } @else {
              <li class="sm-panel-itemWrap" aria-hidden="true">
                <span class="sm-panel-item">
                  <span class="sm-panel-itemLabel">No items</span>
                </span>
              </li>
            }
          </ul>

          <!-- Social Links Footer -->
          @if (displaySocials() && socialItems().length > 0) {
            <div class="sm-socials" aria-label="Social links">
              <h3 class="sm-socials-title">Connect & Resources</h3>
              <ul class="sm-socials-list" role="list">
                @for (s of socialItems(); track s.label + $index) {
                  <li class="sm-socials-item">
                    <a
                      [href]="s.link"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="sm-socials-link"
                      (click)="closeMenu()"
                    >
                      {{ s.label }}
                    </a>
                  </li>
                }
              </ul>
            </div>
          }
        </div>
      </aside>
    </div>
  `,
  styleUrls: ['./staggered-menu.component.scss'],
})
export class StaggeredMenuComponent implements AfterViewInit, OnDestroy {
  // Inputs matching React Bits StaggeredMenu API
  readonly position = input<'left' | 'right'>('right');
  readonly colors = input<string[]>(['#0284c7', '#0369a1', '#0f172a', '#1e293b']);
  readonly items = input<StaggeredMenuItem[]>([]);
  readonly socialItems = input<StaggeredMenuSocialItem[]>([]);
  readonly displaySocials = input<boolean>(true);
  readonly displayItemNumbering = input<boolean>(true);
  readonly className = input<string>('');
  readonly logoUrl = input<string>('');
  readonly showLogo = input<boolean>(true);
  readonly menuButtonColor = input<string>('#fff');
  readonly openMenuButtonColor = input<string>('#0f172a');
  readonly accentColor = input<string>('#0284c7');
  readonly changeMenuColorOnOpen = input<boolean>(true);
  readonly isFixed = input<boolean>(false);
  readonly closeOnClickAway = input<boolean>(true);

  // Outputs matching React Bits StaggeredMenu callbacks
  readonly onMenuOpen = output<void>();
  readonly onMenuClose = output<void>();

  // Reactive state
  readonly open = signal<boolean>(false);
  readonly textLines = signal<string[]>(['Menu', 'Close']);

  // Element queries
  readonly panelRef = viewChild<ElementRef<HTMLElement>>('panelRef');
  readonly preLayersRef = viewChild<ElementRef<HTMLElement>>('preLayersRef');
  readonly plusHRef = viewChild<ElementRef<HTMLElement>>('plusHRef');
  readonly plusVRef = viewChild<ElementRef<HTMLElement>>('plusVRef');
  readonly iconRef = viewChild<ElementRef<HTMLElement>>('iconRef');
  readonly textInnerRef = viewChild<ElementRef<HTMLElement>>('textInnerRef');
  readonly textWrapRef = viewChild<ElementRef<HTMLElement>>('textWrapRef');
  readonly toggleBtnRef = viewChild<ElementRef<HTMLButtonElement>>('toggleBtnRef');

  private readonly hostRef = inject(ElementRef<HTMLElement>);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly router = inject(Router);

  // GSAP animation references
  private gsapCtx: gsap.Context | null = null;
  private openTl: gsap.core.Timeline | null = null;
  private closeTween: gsap.core.Tween | null = null;
  private spinTween: gsap.core.Tween | null = null;
  private textCycleAnim: gsap.core.Tween | null = null;
  private colorTween: gsap.core.Tween | null = null;
  private isBusy = false;
  private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

  // Computed layer colors according to React Bits algorithm
  protected readonly computedLayers = computed(() => {
    const raw = this.colors().length ? this.colors().slice(0, 4) : ['#0284c7', '#0369a1', '#0f172a'];
    const arr = [...raw];
    if (arr.length >= 3) {
      const mid = Math.floor(arr.length / 2);
      arr.splice(mid, 1);
    }
    return arr;
  });

  ngAfterViewInit(): void {
    this.gsapCtx = gsap.context(() => {
      this.resetInitialPositions();
    }, this.hostRef.nativeElement);

    if (this.closeOnClickAway()) {
      this.clickOutsideHandler = (event: MouseEvent) => {
        if (!this.open()) return;
        const panelEl = this.panelRef()?.nativeElement;
        const toggleBtnEl = this.toggleBtnRef()?.nativeElement;
        const target = event.target as Node;

        if (panelEl && !panelEl.contains(target) && toggleBtnEl && !toggleBtnEl.contains(target)) {
          this.closeMenu();
        }
      };
      document.addEventListener('mousedown', this.clickOutsideHandler);
    }
  }

  ngOnDestroy(): void {
    if (this.clickOutsideHandler) {
      document.removeEventListener('mousedown', this.clickOutsideHandler);
      this.clickOutsideHandler = null;
    }
    this.openTl?.kill();
    this.closeTween?.kill();
    this.spinTween?.kill();
    this.textCycleAnim?.kill();
    this.colorTween?.kill();
    this.gsapCtx?.revert();
  }

  private resetInitialPositions(): void {
    const panel = this.panelRef()?.nativeElement;
    const preContainer = this.preLayersRef()?.nativeElement;
    const plusH = this.plusHRef()?.nativeElement;
    const plusV = this.plusVRef()?.nativeElement;
    const icon = this.iconRef()?.nativeElement;
    const textInner = this.textInnerRef()?.nativeElement;
    const toggleBtn = this.toggleBtnRef()?.nativeElement;

    if (!panel || !plusH || !plusV || !icon || !textInner) return;

    const preLayers = preContainer ? Array.from(preContainer.querySelectorAll<HTMLElement>('.sm-prelayer')) : [];
    const offscreen = this.position() === 'left' ? -100 : 100;

    gsap.set([panel, ...preLayers], { xPercent: offscreen, opacity: 1 });
    if (preContainer) {
      gsap.set(preContainer, { xPercent: 0, opacity: 1 });
    }
    gsap.set(plusH, { transformOrigin: '50% 50%', rotate: 0 });
    gsap.set(plusV, { transformOrigin: '50% 50%', rotate: 90 });
    gsap.set(icon, { rotate: 0, transformOrigin: '50% 50%' });
    gsap.set(textInner, { yPercent: 0 });
    if (toggleBtn) {
      gsap.set(toggleBtn, { color: this.menuButtonColor() });
    }
  }

  toggleMenu(): void {
    const nextState = !this.open();
    this.open.set(nextState);

    if (nextState) {
      this.onMenuOpen.emit();
      this.playOpen();
    } else {
      this.onMenuClose.emit();
      this.playClose();
    }

    this.animateIcon(nextState);
    this.animateColor(nextState);
    this.animateText(nextState);
  }

  closeMenu(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.onMenuClose.emit();
    this.playClose();
    this.animateIcon(false);
    this.animateColor(false);
    this.animateText(false);
  }

  handleItemClick(event: MouseEvent, item: StaggeredMenuItem): void {
    if (!item.external && item.link.startsWith('/')) {
      event.preventDefault();
      this.closeMenu();
      this.router.navigateByUrl(item.link);
    } else {
      this.closeMenu();
    }
  }

  private buildOpenTimeline(): gsap.core.Timeline | null {
    const panel = this.panelRef()?.nativeElement;
    const preContainer = this.preLayersRef()?.nativeElement;
    if (!panel) return null;

    const layers = preContainer ? Array.from(preContainer.querySelectorAll<HTMLElement>('.sm-prelayer')) : [];

    this.openTl?.kill();
    if (this.closeTween) {
      this.closeTween.kill();
      this.closeTween = null;
    }

    const itemEls = Array.from(panel.querySelectorAll<HTMLElement>('.sm-panel-itemLabel'));
    const numberEls = Array.from(panel.querySelectorAll<HTMLElement>('.sm-panel-list[data-numbering] .sm-panel-item'));
    const socialTitle = panel.querySelector<HTMLElement>('.sm-socials-title');
    const socialLinks = Array.from(panel.querySelectorAll<HTMLElement>('.sm-socials-link'));

    const offscreen = this.position() === 'left' ? -100 : 100;
    const layerStates = layers.map((el) => ({ el, start: offscreen }));
    const panelStart = offscreen;

    if (itemEls.length) {
      gsap.set(itemEls, { yPercent: 140, rotate: 10 });
    }
    if (numberEls.length) {
      gsap.set(numberEls, { '--sm-num-opacity': 0 });
    }
    if (socialTitle) {
      gsap.set(socialTitle, { opacity: 0 });
    }
    if (socialLinks.length) {
      gsap.set(socialLinks, { y: 25, opacity: 0 });
    }

    const tl = gsap.timeline({ paused: true });

    layerStates.forEach((ls, i) => {
      tl.fromTo(ls.el, { xPercent: ls.start }, { xPercent: 0, duration: 0.5, ease: 'power4.out' }, i * 0.07);
    });

    const lastTime = layerStates.length ? (layerStates.length - 1) * 0.07 : 0;
    const panelInsertTime = lastTime + (layerStates.length ? 0.08 : 0);
    const panelDuration = 0.65;

    tl.fromTo(
      panel,
      { xPercent: panelStart },
      { xPercent: 0, duration: panelDuration, ease: 'power4.out' },
      panelInsertTime
    );

    if (itemEls.length) {
      const itemsStartRatio = 0.15;
      const itemsStart = panelInsertTime + panelDuration * itemsStartRatio;
      tl.to(
        itemEls,
        {
          yPercent: 0,
          rotate: 0,
          duration: 1,
          ease: 'power4.out',
          stagger: { each: 0.1, from: 'start' },
        },
        itemsStart
      );

      if (numberEls.length) {
        tl.to(
          numberEls,
          {
            duration: 0.6,
            ease: 'power2.out',
            '--sm-num-opacity': 1,
            stagger: { each: 0.08, from: 'start' },
          },
          itemsStart + 0.1
        );
      }
    }

    if (socialTitle || socialLinks.length) {
      const socialsStart = panelInsertTime + panelDuration * 0.4;
      if (socialTitle) {
        tl.to(
          socialTitle,
          {
            opacity: 1,
            duration: 0.5,
            ease: 'power2.out',
          },
          socialsStart
        );
      }
      if (socialLinks.length) {
        tl.to(
          socialLinks,
          {
            y: 0,
            opacity: 1,
            duration: 0.55,
            ease: 'power3.out',
            stagger: { each: 0.08, from: 'start' },
            onComplete: () => {
              gsap.set(socialLinks, { clearProps: 'opacity' });
            },
          },
          socialsStart + 0.04
        );
      }
    }

    this.openTl = tl;
    return tl;
  }

  private playOpen(): void {
    if (this.isBusy) return;
    this.isBusy = true;
    const tl = this.buildOpenTimeline();
    if (tl) {
      tl.eventCallback('onComplete', () => {
        this.isBusy = false;
      });
      tl.play(0);
    } else {
      this.isBusy = false;
    }
  }

  private playClose(): void {
    this.openTl?.kill();
    this.openTl = null;

    const panel = this.panelRef()?.nativeElement;
    const preContainer = this.preLayersRef()?.nativeElement;
    if (!panel) return;

    const layers = preContainer ? Array.from(preContainer.querySelectorAll<HTMLElement>('.sm-prelayer')) : [];
    const all = [...layers, panel];

    this.closeTween?.kill();
    const offscreen = this.position() === 'left' ? -100 : 100;

    this.closeTween = gsap.to(all, {
      xPercent: offscreen,
      duration: 0.32,
      ease: 'power3.in',
      overwrite: 'auto',
      onComplete: () => {
        const itemEls = Array.from(panel.querySelectorAll<HTMLElement>('.sm-panel-itemLabel'));
        if (itemEls.length) {
          gsap.set(itemEls, { yPercent: 140, rotate: 10 });
        }
        const numberEls = Array.from(panel.querySelectorAll<HTMLElement>('.sm-panel-list[data-numbering] .sm-panel-item'));
        if (numberEls.length) {
          gsap.set(numberEls, { '--sm-num-opacity': 0 });
        }
        const socialTitle = panel.querySelector<HTMLElement>('.sm-socials-title');
        const socialLinks = Array.from(panel.querySelectorAll<HTMLElement>('.sm-socials-link'));
        if (socialTitle) gsap.set(socialTitle, { opacity: 0 });
        if (socialLinks.length) gsap.set(socialLinks, { y: 25, opacity: 0 });
        this.isBusy = false;
      },
    });
  }

  private animateIcon(opening: boolean): void {
    const icon = this.iconRef()?.nativeElement;
    if (!icon) return;
    this.spinTween?.kill();
    if (opening) {
      this.spinTween = gsap.to(icon, { rotate: 225, duration: 0.8, ease: 'power4.out', overwrite: 'auto' });
    } else {
      this.spinTween = gsap.to(icon, { rotate: 0, duration: 0.35, ease: 'power3.inOut', overwrite: 'auto' });
    }
  }

  private animateColor(opening: boolean): void {
    const btn = this.toggleBtnRef()?.nativeElement;
    if (!btn) return;
    this.colorTween?.kill();

    if (this.changeMenuColorOnOpen()) {
      const targetColor = opening ? this.openMenuButtonColor() : this.menuButtonColor();
      this.colorTween = gsap.to(btn, {
        color: targetColor,
        delay: 0.18,
        duration: 0.3,
        ease: 'power2.out',
      });
    } else {
      gsap.set(btn, { color: this.menuButtonColor() });
    }
  }

  private animateText(opening: boolean): void {
    const inner = this.textInnerRef()?.nativeElement;
    if (!inner) return;
    this.textCycleAnim?.kill();

    const currentLabel = opening ? 'Menu' : 'Close';
    const targetLabel = opening ? 'Close' : 'Menu';
    const cycles = 3;
    const seq = [currentLabel];
    let last = currentLabel;
    for (let i = 0; i < cycles; i++) {
      last = last === 'Menu' ? 'Close' : 'Menu';
      seq.push(last);
    }
    if (last !== targetLabel) seq.push(targetLabel);
    seq.push(targetLabel);

    this.textLines.set(seq);
    this.cdr.detectChanges();

    gsap.set(inner, { yPercent: 0 });
    const lineCount = seq.length;
    const finalShift = ((lineCount - 1) / lineCount) * 100;
    this.textCycleAnim = gsap.to(inner, {
      yPercent: -finalShift,
      duration: 0.5 + lineCount * 0.07,
      ease: 'power4.out',
    });
  }
}
