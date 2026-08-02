import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatTile } from '../../shared/ui/stat-tile';
import { PartyLedgerStore } from '../../core/ledger/party-ledger-store';
import { ownerRentLines } from '../../../domain/party/reports';
import { formatInr, formatTons } from '../../../domain/format';
import type {
  PrintChoice,
  PrintOptions,
  PrintOptionsData,
  PrintOptionsDialog,
} from '../../shared/print/print-options-dialog';
import { handoffToPrint, printStamp } from '../../shared/print/print-flow';

/** The printable sections of this page. */
type PrintSection = 'summary' | 'owners';

const PRINT_CHOICES: readonly PrintChoice<PrintSection>[] = [
  {
    key: 'summary',
    label: 'Cross-party summary',
    hint: 'Grand totals and the per-party payable vs receivable table',
  },
  {
    key: 'owners',
    label: 'Vehicle rent by owner',
    hint: 'Rent payable per owner across every party, all time',
  },
];

/**
 * The cross-party view — the workbook's SUMMARY sheet, computed live: per-party
 * payable vs receivable, grand totals, and rent payable per owner across every
 * party. Pure functions over the rows; nothing stored.
 *
 * Printing mirrors the daily Reports tab: pick sections, render them into the
 * hidden `.report-print` block, hand off to the browser's print dialog.
 */
@Component({
  selector: 'app-party-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, PageHeader, SectionCard, StatTile],
  templateUrl: './party-reports.html',
})
export class PartyReports {
  private readonly store = inject(PartyLedgerStore);
  private readonly dialog = inject(MatDialog);

  protected readonly account = this.store.account;
  protected readonly initialised = this.store.initialised;
  protected readonly summary = this.store.summary;

  /** Rent payable per owner across all parties. */
  protected readonly owners = computed(() => ownerRentLines(this.store.rows()));
  protected readonly ownersTotal = computed(() =>
    this.owners().reduce((sum, line) => sum + line.rent, 0),
  );

  /** Sections included in the next printout; empty until Print is used. */
  protected readonly printSections = signal<readonly PrintSection[]>([]);
  /** Stamped when a printout is prepared, so the page footer can show it. */
  protected readonly printedAt = signal('');

  protected includesSection(section: PrintSection): boolean {
    return this.printSections().includes(section);
  }

  protected async print(): Promise<void> {
    // Lazy: the dialog and its checkbox module only load when someone prints.
    const { PrintOptionsDialog: Dialog } = await import(
      '../../shared/print/print-options-dialog'
    );

    const emptyKeys: PrintSection[] = this.summary().parties.length === 0 ? ['summary'] : [];
    if (this.owners().length === 0) emptyKeys.push('owners');

    const data: PrintOptionsData<PrintSection> = {
      choices: PRINT_CHOICES,
      selected: ['summary', 'owners'],
      emptyKeys,
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

  protected inr(value: number): string {
    return formatInr(value);
  }

  protected tons(value: number): string {
    return formatTons(value);
  }
}
