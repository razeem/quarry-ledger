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
import { SectionCard } from '../../shared/ui/section-card';
import { PartyLedgerStore, type PartyLedgerRowDraft } from '../../core/ledger/party-ledger-store';
import { computePartyRow, type ComputedPartyRow } from '../../../domain/party/calc';
import { partyRatePrefill } from '../../../domain/party/rates';
import { vehicleOwner } from '../../../domain/rates';
import { formatDate, formatInr, formatTons } from '../../../domain/format';
import type { PartyLedgerRow, PartyProfitShare } from '../../../domain/party/types';

type RateField = 'quaryRate' | 'billRate' | 'rentRate';
type RateOrigin = 'auto' | 'saved' | 'edited' | 'none';

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
 * Party-ledger load entry — the same fast-entry contract as the daily sheet:
 * pick the party, the rates and profit split autofill from the party's config
 * (and stay editable), the owner autofills from the vehicle master, and the
 * computed money is previewed live. Whatever is visible at save time is what
 * gets snapshotted onto the row; editing the config later never touches it.
 */
@Component({
  selector: 'app-party-entry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule, PageHeader, SectionCard],
  templateUrl: './party-entry.html',
})
export class PartyEntry {
  private readonly store = inject(PartyLedgerStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  private readonly qtyField = viewChild<ElementRef<HTMLInputElement>>('qtyField');

  /** `?edit=<row id>` — statements link here to edit a row. */
  readonly edit = input<string | undefined>(undefined);
  readonly editingId = signal<string | null>(null);

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

  private readonly hasPrefill = computed(
    () => partyRatePrefill(this.store.rates(), this.party(), this.withRent()) !== undefined,
  );

  /** Live preview via the same engine the reports use — no UI arithmetic. */
  protected readonly preview = computed<ComputedPartyRow>(() => computePartyRow(this.draft()));
  protected readonly perTonProfit = computed(() =>
    this.profitShares().reduce((sum, share) => sum + share.perTon, 0),
  );

  protected readonly canSave = computed(
    () => this.party().trim() !== '' && (this.qty() ?? 0) > 0,
  );

  /** The selected date's saved rows, newest last (entry order). */
  protected readonly dayRows = computed(() =>
    this.store.rows().filter((row) => row.date === this.date()),
  );
  protected readonly dayQty = computed(() =>
    this.dayRows().reduce((sum, row) => sum + row.qty, 0),
  );
  protected readonly dayLabel = computed(() => formatDate(this.date()));

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

    // Load the row named by `?edit=<id>` once the store has hydrated.
    effect(() => {
      const id = this.edit();
      if (!id || !this.store.ready() || this.editingId() === id) return;
      const row = this.store.rowById(id);
      if (row) this.loadRow(row);
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
    this.overridden.set(new Set());
    this.party.set(value);
  }

  protected onWithRentChange(value: boolean): void {
    this.suppressPrefill = false;
    this.overridden.set(new Set());
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

  // --- Row actions -----------------------------------------------------------

  /** Persist, then confirm — nothing is reported until the write has landed. */
  protected async save(): Promise<void> {
    if (!this.canSave() || this.saving() || !this.initialised()) return;
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
      this.snackBar.open('Row updated', 'OK', { duration: 3000 });
      void this.router.navigate(['/party/statements']);
      return;
    }
    this.startNextRow();
  }

  /** Carry everything over except the quantity — same-party loads are frequent. */
  private startNextRow(): void {
    this.editingId.set(null);
    this.qty.set(null);
    this.qtyField()?.nativeElement.focus();
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.qty.set(null);
    void this.router.navigate(['/party/statements']);
  }

  protected async deleteRow(row: PartyLedgerRow): Promise<void> {
    if (!confirm(`Delete this ${formatTons(row.qty)} load for ${row.party}?`)) return;
    await this.store.deleteRow(row.id);
    this.snackBar.open('Row deleted', 'OK', { duration: 3000 });
  }

  protected editRow(row: PartyLedgerRow): void {
    this.loadRow(row);
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

  protected calc(row: PartyLedgerRow): ComputedPartyRow {
    return computePartyRow(row);
  }

  protected inr(value: number): string {
    return formatInr(value);
  }

  protected tons(value: number): string {
    return formatTons(value);
  }
}
