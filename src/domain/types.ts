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
 * What every syncable record carries so edits and deletes can travel between
 * devices. Shared by `LedgerRow` and `PartyLedgerRow`.
 *
 * **Both are optional on purpose.** The bundled seed and every export written
 * before sync existed carry neither, and must keep parsing byte-identically —
 * so a missing `updatedAt` reads as `0` (older than anything a user has
 * touched) and a missing `deleted` reads as live.
 */
export interface SyncFields {
  /**
   * Device clock in ms at the last edit — the last-write-wins comparison key.
   * Device clocks can disagree; the sync cursor uses server time instead, so
   * skew can pick an unexpected winner but can never lose a record.
   */
  updatedAt?: number;
  /**
   * Tombstone. A deleted record is kept, flagged, so the delete propagates
   * instead of the row being resurrected by an older copy from another device.
   * Tombstones are invisible above the store: `rows()` filters them out.
   */
  deleted?: boolean;
}

/**
 * A single rock load — the only stored record and the single source of truth.
 *
 * `quaryRate` / `crusherRate` / `rentRate` / `commRate` are **snapshots** taken
 * at entry time. The rate chart only pre-fills the entry form; editing it must
 * never mutate an existing row.
 */
export interface LedgerRow extends SyncFields {
  /** Unique and immutable — the merge key for cross-device import. Never regenerate. */
  id: string;
  /** ISO calendar date, 'YYYY-MM-DD'. */
  date: string;
  /** Always 'Rock' today; kept flexible. */
  item: string;
  /** Free-text business key, e.g. 'Riverside Crusher', 'Eastfield Metal Crusher'. Never normalised. */
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
  /** Registration, e.g. 'KL 00 V 1087'. Messy free text; may be ''. Never normalised. */
  vehicle: string;

  /**
   * A quarry amount the user typed over the computed one.
   *
   * The business adjusts what it actually settles with the quarry — a
   * negotiated figure, a slip-weight difference, a rounding at the quarry's
   * end — and that adjusted amount is the real one. It averages a couple of
   * hundred rupees away from `ROUND(qty × quaryRate, -1)`, so it is nothing
   * like a rounding artefact.
   *
   * **This does not break "never store derived values".** That rule exists so
   * totals cannot drift away from their inputs. A figure the user deliberately
   * typed *is* an input — the same standing a snapshotted rate already has —
   * and it is the only way to record an amount the formula cannot reach:
   * `round10` always yields a multiple of 10, while real settlements are not.
   *
   * Absent means "compute it", which is why it is optional and why the bundled
   * seed and every earlier export still reproduce the golden totals exactly.
   */
  quaryAmountOverride?: number;
  /**
   * A vehicle rent the user typed over `vehicleTon × rentRate`, for the same
   * reason. `0` is a meaningful override — a trip where no rent was actually
   * paid despite a rate being on file.
   */
  vehicleRentOverride?: number;

  /**
   * Which rate cells were typed over, and what the chart said first — e.g.
   * `quaryRate:650;rentRate:250`. Absent means every rate matched the chart at
   * entry time.
   *
   * Provenance only: nothing calculates from it, so the golden totals cannot
   * move. It exists because a rate that differs from *today's* chart says
   * nothing about who set it — see `src/domain/rate-provenance.ts` for why
   * comparing against the current chart gets it exactly backwards once rates
   * change.
   */
  ratesFrom?: string;
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
  /**
   * ₹/ton monthly commission to pre-fill. Optional: when absent (an older chart or
   * an import from one), the global `discountRatePerTon` is used instead.
   *
   * Per-entry rather than global because several crushers run at ₹0 — but note it
   * is only a default, since a couple of crusher/pass combinations have
   * historically used both ₹0 and ₹20, so the row's own value always wins.
   */
  comm?: number;
}

/** A vehicle registration and its owner. Lookup is an exact string match. */
export interface Vehicle {
  /** Registration as written, e.g. 'KI 00 Q 1011'. Never normalised. */
  num: string;
  owner: string;
}

/** Global, user-editable settings. */
export interface LedgerSettings {
  /** "monthly discount" ₹/ton used to pre-fill `commRate`. Default 20. */
  discountRatePerTon: number;
}

export const DEFAULT_SETTINGS: LedgerSettings = { discountRatePerTon: 20 };
