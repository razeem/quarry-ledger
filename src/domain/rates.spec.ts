import { describe, expect, it } from 'vitest';
import {
  crusherNames,
  findRate,
  knownCrushers,
  knownVehicles,
  ratePrefill,
  vehicleOwner,
} from './rates';
import type { LedgerRow, RateChartEntry, Vehicle } from './types';

const CHART: RateChartEntry[] = [
  // MR Granites Pass runs at zero commission; the WO Pass entry predates the
  // `comm` column entirely, so it must fall back to the global discount rate.
  { crusher: 'MR Granites', type: 'Pass', quary: 650, rent: 0, crusherRate: 675, comm: 0 },
  { crusher: 'MR Granites', type: 'WO Pass', quary: 610, rent: 0, crusherRate: 675 },
  {
    crusher: 'Al Falah metal crusher',
    type: 'Pass',
    quary: 640,
    rent: 215,
    crusherRate: 870,
    comm: 20,
  },
  {
    crusher: 'Al Falah metal crusher',
    type: 'WO Pass',
    quary: 610,
    rent: 215,
    crusherRate: 870,
    comm: 20,
  },
];

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'r',
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

describe('findRate', () => {
  it('matches on crusher and pass type together', () => {
    expect(findRate(CHART, 'MR Granites', 'Pass')?.quary).toBe(650);
    expect(findRate(CHART, 'MR Granites', 'WO Pass')?.quary).toBe(610);
  });

  it('preserves the Al Falah Pass quirk of ₹640 rather than the usual ₹650', () => {
    expect(findRate(CHART, 'Al Falah metal crusher', 'Pass')?.quary).toBe(640);
  });

  it('matches crusher names exactly — no trimming or case folding', () => {
    expect(findRate(CHART, 'mr granites', 'Pass')).toBeUndefined();
    expect(findRate(CHART, ' MR Granites', 'Pass')).toBeUndefined();
  });

  it('returns undefined for an unknown crusher or a null pass type', () => {
    expect(findRate(CHART, 'Nobody', 'Pass')).toBeUndefined();
    expect(findRate(CHART, 'MR Granites', null)).toBeUndefined();
  });
});

describe('ratePrefill', () => {
  it('maps chart columns onto the four row rate fields', () => {
    expect(ratePrefill(CHART, 'Al Falah metal crusher', 'WO Pass', 20)).toEqual({
      quaryRate: 610,
      crusherRate: 870,
      rentRate: 215,
      commRate: 20,
    });
  });

  it('takes commRate from the chart entry when it has one', () => {
    // Several crushers genuinely run at zero commission — the chart, not the
    // global rate, is what knows that.
    expect(ratePrefill(CHART, 'MR Granites', 'Pass', 25)?.commRate).toBe(0);
    expect(ratePrefill(CHART, 'Al Falah metal crusher', 'Pass', 25)?.commRate).toBe(20);
  });

  it('falls back to the global discount rate when the entry has no comm', () => {
    // Charts written before the column existed, or imported from an older export.
    expect(ratePrefill(CHART, 'MR Granites', 'WO Pass', 25)?.commRate).toBe(25);
  });

  it('keeps a rent rate of 0 for crushers that supply their own vehicles', () => {
    expect(ratePrefill(CHART, 'MR Granites', 'Pass', 20)?.rentRate).toBe(0);
  });

  it('returns undefined on a miss so the form can leave its values alone', () => {
    expect(ratePrefill(CHART, 'Brand New Crusher', 'Pass', 20)).toBeUndefined();
  });
});

describe('crusherNames', () => {
  it('lists distinct crushers in first-seen order', () => {
    expect(crusherNames(CHART)).toEqual(['MR Granites', 'Al Falah metal crusher']);
  });

  it('is empty for an empty chart', () => {
    expect(crusherNames([])).toEqual([]);
  });
});

describe('vehicleOwner', () => {
  const vehicles: Vehicle[] = [
    { num: 'KL 21 U 5340', owner: 'Arun 5340' },
    { num: 'KI 40 Q 3885', owner: 'Shibu' },
  ];

  it('looks up an owner by exact registration', () => {
    expect(vehicleOwner(vehicles, 'KL 21 U 5340')).toBe('Arun 5340');
  });

  it('returns an empty string when the registration is unknown', () => {
    // Missing owners are expected — registrations are messy free text.
    expect(vehicleOwner(vehicles, 'KL24 H 6714')).toBe('');
    expect(vehicleOwner(vehicles, '')).toBe('');
  });

  it('does not normalise the registration before matching', () => {
    expect(vehicleOwner(vehicles, 'KI40Q3885')).toBe('');
  });
});

describe('knownVehicles / knownCrushers', () => {
  it('includes registrations used on rows but missing from the vehicle list', () => {
    const vehicles: Vehicle[] = [{ num: 'KL 1', owner: 'A' }];
    const rows = [row({ vehicle: 'KL 2' }), row({ vehicle: 'KL 1' }), row({ vehicle: '' })];
    expect(knownVehicles(vehicles, rows)).toEqual(['KL 1', 'KL 2']);
  });

  it('includes crushers used on rows but missing from the chart', () => {
    const rows = [row({ crusher: 'AVK' }), row({ crusher: 'MR Granites' })];
    expect(knownCrushers(CHART, rows)).toEqual(['MR Granites', 'Al Falah metal crusher', 'AVK']);
  });

  it('never yields blanks or duplicates', () => {
    const rows = [row({ vehicle: '' }), row({ vehicle: 'KL 1' }), row({ vehicle: 'KL 1' })];
    expect(knownVehicles([{ num: 'KL 1', owner: 'A' }], rows)).toEqual(['KL 1']);
  });
});
