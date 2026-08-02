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
import { Paginator } from '../../shared/ui/paginator';
import { pageOf } from '../../shared/ledger/paging';
import { deleteRowWithUndo } from '../../shared/ledger/undo-delete';
import { LedgerStore } from '../../core/ledger/ledger-store';
import { computeRow } from '../../../domain/calc';
import { formatDate, formatInr, formatTons } from '../../../domain/format';
import {
  filterLedgerRows,
  lastActiveDateRange,
  sortByDateDesc,
  type LedgerRowFilter,
} from '../../../domain/reports';
import { summarize } from '../../../domain/summaries';
import type { LedgerRow } from '../../../domain/types';
import { RowDetailDialog, type RowDetailData, type RowDetailResult } from './row-detail-dialog';

/** Rows per page. Also comfortably above the default 5-active-day row count. */
const PAGE_SIZE = 25;

/**
 * The Daily Ledger — every row on record in one flat, filterable, paginated
 * table, newest date first. Tapping a row opens its full breakdown, from which
 * it can be edited or deleted.
 */
@Component({
  selector: 'app-ledger',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule, PageHeader, SectionCard, Paginator],
  templateUrl: './ledger.html',
})
export class Ledger {
  private readonly store = inject(LedgerStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  protected readonly ready = this.store.ready;
  /** Hydrated *and* seeded — see LedgerStore.initialised. */
  protected readonly initialised = this.store.initialised;
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly crusher = signal('');
  protected readonly passType = signal('');
  protected readonly vehicle = signal('');
  protected readonly pageIndex = signal(0);

  protected readonly crusherOptions = this.store.crusherOptions;

  /**
   * Set as soon as the user touches the filter. Seeding is asynchronous, so
   * without this a filter changed during the first load would be silently
   * overwritten the moment the default range was applied.
   */
  private rangeTouched = false;

  constructor() {
    // Default to the 5 most recent dates that actually have rows. A calendar
    // window would usually be empty — the quarry runs in bursts.
    // Waits for `initialised`, not `ready`: on a fresh device `ready` flips true
    // before the seed lands, which would latch this onto an empty row set.
    const seedRange = effect(() => {
      if (this.rangeTouched) {
        seedRange.destroy();
        return;
      }
      if (!this.store.initialised()) return;
      const range = lastActiveDateRange(this.store.rows(), 5);
      seedRange.destroy();
      if (this.rangeTouched || !range) return;
      this.from.set(range[0]);
      this.to.set(range[1]);
    });
  }

  // --- Filters ---------------------------------------------------------------

  /** Any user edit of the range, from either date field. */
  protected setFrom(value: string): void {
    this.rangeTouched = true;
    this.from.set(value);
    this.pageIndex.set(0);
  }

  protected setTo(value: string): void {
    this.rangeTouched = true;
    this.to.set(value);
    this.pageIndex.set(0);
  }

  protected setCrusher(value: string): void {
    this.crusher.set(value);
    this.pageIndex.set(0);
  }

  protected setPassType(value: string): void {
    this.passType.set(value);
    this.pageIndex.set(0);
  }

  protected setVehicle(value: string): void {
    this.vehicle.set(value);
    this.pageIndex.set(0);
  }

  /** Reset every filter to show the full record. */
  protected showAll(): void {
    this.rangeTouched = true;
    this.from.set('');
    this.to.set('');
    this.crusher.set('');
    this.passType.set('');
    this.vehicle.set('');
    this.pageIndex.set(0);
  }

  // --- Rows ------------------------------------------------------------------

  private readonly filter = computed<LedgerRowFilter>(() => ({
    from: this.from(),
    to: this.to(),
    crusher: this.crusher(),
    passType: this.passType() as LedgerRowFilter['passType'],
    vehicle: this.vehicle(),
  }));

  /** Everything matching the filters — totals always cover this whole set. */
  protected readonly filteredRows = computed(() =>
    sortByDateDesc(filterLedgerRows(this.store.rows(), this.filter())),
  );

  protected readonly paged = computed(() =>
    pageOf(this.filteredRows(), this.pageIndex(), PAGE_SIZE),
  );

  protected readonly rangeTotal = computed(() => summarize(this.filteredRows()));
  protected readonly totalRowCount = computed(() => this.store.rows().length);

  protected readonly pagerCaption = computed(() => {
    const total = this.filteredRows().length;
    if (total === 0) return '0 rows';
    const start = this.paged().clampedIndex * PAGE_SIZE + 1;
    const end = Math.min(start + PAGE_SIZE - 1, total);
    return `Rows ${start}–${end} of ${total}`;
  });

  protected setPage(index: number): void {
    this.pageIndex.set(index);
  }

  // --- Row actions -------------------------------------------------------------

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
      await deleteRowWithUndo(this.snackBar, {
        message: 'Row deleted',
        doDelete: () => this.store.deleteRow(row.id),
        restore: () => this.store.restoreRow(row),
      });
    }
  }

  // --- Formatting ----------------------------------------------------------------

  protected rowProfit(row: LedgerRow): number {
    return computeRow(row).profit;
  }

  protected day(iso: string): string {
    return formatDate(iso);
  }

  protected inr(value: number): string {
    return formatInr(value);
  }

  protected tons(value: number): string {
    return formatTons(value);
  }
}
