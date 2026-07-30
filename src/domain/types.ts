/**
 * Domain types for the quarry load ledger.
 *
 * This layer is pure: no framework imports, no I/O. Everything the app displays
 * is either a `LedgerRow` field or a pure function of one — nothing derived is
 * ever stored (see CLAUDE.md).
 */

/** With / without a quarry pass. */
export type PassType = 'Pass' | 'WO Pass';

/**
 * A single rock load — the only stored record and the single source of truth.
 *
 * `quaryRate` / `crusherRate` / `rentRate` / `commRate` are **snapshots** taken
 * at entry time. The rate chart only pre-fills the entry form; editing it must
 * never mutate an existing row.
 */
export interface LedgerRow {
  /** Unique and immutable — the merge key for cross-device import. Never regenerate. */
  id: string;
  /** ISO calendar date, 'YYYY-MM-DD'. */
  date: string;
  /** Always 'Rock' today; kept flexible. */
  item: string;
  /** Free-text business key, e.g. 'AVK', 'Al Falah metal crusher'. Never normalised. */
  crusher: string;
  /**
   * `null` for the rare row that belongs to neither split — the seed data has one
   * ('Outside site No Profit', 2025-11-29). Such rows still count towards qty and
   * the amount totals but are excluded from the Pass / WO Pass splits, which is
   * what the golden totals encode. Do not "fix" this by forcing a value.
   */
  passType: PassType | null;
  /** Tons. Mostly 2 dp, but the seed data contains 3 dp values — stored as entered. */
  qty: number;
  /** ₹/ton paid to the quarry (snapshot). */
  quaryRate: number;
  /** ₹/ton charged to the crusher (snapshot). */
  crusherRate: number;
  /** ₹/ton vehicle rent; 0 for own / crusher-supplied vehicles. */
  rentRate: number;
  /** ₹/ton monthly commission ("monthly discount"); 0 or 20. */
  commRate: number;
  /** Registration, e.g. 'KL 58 V 5636'. Messy free text; may be ''. Never normalised. */
  vehicle: string;
}

/** One rate-chart entry: the pre-fill source for a crusher + pass type. */
export interface RateChartEntry {
  crusher: string;
  type: PassType;
  /** ₹/ton paid to the quarry. */
  quary: number;
  /** ₹/ton vehicle rent; 0 when the crusher supplies the vehicle. */
  rent: number;
  /** ₹/ton charged to the crusher. */
  crusherRate: number;
}

/** A vehicle registration and its owner. Lookup is an exact string match. */
export interface Vehicle {
  /** Registration as written, e.g. 'KI 40 Q 3885'. Never normalised. */
  num: string;
  owner: string;
}

/** Global, user-editable settings. */
export interface LedgerSettings {
  /** "monthly discount" ₹/ton used to pre-fill `commRate`. Default 20. */
  discountRatePerTon: number;
}

export const DEFAULT_SETTINGS: LedgerSettings = { discountRatePerTon: 20 };
