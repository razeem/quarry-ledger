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
import { MatSnackBar } from '@angular/material/snack-bar';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { Paginator } from '../../shared/ui/paginator';
import { pageOf } from '../../shared/ledger/paging';
import { deleteRowWithUndo } from '../../shared/ledger/undo-delete';
import { PartyLedgerStore } from '../../core/ledger/party-ledger-store';
import { computePartyRow, type ComputedPartyRow } from '../../../domain/party/calc';
import {
  filterPartyRows,
  lastActivePartyDateRange,
  partySummaryReport,
  sortPartyRowsByDateDesc,
  type PartyRowFilter,
} from '../../../domain/party/reports';
import { formatDate, formatInr, formatTons } from '../../../domain/format';
import type { PartyLedgerRow } from '../../../domain/party/types';

/** Rows per page — matches the daily Ledger page. */
const PAGE_SIZE = 25;

/**
 * The party book's Ledger — every load across every party in one flat,
 * filterable, paginated table, newest date first. Rows edit on the Entry sheet
 * (via `?edit=`) and delete here with an id-preserving Undo.
 */
@Component({
  selector: 'app-party-ledger',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule, PageHeader, SectionCard, Paginator],
  templateUrl: './party-ledger.html',
})
export class PartyLedger {
  private readonly store = inject(PartyLedgerStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  protected readonly account = this.store.account;
  protected readonly ready = this.store.ready;
  /** Hydrated *and* seeded — see PartyLedgerStore.initialised. */
  protected readonly initialised = this.store.initialised;

  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly party = signal('');
  protected readonly owner = signal('');
  protected readonly vehicle = signal('');
  protected readonly rentMode = signal<'' | 'with' | 'without'>('');
  protected readonly pageIndex = signal(0);

  protected readonly partyOptions = this.store.partyOptions;
  /** Distinct owners exactly as written on rows — free-text keys, never merged. */
  protected readonly ownerOptions = computed(() =>
    [...new Set(this.store.rows().map((row) => row.owner).filter(Boolean))].sort(),
  );

  /** Set on any filter touch, so the async default range backs off. */
  private rangeTouched = false;

  constructor() {
    // Default to the 5 most recent active dates. Waits for `initialised`, never
    // `ready` — on a fresh device the seed lands after hydration (CLAUDE.md).
    const seedRange = effect(() => {
      if (this.rangeTouched) {
        seedRange.destroy();
        return;
      }
      if (!this.store.initialised()) return;
      const range = lastActivePartyDateRange(this.store.rows(), 5);
      seedRange.destroy();
      if (this.rangeTouched || !range) return;
      this.from.set(range[0]);
      this.to.set(range[1]);
    });
  }

  // --- Filters ---------------------------------------------------------------

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

  protected setParty(value: string): void {
    this.party.set(value);
    this.pageIndex.set(0);
  }

  protected setOwner(value: string): void {
    this.owner.set(value);
    this.pageIndex.set(0);
  }

  protected setVehicle(value: string): void {
    this.vehicle.set(value);
    this.pageIndex.set(0);
  }

  protected setRentMode(value: '' | 'with' | 'without'): void {
    this.rentMode.set(value);
    this.pageIndex.set(0);
  }

  /** Reset every filter to show the full record. */
  protected showAll(): void {
    this.rangeTouched = true;
    this.from.set('');
    this.to.set('');
    this.party.set('');
    this.owner.set('');
    this.vehicle.set('');
    this.rentMode.set('');
    this.pageIndex.set(0);
  }

  // --- Rows ------------------------------------------------------------------

  private readonly filter = computed<PartyRowFilter>(() => ({
    from: this.from(),
    to: this.to(),
    party: this.party(),
    owner: this.owner(),
    vehicle: this.vehicle(),
    rentMode: this.rentMode(),
  }));

  /** Everything matching the filters — totals always cover this whole set. */
  protected readonly filteredRows = computed(() =>
    sortPartyRowsByDateDesc(filterPartyRows(this.store.rows(), this.filter())),
  );

  protected readonly paged = computed(() =>
    pageOf(this.filteredRows(), this.pageIndex(), PAGE_SIZE),
  );

  /** Totals via the same engine as the reports — the rounding contract holds. */
  protected readonly rangeTotal = computed(() => partySummaryReport(this.filteredRows()).totals);
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

  /** Edit on the Entry sheet — the id is the merge key, safe in the URL. */
  protected editRow(row: PartyLedgerRow): void {
    void this.router.navigate(['/party/entry'], { queryParams: { edit: row.id } });
  }

  protected async deleteRow(row: PartyLedgerRow): Promise<void> {
    await deleteRowWithUndo(this.snackBar, {
      message: 'Row deleted',
      doDelete: () => this.store.deleteRow(row.id),
      restore: () => this.store.restoreRow(row),
    });
  }

  // --- Formatting ----------------------------------------------------------------

  protected calc(row: PartyLedgerRow): ComputedPartyRow {
    return computePartyRow(row);
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
