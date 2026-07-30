import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { LedgerStore } from '../../core/ledger/ledger-store';
import { LedgerTransfer } from '../../core/ledger/ledger-transfer';
import { describeMerge } from '../../../domain/merge';
import type { PassType, RateChartEntry, Vehicle } from '../../../domain/types';

/**
 * Settings: the rate chart, the vehicle list, the global discount rate, and the
 * export / import / erase actions.
 *
 * Editing a rate here only changes what future entries pre-fill — every saved row
 * keeps the rates it was snapshotted with.
 */
@Component({
  selector: 'app-ledger-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule, PageHeader, SectionCard],
  templateUrl: './ledger-settings.html',
})
export class LedgerSettingsPage {
  private readonly store = inject(LedgerStore);
  private readonly transfer = inject(LedgerTransfer);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly ready = this.store.ready;
  protected readonly rows = this.store.rows;
  protected readonly rateChart = this.store.rateChart;
  protected readonly vehicles = this.store.vehicles;
  protected readonly discountRate = this.store.discountRate;

  protected readonly busy = signal(false);
  /** Two-step confirmation for the destructive erase. */
  protected readonly confirmingErase = signal(false);
  /**
   * Briefly true after a reference-data edit has landed on disk. Editing a rate
   * table with no feedback leaves people unsure whether it stuck, and the writes
   * here are durable-on-write, so it is a promise we can actually make.
   */
  protected readonly justSaved = signal(false);
  private savedTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly counts = computed(() => ({
    rows: this.store.rows().length,
    rates: this.store.rateChart().length,
    vehicles: this.store.vehicles().length,
  }));

  /** Run a persisting edit, then flag it as saved once it is on disk. */
  private async persist(write: () => Promise<void>): Promise<void> {
    await write();
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.justSaved.set(true);
    this.savedTimer = setTimeout(() => this.justSaved.set(false), 2000);
  }

  // --- Discount rate -------------------------------------------------------

  protected setDiscountRate(value: number | string): void {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0) return;
    void this.persist(() => this.store.setDiscountRate(rate));
  }

  // --- Rate chart ----------------------------------------------------------

  protected updateRate(index: number, patch: Partial<RateChartEntry>): void {
    const entries = this.rateChart().map((entry, at) =>
      at === index ? { ...entry, ...patch } : entry,
    );
    void this.persist(() => this.store.saveRateChart(entries));
  }

  protected addRate(): void {
    void this.persist(() =>
      this.store.saveRateChart([
        ...this.rateChart(),
        {
          crusher: '',
          type: 'Pass' as PassType,
          quary: 0,
          rent: 0,
          crusherRate: 0,
          comm: this.discountRate(),
        },
      ]),
    );
  }

  protected removeRate(index: number): void {
    void this.persist(() =>
      this.store.saveRateChart(this.rateChart().filter((_, at) => at !== index)),
    );
  }

  // --- Vehicles ------------------------------------------------------------

  protected updateVehicle(index: number, patch: Partial<Vehicle>): void {
    const list = this.vehicles().map((vehicle, at) =>
      at === index ? { ...vehicle, ...patch } : vehicle,
    );
    void this.persist(() => this.store.saveVehicles(list));
  }

  protected addVehicle(): void {
    void this.persist(() => this.store.saveVehicles([...this.vehicles(), { num: '', owner: '' }]));
  }

  protected removeVehicle(index: number): void {
    void this.persist(() =>
      this.store.saveVehicles(this.vehicles().filter((_, at) => at !== index)),
    );
  }

  // --- Export --------------------------------------------------------------

  protected async exportXlsx(): Promise<void> {
    this.busy.set(true);
    try {
      await this.store.flush();
      await this.transfer.exportXlsx(this.store.snapshot());
      this.toast('Workbook downloaded');
    } catch (err) {
      this.toast(`Export failed: ${message(err)}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected async exportJson(): Promise<void> {
    this.busy.set(true);
    try {
      await this.store.flush();
      this.transfer.exportJson(this.store.snapshot());
      this.toast('Backup downloaded');
    } catch (err) {
      this.toast(`Backup failed: ${message(err)}`);
    } finally {
      this.busy.set(false);
    }
  }

  // --- Import --------------------------------------------------------------

  /**
   * Merge an .xlsx or .json export into what is already here, deduped by row `id`.
   * Importing the same file twice adds nothing.
   */
  protected async onImportPicked(event: Event, mode: 'merge' | 'replace'): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear the picker so choosing the same file again still fires a change event.
    input.value = '';
    if (!file) return;

    this.busy.set(true);
    try {
      const snapshot = await this.transfer.parseFile(file);

      if (mode === 'replace') {
        this.store.replaceAll({
          rows: snapshot.rows ?? [],
          rateChart: snapshot.rateChart ?? [],
          vehicles: snapshot.vehicles ?? [],
          settings: snapshot.settings ?? { discountRatePerTon: this.discountRate() },
        });
        await this.store.flush();
        this.toast(`Restored ${snapshot.rows?.length ?? 0} rows`);
        return;
      }

      const report = this.store.mergeImport(snapshot);
      await this.store.flush();
      this.toast(describeMerge(report));
    } catch (err) {
      this.toast(`Import failed: ${message(err)}`);
    } finally {
      this.busy.set(false);
    }
  }

  // --- Erase ---------------------------------------------------------------

  protected async eraseAll(): Promise<void> {
    if (!this.confirmingErase()) {
      this.confirmingErase.set(true);
      return;
    }
    this.confirmingErase.set(false);
    await this.store.eraseAll();
    this.toast('Everything erased');
  }

  protected cancelErase(): void {
    this.confirmingErase.set(false);
  }

  private toast(text: string): void {
    this.snackBar.open(text, 'OK', { duration: 6000 });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
