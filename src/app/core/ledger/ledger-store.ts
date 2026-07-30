import { computed, effect, inject, Injectable } from '@angular/core';
import { StorageService } from '../storage/storage.service';
import {
  DEFAULT_SETTINGS,
  type LedgerRow,
  type LedgerSettings,
  type RateChartEntry,
  type Vehicle,
} from '../../../domain/types';
import { activeDates, summarize } from '../../../domain/summaries';
import { knownCrushers, knownVehicles } from '../../../domain/rates';
import { mergeRateChart, mergeRows, mergeVehicles, type MergeReport } from '../../../domain/merge';

/**
 * The app's persistence facade.
 *
 * Features read signals and call the mutators here; they never open IndexedDB and
 * never compute business values (that is `src/domain`). Every write goes through
 * `StorageService`, so this class is the single seam Phase 2 replaces with Supabase
 * sync — no UI or domain change required.
 */

/** Collection document shapes. Bump the matching `version` when one changes. */
interface RowsDoc {
  rows: LedgerRow[];
}
interface RateChartDoc {
  entries: RateChartEntry[];
}
interface VehiclesDoc {
  list: Vehicle[];
}
/**
 * Tracks whether the one-time seed has run. Without this we could not tell
 * "never seeded" from "seeded, then the user erased everything" — the latter
 * must not silently refill itself.
 */
interface SeedDoc {
  seeded: boolean;
}

export const COLLECTION_VERSIONS = {
  'ledger-rows': 1,
  'rate-chart': 1,
  vehicles: 1,
  'ledger-settings': 1,
  'ledger-seed': 1,
} as const;

/** A new row minus its id — the store assigns the id and never changes it after. */
export type LedgerRowDraft = Omit<LedgerRow, 'id'>;

/** Everything a backup/restore or merge-import carries. */
export interface LedgerSnapshot {
  rows: LedgerRow[];
  rateChart: RateChartEntry[];
  vehicles: Vehicle[];
  settings: LedgerSettings;
}

/**
 * 12 hex characters, matching the id format already in the seed data. Long enough
 * that two offline devices will not collide in practice.
 */
export function newRowId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

@Injectable({ providedIn: 'root' })
export class LedgerStore {
  private readonly storage = inject(StorageService);

  private readonly rowsStore = this.storage.bind<RowsDoc>({
    key: 'ledger-rows',
    version: COLLECTION_VERSIONS['ledger-rows'],
    defaults: { rows: [] },
    migrate: (data) => ({ rows: (data as Partial<RowsDoc>)?.rows ?? [] }),
  });

  private readonly rateChartStore = this.storage.bind<RateChartDoc>({
    key: 'rate-chart',
    version: COLLECTION_VERSIONS['rate-chart'],
    defaults: { entries: [] },
    migrate: (data) => ({ entries: (data as Partial<RateChartDoc>)?.entries ?? [] }),
  });

  private readonly vehiclesStore = this.storage.bind<VehiclesDoc>({
    key: 'vehicles',
    version: COLLECTION_VERSIONS.vehicles,
    defaults: { list: [] },
    migrate: (data) => ({ list: (data as Partial<VehiclesDoc>)?.list ?? [] }),
  });

  private readonly settingsStore = this.storage.bind<LedgerSettings>({
    key: 'ledger-settings',
    version: COLLECTION_VERSIONS['ledger-settings'],
    defaults: DEFAULT_SETTINGS,
    migrate: (data) => ({ ...DEFAULT_SETTINGS, ...(data as Partial<LedgerSettings>) }),
  });

  private readonly seedStore = this.storage.bind<SeedDoc>({
    key: 'ledger-seed',
    version: COLLECTION_VERSIONS['ledger-seed'],
    defaults: { seeded: false },
    migrate: (data) => ({ seeded: (data as Partial<SeedDoc>)?.seeded === true }),
  });

  // --- Read surface ---------------------------------------------------------

  /** True once every collection has hydrated from IndexedDB. */
  readonly ready = computed(
    () =>
      this.rowsStore.ready() &&
      this.rateChartStore.ready() &&
      this.vehiclesStore.ready() &&
      this.settingsStore.ready() &&
      this.seedStore.ready(),
  );

  /**
   * True once hydration **and** the first-run seed have both settled.
   *
   * `ready()` alone is not enough: on a fresh device every collection hydrates to
   * its (empty) default almost immediately, so a feature that seeded its state
   * from `ready()` would see zero rows and latch onto that. Wait for this instead
   * before deriving any default from the row set.
   */
  readonly initialised = computed(() => this.ready() && this.seedStore.value().seeded);

  readonly rows = computed(() => this.rowsStore.value().rows);
  readonly rateChart = computed(() => this.rateChartStore.value().entries);
  readonly vehicles = computed(() => this.vehiclesStore.value().list);
  readonly settings = this.settingsStore.value;
  readonly discountRate = computed(() => this.settingsStore.value().discountRatePerTon);

  /** All-time totals — a pure function of the rows, recomputed, never stored. */
  readonly allTime = computed(() => summarize(this.rows()));
  /** Crushers to offer in the entry form: chart entries plus any used on a row. */
  readonly crusherOptions = computed(() => knownCrushers(this.rateChart(), this.rows()).sort());
  /** Registrations to offer: the vehicle list plus any used on a row. */
  readonly vehicleOptions = computed(() => knownVehicles(this.vehicles(), this.rows()).sort());
  /** Dates that have at least one row, most recent first. */
  readonly datesWithRows = computed(() => activeDates(this.rows()));

  rowById(id: string): LedgerRow | undefined {
    return this.rows().find((row) => row.id === id);
  }

  snapshot(): LedgerSnapshot {
    return {
      rows: this.rows(),
      rateChart: this.rateChart(),
      vehicles: this.vehicles(),
      settings: this.settings(),
    };
  }

  // --- Seeding -------------------------------------------------------------

  constructor() {
    // First run only: fill IndexedDB from `data/*.json`. The seed modules are
    // dynamically imported so they stay out of the initial bundle.
    const seeder = effect(() => {
      if (!this.ready() || this.seedStore.value().seeded) return;
      seeder.destroy();
      void this.seedFromBundledData();
    });

    // Belt and braces for the reference-data edits, which stay debounced: flush any
    // pending write when the page is hidden or unloaded (backgrounding a PWA on
    // Android can kill it outright).
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => void this.flush());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flush();
      });
    }
  }

  private async seedFromBundledData(): Promise<void> {
    try {
      const [rows, chart, vehicles] = await Promise.all([
        import('@data/ledger-rows.json').then((m) => m.default as LedgerRow[]),
        import('@data/rate-chart.json').then((m) => m.default as RateChartEntry[]),
        import('@data/vehicles.json').then((m) => m.default as Vehicle[]),
      ]);

      // Merge rather than replace: if a restore landed before the seed effect ran,
      // the user's own data must win and ids must not duplicate.
      this.rowsStore.set({ rows: mergeRows(this.rows(), rows).rows });
      this.rateChartStore.set({ entries: mergeRateChart(this.rateChart(), chart) });
      this.vehiclesStore.set({ list: mergeVehicles(this.vehicles(), vehicles) });
      this.seedStore.set({ seeded: true });
    } catch (err) {
      console.error('[LedgerStore] Seeding from bundled data failed', err);
      // Leave `seeded` false so a later reload can retry.
    }
  }

  // --- Row mutations -------------------------------------------------------

  /**
   * Append a row, assigning it a fresh immutable id.
   *
   * The signal updates synchronously; the returned promise resolves once the row
   * is actually on disk. Await it before confirming to the user or navigating —
   * see `persistNow`.
   */
  async addRow(draft: LedgerRowDraft): Promise<LedgerRow> {
    const row: LedgerRow = { ...draft, id: newRowId() };
    this.rowsStore.update((doc) => ({ rows: [...doc.rows, row] }));
    await this.persistNow();
    return row;
  }

  /**
   * Patch a row in place. The `id` is immutable — it is the cross-device merge key,
   * so it is stripped from any incoming patch rather than trusted.
   */
  /** Patch a row in place; resolves once the change is on disk. */
  async updateRow(id: string, patch: Partial<LedgerRowDraft>): Promise<void> {
    this.rowsStore.update((doc) => ({
      rows: doc.rows.map((row) => (row.id === id ? { ...row, ...patch, id: row.id } : row)),
    }));
    await this.persistNow();
  }

  /** Remove a row; resolves once the deletion is on disk. */
  async deleteRow(id: string): Promise<void> {
    this.rowsStore.update((doc) => ({ rows: doc.rows.filter((row) => row.id !== id) }));
    await this.persistNow();
  }

  /**
   * Land a row change in IndexedDB immediately instead of waiting out
   * `StorageService`'s 250 ms write debounce.
   *
   * Entering a load and instantly navigating away (or the OS killing a
   * backgrounded tab) would otherwise drop the pending write — and losing entered
   * data is the exact failure this app exists to prevent. Ledger rows are small
   * and saves are user-paced, so the extra write costs nothing that matters.
   *
   * Callers must await this before telling the user the save succeeded: the
   * confirmation is a promise about durability, not about the in-memory signal.
   */
  private async persistNow(): Promise<void> {
    await this.rowsStore.flush();
  }

  // --- Reference data ------------------------------------------------------

  saveRateChart(entries: RateChartEntry[]): void {
    // Rates are snapshots: existing rows keep the values they were entered with.
    this.rateChartStore.set({ entries });
  }

  saveVehicles(list: Vehicle[]): void {
    this.vehiclesStore.set({ list });
  }

  setDiscountRate(discountRatePerTon: number): void {
    this.settingsStore.patch({ discountRatePerTon });
  }

  // --- Backup / restore / merge -------------------------------------------

  /**
   * Merge an imported snapshot into what is already stored, deduped by row `id`:
   * identical rows are skipped, changed rows updated, new rows added. Importing the
   * same file twice therefore adds nothing.
   */
  mergeImport(incoming: Partial<LedgerSnapshot>): MergeReport {
    const result = mergeRows(this.rows(), incoming.rows ?? []);
    this.rowsStore.set({ rows: result.rows });

    if (incoming.rateChart?.length) {
      this.rateChartStore.set({ entries: mergeRateChart(this.rateChart(), incoming.rateChart) });
    }
    if (incoming.vehicles?.length) {
      this.vehiclesStore.set({ list: mergeVehicles(this.vehicles(), incoming.vehicles) });
    }
    if (incoming.settings?.discountRatePerTon != null) {
      this.setDiscountRate(incoming.settings.discountRatePerTon);
    }
    // A restore counts as seeded, so the bundled seed never overwrites it.
    this.seedStore.set({ seeded: true });
    return result.report;
  }

  /** Replace everything wholesale — the "restore backup" path. */
  replaceAll(snapshot: LedgerSnapshot): void {
    this.rowsStore.set({ rows: snapshot.rows ?? [] });
    this.rateChartStore.set({ entries: snapshot.rateChart ?? [] });
    this.vehiclesStore.set({ list: snapshot.vehicles ?? [] });
    this.settingsStore.set({ ...DEFAULT_SETTINGS, ...snapshot.settings });
    this.seedStore.set({ seeded: true });
  }

  /**
   * Erase every ledger row and all reference data. `seeded` stays true so the
   * bundled seed does not quietly reappear on the next load.
   */
  async eraseAll(): Promise<void> {
    this.rowsStore.set({ rows: [] });
    this.rateChartStore.set({ entries: [] });
    this.vehiclesStore.set({ list: [] });
    this.settingsStore.set({ ...DEFAULT_SETTINGS });
    this.seedStore.set({ seeded: true });
    await this.flush();
  }

  /** Force any debounced write to land — call before exporting or reloading. */
  async flush(): Promise<void> {
    await Promise.all([
      this.rowsStore.flush(),
      this.rateChartStore.flush(),
      this.vehiclesStore.flush(),
      this.settingsStore.flush(),
      this.seedStore.flush(),
    ]);
  }
}
