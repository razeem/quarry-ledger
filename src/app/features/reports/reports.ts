import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatTile } from '../../shared/ui/stat-tile';
import { LedgerStore } from '../../core/ledger/ledger-store';
import { formatDate, formatInr, formatMonth, formatTons } from '../../../domain/format';
import {
  crusherReport,
  dailyReport,
  monthlyReport,
  vehicleRentReport,
} from '../../../domain/reports';
import type {
  PrintOptions,
  PrintOptionsData,
  PrintOptionsDialog,
  PrintSection,
} from './print-options-dialog';

export type ReportView = 'daily' | 'rent' | 'crusher' | 'monthly';

/**
 * The four reports. Every figure is a pure function of the ledger rows — this
 * component only picks a view and a date, then formats what `src/domain` returns.
 *
 * Printing renders the chosen sections into a print-only block (`.report-print`)
 * that screen CSS hides and `@media print` reveals, so one browser print dialog
 * (or "Save as PDF") covers any combination of sections.
 */
@Component({
  selector: 'app-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatButtonToggleModule,
    PageHeader,
    SectionCard,
    StatTile,
  ],
  templateUrl: './reports.html',
})
export class Reports {
  private readonly store = inject(LedgerStore);
  private readonly dialog = inject(MatDialog);

  protected readonly ready = this.store.ready;
  protected readonly view = signal<ReportView>('daily');
  /** The date driving the Daily summary and Vehicle rent reports. */
  protected readonly date = signal('');

  /** Sections included in the next printout; empty until Print is used. */
  protected readonly printSections = signal<readonly PrintSection[]>([]);
  /** Stamped when a printout is prepared, so the page footer can show it. */
  protected readonly printedAt = signal('');

  constructor() {
    // Default to the most recent date that has rows, not today — today is usually
    // empty and an empty report looks like a bug.
    // Waits for `initialised`, not `ready` — see LedgerStore.initialised.
    const seedDate = effect(() => {
      if (!this.store.initialised()) return;
      const dates = this.store.datesWithRows();
      seedDate.destroy();
      if (dates.length) this.date.set(dates[0]);
    });
  }

  protected readonly datesWithRows = this.store.datesWithRows;

  protected readonly daily = computed(() => dailyReport(this.store.rows(), this.date()));
  protected readonly rent = computed(() =>
    vehicleRentReport(this.store.rows(), this.date(), this.store.vehicles()),
  );
  protected readonly crushers = computed(() => crusherReport(this.store.rows()));
  protected readonly months = computed(() => monthlyReport(this.store.rows()));

  /** All-time footer totals for the crusher-wise table. */
  protected readonly crusherTotals = computed(() =>
    this.crushers().reduce(
      (acc, row) => ({
        qty: acc.qty + row.qty,
        crusherAmount: acc.crusherAmount + row.crusherAmount,
        quaryAmount: acc.quaryAmount + row.quaryAmount,
        vehicleRent: acc.vehicleRent + row.vehicleRent,
        profit: acc.profit + row.profit,
      }),
      { qty: 0, crusherAmount: 0, quaryAmount: 0, vehicleRent: 0, profit: 0 },
    ),
  );

  protected readonly monthlyTotals = computed(() =>
    this.months().reduce(
      (acc, row) => ({
        qty: acc.qty + row.qty,
        discountQty: acc.discountQty + row.discountQty,
        discount: acc.discount + row.discount,
        profit: acc.profit + row.profit,
      }),
      { qty: 0, discountQty: 0, discount: 0, profit: 0 },
    ),
  );

  // --- Printing ------------------------------------------------------------

  /** True when a section would print with no rows, so the dialog can warn. */
  private readonly emptySections = computed<PrintSection[]>(() => {
    const empty: PrintSection[] = [];
    if (this.daily().crushers.length === 0) empty.push('daily');
    if (this.rent().rows.length === 0) empty.push('rent');
    if (this.crushers().length === 0) empty.push('crusher');
    if (this.months().length === 0) empty.push('monthly');
    return empty;
  });

  protected includesSection(section: PrintSection): boolean {
    return this.printSections().includes(section);
  }

  protected readonly dateLabel = computed(() => formatDate(this.date()));

  /**
   * Ask which sections to include, render them, then hand off to the browser's
   * print dialog — where "Save as PDF" is the usual destination.
   */
  protected async print(): Promise<void> {
    // Lazy: the dialog and its checkbox module only load when someone prints.
    const { PrintOptionsDialog: Dialog } = await import('./print-options-dialog');

    const data: PrintOptionsData = {
      // Pre-tick whichever report is on screen.
      sections: [this.view()],
      date: this.date(),
      emptySections: this.emptySections(),
    };

    const ref = this.dialog.open<PrintOptionsDialog, PrintOptionsData, PrintOptions>(Dialog, {
      data,
      autoFocus: false,
      width: '440px',
      maxWidth: '94vw',
    });

    const options = await new Promise<PrintOptions | undefined>((resolve) =>
      ref.afterClosed().subscribe(resolve),
    );
    if (!options?.sections.length) return;

    this.printedAt.set(new Date().toLocaleString('en-IN'));
    this.printSections.set(options.sections);

    // Let the print block render before handing control to the browser; without
    // this the dialog can still be closing and the print block still empty.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    window.print();
  }

  protected inr(value: number): string {
    return formatInr(value);
  }

  protected tons(value: number): string {
    return formatTons(value);
  }

  protected month(key: string): string {
    return formatMonth(key);
  }
}
