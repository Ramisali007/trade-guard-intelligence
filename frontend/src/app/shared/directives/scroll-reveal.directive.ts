import {
  Directive,
  ElementRef,
  inject,
  OnInit,
  OnDestroy,
  input,
} from '@angular/core';

/**
 * Scroll Reveal Directive — applies reveal animation when element scrolls into view.
 *
 * Usage:
 *   <div appScrollReveal>...</div>
 *   <div appScrollReveal [revealDelay]="200">...</div>
 *   <div appScrollReveal revealClass="fade-up">...</div>
 */
@Directive({
  selector: '[appScrollReveal]',
  standalone: true,
})
export class ScrollRevealDirective implements OnInit, OnDestroy {
  readonly revealDelay = input<number>(0);
  readonly revealClass = input<string>('revealed');
  readonly revealThreshold = input<number>(0.1);

  private readonly el = inject(ElementRef);
  private observer: IntersectionObserver | null = null;

  ngOnInit(): void {
    const element = this.el.nativeElement as HTMLElement;

    // Add initial hidden state
    element.classList.add('reveal');

    if (typeof IntersectionObserver === 'undefined') {
      element.classList.add(this.revealClass());
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const delay = this.revealDelay();
            if (delay > 0) {
              setTimeout(() => {
                element.classList.add(this.revealClass());
              }, delay);
            } else {
              element.classList.add(this.revealClass());
            }
            this.observer?.unobserve(element);
          }
        });
      },
      {
        threshold: this.revealThreshold(),
        rootMargin: '0px 0px -40px 0px',
      }
    );

    this.observer.observe(element);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
