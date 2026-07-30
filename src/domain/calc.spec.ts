import { describe, expect, it } from 'vitest';
import { computeRow, round10 } from './calc';
import type { LedgerRow } from './types';

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'test',
    date: '2026-07-29',
    item: 'Rock',
    crusher: 'AVK',
    passType: 'WO Pass',
    qty: 30,
    quaryRate: 610,
    crusherRate: 900,
    rentRate: 220,
    commRate: 20,
    vehicle: 'KL 61 D 5401',
    ...overrides,
  };
}

describe('round10 — Excel ROUND(x, -1)', () => {
  it('rounds to the nearest 10', () => {
    expect(round10(19922.6)).toBe(19920);
    expect(round10(19926)).toBe(19930);
    expect(round10(0)).toBe(0);
    expect(round10(4)).toBe(0);
    expect(round10(6)).toBe(10);
  });

  it('rounds halves away from zero, not towards +infinity', () => {
    expect(round10(1225)).toBe(1230);
    expect(round10(1235)).toBe(1240);
    // Math.round(-122.5) is -122, which would give -1220 — Excel gives -1230.
    expect(round10(-1225)).toBe(-1230);
    expect(round10(-1235)).toBe(-1240);
    expect(round10(5)).toBe(10);
    expect(round10(-5)).toBe(-10);
  });

  it('is symmetric about zero', () => {
    for (const x of [0, 4.9, 5, 12.5, 1225, 19922.6, 1_234_567.89]) {
      expect(round10(-x)).toBe(-round10(x));
    }
  });

  it('rounds only at the tens boundary, not the units', () => {
    // 204.5 is nearer 200 than 210 — Excel ROUND(204.5, -1) is 200. The tie that
    // matters for this function is a 5 in the *units* place.
    expect(round10(204.5)).toBe(200);
    expect(round10(205)).toBe(210);
  });

  it('rounds a true units tie away from zero even when the float product falls short', () => {
    // 2.3 t at ₹650/t is exactly ₹1495, but the IEEE-754 product is
    // 1494.9999999999998, so a naive floor(x / 10 + 0.5) yields ₹1490 where Excel
    // yields ₹1500. `Number()` keeps the bundler from constant-folding the product.
    const qty = Number('2.3');
    expect(qty * 650).toBeLessThan(1495); // guard: the float really is short
    expect(round10(qty * 650)).toBe(1500);
  });

  it('treats non-finite input as zero rather than producing NaN', () => {
    expect(round10(Number.NaN)).toBe(0);
    expect(round10(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('computeRow', () => {
  it('applies every formula from the Daily Ledger', () => {
    const c = computeRow(row({ qty: 30.45, quaryRate: 610, crusherRate: 900, rentRate: 220 }));
    expect(c.crusherAmount).toBeCloseTo(27405, 2);
    expect(c.quaryAmount).toBe(18570); // round10(18574.5)
    expect(c.vehicleTon).toBeCloseTo(30.45, 2);
    expect(c.vehicleRent).toBeCloseTo(6699, 2);
    expect(c.profit).toBeCloseTo(2136, 2);
    expect(c.discountQty).toBeCloseTo(30.45, 2);
    expect(c.discount).toBeCloseTo(609, 2);
  });

  it('zeroes vehicleTon and rent when there is no rent rate (own / crusher vehicle)', () => {
    const c = computeRow(row({ qty: 32, rentRate: 0 }));
    expect(c.vehicleTon).toBe(0);
    expect(c.vehicleRent).toBe(0);
    // Profit is then just crusherAmount − quaryAmount.
    expect(c.profit).toBeCloseTo(c.crusherAmount - c.quaryAmount, 2);
  });

  it('zeroes the discount when commRate is 0', () => {
    const c = computeRow(row({ qty: 32, commRate: 0 }));
    expect(c.discountQty).toBe(0);
    expect(c.discount).toBe(0);
  });

  it('produces a negative profit when the crusher rate does not cover costs', () => {
    const c = computeRow(row({ qty: 30, crusherRate: 600, quaryRate: 650, rentRate: 100 }));
    expect(c.profit).toBeLessThan(0);
  });

  it('ignores passType — the splits happen in aggregation, not per row', () => {
    const base = row({ passType: 'Pass' });
    expect(computeRow(base)).toEqual(computeRow({ ...base, passType: 'WO Pass' }));
    expect(computeRow(base)).toEqual(computeRow({ ...base, passType: null }));
  });

  it('treats missing or non-numeric fields as zero', () => {
    const c = computeRow(row({ qty: Number.NaN, rentRate: Number.NaN }));
    expect(c.crusherAmount).toBe(0);
    expect(c.quaryAmount).toBe(0);
    expect(c.vehicleRent).toBe(0);
    expect(c.profit).toBe(0);
  });

  it('carries the units-tie correction through to quaryAmount', () => {
    // The float shortfall above must not cost the quarry ₹10 on a real row.
    expect(computeRow(row({ qty: 2.3, quaryRate: 650 })).quaryAmount).toBe(1500);
  });

  it('does not mutate its input', () => {
    const input = row();
    const snapshot = { ...input };
    computeRow(input);
    expect(input).toEqual(snapshot);
  });
});
