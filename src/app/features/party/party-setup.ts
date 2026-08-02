import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { PartyLedgerStore } from '../../core/ledger/party-ledger-store';
import { PartyLedgerTransfer } from '../../core/ledger/party-ledger-transfer';
import { AccountsStore } from '../../core/accounts/accounts-store';
import { describeMerge } from '../../../domain/merge';
import type { PartyRateConfig } from '../../../domain/party/types';
import type { Vehicle } from '../../../domain/types';

/**
 * Party-book setup: per-party rates + profit splits, the vehicle→owner master,
 * book rename and erase.
 *
 * Rates are snapshots — saving here only changes what future rows autofill
 * with; existing rows keep the values they were entered with.
 */
@Component({
  selector: 'app-party-setup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule, PageHeader, SectionCard],
  templateUrl: './party-setup.html',
})
export class PartySetup {
  private readonly store = inject(PartyLedgerStore);
  private readonly transfer = inject(PartyLedgerTransfer);
  private readonly accounts = inject(AccountsStore);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly account = this.store.account;
  protected readonly initialised = this.store.initialised;
  protected readonly saving = signal(false);

  /** Local editable copies; refreshed from the store until first touched. */
  protected readonly rates = signal<PartyRateConfig[]>([]);
  protected readonly vehicles = signal<Vehicle[]>([]);
  protected readonly ratesDirty = signal(false);
  protected readonly vehiclesDirty = signal(false);

  protected readonly bookName = signal('');

  constructor() {
    effect(() => {
      if (!this.initialised() || this.ratesDirty()) return;
      this.rates.set(structuredClone(this.store.rates()) as PartyRateConfig[]);
    });
    effect(() => {
      if (!this.initialised() || this.vehiclesDirty()) return;
      this.vehicles.set(this.store.vehicles().map((v) => ({ ...v })));
    });
    effect(() => {
      this.bookName.set(this.account().name);
    });
  }

  // --- Party rates -------------------------------------------------------------

  protected touchRates(): void {
    this.ratesDirty.set(true);
  }

  protected addParty(): void {
    this.rates.update((list) => [
      ...list,
      {
        party: '',
        quaryRate: 0,
        rentRate: 0,
        withRent: { billRate: 0, shares: [] },
        withoutRent: { billRate: 0, shares: [] },
      },
    ]);
    this.ratesDirty.set(true);
  }

  protected removeParty(index: number): void {
    this.rates.update((list) => list.filter((_, i) => i !== index));
    this.ratesDirty.set(true);
  }

  protected addShare(entry: PartyRateConfig, mode: 'withRent' | 'withoutRent'): void {
    entry[mode].shares.push({ name: '', perTon: 0 });
    this.rates.update((list) => [...list]);
    this.ratesDirty.set(true);
  }

  protected removeShare(
    entry: PartyRateConfig,
    mode: 'withRent' | 'withoutRent',
    index: number,
  ): void {
    entry[mode].shares.splice(index, 1);
    this.rates.update((list) => [...list]);
    this.ratesDirty.set(true);
  }

  protected async saveRates(): Promise<void> {
    this.saving.set(true);
    try {
      const cleaned = this.rates()
        .filter((entry) => entry.party.trim() !== '')
        .map((entry) => ({
          party: entry.party,
          quaryRate: Number(entry.quaryRate) || 0,
          rentRate: Number(entry.rentRate) || 0,
          withRent: cleanMode(entry.withRent),
          withoutRent: cleanMode(entry.withoutRent),
        }));
      await this.store.saveRates(cleaned);
      this.ratesDirty.set(false);
      this.snackBar.open('Party rates saved — existing rows keep their snapshots', 'OK', {
        duration: 4000,
      });
    } finally {
      this.saving.set(false);
    }
  }

  // --- Vehicles ------------------------------------------------------------------

  protected touchVehicles(): void {
    this.vehiclesDirty.set(true);
  }

  protected addVehicle(): void {
    this.vehicles.update((list) => [...list, { num: '', owner: '' }]);
    this.vehiclesDirty.set(true);
  }

  protected removeVehicle(index: number): void {
    this.vehicles.update((list) => list.filter((_, i) => i !== index));
    this.vehiclesDirty.set(true);
  }

  protected async saveVehicles(): Promise<void> {
    this.saving.set(true);
    try {
      await this.store.saveVehicles(this.vehicles().filter((v) => v.num.trim() !== ''));
      this.vehiclesDirty.set(false);
      this.snackBar.open('Vehicles saved', 'OK', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  // --- Export / import ---------------------------------------------------------------

  protected async exportXlsx(): Promise<void> {
    this.saving.set(true);
    try {
      await this.store.flush();
      await this.transfer.exportXlsx(this.store.snapshot());
      this.snackBar.open('Workbook downloaded', 'OK', { duration: 4000 });
    } catch (err) {
      this.snackBar.open(`Export failed: ${message(err)}`, 'OK', { duration: 8000 });
    } finally {
      this.saving.set(false);
    }
  }

  protected async exportJson(): Promise<void> {
    this.saving.set(true);
    try {
      await this.store.flush();
      this.transfer.exportJson(this.store.snapshot());
      this.snackBar.open('Backup downloaded', 'OK', { duration: 4000 });
    } catch (err) {
      this.snackBar.open(`Backup failed: ${message(err)}`, 'OK', { duration: 8000 });
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Merge an .xlsx or .json export into the active book, deduped by row `id` —
   * importing the same file twice adds nothing. `replace` restores wholesale.
   */
  protected async onImportPicked(event: Event, mode: 'merge' | 'replace'): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear the picker so choosing the same file again still fires a change event.
    input.value = '';
    if (!file) return;

    this.saving.set(true);
    try {
      const snapshot = await this.transfer.parseFile(file);

      if (mode === 'replace') {
        await this.store.replaceAll({
          rows: snapshot.rows ?? [],
          rates: snapshot.rates ?? [],
          vehicles: snapshot.vehicles ?? [],
          drafts: snapshot.drafts ?? [],
        });
        this.snackBar.open(`Restored ${snapshot.rows?.length ?? 0} rows`, 'OK', {
          duration: 6000,
        });
      } else {
        const report = this.store.mergeImport(snapshot);
        await this.store.flush();
        this.snackBar.open(describeMerge(report), 'OK', { duration: 6000 });
      }
      // The store is now the truth again; drop any half-edited local copies.
      this.ratesDirty.set(false);
      this.vehiclesDirty.set(false);
    } catch (err) {
      this.snackBar.open(`Import failed: ${message(err)}`, 'OK', { duration: 8000 });
    } finally {
      this.saving.set(false);
    }
  }

  // --- Book management --------------------------------------------------------------

  protected async renameBook(): Promise<void> {
    const name = this.bookName().trim();
    if (!name || name === this.account().name) return;
    await this.accounts.rename(this.account().id, name);
    this.snackBar.open('Book renamed', 'OK', { duration: 3000 });
  }

  protected async eraseBook(): Promise<void> {
    const name = this.account().name;
    if (!confirm(`Erase every row, rate and vehicle in “${name}”? This cannot be undone.`)) {
      return;
    }
    await this.store.eraseAll();
    this.ratesDirty.set(false);
    this.vehiclesDirty.set(false);
    this.snackBar.open('Book erased', 'OK', { duration: 4000 });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function cleanMode(mode: PartyRateConfig['withRent']): PartyRateConfig['withRent'] {
  return {
    billRate: Number(mode.billRate) || 0,
    shares: mode.shares
      .filter((share) => share.name.trim() !== '')
      .map((share) => ({ name: share.name, perTon: Number(share.perTon) || 0 })),
  };
}
