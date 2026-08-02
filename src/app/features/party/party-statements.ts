import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatTile } from '../../shared/ui/stat-tile';
import { PartyLedgerStore } from '../../core/ledger/party-ledger-store';
import { partyStatement, reconcileQty } from '../../../domain/party/reports';
import { computePartyRow, type ComputedPartyRow } from '../../../domain/party/calc';
import { formatDate, formatInr, formatTons } from '../../../domain/format';
import type { PartyLedgerRow } from '../../../domain/party/types';
import type {
  PrintChoice,
  PrintOptions,
  PrintOptionsData,
  PrintOptionsDialog,
} from '../../shared/print/print-options-dialog';
import { handoffToPrint, printStamp } from '../../shared/print/print-flow';

/** The printable sections of this page — both scoped to the selected party. */
type PrintSection = 'statement' | 'loads';

const PRINT_CHOICES: readonly PrintChoice<PrintSection>[] = [
  {
    key: 'statement',
    label: 'Statement',
    hint: 'Payable, receivable, per-owner rent and the profit split',
  },
  {
    key: 'loads',
    label: 'All loads',
    hint: 'Every load recorded against this party',
  },
];

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
  private readonly dialog = inject(MatDialog);

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

  // --- Printing --------------------------------------------------------------

  /** Sections included in the next printout; empty until Print is used. */
  protected readonly printSections = signal<readonly PrintSection[]>([]);
  protected readonly printedAt = signal('');

  protected includesSection(section: PrintSection): boolean {
    return this.printSections().includes(section);
  }

  protected async print(): Promise<void> {
    // Lazy: the dialog and its checkbox module only load when someone prints.
    const { PrintOptionsDialog: Dialog } = await import(
      '../../shared/print/print-options-dialog'
    );

    const data: PrintOptionsData<PrintSection> = {
      choices: PRINT_CHOICES,
      selected: ['statement'],
      // Both sections are "the selected party"; flag them when it has no rows.
      emptyKeys: this.statement().loads === 0 ? ['statement', 'loads'] : [],
    };

    const ref = this.dialog.open<
      PrintOptionsDialog,
      PrintOptionsData<PrintSection>,
      PrintOptions<PrintSection>
    >(Dialog, { data, autoFocus: false, width: '440px', maxWidth: '94vw' });

    const options = await new Promise<PrintOptions<PrintSection> | undefined>((resolve) =>
      ref.afterClosed().subscribe(resolve),
    );
    if (!options?.sections.length) return;

    this.printedAt.set(printStamp());
    this.printSections.set(options.sections);
    await handoffToPrint();
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
