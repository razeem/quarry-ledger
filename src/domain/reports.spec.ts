import { describe, expect, it } from 'vitest';
import ledgerRows from '@data/ledger-rows.json';
import goldenTotals from '@data/golden-totals.json';
import {
  crusherReport,
  dailyReport,
  groupByDay,
  lastActiveDateRange,
  monthlyReport,
  rowsInRange,
  vehicleRentReport,
} from './reports';
import { summarize } from './summaries';
import type { LedgerRow, PassType, Vehicle } from './types';

const ROWS: LedgerRow[] = (ledgerRows as readonly Record<string, unknown>[]).map(
  (r) => ({ ...r, passType: r['passType'] as PassType | null }) as LedgerRow,
);

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: Math.random().toString(36).slice(2),
    date: '2026-07-29',
    item: 'Rock',
    crusher: 'AVK',
    passType: 'WO Pass',
    qty: 10,
    quaryRate: 610,
    crusherRate: 900,
    rentRate: 220,
    commRate: 20,
    vehicle: 'KL 61 D 5401',
    ...overrides,
  };
}

describe('dailyReport', () => {
  it('matches the golden totals for a real date', () => {
    const report = dailyReport(ROWS, '2026-03-10');
    const golden = goldenTotals.by_date['2026-03-10'];
    expect(Math.abs(report.totals.qty - golden.qty)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(report.totals.crusherAmount - golden.crusherAmount)).toBeLessThanOrEqual(0.01);
    expect(report.totals.quaryAmount).toBe(golden.quaryAmount);
  });

  it('breaks the day down by crusher, biggest quantity first', () => {
    const report = dailyReport(ROWS, '2026-07-29');
    expect(report.crushers.length).toBeGreaterThan(1);
    const quantities = report.crushers.map((c) => c.summary.qty);
    expect([...quantities].sort((a, b) => b - a)).toEqual(quantities);
  });

  it('per-crusher quantities add up to the day total', () => {
    const report = dailyReport(ROWS, '2026-07-29');
    const summed = report.crushers.reduce((n, c) => n + c.summary.qty, 0);
    expect(Math.abs(summed - report.totals.qty)).toBeLessThanOrEqual(0.01);
  });

  it('returns an empty report for a date with no rows', () => {
    const report = dailyReport(ROWS, '1999-01-01');
    expect(report.totals.loads).toBe(0);
    expect(report.crushers).toEqual([]);
    expect(report.label).toBe('01 Jan 1999');
  });
});

describe('vehicleRentReport', () => {
  const vehicles: Vehicle[] = [{ num: 'KL 61 D 5401', owner: 'Renjith' }];

  it('excludes rows with no rent (own / crusher-supplied vehicles)', () => {
    const rows = [
      row({ vehicle: 'KL 1', rentRate: 220, qty: 10 }),
      row({ vehicle: 'KL 2', rentRate: 0, qty: 10 }),
    ];
    const report = vehicleRentReport(rows, '2026-07-29', vehicles);
    expect(report.rows.map((r) => r.vehicle)).toEqual(['KL 1']);
  });

  it('aggregates trips, qty and rent per vehicle', () => {
    const rows = [
      row({ vehicle: 'KL 1', qty: 10, rentRate: 200 }),
      row({ vehicle: 'KL 1', qty: 5, rentRate: 200 }),
    ];
    const report = vehicleRentReport(rows, '2026-07-29', vehicles);
    expect(report.rows[0]).toMatchObject({ trips: 2, qty: 15, rent: 3000 });
  });

  it('resolves owners exactly and tolerates unknown registrations', () => {
    const rows = [row({ vehicle: 'KL 61 D 5401' }), row({ vehicle: 'KL 99 Z 0000' })];
    const report = vehicleRentReport(rows, '2026-07-29', vehicles);
    const owners = new Map(report.rows.map((r) => [r.vehicle, r.owner]));
    expect(owners.get('KL 61 D 5401')).toBe('Renjith');
    expect(owners.get('KL 99 Z 0000')).toBe('');
  });

  it('totals match the sum of its rows and the day rent total', () => {
    const report = vehicleRentReport(ROWS, '2026-07-29', []);
    expect(report.totals.rent).toBeCloseTo(
      report.rows.reduce((n, r) => n + r.rent, 0),
      2,
    );
    // Every billable row on the date is represented, so rent equals the day total.
    const dayRent = summarize(ROWS.filter((r) => r.date === '2026-07-29')).vehicleRent;
    expect(report.totals.rent).toBeCloseTo(dayRent, 2);
    expect(report.totals.rent).toBeCloseTo(goldenTotals.by_date['2026-07-29'].vehicleRent, 2);
  });

  it('sorts by rent, largest first', () => {
    const report = vehicleRentReport(ROWS, '2026-07-29', []);
    const rents = report.rows.map((r) => r.rent);
    expect([...rents].sort((a, b) => b - a)).toEqual(rents);
  });

  it('is empty for a date with no billable rent', () => {
    const report = vehicleRentReport(ROWS, '2025-11-14', []);
    // 2025-11-14 has no vehicle rent at all in the golden totals.
    expect(goldenTotals.by_date['2025-11-14'].vehicleRent).toBe(0);
    expect(report.rows).toEqual([]);
    expect(report.totals).toEqual({ trips: 0, qty: 0, rent: 0 });
  });
});

describe('crusherReport', () => {
  it('covers every crusher exactly once and reconciles to the all-time totals', () => {
    const report = crusherReport(ROWS);
    const crushers = report.map((r) => r.crusher);
    expect(new Set(crushers).size).toBe(crushers.length);

    const totalQty = report.reduce((n, r) => n + r.qty, 0);
    expect(Math.abs(totalQty - goldenTotals.all_time.qty)).toBeLessThanOrEqual(0.01);
    expect(report.reduce((n, r) => n + r.quaryAmount, 0)).toBe(goldenTotals.all_time.quaryAmount);
    expect(report.reduce((n, r) => n + r.loads, 0)).toBe(ROWS.length);
  });

  it('sorts by profit, most profitable first', () => {
    const profits = crusherReport(ROWS).map((r) => r.profit);
    expect([...profits].sort((a, b) => b - a)).toEqual(profits);
  });

  it('derives profit as crusherAmount − quaryAmount − vehicleRent per crusher', () => {
    for (const r of crusherReport(ROWS)) {
      expect(r.profit).toBeCloseTo(r.crusherAmount - r.quaryAmount - r.vehicleRent, 2);
    }
  });

  it('is empty with no rows', () => {
    expect(crusherReport([])).toEqual([]);
  });
});

describe('monthlyReport', () => {
  it('lists months most recent first', () => {
    const months = monthlyReport(ROWS).map((r) => r.month);
    expect(months).toEqual(['2026-07', '2026-03', '2025-11']);
  });

  it('reconciles discount and qty to the all-time totals', () => {
    const report = monthlyReport(ROWS);
    // The golden file records aggregates to 2 dp while some seed quantities carry 3
    // (discQty sums to 3717.715), so use the spec's ±0.01 tolerance, not ±0.005.
    const within = (actual: number, expected: number) =>
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.01);
    within(
      report.reduce((n, r) => n + r.discount, 0),
      goldenTotals.all_time.discount,
    );
    within(
      report.reduce((n, r) => n + r.discountQty, 0),
      goldenTotals.all_time.discQty,
    );
  });

  it('counts discount qty only for commissioned rows', () => {
    const report = monthlyReport([
      row({ date: '2026-07-01', qty: 10, commRate: 20 }),
      row({ date: '2026-07-02', qty: 10, commRate: 0 }),
    ]);
    expect(report).toHaveLength(1);
    expect(report[0].qty).toBe(20);
    expect(report[0].discountQty).toBe(10);
    expect(report[0].discount).toBe(200);
  });
});

describe('groupByDay', () => {
  it('groups most recent day first with a subtotal per day', () => {
    const groups = groupByDay(ROWS);
    const dates = groups.map((g) => g.date);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);

    const nov14 = groups.find((g) => g.date === '2025-11-14');
    expect(nov14?.subtotal.quaryAmount).toBe(goldenTotals.by_date['2025-11-14'].quaryAmount);
  });

  it('keeps entry order within a day and loses no rows', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c', date: '2026-03-10' })];
    const groups = groupByDay(rows);
    expect(groups.flatMap((g) => g.rows)).toHaveLength(3);
    expect(groups.find((g) => g.date === '2026-07-29')?.rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('is empty with no rows', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('lastActiveDateRange', () => {
  it('spans the 5 most recent dates that actually have rows', () => {
    // The seed data's dates are sparse bursts — a calendar window would be empty.
    expect(lastActiveDateRange(ROWS, 5)).toEqual(['2026-03-06', '2026-07-29']);
  });

  it('honours a custom window and clamps to the available dates', () => {
    expect(lastActiveDateRange(ROWS, 1)).toEqual(['2026-07-29', '2026-07-29']);
    expect(lastActiveDateRange(ROWS, 500)).toEqual(['2025-11-14', '2026-07-29']);
  });

  it('returns null when there are no rows', () => {
    expect(lastActiveDateRange([], 5)).toBeNull();
  });
});

describe('rowsInRange', () => {
  it('includes both endpoints', () => {
    const rows = rowsInRange(ROWS, '2025-11-14', '2025-11-14');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.date === '2025-11-14')).toBe(true);
  });

  it('tolerates a reversed range', () => {
    expect(rowsInRange(ROWS, '2026-07-29', '2025-11-14')).toHaveLength(ROWS.length);
  });

  it('is empty outside the data', () => {
    expect(rowsInRange(ROWS, '1999-01-01', '1999-12-31')).toEqual([]);
  });
});
