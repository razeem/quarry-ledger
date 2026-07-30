/**
 * Aggregations over ledger rows — plain sums of `computeRow` output.
 *
 * Every report in the app is a pure function over rows built from these
 * primitives. Nothing here is ever persisted.
 */

import { computeRow } from './calc';
import type { LedgerRow } from './types';

/** Totals for any set of rows. Matches the shape of `data/golden-totals.json`. */
export interface LedgerSummary {
  /** Row count in the set. */
  loads: number;
  qty: number;
  crusherAmount: number;
  quaryAmount: number;
  vehicleRent: number;
  /** Tons on rows with a quarry pass. */
  passQty: number;
  passProfit: number;
  /** Tons on rows without a quarry pass. */
  woQty: number;
  woProfit: number;
  /** Tons attracting the monthly commission (`commRate > 0`). */
  discQty: number;
  discount: number;
  /**
   * Total profit across every row. Note this is **not** `passProfit + woProfit`:
   * a row with a `null` passType contributes here but to neither split.
   */
  profit: number;
}

export const EMPTY_SUMMARY: LedgerSummary = {
  loads: 0,
  qty: 0,
  crusherAmount: 0,
  quaryAmount: 0,
  vehicleRent: 0,
  passQty: 0,
  passProfit: 0,
  woQty: 0,
  woProfit: 0,
  discQty: 0,
  discount: 0,
  profit: 0,
};

/**
 * Sum every derived value over `rows`.
 *
 * The Pass / WO Pass splits key strictly on `passType`, so a row whose
 * `passType` is neither lands in neither split — this is deliberate and is what
 * the golden totals encode.
 */
export function summarize(rows: readonly LedgerRow[]): LedgerSummary {
  const total: LedgerSummary = { ...EMPTY_SUMMARY };

  for (const row of rows) {
    const c = computeRow(row);
    const qty = Number.isFinite(Number(row.qty)) ? Number(row.qty) : 0;

    total.loads += 1;
    total.qty += qty;
    total.crusherAmount += c.crusherAmount;
    total.quaryAmount += c.quaryAmount;
    total.vehicleRent += c.vehicleRent;
    total.discQty += c.discountQty;
    total.discount += c.discount;
    total.profit += c.profit;

    if (row.passType === 'Pass') {
      total.passQty += qty;
      total.passProfit += c.profit;
    } else if (row.passType === 'WO Pass') {
      total.woQty += qty;
      total.woProfit += c.profit;
    }
  }

  return total;
}

/** Group rows by an arbitrary key, preserving first-seen key order. */
export function groupBy<K>(
  rows: readonly LedgerRow[],
  keyFn: (row: LedgerRow) => K,
): Map<K, LedgerRow[]> {
  const groups = new Map<K, LedgerRow[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/** Summarise each group of a grouping, keeping the grouping's key order. */
export function summarizeGroups<K>(groups: Map<K, LedgerRow[]>): Map<K, LedgerSummary> {
  const out = new Map<K, LedgerSummary>();
  for (const [key, rows] of groups) out.set(key, summarize(rows));
  return out;
}

/** 'YYYY-MM' month key of a row's ISO date. */
export function monthKey(row: LedgerRow): string {
  return row.date.slice(0, 7);
}

export const byDate = (rows: readonly LedgerRow[]) => groupBy(rows, (r) => r.date);
export const byCrusher = (rows: readonly LedgerRow[]) => groupBy(rows, (r) => r.crusher);
export const byMonth = (rows: readonly LedgerRow[]) => groupBy(rows, monthKey);
export const byVehicle = (rows: readonly LedgerRow[]) => groupBy(rows, (r) => r.vehicle);

/** The distinct dates that have at least one row, most recent first. */
export function activeDates(rows: readonly LedgerRow[]): string[] {
  return [...new Set(rows.map((r) => r.date))].sort((a, b) => b.localeCompare(a));
}
