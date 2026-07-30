import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { LedgerStore, type LedgerRowDraft } from '../../core/ledger/ledger-store';
import { computeRow } from '../../../domain/calc';
import { formatInr, formatTons } from '../../../domain/format';
import { ratePrefill } from '../../../domain/rates';
import type { LedgerRow, PassType } from '../../../domain/types';

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
 * Fast load entry — the screen that has to work in under ten seconds, one-handed,
 * on a phone at the quarry.
 *
 * The four rate fields are pre-filled from the rate chart whenever crusher or pass
 * type changes, but stay editable: whatever is on screen at save time is what gets
 * snapshotted onto the row. Editing the chart later never touches a saved row.
 */
@Component({
  selector: 'app-entry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatButtonToggleModule,
    PageHeader,
    SectionCard,
  ],
  templateUrl: './entry.html',
})
export class Entry {
  private readonly store = inject(LedgerStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  /**
   * `?edit=<row id>` — the Ledger tab links here to edit a row. Bound from the
   * query string by `withComponentInputBinding()`.
   */
  readonly edit = input<string | undefined>(undefined);

  /** Set once the row named by `edit` has been loaded into the form. */
  readonly editingId = signal<string | null>(null);

  protected readonly date = signal(todayIso());
  protected readonly crusher = signal('');
  protected readonly passType = signal<PassType>('WO Pass');
  protected readonly qty = signal<number | null>(null);
  protected readonly vehicle = signal('');
  protected readonly quaryRate = signal(0);
  protected readonly crusherRate = signal(0);
  protected readonly rentRate = signal(0);
  protected readonly commRate = signal(0);

  protected readonly ready = this.store.ready;
  /** True while a save is in flight, so the button cannot be double-tapped. */
  protected readonly saving = signal(false);
  protected readonly crushers = this.store.crusherOptions;
  protected readonly vehicles = this.store.vehicleOptions;
  protected readonly isEditing = computed(() => this.editingId() !== null);

  /**
   * Live preview of the row as it would be saved. Uses the same `computeRow` the
   * reports use — the UI never does arithmetic of its own.
   */
  protected readonly preview = computed(() => computeRow(this.draft()));

  protected readonly canSave = computed(
    () => this.crusher().trim() !== '' && (this.qty() ?? 0) > 0,
  );

  constructor() {
    // Pre-fill rates from the chart on crusher / pass-type change. A chart miss
    // leaves the current values alone rather than blanking a half-typed row.
    effect(() => {
      const crusher = this.crusher();
      const passType = this.passType();
      const prefill = ratePrefill(
        this.store.rateChart(),
        crusher,
        passType,
        this.store.discountRate(),
      );
      if (!prefill || this.suppressPrefill) return;
      this.quaryRate.set(prefill.quaryRate);
      this.crusherRate.set(prefill.crusherRate);
      this.rentRate.set(prefill.rentRate);
      this.commRate.set(prefill.commRate);
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
      item: 'Rock',
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

  /** Load an existing row into the form. Called by the Ledger tab's edit action. */
  loadRow(row: LedgerRow): void {
    this.suppressPrefill = true;
    this.editingId.set(row.id);
    this.date.set(row.date);
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

  protected onCrusherChange(value: string): void {
    this.suppressPrefill = false;
    this.crusher.set(value);
  }

  protected onPassTypeChange(value: PassType): void {
    this.suppressPrefill = false;
    this.passType.set(value);
  }

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

    this.resetForNextEntry();
    this.snackBar
      .open(`Saved ${formatTons(draft.qty)} · ${draft.crusher}`, 'Ledger', { duration: 3000 })
      .onAction()
      .subscribe(() => void this.router.navigate(['/ledger']));
  }

  /**
   * Keep date, crusher, pass type, vehicle and the rates; clear only the quantity.
   * Consecutive loads from the same crusher are the common case, so this is what
   * makes the next entry a two-tap job.
   */
  private resetForNextEntry(): void {
    this.editingId.set(null);
    this.qty.set(null);
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.qty.set(null);
    void this.router.navigate(['/ledger']);
  }

  protected inr(value: number): string {
    return formatInr(value);
  }

  protected tons(value: number): string {
    return formatTons(value);
  }
}
