import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * A titled content card with an optional eyebrow, icon, and a projected
 * `[actions]` slot in the header. The default slot holds the body.
 */
@Component({
  selector: 'app-section-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <section class="card app-section">
      <header class="card__head">
        <div class="card__titles">
          @if (eyebrow()) {
            <span class="app-eyebrow">{{ eyebrow() }}</span>
          }
          <h2 class="card__title">
            @if (icon()) {
              <mat-icon aria-hidden="true">{{ icon() }}</mat-icon>
            }
            {{ title() }}
          </h2>
          @if (subtitle()) {
            <p class="card__subtitle">{{ subtitle() }}</p>
          }
        </div>
        <div class="card__actions">
          <ng-content select="[actions]" />
        </div>
      </header>
      <div class="card__body">
        <ng-content />
      </div>
    </section>
  `,
  styles: `
    .card {
      padding: 1.35rem 1.4rem 1.5rem;
    }
    .card__head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .card__title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.15rem 0 0;
      font-size: 1.15rem;
      font-weight: 700;
    }
    .card__title mat-icon {
      color: var(--mat-sys-primary);
    }
    .card__subtitle {
      margin: 0.35rem 0 0;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .card__actions {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
  `,
})
export class SectionCard {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly eyebrow = input<string>('');
  readonly icon = input<string>('');
}
