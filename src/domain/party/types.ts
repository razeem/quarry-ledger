/**
 * Domain types for the party ledger — the second ledger model the business runs.
 *
 * Where the daily ledger tracks loads brokered to crushers with a single profit
 * figure, the party ledger tracks loads supplied to *parties*, splitting money
 * three ways per load: payable to the quarry, receivable from the party, and
 * vehicle rent payable to the vehicle's owner — plus a multi-way profit split.
 *
 * This layer is pure: no framework, no I/O (same rules as `src/domain`).
 */

import type { SyncFields } from '../types';

/** One named per-ton profit share, e.g. `{ name: 'Owner', perTon: 40 }`. */
export interface PartyProfitShare {
  name: string;
  perTon: number;
}

/**
 * A single load supplied to a party — the only stored record and the single
 * source of truth for this ledger.
 *
 * `quaryRate` / `billRate` / `rentRate` / `profitShares` are **snapshots**
 * resolved from the party's rate config at entry time. Editing the config must
 * never mutate an existing row (same non-negotiable as the daily ledger).
 */
export interface PartyLedgerRow extends SyncFields {
  /** Unique and immutable — the merge key for cross-device import. Never regenerate. */
  id: string;
  /** ISO calendar date, 'YYYY-MM-DD'. */
  date: string;
  /** Free-text business key, e.g. 'Lakeside Crushers'. Never normalised. */
  party: string;
  /** Always 'Rock' today; kept flexible. */
  item: string;
  /** Registration as written. Messy free text; never normalised. */
  vehicle: string;
  /**
   * The vehicle's owner as attributed for THIS load — rent is paid per owner.
   * Snapshot, autofilled from the vehicle master but editable: the same physical
   * vehicle is attributed to different owners on different parties' loads in the
   * source workbook, so the row's own value always wins.
   */
  owner: string;
  /** Tons, stored as entered. */
  qty: number;
  /** Whether this trip used a rented vehicle — selects the bill rate and drives rent. */
  withRent: boolean;
  /** ₹/ton payable to the quarry (snapshot). */
  quaryRate: number;
  /** ₹/ton receivable from the party (snapshot of the with/without-rent rate). */
  billRate: number;
  /** ₹/ton payable to the vehicle owner; 0 when `withRent` is false. */
  rentRate: number;
  /** The per-ton profit split (snapshot). May be empty. */
  profitShares: PartyProfitShare[];

  /**
   * Which rate cells were typed over, and what the party's setup said first —
   * e.g. `billRate:850`. Absent means every rate matched the setup at entry
   * time. Same field and same encoding as the daily ledger's; see
   * `src/domain/rate-provenance.ts`.
   *
   * Covers the three scalar rates only. `profitShares` is a list, so it does not
   * fit `field:value` — if per-load split changes ever need provenance, the
   * baseline would nest the workbook's existing `Owner:40|Adjust:20` form rather
   * than gain a second field.
   */
  ratesFrom?: string;
}

/** The rates + profit split one of a party's two modes resolves to. */
export interface PartyModeRates {
  /** ₹/ton receivable from the party in this mode. */
  billRate: number;
  /** Per-ton profit split in this mode. May be empty (no profit tracked). */
  shares: PartyProfitShare[];
}

/**
 * One party's rate configuration: the pre-fill source for the entry form.
 * The `withRent` flag on the row picks which mode applies.
 */
export interface PartyRateConfig {
  /** Free-text business key; must match `PartyLedgerRow.party` exactly. */
  party: string;
  /** ₹/ton payable to the quarry. */
  quaryRate: number;
  /** ₹/ton payable to the vehicle owner on with-rent trips. */
  rentRate: number;
  withRent: PartyModeRates;
  withoutRent: PartyModeRates;
}
