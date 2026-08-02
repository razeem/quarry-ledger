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
import { mergeVehicles, revive, type MergeReport } from '../../../domain/merge';

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
  // v1 -> v2 added the optional `updatedAt` / `deleted` sync fields to each row.
  'party-rows': 2,
  'party-rates': 1,
  'party-vehicles': 1,
  'party-seed': 1,
  'party-entry-drafts': 2,
} as const;

export type PartyLedgerRowDraft = Omit<PartyLedgerRow, 'id'>;

/** Everything a backup/restore or merge-import carries for one party book. */
export interface PartyLedgerSnapshot {
  rows: PartyLedgerRow[];
  rates: PartyRateConfig[];
  vehicles: Vehicle[];
  /** Staged entry-sheet rows not yet synced — optional, as in older backups. */
  drafts?: PartyLedgerRow[];
}

/**
 * Can this staged row be synced? Party is the daily book's "crusher": the raw
 * quarry data arrives without it, so drafts accept its absence but sync holds
 * such rows back.
 */
export function isPartyDraftComplete(row: Pick<PartyLedgerRow, 'party' | 'qty'>): boolean {
  return row.party.trim() !== '' && row.qty > 0;
}

interface AccountCollections {
  rows: PersistentCollection<PartyRowsDoc>;
  rates: PersistentCollection<PartyRatesDoc>;
  vehicles: PersistentCollection<PartyVehiclesDoc>;
  seed: PersistentCollection<PartySeedDoc>;
  drafts: PersistentCollection<PartyRowsDoc>;
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
        drafts: this.storage.bind<PartyRowsDoc>({
          key: key('party-entry-drafts'),
          version: PARTY_COLLECTION_VERSIONS['party-entry-drafts'],
          defaults: { rows: [] },
          migrate: (data) => ({ rows: (data as Partial<PartyRowsDoc>)?.rows ?? [] }),
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
      cols.rows.ready() &&
      cols.rates.ready() &&
      cols.vehicles.ready() &&
      cols.seed.ready() &&
      cols.drafts.ready()
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

  /**
   * Every stored row of the active book, tombstones included — the merge,
   * transfer and sync surface. Anything writing the whole collection back must
   * read this, not `rows()`; see the daily store for why.
   */
  readonly rowsWithTombstones = computed(() => this.activeCols().rows.value().rows);
  /** The live rows. Tombstones are invisible above the store. */
  readonly rows = computed(() => this.rowsWithTombstones().filter((row) => !row.deleted));

  /** Staged rows, tombstones included — the transfer and sync surface. */
  readonly draftsWithTombstones = computed(() => this.activeCols().drafts.value().rows);
  /**
   * Staged entry-sheet rows awaiting `syncDrafts()`, per book. A draft whose id
   * already exists in the book's rows is filtered out, so graduation stays
   * idempotent when the sync happened on another device.
   */
  readonly drafts = computed(() => {
    const synced = new Set(this.rowsWithTombstones().map((row) => row.id));
    return this.draftsWithTombstones().filter((row) => !row.deleted && !synced.has(row.id));
  });
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

  draftById(id: string): PartyLedgerRow | undefined {
    return this.drafts().find((row) => row.id === id);
  }

  /** The whole book for backup / transfer — tombstones included, so deletes travel. */
  snapshot(): PartyLedgerSnapshot {
    return {
      rows: this.rowsWithTombstones(),
      rates: this.rates(),
      vehicles: this.vehicles(),
      drafts: this.draftsWithTombstones(),
    };
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
        cols.rows.ready() &&
        cols.rates.ready() &&
        cols.vehicles.ready() &&
        cols.seed.ready() &&
        cols.drafts.ready();
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
    const row: PartyLedgerRow = { ...draft, id: newRowId(), updatedAt: Date.now() };
    const cols = this.activeCols();
    cols.rows.update((doc) => ({ rows: [...doc.rows, row] }));
    await cols.rows.flush();
    return row;
  }

  /** Patch a row in place (id immutable); resolves once the change is on disk. */
  async updateRow(id: string, patch: Partial<PartyLedgerRowDraft>): Promise<void> {
    const cols = this.activeCols();
    const now = Date.now();
    cols.rows.update((doc) => ({
      rows: doc.rows.map((row) =>
        row.id === id ? { ...row, ...patch, id: row.id, updatedAt: now } : row,
      ),
    }));
    await cols.rows.flush();
  }

  /** Delete a row by tombstoning it, so the delete travels instead of being local. */
  async deleteRow(id: string): Promise<void> {
    const cols = this.activeCols();
    const now = Date.now();
    cols.rows.update((doc) => ({
      rows: doc.rows.map((row) =>
        row.id === id ? { ...row, deleted: true, updatedAt: now } : row,
      ),
    }));
    await cols.rows.flush();
  }

  // --- Staged drafts ---------------------------------------------------------
  // The party twin of LedgerStore's staged drafts — same durability, same
  // id-preserving sync (see the daily store for the full rationale).

  /** Stage a row with a fresh immutable id; resolves once it is on disk. */
  async addDraft(draft: PartyLedgerRowDraft): Promise<PartyLedgerRow> {
    const row: PartyLedgerRow = { ...draft, id: newRowId(), updatedAt: Date.now() };
    const cols = this.activeCols();
    cols.drafts.update((doc) => ({ rows: [...doc.rows, row] }));
    await cols.drafts.flush();
    return row;
  }

  /** Patch a draft in place (id immutable); resolves once it is on disk. */
  async updateDraft(id: string, patch: Partial<PartyLedgerRowDraft>): Promise<void> {
    const cols = this.activeCols();
    const now = Date.now();
    cols.drafts.update((doc) => ({
      rows: doc.rows.map((row) =>
        row.id === id ? { ...row, ...patch, id: row.id, updatedAt: now } : row,
      ),
    }));
    await cols.drafts.flush();
  }

  /** Tombstone a draft, for the same reason `deleteRow` does. */
  async deleteDraft(id: string): Promise<void> {
    const cols = this.activeCols();
    const now = Date.now();
    cols.drafts.update((doc) => ({
      rows: doc.rows.map((row) =>
        row.id === id ? { ...row, deleted: true, updatedAt: now } : row,
      ),
    }));
    await cols.drafts.flush();
  }

  /** Undo path: put a deleted row back under its ORIGINAL id, idempotently. */
  async restoreRow(row: PartyLedgerRow): Promise<void> {
    const cols = this.activeCols();
    const revived = revive(row, Date.now());
    cols.rows.update((doc) => ({ rows: mergePartyRows(doc.rows, [revived]).rows }));
    await cols.rows.flush();
  }

  /** Undo path: put a deleted draft back under its ORIGINAL id, idempotently. */
  async restoreDraft(row: PartyLedgerRow): Promise<void> {
    const cols = this.activeCols();
    const revived = revive(row, Date.now());
    cols.drafts.update((doc) => ({ rows: mergePartyRows(doc.rows, [revived]).rows }));
    await cols.drafts.flush();
  }

  /**
   * Move every complete draft into the book's rows, keeping each draft's id.
   * Values copy verbatim — rates/splits were snapshotted at entry or edit time,
   * and sync never recomputes. Incomplete drafts (no party / zero qty) stay.
   */
  async syncDrafts(): Promise<{ synced: number; held: number }> {
    const cols = this.activeCols();
    const drafts = this.drafts();
    const complete = drafts.filter(isPartyDraftComplete);
    const held = drafts.length - complete.length;
    if (complete.length === 0) return { synced: 0, held };

    // Timestamps copy verbatim too: re-stamping here would let a graduated row
    // beat a newer edit made to the same id on another device.
    const graduated = new Set(complete.map((row) => row.id));
    cols.rows.set({ rows: mergePartyRows(this.rowsWithTombstones(), complete).rows });
    cols.drafts.set({
      rows: this.draftsWithTombstones().filter((row) => !graduated.has(row.id)),
    });
    await Promise.all([cols.rows.flush(), cols.drafts.flush()]);
    return { synced: complete.length, held };
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
    const result = mergePartyRows(this.rowsWithTombstones(), incoming.rows ?? []);
    cols.rows.set({ rows: result.rows });
    if (incoming.drafts?.length) {
      // Staged rows already synced here (same id in the ledger) are not re-staged.
      const syncedIds = new Set(result.rows.map((row) => row.id));
      const unsynced = incoming.drafts.filter((row) => !syncedIds.has(row.id));
      cols.drafts.set({ rows: mergePartyRows(this.draftsWithTombstones(), unsynced).rows });
    }
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
    cols.drafts.set({ rows: snapshot.drafts ?? [] });
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
    cols.drafts.set({ rows: [] });
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
      cols.drafts.flush(),
    ]);
  }
}
