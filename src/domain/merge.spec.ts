import { describe, expect, it } from 'vitest';
import { describeMerge, mergeRateChart, mergeRows, mergeVehicles, rowsEqual } from './merge';
import type { LedgerRow, RateChartEntry, Vehicle } from './types';

function row(id: string, overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id,
    date: '2026-07-29',
    item: 'Rock',
    crusher: 'Riverside Crusher',
    passType: 'WO Pass',
    qty: 30,
    quaryRate: 610,
    crusherRate: 900,
    rentRate: 220,
    commRate: 20,
    vehicle: 'KL 00 D 1089',
    ...overrides,
  };
}

describe('rowsEqual', () => {
  it('ignores id and compares every other field', () => {
    expect(rowsEqual(row('a'), row('b'))).toBe(true);
    expect(rowsEqual(row('a'), row('a', { qty: 31 }))).toBe(false);
    expect(rowsEqual(row('a'), row('a', { vehicle: 'KL 00 D 1046' }))).toBe(false);
    expect(rowsEqual(row('a'), row('a', { passType: 'Pass' }))).toBe(false);
    expect(rowsEqual(row('a'), row('a', { passType: null }))).toBe(false);
  });

  it('counts the tombstone but compares it as a boolean', () => {
    expect(rowsEqual(row('a'), row('a', { deleted: true }))).toBe(false);
    // An untouched row omits the field entirely; that must read as live, not as
    // a difference — `undefined === false` would be false.
    expect(rowsEqual(row('a'), row('a', { deleted: false }))).toBe(true);
  });

  it('ignores updatedAt, so a pulled row does not read as changed', () => {
    expect(rowsEqual(row('a', { updatedAt: 1 }), row('a', { updatedAt: 999 }))).toBe(true);
  });
});

describe('mergeRows', () => {
  it('adds rows whose id is new', () => {
    const { rows, report } = mergeRows([row('a')], [row('b')]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(report).toMatchObject({ added: 1, updated: 0, unchanged: 0, total: 2 });
  });

  it('adds zero duplicates when the same file is imported twice', () => {
    const incoming = [row('a'), row('b')];
    const first = mergeRows([], incoming);
    const second = mergeRows(first.rows, incoming);

    expect(second.rows).toHaveLength(2);
    expect(second.report).toMatchObject({ added: 0, updated: 0, unchanged: 2, total: 2 });
  });

  it('updates a row in place when its fields changed', () => {
    const { rows, report } = mergeRows(
      [row('a', { qty: 30, updatedAt: 100 })],
      [row('a', { qty: 42, updatedAt: 200 })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(42);
    expect(report).toMatchObject({ added: 0, updated: 1, unchanged: 0, stale: 0 });
  });

  it('never regenerates or reorders existing ids', () => {
    const existing = [row('a'), row('b'), row('c')];
    const { rows } = mergeRows(existing, [row('b', { qty: 99 }), row('d')]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rows[1].id).toBe('b');
  });

  it('skips incoming rows with no usable id', () => {
    const { rows, report } = mergeRows(
      [row('a')],
      [row(''), { ...row('x'), id: undefined } as unknown as LedgerRow],
    );
    expect(rows).toHaveLength(1);
    expect(report.skipped).toBe(2);
    expect(report.added).toBe(0);
  });

  it('does not mutate its inputs', () => {
    const existing = [row('a')];
    const incoming = [row('a', { qty: 5 }), row('b')];
    mergeRows(existing, incoming);
    expect(existing).toHaveLength(1);
    expect(existing[0].qty).toBe(30);
    expect(incoming).toHaveLength(2);
  });

  it('handles an empty merge on both sides', () => {
    expect(mergeRows([], []).report).toMatchObject({ added: 0, total: 0 });
    expect(mergeRows([row('a')], []).report).toMatchObject({ added: 0, total: 1 });
  });

  it('applies the newest of several incoming versions of one id', () => {
    const { rows, report } = mergeRows(
      [],
      [row('a', { qty: 1, updatedAt: 100 }), row('a', { qty: 2, updatedAt: 200 })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(2);
    expect(report).toMatchObject({ added: 1, updated: 1 });
  });

  it('keeps the local row when the incoming copy is older', () => {
    const { rows, report } = mergeRows(
      [row('a', { qty: 42, updatedAt: 900 })],
      [row('a', { qty: 30, updatedAt: 100 })],
    );
    expect(rows[0].qty).toBe(42);
    expect(report).toMatchObject({ updated: 0, stale: 1 });
  });

  it('applies an incoming tombstone over a live local row', () => {
    const { rows, report } = mergeRows(
      [row('a', { updatedAt: 100 })],
      [row('a', { deleted: true, updatedAt: 900 })],
    );
    expect(rows[0].deleted).toBe(true);
    expect(report).toMatchObject({ updated: 1, stale: 0 });
  });

  it('does not let a stale export resurrect a row deleted on another device', () => {
    // The bug this whole rule exists to stop: device A deletes a row, then someone
    // merge-imports a backup taken before the delete.
    const { rows, report } = mergeRows(
      [row('a', { deleted: true, updatedAt: 900 })],
      [row('a', { updatedAt: 100 })],
    );
    expect(rows[0].deleted).toBe(true);
    expect(report.stale).toBe(1);
  });

  it('treats a row with no updatedAt as older than any stamped row', () => {
    // The bundled seed and every pre-sync export carry no timestamp, so they must
    // always lose to a row the user has actually touched — in either direction.
    const forward = mergeRows([row('a', { qty: 1 })], [row('a', { qty: 2, updatedAt: 1 })]);
    expect(forward.rows[0].qty).toBe(2);

    const backward = mergeRows([row('a', { qty: 2, updatedAt: 1 })], [row('a', { qty: 1 })]);
    expect(backward.rows[0].qty).toBe(2);
    expect(backward.report.stale).toBe(1);
  });

  it('breaks an equal-timestamp tie identically in both directions', () => {
    // Convergence: two devices resolving the same conflict must land on the same
    // row, or they overwrite each other forever.
    const a = row('x', { qty: 10, updatedAt: 500 });
    const b = row('x', { qty: 20, updatedAt: 500 });
    expect(mergeRows([a], [b]).rows[0]).toEqual(mergeRows([b], [a]).rows[0]);
  });
});

describe('describeMerge', () => {
  it('summarises a merge for the toast', () => {
    expect(
      describeMerge({ added: 2, updated: 1, unchanged: 3, skipped: 0, stale: 0, total: 6 }),
    ).toBe('2 added · 1 updated · 3 unchanged — 6 rows total');
  });

  it('mentions skipped rows only when there are some', () => {
    expect(
      describeMerge({ added: 0, updated: 0, unchanged: 0, skipped: 2, stale: 0, total: 0 }),
    ).toContain('2 skipped');
  });

  it('mentions rows rejected as older only when there are some', () => {
    expect(
      describeMerge({ added: 0, updated: 0, unchanged: 0, skipped: 0, stale: 3, total: 5 }),
    ).toContain('3 older');
  });
});

describe('mergeRateChart', () => {
  const entry = (crusher: string, type: 'Pass' | 'WO Pass', quary: number): RateChartEntry => ({
    crusher,
    type,
    quary,
    rent: 0,
    crusherRate: 675,
  });

  it('overwrites by crusher + pass type and appends the rest', () => {
    const merged = mergeRateChart(
      [entry('Riverside Crusher', 'Pass', 650), entry('Riverside Crusher', 'WO Pass', 610)],
      [entry('Riverside Crusher', 'Pass', 640), entry('New', 'Pass', 700)],
    );
    expect(merged).toHaveLength(3);
    expect(merged[0].quary).toBe(640);
    expect(merged[2].crusher).toBe('New');
  });

  it('treats Pass and WO Pass for one crusher as distinct entries', () => {
    const merged = mergeRateChart(
      [entry('Riverside Crusher', 'Pass', 650)],
      [entry('Riverside Crusher', 'WO Pass', 610)],
    );
    expect(merged).toHaveLength(2);
  });
});

describe('mergeVehicles', () => {
  const v = (num: string, owner: string): Vehicle => ({ num, owner });

  it('overwrites owners by registration and appends new vehicles', () => {
    const merged = mergeVehicles([v('KL 1', 'Old')], [v('KL 1', 'New'), v('KL 2', 'Other')]);
    expect(merged).toEqual([v('KL 1', 'New'), v('KL 2', 'Other')]);
  });

  it('keeps messy registrations distinct rather than normalising them', () => {
    const merged = mergeVehicles([v('KL00 H 1057', 'A')], [v('KL 00 H 1057', 'B')]);
    expect(merged).toHaveLength(2);
  });

  it('ignores entries with no registration', () => {
    expect(mergeVehicles([], [v('', 'Nobody')])).toHaveLength(0);
  });
});
