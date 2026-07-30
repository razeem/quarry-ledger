import { describe, expect, it } from 'vitest';
import {
  activeDates,
  byCrusher,
  byDate,
  byMonth,
  byVehicle,
  EMPTY_SUMMARY,
  groupBy,
  monthKey,
  summarize,
  summarizeGroups,
} from './summaries';
import type { LedgerRow } from './types';

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

describe('summarize', () => {
  it('returns zeroes for an empty set', () => {
    expect(summarize([])).toEqual(EMPTY_SUMMARY);
  });

  it('counts loads and sums quantities', () => {
    const s = summarize([row({ qty: 10 }), row({ qty: 12.5 })]);
    expect(s.loads).toBe(2);
    expect(s.qty).toBeCloseTo(22.5, 2);
  });

  it('splits qty and profit by passType', () => {
    const s = summarize([
      row({ passType: 'Pass', qty: 10 }),
      row({ passType: 'WO Pass', qty: 20 }),
      row({ passType: 'WO Pass', qty: 5 }),
    ]);
    expect(s.passQty).toBeCloseTo(10, 2);
    expect(s.woQty).toBeCloseTo(25, 2);
    expect(s.passProfit + s.woProfit).toBeCloseTo(s.profit, 2);
  });

  it('excludes a null-passType row from both splits but not from the totals', () => {
    const rows = [row({ passType: 'Pass', qty: 10 }), row({ passType: null, qty: 7 })];
    const s = summarize(rows);
    expect(s.qty).toBeCloseTo(17, 2);
    expect(s.passQty).toBeCloseTo(10, 2);
    expect(s.woQty).toBe(0);
    // Grand-total profit still includes the unsplit row, so it exceeds the splits.
    expect(s.profit).toBeGreaterThan(s.passProfit + s.woProfit);
  });

  it('counts discount qty only on commissioned rows', () => {
    const s = summarize([row({ qty: 10, commRate: 20 }), row({ qty: 10, commRate: 0 })]);
    expect(s.discQty).toBeCloseTo(10, 2);
    expect(s.discount).toBeCloseTo(200, 2);
  });

  it('sums rent only for rows that carry a rent rate', () => {
    const s = summarize([row({ qty: 10, rentRate: 220 }), row({ qty: 10, rentRate: 0 })]);
    expect(s.vehicleRent).toBeCloseTo(2200, 2);
  });

  it('does not mutate EMPTY_SUMMARY', () => {
    summarize([row(), row()]);
    expect(EMPTY_SUMMARY.qty).toBe(0);
    expect(EMPTY_SUMMARY.loads).toBe(0);
  });
});

describe('groupBy', () => {
  it('preserves first-seen key order', () => {
    const rows = [row({ crusher: 'B' }), row({ crusher: 'A' }), row({ crusher: 'B' })];
    expect([...groupBy(rows, (r) => r.crusher).keys()]).toEqual(['B', 'A']);
  });

  it('keeps every row exactly once', () => {
    const rows = [
      row({ date: '2026-07-29' }),
      row({ date: '2026-03-10' }),
      row({ date: '2026-07-29' }),
    ];
    const groups = byDate(rows);
    expect(groups.get('2026-07-29')).toHaveLength(2);
    expect(groups.get('2026-03-10')).toHaveLength(1);
    expect([...groups.values()].flat()).toHaveLength(rows.length);
  });

  it('groups by crusher, month and vehicle', () => {
    const rows = [
      row({ crusher: 'AVK', date: '2026-07-29', vehicle: 'KL 61 D 5401' }),
      row({ crusher: 'AVK', date: '2026-03-10', vehicle: '' }),
    ];
    expect([...byCrusher(rows).keys()]).toEqual(['AVK']);
    expect([...byMonth(rows).keys()]).toEqual(['2026-07', '2026-03']);
    expect([...byVehicle(rows).keys()]).toEqual(['KL 61 D 5401', '']);
  });

  it('does not normalise crusher names or vehicle numbers', () => {
    // Messy free-text business keys must stay distinct exactly as entered.
    const rows = [row({ vehicle: 'KL24 H 6714' }), row({ vehicle: 'KL 24 H 6714' })];
    expect(byVehicle(rows).size).toBe(2);
  });
});

describe('summarizeGroups', () => {
  it('summarises each group and keeps key order', () => {
    const rows = [
      row({ date: '2026-07-29', qty: 10 }),
      row({ date: '2026-03-10', qty: 4 }),
      row({ date: '2026-07-29', qty: 2 }),
    ];
    const summaries = summarizeGroups(byDate(rows));
    expect([...summaries.keys()]).toEqual(['2026-07-29', '2026-03-10']);
    expect(summaries.get('2026-07-29')?.qty).toBeCloseTo(12, 2);
    expect(summaries.get('2026-03-10')?.loads).toBe(1);
  });
});

describe('monthKey / activeDates', () => {
  it('derives a YYYY-MM key', () => {
    expect(monthKey(row({ date: '2025-11-14' }))).toBe('2025-11');
  });

  it('lists distinct dates most recent first', () => {
    const rows = [
      row({ date: '2026-03-10' }),
      row({ date: '2026-07-29' }),
      row({ date: '2026-03-10' }),
      row({ date: '2025-11-14' }),
    ];
    expect(activeDates(rows)).toEqual(['2026-07-29', '2026-03-10', '2025-11-14']);
  });

  it('returns an empty list for no rows', () => {
    expect(activeDates([])).toEqual([]);
  });
});
