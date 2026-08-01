/**
 * The party-ledger calculation engine — contract-bound.
 *
 * Every formula mirrors the source workbook's party sheets:
 *
 * | Value          | Excel                                | Rounding                |
 * |----------------|--------------------------------------|-------------------------|
 * | quarryAmount   | `ROUND(qty × quaryRate, 0)`          | per row                 |
 * | receivable     | `ROUND(Σqty × billRate, 0)` per mode | on the aggregate        |
 * | owner rent     | `ROUND(Σqty × rentRate, 0)` per owner| on the aggregate        |
 * | profit share   | `ROUND(Σqty × perTon, 0)` per share  | on the aggregate        |
 *
 * Note the asymmetry: the workbook rounds the quarry amount per row (its Amount
 * column) but rounds receivable/rent/profit on summed tonnage. Both behaviours
 * are encoded in `data/party-golden-totals.json`; if a change here breaks a
 * golden test, the change is wrong — not the test.
 */

import type { PartyLedgerRow } from './types';

/**
 * Excel `ROUND(x, 0)`: nearest rupee, halves rounded **away from zero**.
 *
 * Same care as the daily ledger's `round10`: `Math.round` breaks negative ties
 * the wrong way, and IEEE-754 can land a true decimal `…·5` tie a hair below it,
 * so the magnitude is nudged by one ulp-ish epsilon before flooring. Real ties
 * occur in the seed data — `290.51 × 850` is exactly `246 933.5` and must bill
 * `₹246 934`, not `₹246 933`.
 */
export function round0(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const magnitude = Math.abs(x);
  const rounded = Math.floor(magnitude + 0.5 + Number.EPSILON * magnitude);
  return Math.sign(x) * rounded;
}

/** A quantity at a rate — the input to aggregate-level rounding. */
export interface RateQty {
  qty: number;
  rate: number;
}

/**
 * The workbook's aggregate rounding: group by rate, round each `Σqty × rate`
 * product once, then sum the rounded products.
 *
 * Grouping by rate matters: rows normally share one snapshot rate (matching
 * Excel's single `ROUND(SUMIFS(…) * rate, 0)` exactly), but after a config
 * change two snapshot rates can coexist — each then rounds separately, exactly
 * as two Excel rows would. Zero rates contribute nothing.
 */
export function sumRounded(items: readonly RateQty[]): number {
  const qtyByRate = new Map<number, number>();
  for (const { qty, rate } of items) {
    if (!rate) continue;
    qtyByRate.set(rate, (qtyByRate.get(rate) ?? 0) + num(qty));
  }
  let total = 0;
  for (const [rate, qty] of qtyByRate) total += round0(qty * rate);
  return total;
}

/** Coerce a possibly-missing numeric field the way the ledger treats blanks: as 0. */
function num(value: number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** All derived values for one row. Computed on demand — never persisted. */
export interface ComputedPartyRow {
  /** `ROUND(qty × quaryRate, 0)` — the one per-row-rounded value. */
  quarryAmount: number;
  /** `qty × billRate`, unrounded — aggregates round via `sumRounded`. */
  billAmount: number;
  /** `qty × rentRate`, unrounded; 0 unless the trip is with rent. */
  rentAmount: number;
  /** `qty × Σshares`, unrounded — the row's indicative total profit. */
  profitAmount: number;
}

/** Compute every derived value for a single row. Pure. */
export function computePartyRow(row: PartyLedgerRow): ComputedPartyRow {
  const qty = num(row.qty);
  const rentRate = row.withRent ? num(row.rentRate) : 0;
  const perTon = (row.profitShares ?? []).reduce((sum, share) => sum + num(share.perTon), 0);

  return {
    quarryAmount: round0(qty * num(row.quaryRate)),
    billAmount: qty * num(row.billRate),
    rentAmount: qty * rentRate,
    profitAmount: qty * perTon,
  };
}
