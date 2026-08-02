/**
 * The calculation engine — contract-bound.
 *
 * Every formula here mirrors a Daily Ledger column of the source Excel workbook
 * (`source-workbook-v5.xlsx`):
 *
 * | Field         | Excel col | Formula                                  |
 * |---------------|-----------|------------------------------------------|
 * | crusherAmount | K         | `qty × crusherRate`                      |
 * | quaryAmount   | L         | `ROUND(qty × quaryRate, -1)`             |
 * | vehicleTon    | N         | `rentRate > 0 ? qty : 0`                 |
 * | vehicleRent   | O         | `vehicleTon × rentRate`                  |
 * | profit        | AR / AT   | `crusherAmount − quaryAmount − vehicleRent` |
 * | discountQty   | AU        | `commRate > 0 ? qty : 0`                 |
 * | discount      | AV        | `commRate > 0 ? qty × commRate : 0`      |
 *
 * `data/golden-totals.json` was verified against that workbook. If a change here
 * breaks a golden test, the change is wrong — not the test.
 *
 * Only `quaryAmount` is rounded. Everything else is stored and summed unrounded;
 * rounding to whole rupees happens at display time only (see `format.ts`).
 */

import type { LedgerRow } from './types';

/** All derived values for one row. Computed on demand — never persisted. */
export interface ComputedRow {
  crusherAmount: number;
  quaryAmount: number;
  vehicleTon: number;
  vehicleRent: number;
  profit: number;
  discountQty: number;
  discount: number;
}

/**
 * Excel `ROUND(x, -1)`: nearest 10, halves rounded **away from zero**.
 *
 * `Math.round` breaks ties towards +∞, which differs from Excel for negatives
 * (`Math.round(-122.5) === -122`, Excel gives `-123`), so the sign is handled
 * explicitly. Values are nudged by one ulp-ish epsilon first: Excel rounds the
 * exact decimal product, whereas IEEE-754 can land a true `…5` tie a hair below
 * it (e.g. `2.045 * 100`), which would otherwise round the wrong way.
 */
export function round10(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const scaled = x / 10;
  const magnitude = Math.abs(scaled);
  const rounded = Math.floor(magnitude + 0.5 + Number.EPSILON * magnitude);
  return Math.sign(scaled) * rounded * 10;
}

/** Coerce a possibly-missing numeric field the way the ledger treats blanks: as 0. */
function num(value: number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A typed-over amount, or the computed one when there is none.
 *
 * `0` is a real override and must win — hence an explicit null check rather
 * than `||`. A non-finite value falls back rather than poisoning every total
 * downstream with NaN.
 */
function overridden(value: number | null | undefined, computed: number): number {
  if (value === null || value === undefined) return computed;
  const n = Number(value);
  return Number.isFinite(n) ? n : computed;
}

/** True when this row carries a user-typed amount for `field`. */
export function hasOverride(
  row: LedgerRow,
  field: 'quaryAmountOverride' | 'vehicleRentOverride',
): boolean {
  const value = row[field];
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

/** Compute every derived value for a single row. Pure. */
export function computeRow(row: LedgerRow): ComputedRow {
  const qty = num(row.qty);
  const quaryRate = num(row.quaryRate);
  const crusherRate = num(row.crusherRate);
  const rentRate = num(row.rentRate);
  const commRate = num(row.commRate);

  const crusherAmount = qty * crusherRate;
  const quaryAmount = overridden(row.quaryAmountOverride, round10(qty * quaryRate));
  // Ton stays computed even when the rent is overridden: it is a display column
  // that feeds no money figure once `vehicleRent` is settled directly.
  const vehicleTon = rentRate > 0 ? qty : 0;
  const vehicleRent = overridden(row.vehicleRentOverride, vehicleTon * rentRate);

  return {
    crusherAmount,
    quaryAmount,
    vehicleTon,
    vehicleRent,
    profit: crusherAmount - quaryAmount - vehicleRent,
    discountQty: commRate > 0 ? qty : 0,
    discount: commRate > 0 ? qty * commRate : 0,
  };
}
