import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatTile } from '../../shared/ui/stat-tile';
import { PartyLedgerStore } from '../../core/ledger/party-ledger-store';
import { ownerRentLines } from '../../../domain/party/reports';
import { formatInr, formatTons } from '../../../domain/format';

/**
 * The cross-party view — the workbook's SUMMARY sheet, computed live: per-party
 * payable vs receivable, grand totals, and rent payable per owner across every
 * party. Pure functions over the rows; nothing stored.
 */
@Component({
  selector: 'app-party-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, PageHeader, SectionCard, StatTile],
  templateUrl: './party-reports.html',
})
export class PartyReports {
  private readonly store = inject(PartyLedgerStore);

  protected readonly account = this.store.account;
  protected readonly initialised = this.store.initialised;
  protected readonly summary = this.store.summary;

  /** Rent payable per owner across all parties. */
  protected readonly owners = computed(() => ownerRentLines(this.store.rows()));
  protected readonly ownersTotal = computed(() =>
    this.owners().reduce((sum, line) => sum + line.rent, 0),
  );

  protected inr(value: number): string {
    return formatInr(value);
  }

  protected tons(value: number): string {
    return formatTons(value);
  }
}
