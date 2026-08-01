import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatTile } from '../../shared/ui/stat-tile';
import { PartyLedgerStore } from '../../core/ledger/party-ledger-store';
import { partyStatement, reconcileQty } from '../../../domain/party/reports';
import { computePartyRow, type ComputedPartyRow } from '../../../domain/party/calc';
import { formatDate, formatInr, formatTons } from '../../../domain/format';
import type { PartyLedgerRow } from '../../../domain/party/types';

/**
 * One party's full statement: quarry payable, receivable, per-owner rent and
 * the profit split — everything the workbook's per-party sheet derived, plus
 * the quarry-statement reconciliation. All values are computed from the rows
 * on demand; nothing is stored.
 */
@Component({
  selector: 'app-party-statements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    MatIconModule,
    MatButtonModule,
    PageHeader,
    SectionCard,
    StatTile,
  ],
  templateUrl: './party-statements.html',
})
export class PartyStatements {
  private readonly store = inject(PartyLedgerStore);

  protected readonly account = this.store.account;
  protected readonly initialised = this.store.initialised;
  protected readonly parties = this.store.partyOptions;

  protected readonly party = signal('');
  /** Tonnage claimed by the quarry statement — reconciliation input, never stored. */
  protected readonly statedQty = signal<number | null>(null);

  /** Whether the user changed the party; guards the async default (CLAUDE.md). */
  private readonly partyTouched = signal(false);

  protected readonly statement = computed(() =>
    partyStatement(this.store.rows(), this.party()),
  );

  protected readonly partyRows = computed(() =>
    this.store
      .rows()
      .filter((row) => row.party === this.party())
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date)),
  );

  protected readonly reconciliation = computed(() => {
    const stated = this.statedQty();
    if (stated == null || !(stated > 0)) return null;
    return reconcileQty(this.store.rows(), this.party(), stated);
  });

  constructor() {
    // Default to the busiest party once seeded — but never clobber a choice the
    // user already made (the async-default trap in CLAUDE.md).
    effect(() => {
      if (!this.initialised() || this.partyTouched() || this.party()) return;
      const first = this.store.summary().parties[0]?.party ?? this.parties()[0] ?? '';
      if (first) this.party.set(first);
    });
  }

  protected onPartyChange(value: string): void {
    this.partyTouched.set(true);
    this.party.set(value);
    this.statedQty.set(null);
  }

  protected calc(row: PartyLedgerRow): ComputedPartyRow {
    return computePartyRow(row);
  }

  protected inr(value: number): string {
    return formatInr(value);
  }

  protected tons(value: number): string {
    return formatTons(value);
  }

  protected day(iso: string): string {
    return formatDate(iso);
  }
}
