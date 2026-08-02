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
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PageHeader } from '../../shared/ui/page-header';
import { filterOptions } from '../../shared/ui/option-filter';
import { deleteRowWithUndo } from '../../shared/ledger/undo-delete';
import {
  isPartyDraftComplete,
  PartyLedgerStore,
  type PartyLedgerRowDraft,
} from '../../core/ledger/party-ledger-store';
import { computePartyRow, type ComputedPartyRow } from '../../../domain/party/calc';
import { partyRatePrefill } from '../../../domain/party/rates';
import { vehicleOwner } from '../../../domain/rates';
import { formatDate, formatInr, formatTons } from '../../../domain/format';
import type { PartyLedgerRow, PartyProfitShare } from '../../../domain/party/types';

type RateField = 'quaryRate' | 'billRate' | 'rentRate';
type RateOrigin = 'auto' | 'saved' | 'edited' | 'none';

/** Which visual group a column belongs to (same vocabulary as the daily sheet). */
type ColumnGroup = 'input' | 'auto' | 'calc';

interface SheetColumn {
  key: string;
  label: string;
  width: number;
  group: ColumnGroup;
  /** Absorbs surplus width — free-text columns only (see the daily sheet). */
  flex?: boolean;
}

/**
 * Column order mirrors the source workbook's party sheets: the load facts, the
 * three snapshotted rates, then the computed money.
 */
const COLUMNS: readonly SheetColumn[] = [
  { key: 'date', label: 'Date', width: 126, group: 'input' },
  { key: 'party', label: 'Party', width: 168, group: 'input', flex: true },
  { key: 'qty', label: 'Qty (t)', width: 82, group: 'input' },
  { key: 'rent', label: 'Rent', width: 108, group: 'input' },
  { key: 'vehicle', label: 'Vehicle', width: 138, group: 'input', flex: true },
  { key: 'owner', label: 'Owner', width: 130, group: 'input', flex: true },
  { key: 'quaryRate', label: 'Quary', width: 86, group: 'auto' },
  { key: 'billRate', label: 'Bill', width: 86, group: 'auto' },
  { key: 'rentRate', label: 'Rent ₹/t', width: 86, group: 'auto' },
  { key: 'quarryAmount', label: 'Quarry Amt', width: 100, group: 'calc' },
  { key: 'billAmount', label: 'Bill Amt', width: 100, group: 'calc' },
  { key: 'rentAmount', label: 'Veh Rent', width: 94, group: 'calc' },
  { key: 'profitAmount', label: 'Profit', width: 94, group: 'calc' },
  { key: 'actions', label: '', width: 100, group: 'input' },
];

const RATE_COLUMNS: readonly { field: RateField; label: string; testid: string }[] = [
  { field: 'quaryRate', label: 'Quary rate', testid: 'party-entry-quary-rate' },
  { field: 'billRate', label: 'Bill rate', testid: 'party-entry-bill-rate' },
  { field: 'rentRate', label: 'Rent rate', testid: 'party-entry-rent-rate' },
];

/** How many of the date's saved rows to show above the entry row. */
const VISIBLE_DAY_ROWS = 20;

/** A saved row prepared for display above the entry row (daily-sheet twin). */
interface SavedRowView {
  row: PartyLedgerRow;
  calc: ComputedPartyRow;
  differs: Record<RateField, boolean>;
  /** False when the setup has no entry for this party, so nothing to compare. */
  comparable: boolean;
  /** 'draft' rows are staged on this sheet only; 'row' is in the book's ledger. */
  kind: 'row' | 'draft';
  /** A draft still missing what it needs to sync (party / qty). */
  incomplete: boolean;
  /** `data-testid` prefix for this row's cells — `draft-` or `row-`. */
  prefix: 'draft-' | 'row-';
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
 * Party-ledger load entry as a spreadsheet — the same sheet contract as the
 * daily Entry tab: saved rows stack above a sticky entry row, the tinted rate
 * cells autofill from the party setup (and stay editable), the computed money
 * is previewed live, and new rows stage as durable DRAFTS until "Save to
 * ledger" moves the complete ones across. Whatever is visible at save time is
 * what gets snapshotted onto the row; editing the setup later never touches it.
 */
@Component({
  selector: 'app-party-entry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Sheet styles are global (`src/styles/_sheet.scss`), shared with the daily sheet.
  imports: [FormsModule, MatIconModule, MatButtonModule, MatAutocompleteModule, PageHeader],
  templateUrl: './party-entry.html',
})
export class PartyEntry {
  private readonly store = inject(PartyLedgerStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  protected readonly COLUMNS = COLUMNS;
  protected readonly RATE_COLUMNS = RATE_COLUMNS;
  /** Tooltip on a highlighted saved-row rate cell. */
  protected readonly DIFFERS_HINT =
    'This rate does not match the current party setup — it was either typed over on entry or the setup changed afterwards. The row keeps its own snapshot.';

  private readonly qtyCell = viewChild<ElementRef<HTMLInputElement>>('qtyCell');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  /** `?edit=<row id>` — statements and the party ledger link here to edit. */
  readonly edit = input<string | undefined>(undefined);
  readonly editingId = signal<string | null>(null);
  /** Provenance of the row being edited: a staged draft or a ledger row. */
  readonly editingKind = signal<'row' | 'draft' | null>(null);
  /** A `query` edit returns to where it started; an `inline` edit stays here. */
  private editSource: 'query' | 'inline' = 'inline';

  protected readonly date = signal(todayIso());
  protected readonly party = signal('');
  protected readonly vehicle = signal('');
  protected readonly owner = signal('');
  protected readonly qty = signal<number | null>(null);
  protected readonly withRent = signal(true);
  protected readonly quaryRate = signal(0);
  protected readonly billRate = signal(0);
  protected readonly rentRate = signal(0);
  protected readonly profitShares = signal<PartyProfitShare[]>([]);

  /** Rate cells the user typed over, so the prefill won't undo their edit. */
  private readonly overridden = signal<ReadonlySet<RateField>>(new Set());
  /** True once the user edited the owner by hand for the current vehicle. */
  private ownerTouched = false;
  /** Guard so loading a row for editing is not clobbered by the prefill effect. */
  private suppressPrefill = false;

  private readonly rateSignals: Record<RateField, WritableSignal<number>> = {
    quaryRate: this.quaryRate,
    billRate: this.billRate,
    rentRate: this.rentRate,
  };

  protected readonly account = this.store.account;
  protected readonly ready = this.store.ready;
  /** Hydrated *and* seeded — saving is gated on this, never on `ready()`. */
  protected readonly initialised = this.store.initialised;
  protected readonly saving = signal(false);
  protected readonly parties = this.store.partyOptions;
  protected readonly vehicles = this.store.vehicleOptions;
  protected readonly isEditing = computed(() => this.editingId() !== null);

  // Type-ahead panels — a chosen value reopens with the FULL list (shared
  // filterOptions), unlike the datalist behaviour it replaces.
  protected readonly partyPanel = computed(() => filterOptions(this.parties(), this.party()));
  protected readonly vehiclePanel = computed(() => filterOptions(this.vehicles(), this.vehicle()));

  /** Per-draft panel options (called from the template with the row's value). */
  protected filterParties(value: string): string[] {
    return filterOptions(this.parties(), value);
  }

  protected filterVehicles(value: string): string[] {
    return filterOptions(this.vehicles(), value);
  }

  private readonly hasPrefill = computed(
    () => partyRatePrefill(this.store.rates(), this.party(), this.withRent()) !== undefined,
  );

  /** Live preview via the same engine the reports use — no UI arithmetic. */
  protected readonly preview = computed<ComputedPartyRow>(() => computePartyRow(this.draft()));
  protected readonly perTonProfit = computed(() =>
    this.profitShares().reduce((sum, share) => sum + share.perTon, 0),
  );

  /**
   * A new row only needs a quantity — the quarry's raw data arrives without a
   * party, and such rows stage as drafts. Editing a LEDGER row still requires
   * its party: the book never holds a row that belongs to nobody.
   */
  protected readonly canSave = computed(
    () =>
      (this.qty() ?? 0) > 0 &&
      (this.editingKind() !== 'row' || this.party().trim() !== ''),
  );

  /**
   * The date's rows, oldest first: ledger rows first, then the staged drafts
   * (closest to the entry row, since they are the ones still in progress).
   */
  private readonly allDayItems = computed<{ row: PartyLedgerRow; kind: 'row' | 'draft' }[]>(
    () => {
      const date = this.date();
      return [
        ...this.store
          .rows()
          .filter((row) => row.date === date)
          .map((row) => ({ row, kind: 'row' as const })),
        ...this.store
          .drafts()
          .filter((row) => row.date === date)
          .map((row) => ({ row, kind: 'draft' as const })),
      ];
    },
  );
  private readonly dayItems = computed(() => this.allDayItems().slice(-VISIBLE_DAY_ROWS));

  /** The visible saved rows with derived values + setup-difference flags. */
  protected readonly dayRowViews = computed<SavedRowView[]>(() => {
    const rates = this.store.rates();
    return this.dayItems().map(({ row, kind }) => {
      const prefill = partyRatePrefill(rates, row.party, row.withRent);
      return {
        row,
        kind,
        prefix: kind === 'draft' ? ('draft-' as const) : ('row-' as const),
        incomplete: kind === 'draft' && !isPartyDraftComplete(row),
        calc: computePartyRow(row),
        comparable: prefill !== undefined,
        differs: {
          quaryRate: prefill !== undefined && row.quaryRate !== prefill.quaryRate,
          billRate: prefill !== undefined && row.billRate !== prefill.billRate,
          rentRate: prefill !== undefined && row.rentRate !== prefill.rentRate,
        },
      };
    });
  });

  /** How many visible saved rows carry at least one rate off the setup. */
  protected readonly rowsDifferingFromSetup = computed(
    () => this.dayRowViews().filter((v) => Object.values(v.differs).some(Boolean)).length,
  );
  protected readonly hiddenDayRows = computed(
    () => this.allDayItems().length - this.dayItems().length,
  );
  protected readonly dayTotals = computed(() => {
    const rows = this.allDayItems().map((item) => item.row);
    return { loads: rows.length, qty: rows.reduce((sum, row) => sum + row.qty, 0) };
  });
  protected readonly dayLabel = computed(() => formatDate(this.date()));

  // --- Draft sync ------------------------------------------------------------

  protected readonly draftCount = computed(() => this.store.drafts().length);
  protected readonly syncableCount = computed(
    () => this.store.drafts().filter(isPartyDraftComplete).length,
  );
  protected readonly heldCount = computed(() => this.draftCount() - this.syncableCount());
  protected readonly syncing = signal(false);

  constructor() {
    // Autofill rates + split on party / rent-mode change. A config miss leaves
    // the current values alone rather than blanking a half-typed row.
    effect(() => {
      const prefill = partyRatePrefill(this.store.rates(), this.party(), this.withRent());
      if (!prefill || this.suppressPrefill) return;
      const overridden = this.overridden();
      if (!overridden.has('quaryRate')) this.quaryRate.set(prefill.quaryRate);
      if (!overridden.has('billRate')) this.billRate.set(prefill.billRate);
      if (!overridden.has('rentRate')) this.rentRate.set(prefill.rentRate);
      this.profitShares.set(prefill.profitShares);
    });

    // Autofill the owner from the vehicle master on vehicle change.
    effect(() => {
      const registration = this.vehicle();
      if (this.suppressPrefill || this.ownerTouched) return;
      const owner = vehicleOwner(this.store.vehicles(), registration);
      if (owner) this.owner.set(owner);
    });

    // Load the row named by `?edit=<id>` once the store has hydrated. Ledger
    // rows and staged drafts are both addressable.
    effect(() => {
      const id = this.edit();
      if (!id || !this.store.ready() || this.editingId() === id) return;
      const row = this.store.rowById(id);
      if (row) {
        this.editSource = 'query';
        this.editingKind.set('row');
        this.loadRow(row);
        return;
      }
      const draft = this.store.draftById(id);
      if (draft) {
        this.editSource = 'query';
        this.editingKind.set('draft');
        this.loadRow(draft);
      }
    });
  }

  private draftFields(): PartyLedgerRowDraft {
    return {
      date: this.date(),
      party: this.party(),
      item: 'Rock',
      vehicle: this.vehicle(),
      owner: this.owner().trim(),
      qty: this.qty() ?? 0,
      withRent: this.withRent(),
      quaryRate: this.quaryRate(),
      billRate: this.billRate(),
      rentRate: this.withRent() ? this.rentRate() : 0,
      profitShares: this.profitShares(),
    };
  }

  private draft(): PartyLedgerRow {
    return { ...this.draftFields(), id: this.editingId() ?? 'preview' };
  }

  // --- Field handlers -------------------------------------------------------

  protected onPartyChange(value: string): void {
    this.suppressPrefill = false;
    // Edited cells always beat autofill (client rule): a rate the user typed
    // stays put across party/mode changes; untouched cells re-populate.
    this.party.set(value);
  }

  protected onWithRentChange(value: boolean): void {
    this.suppressPrefill = false;
    this.withRent.set(value);
  }

  protected onVehicleChange(value: string): void {
    this.ownerTouched = false;
    this.vehicle.set(value);
  }

  protected onOwnerEdit(value: string): void {
    this.ownerTouched = true;
    this.owner.set(value);
  }

  protected rateValue(field: RateField): number {
    return this.rateSignals[field]();
  }

  protected onRateEdit(field: RateField, value: number | string): void {
    const parsed = Number(value);
    this.rateSignals[field].set(Number.isFinite(parsed) ? parsed : 0);
    this.overridden.update((prev) => new Set(prev).add(field));
  }

  protected rateOrigin(field: RateField): RateOrigin {
    if (this.overridden().has(field)) return 'edited';
    if (this.isEditing()) return 'saved';
    return this.hasPrefill() ? 'auto' : 'none';
  }

  protected isAuto(field: RateField): boolean {
    const origin = this.rateOrigin(field);
    return origin === 'auto' || origin === 'saved';
  }

  /** Keep the focused cell on screen while tabbing across the wide sheet. */
  protected revealCell(event: FocusEvent): void {
    (event.target as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // --- Row actions -----------------------------------------------------------

  /** Persist, then confirm — nothing is reported until the write has landed. */
  protected async save(): Promise<void> {
    if (!this.canSave() || this.saving() || !this.initialised()) return;
    const draft = this.draftFields();
    const editingId = this.editingId();
    const editingKind = this.editingKind();

    this.saving.set(true);
    try {
      if (editingId && editingKind === 'row') {
        await this.store.updateRow(editingId, draft);
      } else if (editingId) {
        await this.store.updateDraft(editingId, draft);
      } else {
        // New rows always stage as drafts; "Save N to ledger" moves them across.
        await this.store.addDraft(draft);
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

    if (editingId && this.editSource === 'query') {
      this.snackBar.open('Row updated', 'OK', { duration: 3000 });
      void this.router.navigate(['/party/statements']);
      return;
    }
    if (editingId) {
      this.snackBar.open('Row updated', 'OK', { duration: 3000 });
    }
    this.startNextRow();
  }

  /** Move every complete draft into the book's ledger; incomplete ones stay. */
  protected async syncDraftsToLedger(): Promise<void> {
    if (this.syncing() || !this.initialised() || this.syncableCount() === 0) return;
    this.syncing.set(true);
    try {
      const { synced, held } = await this.store.syncDrafts();
      const heldNote = held > 0 ? ` · ${held} held — missing party` : '';
      this.snackBar.open(
        `${synced} row${synced === 1 ? '' : 's'} saved to ledger${heldNote}`,
        'OK',
        { duration: 5000 },
      );
    } finally {
      this.syncing.set(false);
    }
  }

  /** Carry everything over except the quantity — same-party loads are frequent. */
  private startNextRow(): void {
    this.editingId.set(null);
    this.editingKind.set(null);
    this.editSource = 'inline';
    this.qty.set(null);
    this.scroller()?.nativeElement.scrollTo({ left: 0 });
    this.qtyCell()?.nativeElement.focus();
  }

  protected cancelEdit(): void {
    const fromQuery = this.editSource === 'query';
    this.editingId.set(null);
    this.editingKind.set(null);
    this.editSource = 'inline';
    this.qty.set(null);
    // An inline edit stays on the sheet; a Statements edit goes back there.
    if (fromQuery) void this.router.navigate(['/party/statements']);
  }

  // --- Inline editing ----------------------------------------------------------
  // Every row on the sheet is a live cell, staged or already in the book
  // (see the daily sheet for the rationale).

  /** Route a cell edit to the right collection. Both are equally durable. */
  protected patchCell(view: SavedRowView, patch: Partial<PartyLedgerRowDraft>): void {
    if (view.kind === 'draft') void this.store.updateDraft(view.row.id, patch);
    else void this.store.updateRow(view.row.id, patch);
  }

  protected patchQty(view: SavedRowView, value: number | string): void {
    const qty = Number(value);
    this.patchCell(view, { qty: Number.isFinite(qty) ? qty : 0 });
  }

  protected patchRate(view: SavedRowView, field: RateField, value: number | string): void {
    const parsed = Number(value);
    this.patchCell(view, { [field]: Number.isFinite(parsed) ? parsed : 0 });
  }

  /** A party typed into a row re-resolves the setup, keeping edited cells. */
  protected patchParty(view: SavedRowView, party: string): void {
    this.patchCell(view, {
      party,
      ...this.setupRatePatch(view.row, party, view.row.withRent),
    });
  }

  protected patchRentMode(view: SavedRowView, withRent: boolean): void {
    const patch = this.setupRatePatch(view.row, view.row.party, withRent);
    // Rent never applies without rent — the engine contract expects 0.
    this.patchCell(view, { withRent, ...patch, ...(withRent ? {} : { rentRate: 0 }) });
  }

  /** Vehicle edits re-run the owner autofill, like the entry row does. */
  protected patchVehicle(view: SavedRowView, vehicle: string): void {
    const owner = vehicleOwner(this.store.vehicles(), vehicle);
    this.patchCell(view, { vehicle, ...(owner ? { owner } : {}) });
  }

  /**
   * The setup rates a party/mode change should apply to a row — skipping any
   * cell that differs from its previous auto-filled value (i.e. was typed).
   * The profit split is not editable inline, so it always tracks the setup.
   */
  private setupRatePatch(
    row: PartyLedgerRow,
    party: string,
    withRent: boolean,
  ): Partial<PartyLedgerRowDraft> {
    const rates = this.store.rates();
    const next = partyRatePrefill(rates, party, withRent);
    if (!next) return {};
    const prev = partyRatePrefill(rates, row.party, row.withRent);
    const patch: Partial<PartyLedgerRowDraft> = { profitShares: next.profitShares };
    for (const field of ['quaryRate', 'billRate', 'rentRate'] as const) {
      const baseline = prev ? prev[field] : 0;
      if (row[field] === baseline) patch[field] = next[field];
    }
    return patch;
  }

  /** Start editing a saved row (ledger or draft) in place, on this sheet. */
  protected editRow(view: SavedRowView): void {
    this.editSource = 'inline';
    this.editingKind.set(view.kind);
    // Drop any ?edit= param, or its effect would reload that row over this one.
    if (this.edit()) void this.router.navigate(['/party/entry'], { replaceUrl: true });
    this.loadRow(view.row);
  }

  /** Delete a saved row (ledger or draft), always with an id-preserving Undo. */
  protected async deleteRow(view: SavedRowView): Promise<void> {
    const { row, kind } = view;
    if (this.editingId() === row.id) {
      this.editingId.set(null);
      this.editingKind.set(null);
      this.editSource = 'inline';
    }
    await deleteRowWithUndo(this.snackBar, {
      message: kind === 'draft' ? 'Draft deleted' : 'Row deleted',
      doDelete: () =>
        kind === 'draft' ? this.store.deleteDraft(row.id) : this.store.deleteRow(row.id),
      restore: () =>
        kind === 'draft' ? this.store.restoreDraft(row) : this.store.restoreRow(row),
    });
  }

  private loadRow(row: PartyLedgerRow): void {
    this.suppressPrefill = true;
    this.ownerTouched = true;
    this.overridden.set(new Set());
    this.editingId.set(row.id);
    this.date.set(row.date);
    this.party.set(row.party);
    this.vehicle.set(row.vehicle);
    this.owner.set(row.owner);
    this.qty.set(row.qty);
    this.withRent.set(row.withRent);
    this.quaryRate.set(row.quaryRate);
    this.billRate.set(row.billRate);
    this.rentRate.set(row.rentRate);
    this.profitShares.set(row.profitShares ?? []);
    queueMicrotask(() => (this.suppressPrefill = false));
  }

  // --- Formatting --------------------------------------------------------------

  protected inr(value: number): string {
    return formatInr(value);
  }

  protected tons(value: number): string {
    return formatTons(value);
  }
}
