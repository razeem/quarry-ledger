import { describe, expect, it } from 'vitest';
import { computePartyRow, round0, sumRounded } from './calc';
import type { PartyLedgerRow } from './types';

describe('round0 — Excel ROUND(x, 0)', () => {
  it('rounds to the nearest rupee', () => {
    expect(round0(17228.8)).toBe(17229);
    expect(round0(5247.9)).toBe(5248);
    expect(round0(6565.6)).toBe(6566);
    expect(round0(12814.2)).toBe(12814);
  });

  it('rounds halves away from zero, both signs', () => {
    expect(round0(246933.5)).toBe(246934);
    expect(round0(0.5)).toBe(1);
    expect(round0(-0.5)).toBe(-1);
    expect(round0(-122.5)).toBe(-123); // Math.round would give -122
  });

  it('survives IEEE-754 ties landing a hair off the decimal value', () => {
    // 290.51 × 850 is exactly 246 933.5 in decimal; the double happens to land
    // on it here, but the epsilon nudge is what guarantees the away-from-zero
    // result for products that land a hair below (same trap as round10).
    // Route through Number() so the bundler cannot constant-fold the product.
    const qty = Number('290.51');
    expect(round0(qty * 850)).toBe(246934);
    const q2 = Number('24.99');
    expect(round0(q2 * 210)).toBe(5248); // product is 5247.8999999999996
  });

  it('treats non-finite input as 0', () => {
    expect(round0(NaN)).toBe(0);
    expect(round0(Infinity)).toBe(0);
  });
});

describe('sumRounded — the workbook aggregate rounding', () => {
  it('rounds once over the summed tonnage, not per row', () => {
    // 30.28 + 30.74 = 61.02 t at ₹210 → ROUND(12 814.2) = 12 814.
    // Per-row rounding would give 6 359 + 6 455 = 12 814 here, but the contract
    // is Excel's ROUND(SUMIFS(...) × rate): one rounding of the aggregate.
    expect(
      sumRounded([
        { qty: 30.28, rate: 210 },
        { qty: 30.74, rate: 210 },
      ]),
    ).toBe(12814);
  });

  it('rounds each distinct rate group separately', () => {
    // Two snapshot rates coexist after a config change — each rounds alone,
    // exactly as two Excel SUMIFS lines would.
    expect(
      sumRounded([
        { qty: 10.24, rate: 850 },
        { qty: 10.24, rate: 640 },
      ]),
    ).toBe(round0(10.24 * 850) + round0(10.24 * 640));
  });

  it('ignores zero rates and missing quantities', () => {
    expect(
      sumRounded([
        { qty: 11.32, rate: 0 },
        { qty: Number.NaN, rate: 850 },
      ]),
    ).toBe(0);
  });
});

describe('computePartyRow', () => {
  const base: PartyLedgerRow = {
    id: 'test',
    date: '2025-10-20',
    party: 'Lakeside Crushers',
    item: 'Rock',
    vehicle: 'KL 00 AS 7477',
    owner: 'Sooraj',
    qty: 30.28,
    withRent: true,
    quaryRate: 580,
    billRate: 850,
    rentRate: 210,
    profitShares: [
      { name: 'Owner', perTon: 40 },
      { name: 'Adjust', perTon: 20 },
    ],
  };

  it('rounds only the quarry amount per row', () => {
    const c = computePartyRow(base);
    expect(c.quarryAmount).toBe(17562); // ROUND(30.28 × 580) — matches the sheet cell
    expect(c.billAmount).toBeCloseTo(30.28 * 850, 6); // unrounded
    expect(c.rentAmount).toBeCloseTo(30.28 * 210, 6);
    expect(c.profitAmount).toBeCloseTo(30.28 * 60, 6);
  });

  it('drops rent on a without-rent row even if a rate is present', () => {
    const c = computePartyRow({ ...base, withRent: false, rentRate: 210 });
    expect(c.rentAmount).toBe(0);
  });

  it('handles an empty profit split', () => {
    const c = computePartyRow({ ...base, profitShares: [] });
    expect(c.profitAmount).toBe(0);
  });
});
