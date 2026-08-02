import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * Minimal pager for the ledger tables: previous / next around a "Page x of n"
 * label, plus an optional caption for what is being paged ("214 rows").
 * Deliberately not MatPaginator — no page-size menu, no per-page styling work,
 * and it stays in the shared chunk both books already load.
 */
@Component({
  selector: 'app-paginator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <span class="text-sm text-[var(--text-soft)]" data-testid="pager-caption">
        {{ caption() }}
      </span>
      <div class="flex items-center gap-1">
        <button
          mat-icon-button
          type="button"
          [disabled]="pageIndex() <= 0"
          (click)="pageChange.emit(pageIndex() - 1)"
          aria-label="Previous page"
          data-testid="pager-prev"
        >
          <mat-icon>chevron_left</mat-icon>
        </button>
        <span class="text-sm app-num" data-testid="pager-label">
          {{ pageIndex() + 1 }} / {{ pageCount() }}
        </span>
        <button
          mat-icon-button
          type="button"
          [disabled]="pageIndex() >= pageCount() - 1"
          (click)="pageChange.emit(pageIndex() + 1)"
          aria-label="Next page"
          data-testid="pager-next"
        >
          <mat-icon>chevron_right</mat-icon>
        </button>
      </div>
    </div>
  `,
})
export class Paginator {
  /** 0-based current page. */
  readonly pageIndex = input.required<number>();
  readonly pageCount = input.required<number>();
  /** Optional caption, e.g. "214 rows". */
  readonly caption = input('');
  readonly pageChange = output<number>();
}
