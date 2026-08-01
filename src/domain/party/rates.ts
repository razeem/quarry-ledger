/**
 * Party rate-config lookups — the pre-fill source for the party entry form.
 *
 * The config NEVER feeds a stored row directly: `PartyLedgerRow` carries its own
 * snapshot, resolved when the row was entered. Editing the config must not
 * change any existing row.
 */

import type { PartyLedgerRow, PartyProfitShare, PartyRateConfig } from './types';

/** The snapshot fields the config pre-fills onto a new row. */
export interface PartyRatePrefill {
  quaryRate: number;
  billRate: number;
  rentRate: number;
  profitShares: PartyProfitShare[];
}

/**
 * Find the config entry for a party. Party names are free-text business keys,
 * so the match is exact. A miss is normal (a new party typed straight in).
 */
export function findPartyConfig(
  config: readonly PartyRateConfig[],
  party: string,
): PartyRateConfig | undefined {
  return config.find((entry) => entry.party === party);
}

/**
 * Snapshot values to pre-fill for a party + rent mode. Returns `undefined` on a
 * config miss so the caller can leave the form's current values alone.
 */
export function partyRatePrefill(
  config: readonly PartyRateConfig[],
  party: string,
  withRent: boolean,
): PartyRatePrefill | undefined {
  const entry = findPartyConfig(config, party);
  if (!entry) return undefined;
  const mode = withRent ? entry.withRent : entry.withoutRent;
  return {
    quaryRate: entry.quaryRate,
    billRate: mode.billRate,
    // Rent is only payable on with-rent trips; the snapshot encodes that.
    rentRate: withRent ? entry.rentRate : 0,
    profitShares: mode.shares.map((share) => ({ ...share })),
  };
}

/** Every party the form should offer: configured ones plus any already on a row. */
export function knownParties(
  config: readonly PartyRateConfig[],
  rows: readonly PartyLedgerRow[],
): string[] {
  const seen = new Set(config.map((entry) => entry.party));
  for (const row of rows) {
    if (row.party) seen.add(row.party);
  }
  return [...seen];
}

/** Every registration the form should offer: the master list plus any on a row. */
export function knownPartyVehicles(
  vehicles: readonly { num: string }[],
  rows: readonly PartyLedgerRow[],
): string[] {
  const seen = new Set(vehicles.map((v) => v.num));
  for (const row of rows) {
    if (row.vehicle) seen.add(row.vehicle);
  }
  return [...seen];
}
