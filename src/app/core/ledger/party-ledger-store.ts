import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { StorageService, type PersistentCollection } from '../storage/storage.service';
import {
  AccountsStore,
  accountCollectionKey,
  SAMPLE_PARTY_ACCOUNT_ID,
} from '../accounts/accounts-store';
import { newRowId } from './ledger-store';
import type { Vehicle } from '../../../domain/types';
import type { PartyLedgerRow, PartyRateConfig } from '../../../domain/party/types';
import { knownParties, knownPartyVehicles } from '../../../domain/party/rates';
import { activePartyDates, partySummaryReport } from '../../../domain/party/reports';
import {
  mergePartyRates,
  mergePartyRows,
} from '../../../domain/party/merge';
import { mergeVehicles, type MergeReport } from '../../../domain/merge';

/**
 * The party ledger's persistence facade — one instance serves every party book,
 * always operating on the account `AccountsStore.activePartyAccount()` names.
 *
 * Same rules as `LedgerStore`: features never open IndexedDB and never compute
 * business values; every mutator is async and resolves only once the write has
 * landed (see the durability trap in CLAUDE.md); and this class is the single
 * seam a future sync phase replaces.
 *
 * Collections are bound lazily per account and cached, so switching books is
 * instant and needs no reload.
 */

interface PartyRowsDoc {
  rows: PartyLedgerRow[];
}
interface PartyRatesDoc {
  entries: PartyRateConfig[];
}
interface PartyVehiclesDoc {
  list: Vehicle[];
}
/** Same role as the daily ledger's SeedDoc — "never seeded" vs "erased". */
interface PartySeedDoc {
  seeded: boolean;
}

/**
 * Keep IN SYNC with `KNOWN_COLLECTIONS` in transfer.model.ts (registered there
 * by base name; the stored key carries the `acc:<id>:` prefix per account).
 */
export const PARTY_COLLECTION_VERSIONS = {
  'party-rows': 1,
  'party-rates': 1,
  'party-vehicles': 1,
  'party-seed': 1,
} as const;

export type PartyLedgerRowDraft = Omit<PartyLedgerRow, 'id'>;

/** Everything a backup/restore or merge-import carries for one party book. */
export interface PartyLedgerSnapshot {
  rows: PartyLedgerRow[];
  rates: PartyRateConfig[];
  vehicles: Vehicle[];
}

interface AccountCollections {
  rows: PersistentCollection<PartyRowsDoc>;
  rates: PersistentCollection<PartyRatesDoc>;
  vehicles: PersistentCollection<PartyVehiclesDoc>;
  seed: PersistentCollection<PartySeedDoc>;
}

@Injectable({ providedIn: 'root' })
export class PartyLedgerStore {
  private readonly storage = inject(StorageService);
  private readonly accounts = inject(AccountsStore);

  private readonly collectionsByAccount = new Map<string, AccountCollections>();
  /** Accounts whose first-run seed (or seed skip) has settled this session. */
  private readonly seedSettled = signal<ReadonlySet<string>>(new Set());
  /** Guards the seeder against re-entry while a seed is in flight. */
  private readonly seeding = new Set<string>();

  /** The account id every read/mutation below applies to. */
  readonly accountId = computed(() => this.accounts.activePartyAccount().id);
  readonly account = this.accounts.activePartyAccount;

  private cols(accountId: string): AccountCollections {
    let existing = this.collectionsByAccount.get(accountId);
    if (!existing) {
      const key = (base: keyof typeof PARTY_COLLECTION_VERSIONS) =>
        accountCollectionKey(accountId, base);
      existing = {
        rows: this.storage.bind<PartyRowsDoc>({
          key: key('party-rows'),
          version: PARTY_COLLECTION_VERSIONS['party-rows'],
          defaults: { rows: [] },
          migrate: (data) => ({ rows: (data as Partial<PartyRowsDoc>)?.rows ?? [] }),
        }),
        rates: this.storage.bind<PartyRatesDoc>({
          key: key('party-rates'),
          version: PARTY_COLLECTION_VERSIONS['party-rates'],
          defaults: { entries: [] },
          migrate: (data) => ({ entries: (data as Partial<PartyRatesDoc>)?.entries ?? [] }),
        }),
        vehicles: this.storage.bind<PartyVehiclesDoc>({
          key: key('party-vehicles'),
          version: PARTY_COLLECTION_VERSIONS['party-vehicles'],
          defaults: { list: [] },
          migrate: (data) => ({ list: (data as Partial<PartyVehiclesDoc>)?.list ?? [] }),
        }),
        seed: this.storage.bind<PartySeedDoc>({
          key: key('party-seed'),
          version: PARTY_COLLECTION_VERSIONS['party-seed'],
          defaults: { seeded: false },
          migrate: (data) => ({ seeded: (data as Partial<PartySeedDoc>)?.seeded === true }),
        }),
      };
      this.collectionsByAccount.set(accountId, existing);
    }
    return existing;
  }

  private readonly activeCols = computed(() => this.cols(this.accountId()));

  // --- Read surface ----------------------------------------------------------

  /** True once the active book's collections have hydrated from IndexedDB. */
  readonly ready = computed(() => {
    const cols = this.activeCols();
    return (
      cols.rows.ready() && cols.rates.ready() && cols.vehicles.ready() && cols.seed.ready()
    );
  });

  /**
   * Hydrated **and** seeded — the party twin of `LedgerStore.initialised()`.
   * Gate saving and default-deriving on this, never on `ready()` (CLAUDE.md).
   */
  readonly initialised = computed(() => {
    const cols = this.activeCols();
    return (
      this.ready() &&
      (cols.seed.value().seeded || this.seedSettled().has(this.accountId()))
    );
  });

  readonly rows = computed(() => this.activeCols().rows.value().rows);
  readonly rates = computed(() => this.activeCols().rates.value().entries);
  readonly vehicles = computed(() => this.activeCols().vehicles.value().list);

  /** Cross-party summary — a pure function of the rows, never stored. */
  readonly summary = computed(() => partySummaryReport(this.rows()));
  /** Parties to offer in the entry form: configured plus any used on a row. */
  readonly partyOptions = computed(() => knownParties(this.rates(), this.rows()).sort());
  /** Registrations to offer: the master list plus any used on a row. */
  readonly vehicleOptions = computed(() =>
    knownPartyVehicles(this.vehicles(), this.rows()).sort(),
  );
  /** Dates that have at least one row, most recent first. */
  readonly datesWithRows = computed(() => activePartyDates(this.rows()));

  rowById(id: string): PartyLedgerRow | undefined {
    return this.rows().find((row) => row.id === id);
  }

  snapshot(): PartyLedgerSnapshot {
    return { rows: this.rows(), rates: this.rates(), vehicles: this.vehicles() };
  }

  // --- Seeding ----------------------------------------------------------------

  constructor() {
    // Runs whenever a book becomes active and hydrated but not yet seeded.
    // Only the built-in sample book gets the bundled data; a user-created book
    // just records the flag so `initialised()` flips without inventing rows.
    effect(() => {
      const accountId = this.accountId();
      const cols = this.activeCols();
      const hydrated =
        cols.rows.ready() && cols.rates.ready() && cols.vehicles.ready() && cols.seed.ready();
      if (!hydrated || cols.seed.value().seeded || this.seeding.has(accountId)) return;
      this.seeding.add(accountId);
      void this.seedAccount(accountId, cols);
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => void this.flush());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flush();
      });
    }
  }

  private async seedAccount(accountId: string, cols: AccountCollections): Promise<void> {
    try {
      if (accountId === SAMPLE_PARTY_ACCOUNT_ID) {
        // Lazy chunks, same as the daily seed — kept out of the initial bundle.
        const [rows, rates, vehicles] = await Promise.all([
          import('@data/party-ledger-rows.json').then((m) => m.default as PartyLedgerRow[]),
          import('@data/party-rates.json').then((m) => m.default as PartyRateConfig[]),
          import('@data/party-vehicles.json').then((m) => m.default as Vehicle[]),
        ]);
        // Merge rather than replace: a restore that landed first must win.
        cols.rows.set({ rows: mergePartyRows(cols.rows.value().rows, rows).rows });
        cols.rates.set({ entries: mergePartyRates(cols.rates.value().entries, rates) });
        cols.vehicles.set({ list: mergeVehicles(cols.vehicles.value().list, vehicles) });
      }
      cols.seed.set({ seeded: true });
      // Land the seed + flag now — losing the flag re-runs the seed over user
      // edits on the next load (the exact trap the daily seed hit).
      await this.flushAccount(cols);
    } catch (err) {
      console.error('[PartyLedgerStore] Seeding failed', err);
      // Leave `seeded` false so a later reload can retry.
    } finally {
      this.seedSettled.update((prev) => new Set(prev).add(accountId));
      this.seeding.delete(accountId);
    }
  }

  // --- Row mutations ------------------------------------------------------------

  /** Append a row with a fresh immutable id; resolves once it is on disk. */
  async addRow(draft: PartyLedgerRowDraft): Promise<PartyLedgerRow> {
    const row: PartyLedgerRow = { ...draft, id: newRowId() };
    const cols = this.activeCols();
    cols.rows.update((doc) => ({ rows: [...doc.rows, row] }));
    await cols.rows.flush();
    return row;
  }

  /** Patch a row in place (id immutable); resolves once the change is on disk. */
  async updateRow(id: string, patch: Partial<PartyLedgerRowDraft>): Promise<void> {
    const cols = this.activeCols();
    cols.rows.update((doc) => ({
      rows: doc.rows.map((row) => (row.id === id ? { ...row, ...patch, id: row.id } : row)),
    }));
    await cols.rows.flush();
  }

  /** Remove a row; resolves once the deletion is on disk. */
  async deleteRow(id: string): Promise<void> {
    const cols = this.activeCols();
    cols.rows.update((doc) => ({ rows: doc.rows.filter((row) => row.id !== id) }));
    await cols.rows.flush();
  }

  // --- Reference data -------------------------------------------------------------

  /**
   * Replace the rate config. Rates are snapshots — existing rows keep the
   * values they were entered with. Resolves once the change is on disk.
   */
  async saveRates(entries: PartyRateConfig[]): Promise<void> {
    const cols = this.activeCols();
    cols.rates.set({ entries });
    await cols.rates.flush();
  }

  /** Replace the vehicle master list. Resolves once the change is on disk. */
  async saveVehicles(list: Vehicle[]): Promise<void> {
    const cols = this.activeCols();
    cols.vehicles.set({ list });
    await cols.vehicles.flush();
  }

  // --- Backup / restore / merge ----------------------------------------------------

  /** Merge an imported snapshot into the active book, deduped by row id. */
  mergeImport(incoming: Partial<PartyLedgerSnapshot>): MergeReport {
    const cols = this.activeCols();
    const result = mergePartyRows(this.rows(), incoming.rows ?? []);
    cols.rows.set({ rows: result.rows });
    if (incoming.rates?.length) {
      cols.rates.set({ entries: mergePartyRates(this.rates(), incoming.rates) });
    }
    if (incoming.vehicles?.length) {
      cols.vehicles.set({ list: mergeVehicles(this.vehicles(), incoming.vehicles) });
    }
    cols.seed.set({ seeded: true });
    return result.report;
  }

  /** Replace the active book wholesale — the "restore backup" path. */
  async replaceAll(snapshot: PartyLedgerSnapshot): Promise<void> {
    const cols = this.activeCols();
    cols.rows.set({ rows: snapshot.rows ?? [] });
    cols.rates.set({ entries: snapshot.rates ?? [] });
    cols.vehicles.set({ list: snapshot.vehicles ?? [] });
    // A restore counts as seeded, so the bundled seed never overwrites it.
    cols.seed.set({ seeded: true });
    await this.flushAccount(cols);
  }

  /** Erase the active book. `seeded` stays true so the seed never reappears. */
  async eraseAll(): Promise<void> {
    const cols = this.activeCols();
    cols.rows.set({ rows: [] });
    cols.rates.set({ entries: [] });
    cols.vehicles.set({ list: [] });
    cols.seed.set({ seeded: true });
    await this.flushAccount(cols);
  }

  /** Force any debounced write on the active book to land. */
  async flush(): Promise<void> {
    await this.flushAccount(this.activeCols());
  }

  private async flushAccount(cols: AccountCollections): Promise<void> {
    await Promise.all([
      cols.rows.flush(),
      cols.rates.flush(),
      cols.vehicles.flush(),
      cols.seed.flush(),
    ]);
  }
}
