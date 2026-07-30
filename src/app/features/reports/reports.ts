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
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatTile } from '../../shared/ui/stat-tile';
import { LedgerStore } from '../../core/ledger/ledger-store';
import { formatInr, formatMonth, formatTons } from '../../../domain/format';
import {
  crusherReport,
  dailyReport,
  monthlyReport,
  vehicleRentReport,
} from '../../../domain/reports';

export type ReportView = 'daily' | 'rent' | 'crusher' | 'monthly';

/**
 * The four reports. Every figure is a pure function of the ledger rows — this
 * component only picks a view and a date, then formats what `src/domain` returns.
 */
@Component({
  selector: 'app-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonToggleModule, PageHeader, SectionCard, StatTile],
  templateUrl: './reports.html',
})
export class Reports {
  private readonly store = inject(LedgerStore);

  protected readonly ready = this.store.ready;
  protected readonly view = signal<ReportView>('daily');
  /** The date driving the Daily summary and Vehicle rent reports. */
  protected readonly date = signal('');

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
