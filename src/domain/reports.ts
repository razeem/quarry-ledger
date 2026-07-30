/**
 * The four reports, as pure functions over ledger rows.
 *
 * Nothing here is stored: every report is recomputed from the rows on demand, so
 * the Daily Ledger stays the single source of truth (see CLAUDE.md).
 */

import { computeRow } from './calc';
import { formatDate } from './format';
import { vehicleOwner } from './rates';
import {
  activeDates,
  byCrusher,
  byMonth,
  byVehicle,
  summarize,
  summarizeGroups,
  type LedgerSummary,
} from './summaries';
import type { LedgerRow, Vehicle } from './types';

// --- Daily summary ---------------------------------------------------------

export interface DailyReport {
  date: string;
  /** Formatted for display, e.g. '29 Jul 2026'. */
  label: string;
  totals: LedgerSummary;
  /** Per-crusher breakdown, biggest quantity first. */
  crushers: { crusher: string; summary: LedgerSummary }[];
}

/** KPIs plus a per-crusher table for one date. */
export function dailyReport(rows: readonly LedgerRow[], date: string): DailyReport {
  const forDate = rows.filter((row) => row.date === date);
  const crushers = [...summarizeGroups(byCrusher(forDate))]
    .map(([crusher, summary]) => ({ crusher, summary }))
    .sort((a, b) => b.summary.qty - a.summary.qty);

  return { date, label: formatDate(date), totals: summarize(forDate), crushers };
}

// --- Vehicle rent by date --------------------------------------------------

export interface VehicleRentRow {
  vehicle: string;
  /** '' when the registration is not in the vehicle list — expected, not an error. */
  owner: string;
  trips: number;
  qty: number;
  rent: number;
}

export interface VehicleRentReport {
  date: string;
  label: string;
  rows: VehicleRentRow[];
  totals: { trips: number; qty: number; rent: number };
}

/**
 * Rent owed per vehicle on one date.
 *
 * Only rows that actually carry rent appear: a `rentRate` of 0 means an own or
 * crusher-supplied vehicle, which is not billed.
 */
export function vehicleRentReport(
  rows: readonly LedgerRow[],
  date: string,
  vehicles: readonly Vehicle[],
): VehicleRentReport {
  const billable = rows.filter((row) => row.date === date && computeRow(row).vehicleRent > 0);

  const reportRows = [...byVehicle(billable)]
    .map(([vehicle, group]): VehicleRentRow => {
      const summary = summarize(group);
      return {
        vehicle,
        owner: vehicleOwner(vehicles, vehicle),
        trips: group.length,
        qty: summary.qty,
        rent: summary.vehicleRent,
      };
    })
    .sort((a, b) => b.rent - a.rent);

  return {
    date,
    label: formatDate(date),
    rows: reportRows,
    totals: {
      trips: reportRows.reduce((n, r) => n + r.trips, 0),
      qty: reportRows.reduce((n, r) => n + r.qty, 0),
      rent: reportRows.reduce((n, r) => n + r.rent, 0),
    },
  };
}

// --- Crusher-wise, all time ------------------------------------------------

export interface CrusherReportRow {
  crusher: string;
  loads: number;
  qty: number;
  crusherAmount: number;
  quaryAmount: number;
  vehicleRent: number;
  profit: number;
}

/** All-time totals per crusher, most profitable first. */
export function crusherReport(rows: readonly LedgerRow[]): CrusherReportRow[] {
  return [...summarizeGroups(byCrusher(rows))]
    .map(([crusher, s]): CrusherReportRow => ({
      crusher,
      loads: s.loads,
      qty: s.qty,
      crusherAmount: s.crusherAmount,
      quaryAmount: s.quaryAmount,
      vehicleRent: s.vehicleRent,
      profit: s.profit,
    }))
    .sort((a, b) => b.profit - a.profit);
}

// --- Monthly ---------------------------------------------------------------

export interface MonthlyReportRow {
  /** 'YYYY-MM'. */
  month: string;
  loads: number;
  qty: number;
  discountQty: number;
  discount: number;
  profit: number;
}

/** Per-month totals, most recent month first. */
export function monthlyReport(rows: readonly LedgerRow[]): MonthlyReportRow[] {
  return [...summarizeGroups(byMonth(rows))]
    .map(([month, s]): MonthlyReportRow => ({
      month,
      loads: s.loads,
      qty: s.qty,
      discountQty: s.discQty,
      discount: s.discount,
      profit: s.profit,
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

// --- Ledger tab grouping ---------------------------------------------------

export interface LedgerDayGroup {
  date: string;
  label: string;
  rows: LedgerRow[];
  subtotal: LedgerSummary;
}

/**
 * Rows grouped by date, most recent day first, each with its day subtotal.
 * Within a day, rows keep their stored order (entry order).
 */
export function groupByDay(rows: readonly LedgerRow[]): LedgerDayGroup[] {
  const groups = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row.date);
    if (bucket) bucket.push(row);
    else groups.set(row.date, [row]);
  }

  return [...groups]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, dayRows]) => ({
      date,
      label: formatDate(date),
      rows: dayRows,
      subtotal: summarize(dayRows),
    }));
}

/**
 * The default Ledger view: the N most recent dates that actually have rows.
 *
 * Calendar-based windows are useless here — the quarry runs in bursts, so "the
 * last 5 days" would often be empty. Returns `[from, to]` inclusive ISO dates, or
 * `null` when there are no rows at all.
 */
export function lastActiveDateRange(rows: readonly LedgerRow[], days = 5): [string, string] | null {
  const dates = activeDates(rows); // already most-recent-first
  if (dates.length === 0) return null;
  const window = dates.slice(0, Math.max(1, days));
  return [window[window.length - 1], window[0]];
}

/** Rows falling inside an inclusive ISO date range. */
export function rowsInRange(rows: readonly LedgerRow[], from: string, to: string): LedgerRow[] {
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return rows.filter((row) => row.date >= lo && row.date <= hi);
}
