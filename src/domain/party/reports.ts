/**
 * Party-ledger reports, as pure functions over party rows.
 *
 * Nothing here is stored: every statement is recomputed from the rows on demand,
 * so the row set stays the single source of truth. Aggregate rounding follows
 * the workbook via `sumRounded` (see calc.ts).
 */

import { computePartyRow, round0, sumRounded } from './calc';
import { formatDate } from '../format';
import type { PartyLedgerRow } from './types';

// --- Party statement ---------------------------------------------------------

export interface OwnerRentLine {
  owner: string;
  trips: number;
  qty: number;
  rent: number;
}

export interface ProfitShareLine {
  name: string;
  qty: number;
  amount: number;
}

/** Everything the SUMMARY sheet + one party sheet's derived sections show. */
export interface PartyStatement {
  party: string;
  loads: number;
  qty: number;
  /** Σ per-row `ROUND(qty × quaryRate, 0)` — payable to the quarry. */
  quarryPayable: number;
  /** Aggregate-rounded `Σqty × billRate` — receivable from the party. */
  receivable: number;
  /** Σ of the per-owner rounded rents below. */
  rentPayable: number;
  /** Rent payable per vehicle owner, biggest first. */
  ownerRent: OwnerRentLine[];
  /** The profit split, in first-seen share order. */
  profit: ProfitShareLine[];
  profitTotal: number;
}

/** Compute a party's full statement from its rows. */
export function partyStatement(rows: readonly PartyLedgerRow[], party: string): PartyStatement {
  const partyRows = rows.filter((row) => row.party === party);
  return statementOf(party, partyRows);
}

function statementOf(party: string, partyRows: readonly PartyLedgerRow[]): PartyStatement {
  let quarryPayable = 0;
  let qty = 0;
  for (const row of partyRows) {
    quarryPayable += computePartyRow(row).quarryAmount;
    qty += Number.isFinite(Number(row.qty)) ? Number(row.qty) : 0;
  }

  const receivable = sumRounded(partyRows.map((row) => ({ qty: row.qty, rate: row.billRate })));

  const ownerRent = ownerRentLines(partyRows);
  const rentPayable = ownerRent.reduce((sum, line) => sum + line.rent, 0);

  const profit = profitShareLines(partyRows);

  return {
    party,
    loads: partyRows.length,
    qty,
    quarryPayable,
    receivable,
    rentPayable,
    ownerRent,
    profit,
    profitTotal: profit.reduce((sum, line) => sum + line.amount, 0),
  };
}

/**
 * Rent payable per owner over `rows` — each owner's tonnage rounds once per
 * rate, exactly like the workbook's per-owner `ROUND(SUMIFS(…) × rate, 0)`.
 * Only with-rent trips carry rent; rows with a blank owner group under `''`.
 */
export function ownerRentLines(rows: readonly PartyLedgerRow[]): OwnerRentLine[] {
  const byOwner = new Map<string, PartyLedgerRow[]>();
  for (const row of rows) {
    if (!row.withRent || !(row.rentRate > 0)) continue;
    const bucket = byOwner.get(row.owner);
    if (bucket) bucket.push(row);
    else byOwner.set(row.owner, [row]);
  }

  return [...byOwner]
    .map(([owner, group]): OwnerRentLine => ({
      owner,
      trips: group.length,
      qty: group.reduce((sum, row) => sum + row.qty, 0),
      rent: sumRounded(group.map((row) => ({ qty: row.qty, rate: row.rentRate }))),
    }))
    .sort((a, b) => b.rent - a.rent);
}

/** The profit split over `rows`: per share name, aggregate-rounded per rate. */
export function profitShareLines(rows: readonly PartyLedgerRow[]): ProfitShareLine[] {
  const byShare = new Map<string, { qty: number; items: { qty: number; rate: number }[] }>();
  for (const row of rows) {
    for (const share of row.profitShares ?? []) {
      let entry = byShare.get(share.name);
      if (!entry) {
        entry = { qty: 0, items: [] };
        byShare.set(share.name, entry);
      }
      entry.qty += row.qty;
      entry.items.push({ qty: row.qty, rate: share.perTon });
    }
  }

  return [...byShare].map(([name, entry]): ProfitShareLine => ({
    name,
    qty: entry.qty,
    amount: sumRounded(entry.items),
  }));
}

// --- Cross-party summary (the SUMMARY sheet) ----------------------------------

export interface PartySummaryReport {
  parties: PartyStatement[];
  totals: {
    loads: number;
    qty: number;
    quarryPayable: number;
    receivable: number;
    rentPayable: number;
    profitTotal: number;
  };
}

/** Statement per party (first-seen row order), plus grand totals. */
export function partySummaryReport(rows: readonly PartyLedgerRow[]): PartySummaryReport {
  const byParty = new Map<string, PartyLedgerRow[]>();
  for (const row of rows) {
    const bucket = byParty.get(row.party);
    if (bucket) bucket.push(row);
    else byParty.set(row.party, [row]);
  }

  const parties = [...byParty].map(([party, group]) => statementOf(party, group));
  return {
    parties,
    totals: {
      loads: parties.reduce((sum, p) => sum + p.loads, 0),
      qty: parties.reduce((sum, p) => sum + p.qty, 0),
      quarryPayable: parties.reduce((sum, p) => sum + p.quarryPayable, 0),
      receivable: parties.reduce((sum, p) => sum + p.receivable, 0),
      rentPayable: parties.reduce((sum, p) => sum + p.rentPayable, 0),
      profitTotal: parties.reduce((sum, p) => sum + p.profitTotal, 0),
    },
  };
}

// --- Reconciliation ------------------------------------------------------------

/**
 * The workbook's "Total ton as per quary stmt" check: compare entered tonnage
 * against the quarry statement's figure. A non-zero variance means loads are
 * missing from one side — the seed data itself contains one real example.
 */
export function reconcileQty(
  rows: readonly PartyLedgerRow[],
  party: string,
  statedQty: number,
): { enteredQty: number; statedQty: number; variance: number } {
  const enteredQty = rows
    .filter((row) => row.party === party)
    .reduce((sum, row) => sum + row.qty, 0);
  return { enteredQty, statedQty, variance: Number((enteredQty - statedQty).toFixed(3)) };
}

// --- Day grouping (entry sheet + ledger views) ----------------------------------

export interface PartyDayGroup {
  date: string;
  label: string;
  rows: PartyLedgerRow[];
  /** Per-row-rounded payable; other aggregates come from the statement fns. */
  quarryPayable: number;
  qty: number;
}

/** Rows grouped by date, most recent day first, keeping entry order within a day. */
export function groupPartyRowsByDay(rows: readonly PartyLedgerRow[]): PartyDayGroup[] {
  const groups = new Map<string, PartyLedgerRow[]>();
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
      quarryPayable: dayRows.reduce((sum, row) => sum + round0(row.qty * row.quaryRate), 0),
      qty: dayRows.reduce((sum, row) => sum + row.qty, 0),
    }));
}

/** The distinct dates that have at least one row, most recent first. */
export function activePartyDates(rows: readonly PartyLedgerRow[]): string[] {
  return [...new Set(rows.map((row) => row.date))].sort((a, b) => b.localeCompare(a));
}
