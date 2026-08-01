/**
 * The contract test for the party-ledger calculation engine.
 *
 * `data/party-golden-totals.json` holds values computed with the engine rules
 * and cross-asserted (in the extraction script) against every cell of the
 * source workbook that is internally consistent; the file's `corrections`
 * notes document the workbook bugs that were deliberately not reproduced.
 *
 * If a change to this domain breaks a test here, the change is wrong — not the
 * test. See CLAUDE.md.
 */

import { describe, expect, it } from 'vitest';
import goldenTotals from '@data/party-golden-totals.json';
import partyRows from '@data/party-ledger-rows.json';
import { partyStatement, partySummaryReport } from './reports';
import type { PartyLedgerRow } from './types';

const ROWS = partyRows as PartyLedgerRow[];

/** Quantities are stored as entered; the golden file records them to 2 dp. */
const TOLERANCE = 0.01;

interface GoldenStatement {
  loads: number;
  qty: number;
  quarryPayable: number;
  receivable: number;
  rentPayable: number;
  ownerRent: Record<string, number>;
  profit: Record<string, number>;
  profitTotal: number;
}

describe('party seed data', () => {
  it('loads the full 35-row seed', () => {
    expect(ROWS).toHaveLength(35);
  });

  it('has an immutable, unique id on every row', () => {
    expect(ROWS.every((r) => typeof r.id === 'string' && r.id.length > 0)).toBe(true);
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(ROWS.length);
  });

  it('snapshots rentRate as 0 on every without-rent row', () => {
    expect(ROWS.filter((r) => !r.withRent).every((r) => r.rentRate === 0)).toBe(true);
  });
});

describe('party golden totals — per party', () => {
  for (const [party, golden] of Object.entries(goldenTotals.parties) as [
    string,
    GoldenStatement,
  ][]) {
    describe(party, () => {
      const statement = partyStatement(ROWS, party);

      it('reproduces loads and tonnage', () => {
        expect(statement.loads).toBe(golden.loads);
        expect(Math.abs(statement.qty - golden.qty)).toBeLessThanOrEqual(TOLERANCE);
      });

      it('reproduces quarry payable to the rupee', () => {
        expect(statement.quarryPayable).toBe(golden.quarryPayable);
      });

      it('reproduces the receivable to the rupee', () => {
        expect(statement.receivable).toBe(golden.receivable);
      });

      it('reproduces rent payable per owner to the rupee', () => {
        expect(statement.rentPayable).toBe(golden.rentPayable);
        const byOwner = Object.fromEntries(statement.ownerRent.map((l) => [l.owner, l.rent]));
        expect(byOwner).toEqual(golden.ownerRent);
      });

      it('reproduces every profit share to the rupee', () => {
        const byShare = Object.fromEntries(statement.profit.map((l) => [l.name, l.amount]));
        expect(byShare).toEqual(golden.profit);
        expect(statement.profitTotal).toBe(golden.profitTotal);
      });
    });
  }
});

describe('party golden totals — grand totals', () => {
  it('reproduces the cross-party summary', () => {
    const summary = partySummaryReport(ROWS);
    expect(summary.totals.loads).toBe(goldenTotals.all.loads);
    expect(Math.abs(summary.totals.qty - goldenTotals.all.qty)).toBeLessThanOrEqual(TOLERANCE);
    expect(summary.totals.quarryPayable).toBe(goldenTotals.all.quarryPayable);
    expect(summary.totals.receivable).toBe(goldenTotals.all.receivable);
    expect(summary.totals.rentPayable).toBe(goldenTotals.all.rentPayable);
    expect(summary.totals.profitTotal).toBe(goldenTotals.all.profitTotal);
  });

  it('covers every seed row in exactly one party', () => {
    const summary = partySummaryReport(ROWS);
    expect(summary.parties.map((p) => p.party).sort()).toEqual(
      Object.keys(goldenTotals.parties).sort(),
    );
    expect(summary.totals.loads).toBe(ROWS.length);
  });
});
