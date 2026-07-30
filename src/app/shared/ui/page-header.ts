import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Standard page title block: icon chip + title/subtitle + a projected `[actions]` slot. */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <header class="page-header">
      <div class="page-header__lead">
        @if (icon()) {
          <span class="page-header__icon" aria-hidden="true">
            <mat-icon>{{ icon() }}</mat-icon>
          </span>
        }
        <div>
          <h1 class="page-header__title">{{ title() }}</h1>
          @if (subtitle()) {
            <p class="page-header__subtitle">{{ subtitle() }}</p>
          }
        </div>
      </div>
      <div class="page-header__actions">
        <ng-content select="[actions]" />
      </div>
    </header>
  `,
  styles: `
    .page-header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .page-header__lead {
      display: flex;
      align-items: center;
      gap: 0.875rem;
    }
    .page-header__icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .page-header__title {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 700;
      line-height: 1.2;
    }
    .page-header__subtitle {
      margin: 0.25rem 0 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.9rem;
    }
    .page-header__actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly icon = input<string>('');
}
