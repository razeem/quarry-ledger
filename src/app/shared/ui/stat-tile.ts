import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export type StatTone = 'neutral' | 'accent' | 'positive' | 'negative';

/** A compact KPI tile: label, big mono value, optional icon + hint, tone-coloured. */
@Component({
  selector: 'app-stat-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="tile" [attr.data-tone]="tone()">
      <div class="tile__head">
        <span class="tile__label">{{ label() }}</span>
        @if (icon()) {
          <mat-icon aria-hidden="true">{{ icon() }}</mat-icon>
        }
      </div>
      <div class="tile__value app-num">{{ value() }}</div>
      @if (hint()) {
        <div class="tile__hint">{{ hint() }}</div>
      }
    </div>
  `,
  styles: `
    .tile {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 1.15rem 1.3rem;
      border-radius: var(--r-card);
      background: var(--mat-sys-surface-container);
      border: 1px solid var(--mat-sys-outline-variant);
      min-height: 108px;
    }
    .tile[data-tone='accent'] {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      border-color: transparent;
    }
    .tile[data-tone='positive'] {
      background: color-mix(in srgb, #17c07a 16%, var(--mat-sys-surface-container));
      border-color: transparent;
    }
    .tile[data-tone='negative'] {
      background: color-mix(in srgb, #f04452 16%, var(--mat-sys-surface-container));
      border-color: transparent;
    }
    .tile__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .tile__label {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.75;
    }
    .tile__head mat-icon {
      opacity: 0.55;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .tile__value {
      font-size: 1.6rem;
      font-weight: 700;
      line-height: 1.1;
    }
    .tile__hint {
      font-size: 0.78rem;
      opacity: 0.7;
    }
  `,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<string | null>();
  readonly hint = input<string>('');
  readonly icon = input<string>('');
  readonly tone = input<StatTone>('neutral');
}
