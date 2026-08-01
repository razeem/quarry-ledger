/**
 * Merge-import for party-ledger data, keyed on the immutable row `id` — same
 * contract as the daily ledger's merge: importing the same file twice adds zero
 * duplicates, and a changed row updates in place rather than forking.
 */

import type { MergeReport } from '../merge';
import type { PartyLedgerRow, PartyProfitShare, PartyRateConfig } from './types';

export interface PartyMergeResult {
  rows: PartyLedgerRow[];
  report: MergeReport;
}

/** Scalar fields that define a row's identity for change detection. */
const ROW_FIELDS = [
  'date',
  'party',
  'item',
  'vehicle',
  'owner',
  'qty',
  'withRent',
  'quaryRate',
  'billRate',
  'rentRate',
] as const;

function sharesEqual(a: readonly PartyProfitShare[], b: readonly PartyProfitShare[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((share, i) => share.name === b[i].name && share.perTon === b[i].perTon);
}

/** True when two rows carry the same values in every field except `id`. */
export function partyRowsEqual(a: PartyLedgerRow, b: PartyLedgerRow): boolean {
  return (
    ROW_FIELDS.every((field) => a[field] === b[field]) &&
    sharesEqual(a.profitShares ?? [], b.profitShares ?? [])
  );
}

/**
 * Merge `incoming` party rows into `existing`, deduped by `id`. Existing rows
 * keep their position; new rows append in arrival order; last write wins.
 */
export function mergePartyRows(
  existing: readonly PartyLedgerRow[],
  incoming: readonly PartyLedgerRow[],
): PartyMergeResult {
  const rows = [...existing];
  const indexById = new Map(rows.map((row, index) => [row.id, index]));
  const report: MergeReport = { added: 0, updated: 0, unchanged: 0, skipped: 0, total: 0 };

  for (const row of incoming) {
    if (!row?.id) {
      report.skipped += 1;
      continue;
    }

    const at = indexById.get(row.id);
    if (at === undefined) {
      indexById.set(row.id, rows.length);
      rows.push(row);
      report.added += 1;
    } else if (partyRowsEqual(rows[at], row)) {
      report.unchanged += 1;
    } else {
      rows[at] = row;
      report.updated += 1;
    }
  }

  report.total = rows.length;
  return { rows, report };
}

/**
 * Merge party rate configs by their natural key (the party name). Incoming
 * entries overwrite matching ones; unmatched entries are appended.
 */
export function mergePartyRates(
  existing: readonly PartyRateConfig[],
  incoming: readonly PartyRateConfig[],
): PartyRateConfig[] {
  const merged = [...existing];
  const indexByParty = new Map(merged.map((entry, index) => [entry.party, index]));

  for (const entry of incoming) {
    if (!entry?.party) continue;
    const at = indexByParty.get(entry.party);
    if (at === undefined) {
      indexByParty.set(entry.party, merged.length);
      merged.push(entry);
    } else {
      merged[at] = entry;
    }
  }
  return merged;
}
