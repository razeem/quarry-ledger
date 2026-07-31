/**
 * Rate-chart lookups — the pre-fill source for the entry form.
 *
 * The chart NEVER feeds a stored row directly: `LedgerRow` carries its own rate
 * snapshot, taken when the row was entered. Editing the chart must not change any
 * existing row (see CLAUDE.md).
 */

import type { LedgerRow, PassType, RateChartEntry, Vehicle } from './types';

/** The four rate fields the chart pre-fills onto a new row. */
export interface RatePrefill {
  quaryRate: number;
  crusherRate: number;
  rentRate: number;
  commRate: number;
}

/**
 * Find the chart entry for a crusher + pass type.
 *
 * Crusher names are free-text business keys, so the match is exact — no trimming,
 * no case folding. A miss is normal (a new crusher typed straight into the form).
 */
export function findRate(
  chart: readonly RateChartEntry[],
  crusher: string,
  passType: PassType | null,
): RateChartEntry | undefined {
  if (!passType) return undefined;
  return chart.find((entry) => entry.crusher === crusher && entry.type === passType);
}

/**
 * Rates to pre-fill for a crusher + pass type. Returns `undefined` when the chart
 * has no entry, so the caller can leave the form's current values alone rather
 * than blanking them.
 */
export function ratePrefill(
  chart: readonly RateChartEntry[],
  crusher: string,
  passType: PassType | null,
  discountRatePerTon: number,
): RatePrefill | undefined {
  const entry = findRate(chart, crusher, passType);
  if (!entry) return undefined;
  return {
    quaryRate: entry.quary,
    crusherRate: entry.crusherRate,
    rentRate: entry.rent,
    // The chart's own commission wins when it has one — several crushers run at ₹0.
    // Charts predating the column (or imported from an older export) fall back to
    // the global setting.
    commRate: entry.comm ?? discountRatePerTon,
  };
}

/** Distinct crusher names in the chart, in first-seen order. */
export function crusherNames(chart: readonly RateChartEntry[]): string[] {
  return [...new Set(chart.map((entry) => entry.crusher))];
}

/**
 * Owner of a vehicle registration, or `''` when unknown.
 *
 * Registrations are messy free text ('KI 00 Q 1011', 'KL00 H 1057'); the lookup is
 * an exact string match and a missing owner is expected, not an error.
 */
export function vehicleOwner(vehicles: readonly Vehicle[], registration: string): string {
  return vehicles.find((v) => v.num === registration)?.owner ?? '';
}

/**
 * Every vehicle registration the form should offer: the vehicle list plus any
 * registration already used on a row but absent from the list.
 */
export function knownVehicles(vehicles: readonly Vehicle[], rows: readonly LedgerRow[]): string[] {
  const seen = new Set(vehicles.map((v) => v.num));
  for (const row of rows) {
    if (row.vehicle) seen.add(row.vehicle);
  }
  return [...seen];
}

/**
 * Every crusher the form should offer: the chart's crushers plus any crusher
 * already used on a row but absent from the chart.
 */
export function knownCrushers(
  chart: readonly RateChartEntry[],
  rows: readonly LedgerRow[],
): string[] {
  const seen = new Set(crusherNames(chart));
  for (const row of rows) {
    if (row.crusher) seen.add(row.crusher);
  }
  return [...seen];
}
