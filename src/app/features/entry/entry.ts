import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
  type WritableSignal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PageHeader } from '../../shared/ui/page-header';
import { LedgerStore, type LedgerRowDraft } from '../../core/ledger/ledger-store';
import { computeRow, type ComputedRow } from '../../../domain/calc';
import { formatDate, formatInr, formatTons } from '../../../domain/format';
import { ratePrefill } from '../../../domain/rates';
import { summarize } from '../../../domain/summaries';
import type { LedgerRow, PassType } from '../../../domain/types';

/** The four rate fields the chart autopopulates. */
type RateField = 'quaryRate' | 'crusherRate' | 'rentRate' | 'commRate';

/** How a rate cell got its current value — drives the cell badge and tint. */
type RateOrigin = 'auto' | 'saved' | 'edited' | 'none';

/** Which visual group a column belongs to. */
type ColumnGroup = 'input' | 'auto' | 'calc';

interface SheetColumn {
  key: string;
  label: string;
  width: number;
  group: ColumnGroup;
}

/**
 * Column order mirrors the source workbook's Daily Ledger sheet.
 *
 * `item` is deliberately absent: only one commodity is handled these days, so the
 * column is hidden and every row is saved as 'Rock'. The field stays on
 * `LedgerRow` (the spec keeps it flexible), so restoring the column is a UI change
 * only.
 *
 * Rate columns are sized for the values that actually occur — three digits plus
 * the cell badge — rather than for their headings, which is why the headings are
 * abbreviated.
 */
const COLUMNS: readonly SheetColumn[] = [
  { key: 'date', label: 'Date', width: 126, group: 'input' },
  { key: 'crusher', label: 'Crusher', width: 168, group: 'input' },
  { key: 'passType', label: 'Pass', width: 96, group: 'input' },
  { key: 'qty', label: 'Qty (t)', width: 82, group: 'input' },
  { key: 'quaryRate', label: 'Quary', width: 74, group: 'auto' },
  { key: 'crusherRate', label: 'Crusher', width: 74, group: 'auto' },
  { key: 'rentRate', label: 'Rent', width: 74, group: 'auto' },
  { key: 'commRate', label: 'Comm', width: 74, group: 'auto' },
  { key: 'vehicle', label: 'Vehicle', width: 138, group: 'input' },
  { key: 'crusherAmount', label: 'Crusher Amt', width: 102, group: 'calc' },
  { key: 'quaryAmount', label: 'Quary Amt', width: 98, group: 'calc' },
  { key: 'vehicleTon', label: 'Veh Ton', width: 82, group: 'calc' },
  { key: 'vehicleRent', label: 'Veh Rent', width: 94, group: 'calc' },
  { key: 'profit', label: 'Profit', width: 94, group: 'calc' },
  { key: 'discount', label: 'Discount', width: 90, group: 'calc' },
];

const RATE_COLUMNS: readonly { field: RateField; label: string; testid: string }[] = [
  { field: 'quaryRate', label: 'Quary rate', testid: 'entry-quary-rate' },
  { field: 'crusherRate', label: 'Crusher rate', testid: 'entry-crusher-rate' },
  { field: 'rentRate', label: 'Rent rate', testid: 'entry-rent-rate' },
  { field: 'commRate', label: 'Comm rate', testid: 'entry-comm-rate' },
];

/** How many of the date's saved rows to show above the entry row. */
const VISIBLE_DAY_ROWS = 20;

/**
 * A saved row prepared for display above the entry row.
 *
 * `differs` flags the rate cells whose snapshot does not match what the rate chart
 * would fill in **today**. That covers a rate typed over at entry time, and also a
 * row entered before the chart was changed — the row itself does not record which,
 * so the highlight is deliberately labelled "differs from the chart" rather than
 * "was edited".
 */
interface SavedRowView {
  row: LedgerRow;
  calc: ComputedRow;
  differs: Record<RateField, boolean>;
  /** False when the chart has no entry for this crusher + pass, so nothing to compare. */
  comparable: boolean;
}

/** Today as ISO 'YYYY-MM-DD' in local time (never a UTC-shifted day). */
function todayIso(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Load entry as a spreadsheet row — the layout the business already works in.
 *
 * Columns follow the Daily Ledger sheet's own order. You fill the plain cells;
 * the tinted rate cells autopopulate from the rate chart and stay editable, and
 * the right-hand cells are computed live. Adding a row pushes it onto the stack
 * directly above, so the sheet visibly fills up as you work.
 *
 * Whatever is in the rate cells at save time is what gets snapshotted onto the
 * row — editing the chart later never touches a saved row.
 *
 * Optimised for tablet and laptop, where this data gets entered. Reports are the
 * mobile-first screen.
 */
@Component({
  selector: 'app-entry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule, PageHeader],
  templateUrl: './entry.html',
  styleUrl: './entry.scss',
})
export class Entry {
  private readonly store = inject(LedgerStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  protected readonly COLUMNS = COLUMNS;
  protected readonly RATE_COLUMNS = RATE_COLUMNS;
  /** Tooltip on a highlighted saved-row rate cell. */
  protected readonly DIFFERS_HINT =
    'This rate does not match the current rate chart — it was either typed over on entry or the chart changed afterwards. The row keeps its own snapshot.';

  private readonly qtyCell = viewChild<ElementRef<HTMLInputElement>>('qtyCell');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  /**
   * `?edit=<row id>` — the Ledger tab links here to edit a row. Bound from the
   * query string by `withComponentInputBinding()`.
   */
  readonly edit = input<string | undefined>(undefined);

  /** Set once the row named by `edit` has been loaded into the form. */
  readonly editingId = signal<string | null>(null);

  protected readonly date = signal(todayIso());
  protected readonly item = signal('Rock');
  protected readonly crusher = signal('');
  protected readonly passType = signal<PassType>('WO Pass');
  protected readonly qty = signal<number | null>(null);
  protected readonly vehicle = signal('');
  protected readonly quaryRate = signal(0);
  protected readonly crusherRate = signal(0);
  protected readonly rentRate = signal(0);
  protected readonly commRate = signal(0);

  /** Rate cells the user has typed over, so they are not relabelled 'auto'. */
  private readonly overridden = signal<ReadonlySet<RateField>>(new Set());

  private readonly rateSignals: Record<RateField, WritableSignal<number>> = {
    quaryRate: this.quaryRate,
    crusherRate: this.crusherRate,
    rentRate: this.rentRate,
    commRate: this.commRate,
  };

  protected readonly ready = this.store.ready;
  /** True while a save is in flight, so the row cannot be added twice. */
  protected readonly saving = signal(false);
  protected readonly crushers = this.store.crusherOptions;
  protected readonly vehicles = this.store.vehicleOptions;
  protected readonly isEditing = computed(() => this.editingId() !== null);

  /** True when the current crusher + pass type actually has a chart entry. */
  private readonly hasPrefill = computed(
    () =>
      ratePrefill(
        this.store.rateChart(),
        this.crusher(),
        this.passType(),
        this.store.discountRate(),
      ) !== undefined,
  );

  /**
   * Live preview of the row as it would be saved. Uses the same `computeRow` the
   * reports use — the UI never does arithmetic of its own.
   */
  protected readonly preview = computed(() => computeRow(this.draft()));

  protected readonly canSave = computed(
    () => this.crusher().trim() !== '' && (this.qty() ?? 0) > 0,
  );

  /** The date's saved rows, oldest first so new ones land just above the entry row. */
  private readonly allDayRows = computed(() =>
    this.store.rows().filter((row) => row.date === this.date()),
  );
  protected readonly dayRows = computed(() => this.allDayRows().slice(-VISIBLE_DAY_ROWS));

  /**
   * The visible saved rows with their derived values and rate-difference flags
   * precomputed, so the template does no work per cell.
   */
  protected readonly dayRowViews = computed<SavedRowView[]>(() => {
    const chart = this.store.rateChart();
    const discount = this.store.discountRate();

    return this.dayRows().map((row) => {
      const prefill = ratePrefill(chart, row.crusher, row.passType, discount);
      return {
        row,
        calc: computeRow(row),
        comparable: prefill !== undefined,
        differs: {
          quaryRate: prefill !== undefined && row.quaryRate !== prefill.quaryRate,
          crusherRate: prefill !== undefined && row.crusherRate !== prefill.crusherRate,
          rentRate: prefill !== undefined && row.rentRate !== prefill.rentRate,
          commRate: prefill !== undefined && row.commRate !== prefill.commRate,
        },
      };
    });
  });

  /** How many visible saved rows carry at least one rate off the current chart. */
  protected readonly rowsDifferingFromChart = computed(
    () => this.dayRowViews().filter((v) => Object.values(v.differs).some(Boolean)).length,
  );
  protected readonly hiddenDayRows = computed(
    () => this.allDayRows().length - this.dayRows().length,
  );
  protected readonly dayTotals = computed(() => summarize(this.allDayRows()));
  protected readonly dayLabel = computed(() => formatDate(this.date()));

  constructor() {
    // Autopopulate the rate cells on crusher / pass-type change. A chart miss
    // leaves the current values alone rather than blanking a half-typed row.
    effect(() => {
      const prefill = ratePrefill(
        this.store.rateChart(),
        this.crusher(),
        this.passType(),
        this.store.discountRate(),
      );
      if (!prefill || this.suppressPrefill) return;
      // A cell the user typed over keeps their value — re-filling it would undo
      // the correction they just made.
      const overridden = this.overridden();
      if (!overridden.has('quaryRate')) this.quaryRate.set(prefill.quaryRate);
      if (!overridden.has('crusherRate')) this.crusherRate.set(prefill.crusherRate);
      if (!overridden.has('rentRate')) this.rentRate.set(prefill.rentRate);
      if (!overridden.has('commRate')) this.commRate.set(prefill.commRate);
    });

    // Default the commission rate for a fresh row even before a crusher is picked.
    effect(() => {
      if (!this.store.ready() || this.isEditing() || this.crusher()) return;
      this.commRate.set(this.store.discountRate());
    });

    // Load the row named by `?edit=<id>` once the store has hydrated.
    effect(() => {
      const id = this.edit();
      if (!id || !this.store.ready() || this.editingId() === id) return;
      const row = this.store.rowById(id);
      if (row) this.loadRow(row);
    });
  }

  /**
   * Guard so loading a row for editing does not immediately get overwritten by the
   * chart prefill effect — an edited row must keep its own snapshotted rates.
   */
  private suppressPrefill = false;

  /** The row's fields as currently entered, without an id. */
  private draftFields(): LedgerRowDraft {
    return {
      date: this.date(),
      item: this.item().trim() || 'Rock',
      crusher: this.crusher(),
      passType: this.passType(),
      qty: this.qty() ?? 0,
      quaryRate: this.quaryRate(),
      crusherRate: this.crusherRate(),
      rentRate: this.rentRate(),
      commRate: this.commRate(),
      vehicle: this.vehicle(),
    };
  }

  /** The draft as a full row, for the live preview only — 'preview' is never saved. */
  private draft(): LedgerRow {
    return { ...this.draftFields(), id: this.editingId() ?? 'preview' };
  }

  // --- Rate cells ----------------------------------------------------------

  protected rateValue(field: RateField): number {
    return this.rateSignals[field]();
  }

  protected onRateEdit(field: RateField, value: number | string): void {
    const parsed = Number(value);
    this.rateSignals[field].set(Number.isFinite(parsed) ? parsed : 0);
    this.overridden.update((prev) => new Set(prev).add(field));
  }

  /** Where a rate cell's value came from — shown as the cell's small badge. */
  protected rateOrigin(field: RateField): RateOrigin {
    if (this.overridden().has(field)) return 'edited';
    if (this.isEditing()) return 'saved';
    return this.hasPrefill() ? 'auto' : 'none';
  }

  protected isAuto(field: RateField): boolean {
    const origin = this.rateOrigin(field);
    return origin === 'auto' || origin === 'saved';
  }

  // --- Cell navigation -----------------------------------------------------

  /**
   * Keep the focused cell on screen. The sheet is wider than the viewport, so
   * tabbing across would otherwise leave the caret in a cell nobody can see.
   */
  protected revealCell(event: FocusEvent): void {
    (event.target as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // --- Row actions ---------------------------------------------------------

  /**
   * Persist the row, then confirm.
   *
   * Nothing is reported to the user until the write has landed, so the visible
   * outcome — a cleared quantity when adding, a return to the Ledger when
   * editing — is a reliable signal that the change is safely on disk.
   */
  protected async save(): Promise<void> {
    if (!this.canSave() || this.saving()) return;
    const draft = this.draftFields();
    const editingId = this.editingId();

    this.saving.set(true);
    try {
      if (editingId) {
        await this.store.updateRow(editingId, draft);
      } else {
        await this.store.addRow(draft);
      }
    } catch (err) {
      this.snackBar.open(
        `Could not save: ${err instanceof Error ? err.message : String(err)}`,
        'OK',
        { duration: 8000 },
      );
      return;
    } finally {
      this.saving.set(false);
    }

    if (editingId) {
      // Go back where the edit started. `editingId` is deliberately left set: the
      // `?edit=` effect would otherwise see it cleared and reload the row straight
      // back into the form.
      this.snackBar.open('Row updated', 'OK', { duration: 3000 });
      void this.router.navigate(['/ledger']);
      return;
    }

    this.startNextRow();
  }

  /**
   * Ready the next row: the date, crusher, pass type, vehicle and rates all carry
   * over, so only the quantity clears. Focus lands back on it, which makes a
   * second load from the same crusher a type-and-Enter job.
   */
  private startNextRow(): void {
    this.editingId.set(null);
    this.qty.set(null);
    this.scroller()?.nativeElement.scrollTo({ left: 0 });
    this.qtyCell()?.nativeElement.focus();
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.qty.set(null);
    void this.router.navigate(['/ledger']);
  }

  protected onCrusherChange(value: string): void {
    this.suppressPrefill = false;
    // A new crusher means new chart rates, so previous overrides no longer apply.
    this.overridden.set(new Set());
    this.crusher.set(value);
  }

  protected onPassTypeChange(value: PassType): void {
    this.suppressPrefill = false;
    this.overridden.set(new Set());
    this.passType.set(value);
  }

  /** Load an existing row into the form. Driven by `?edit=<id>`. */
  loadRow(row: LedgerRow): void {
    this.suppressPrefill = true;
    this.overridden.set(new Set());
    this.editingId.set(row.id);
    this.date.set(row.date);
    this.item.set(row.item);
    this.crusher.set(row.crusher);
    this.passType.set(row.passType ?? 'WO Pass');
    this.qty.set(row.qty);
    this.vehicle.set(row.vehicle);
    this.quaryRate.set(row.quaryRate);
    this.crusherRate.set(row.crusherRate);
    this.rentRate.set(row.rentRate);
    this.commRate.set(row.commRate);
    // Re-enable prefill once the current effect flush has settled, so later
    // crusher changes behave normally.
    queueMicrotask(() => (this.suppressPrefill = false));
  }

  // --- Formatting ----------------------------------------------------------

  /** Derived values for a saved row, for the read-only rows above the entry row. */
  protected calc(row: LedgerRow): ComputedRow {
    return computeRow(row);
  }

  protected inr(value: number): string {
    return formatInr(value);
  }

  protected tons(value: number): string {
    return formatTons(value);
  }
}
