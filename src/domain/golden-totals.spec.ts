/**
 * The contract test for the calculation engine.
 *
 * `data/golden-totals.json` holds aggregate values verified against the original
 * Excel workbook (`source-workbook-v5.xlsx`) via LibreOffice recalculation.
 * This suite loads the real seed rows and must reproduce every one of those
 * numbers exactly (±0.01).
 *
 * If a change to the domain layer breaks a test here, the change is wrong — not
 * the test. See CLAUDE.md.
 */

import { describe, expect, it } from 'vitest';
import goldenTotals from '@data/golden-totals.json';
import ledgerRows from '@data/ledger-rows.json';
import { computeRow } from './calc';
import { summarize } from './summaries';
import type { LedgerRow, PassType } from './types';

/** The raw JSON has `passType: string | null`; narrow it to the domain type. */
const ROWS: LedgerRow[] = (ledgerRows as readonly RawRow[]).map((r) => ({
  ...r,
  passType: r.passType as PassType | null,
}));

interface RawRow extends Omit<LedgerRow, 'passType'> {
  passType: string | null;
}

/**
 * Values are stored unrounded while the golden file records them to 2 dp, so the
 * spec allows ±0.01. (Some seed quantities carry 3 decimals — e.g. 33.375 t on
 * 2025-11-14, which the golden file rounds to 33.38.)
 */
const PAISE = 0.01;

/** Assert `actual` is within ±0.01 of the golden `expected`. */
function expectWithinPaise(actual: number, expected: number, label: string): void {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected}, got ${actual}`,
  ).toBeLessThanOrEqual(PAISE);
}

/** Aggregate keys present in every golden totals block. */
const AGGREGATE_KEYS = [
  'qty',
  'crusherAmount',
  'quaryAmount',
  'vehicleRent',
  'passQty',
  'passProfit',
  'woQty',
  'woProfit',
  'discQty',
  'discount',
] as const;

type AggregateKey = (typeof AGGREGATE_KEYS)[number];
type GoldenAggregate = Record<AggregateKey, number>;

function expectAggregate(rows: readonly LedgerRow[], expected: GoldenAggregate): void {
  const actual = summarize(rows);
  for (const key of AGGREGATE_KEYS) {
    expectWithinPaise(actual[key], expected[key], key);
  }
}

describe('seed data', () => {
  it('loads the full 143-row ledger', () => {
    expect(ROWS).toHaveLength(143);
  });

  it('has an immutable, unique id on every row', () => {
    expect(ROWS.every((r) => typeof r.id === 'string' && r.id.length > 0)).toBe(true);
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(ROWS.length);
  });
});

describe('golden totals — all time', () => {
  it('reproduces every all-time aggregate', () => {
    expectAggregate(ROWS, goldenTotals.all_time as GoldenAggregate);
  });
});

describe('golden totals — by date', () => {
  for (const [date, expected] of Object.entries(goldenTotals.by_date)) {
    it(`reproduces every aggregate for ${date}`, () => {
      const rows = ROWS.filter((r) => r.date === date);
      expect(rows.length, 'rows exist for this date').toBeGreaterThan(0);
      expectAggregate(rows, expected as GoldenAggregate);
    });
  }
});

describe('golden totals — single rows', () => {
  for (const sample of goldenTotals.single_rows) {
    it(`computes row ${sample.input.id} (${sample.input.crusher}) exactly`, () => {
      const input: LedgerRow = {
        ...sample.input,
        passType: sample.input.passType as PassType | null,
      };
      const actual = computeRow(input);

      // quaryAmount is the one rounded value — it must match to the rupee.
      expect(actual.quaryAmount).toBe(sample.expected.quaryAmount);
      expectWithinPaise(actual.crusherAmount, sample.expected.crusherAmount, 'crusherAmount');
      expectWithinPaise(actual.vehicleTon, sample.expected.vehicleTon, 'vehicleTon');
      expectWithinPaise(actual.vehicleRent, sample.expected.vehicleRent, 'vehicleRent');
      expectWithinPaise(actual.profit, sample.expected.profit, 'profit');
      expectWithinPaise(actual.discountQty, sample.expected.discountQty, 'discountQty');
      expectWithinPaise(actual.discount, sample.expected.discount, 'discount');
    });

    it(`computes row ${sample.input.id} identically from the stored seed row`, () => {
      // The sample inputs are real rows — the stored row must compute the same way.
      const stored = ROWS.find((r) => r.id === sample.input.id);
      expect(stored, 'sample row is present in the seed data').toBeDefined();
      expect(computeRow(stored as LedgerRow)).toEqual(computeRow(sample.input as LedgerRow));
    });
  }
});

describe('golden totals — the discount rate', () => {
  it('matches the rate every commissioned seed row was entered with', () => {
    const rates = new Set(ROWS.map((r) => r.commRate).filter((r) => r > 0));
    expect([...rates]).toEqual([goldenTotals.discountRatePerTon]);
  });
});

describe('aggregate invariants', () => {
  it('splits qty by passType without double counting', () => {
    const summary = summarize(ROWS);
    const unsplit = ROWS.filter((r) => r.passType !== 'Pass' && r.passType !== 'WO Pass');

    // The seed data contains exactly one row that belongs to neither split
    // ('Outside site No Profit'), so the splits deliberately fall short of the
    // grand total by its qty. Documented in types.ts — do not "fix" this.
    expect(unsplit).toHaveLength(1);
    const unsplitQty = unsplit.reduce((sum, r) => sum + r.qty, 0);
    expect(summary.passQty + summary.woQty + unsplitQty).toBeCloseTo(summary.qty, 2);
  });

  it('is additive across dates', () => {
    const total = summarize(ROWS);
    const dates = [...new Set(ROWS.map((r) => r.date))];
    const perDate = dates.map((d) => summarize(ROWS.filter((r) => r.date === d)));

    for (const key of AGGREGATE_KEYS) {
      const summed = perDate.reduce((sum, s) => sum + s[key], 0);
      expect(summed, key).toBeCloseTo(total[key], 2);
    }
    expect(perDate.reduce((n, s) => n + s.loads, 0)).toBe(total.loads);
  });

  it('derives profit as crusherAmount − quaryAmount − vehicleRent in aggregate', () => {
    const s = summarize(ROWS);
    expectWithinPaise(s.profit, s.crusherAmount - s.quaryAmount - s.vehicleRent, 'profit');
  });
});
