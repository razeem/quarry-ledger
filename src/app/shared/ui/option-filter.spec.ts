import { describe, expect, it } from 'vitest';
import { filterOptions } from './option-filter';

const OPTIONS = ['Northgate Crusher', 'Riverside Crusher', 'Hillview Granites'];

describe('filterOptions', () => {
  it('shows everything when empty', () => {
    expect(filterOptions(OPTIONS, '')).toEqual(OPTIONS);
    expect(filterOptions(OPTIONS, '   ')).toEqual(OPTIONS);
  });

  it('filters by case-insensitive substring while typing', () => {
    expect(filterOptions(OPTIONS, 'crush')).toEqual(['Northgate Crusher', 'Riverside Crusher']);
    expect(filterOptions(OPTIONS, 'RIVER')).toEqual(['Riverside Crusher']);
  });

  it('reopens with EVERY option once a value is fully chosen', () => {
    // The datalist bug this exists to fix: a chosen value must not trap the
    // dropdown into showing only itself.
    expect(filterOptions(OPTIONS, 'Riverside Crusher')).toEqual(OPTIONS);
    expect(filterOptions(OPTIONS, 'riverside crusher')).toEqual(OPTIONS);
  });

  it('never mutates or normalises the option strings', () => {
    const quirky = ['KL00T5450', 'KL 00 T 5450', ' Ratheesh 8334'];
    expect(filterOptions(quirky, '5450')).toEqual(['KL00T5450', 'KL 00 T 5450']);
    // Matching is display-only; the quirky raw strings come back untouched.
    expect(filterOptions(quirky, 'ratheesh')).toEqual([' Ratheesh 8334']);
  });
});
