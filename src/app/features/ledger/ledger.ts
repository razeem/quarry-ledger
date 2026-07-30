import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { LedgerStore } from '../../core/ledger/ledger-store';
import { computeRow } from '../../../domain/calc';
import { formatInr, formatTons } from '../../../domain/format';
import { groupByDay, lastActiveDateRange, rowsInRange } from '../../../domain/reports';
import type { LedgerRow } from '../../../domain/types';
import { RowDetailDialog, type RowDetailData, type RowDetailResult } from './row-detail-dialog';

/**
 * The Daily Ledger — the single source of truth, grouped by date with a subtotal
 * per day. Tapping a row opens its full breakdown, from which it can be edited or
 * deleted.
 */
@Component({
  selector: 'app-ledger',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule, PageHeader, SectionCard],
  templateUrl: './ledger.html',
})
export class Ledger {
  private readonly store = inject(LedgerStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  protected readonly ready = this.store.ready;
  protected readonly from = signal('');
  protected readonly to = signal('');

  constructor() {
    // Default to the 5 most recent dates that actually have rows. A calendar
    // window would usually be empty — the quarry runs in bursts.
    // Waits for `initialised`, not `ready`: on a fresh device `ready` flips true
    // before the seed lands, which would latch this onto an empty row set.
    const seedRange = effect(() => {
      if (!this.store.initialised()) return;
      const range = lastActiveDateRange(this.store.rows(), 5);
      seedRange.destroy();
      if (range) {
        this.from.set(range[0]);
        this.to.set(range[1]);
      }
    });
  }

  protected readonly visibleRows = computed(() => {
    const from = this.from();
    const to = this.to();
    if (!from || !to) return this.store.rows();
    return rowsInRange(this.store.rows(), from, to);
  });

  /** Most recent day first, each with its own subtotal. */
  protected readonly days = computed(() => groupByDay(this.visibleRows()));

  protected readonly rangeTotal = computed(() =>
    this.days().reduce(
      (acc, day) => ({
        loads: acc.loads + day.subtotal.loads,
        qty: acc.qty + day.subtotal.qty,
        profit: acc.profit + day.subtotal.profit,
      }),
      { loads: 0, qty: 0, profit: 0 },
    ),
  );

  protected readonly totalRowCount = computed(() => this.store.rows().length);

  /** Reset the filter to show every row on record. */
  protected showAll(): void {
    this.from.set('');
    this.to.set('');
  }

  protected async openRow(row: LedgerRow): Promise<void> {
    const ref = this.dialog.open<RowDetailDialog, RowDetailData, RowDetailResult>(RowDetailDialog, {
      data: { row, vehicles: this.store.vehicles() },
      autoFocus: false,
      width: '420px',
      maxWidth: '94vw',
    });

    const action = await new Promise<RowDetailResult>((resolve) =>
      ref.afterClosed().subscribe(resolve),
    );

    if (action === 'edit') {
      // The id is the merge key and never changes, so it is safe in the URL.
      void this.router.navigate(['/entry'], { queryParams: { edit: row.id } });
      return;
    }

    if (action === 'delete') {
      // Confirm only once the deletion is on disk, so the toast is a durability
      // signal rather than an optimistic one.
      await this.store.deleteRow(row.id);
      const snack = this.snackBar.open('Row deleted', 'Undo', { duration: 6000 });
      // Re-adding would mint a new id, so undo restores the row's original id
      // explicitly — ids must never be regenerated.
      snack.onAction().subscribe(() => {
        this.store.mergeImport({ rows: [row] });
        void this.store.flush();
      });
    }
  }

  protected rowProfit(row: LedgerRow): number {
    return computeRow(row).profit;
  }

  protected inr(value: number): string {
    return formatInr(value);
  }

  protected tons(value: number): string {
    return formatTons(value);
  }
}
