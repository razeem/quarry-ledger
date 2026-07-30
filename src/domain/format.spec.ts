import { describe, expect, it } from 'vitest';
import { formatDate, formatInr, formatMonth, formatTons } from './format';

/** Strip the non-breaking space Intl puts after the ₹ symbol so assertions read clearly. */
const plain = (s: string) => s.replace(/\u00a0/g, ' ');

describe('formatInr', () => {
  it('groups digits the Indian way and drops paise', () => {
    expect(plain(formatInr(123456))).toBe('₹1,23,456');
    expect(plain(formatInr(3062202.03))).toBe('₹30,62,202');
    expect(plain(formatInr(0))).toBe('₹0');
  });

  it('rounds for display only', () => {
    expect(plain(formatInr(1472.3))).toBe('₹1,472');
    expect(plain(formatInr(1472.6))).toBe('₹1,473');
  });

  it('renders negatives', () => {
    expect(plain(formatInr(-1500))).toContain('1,500');
  });

  it('renders non-finite input as zero rather than NaN', () => {
    expect(plain(formatInr(Number.NaN))).toBe('₹0');
  });
});

describe('formatTons', () => {
  it('shows two decimals with a unit', () => {
    expect(formatTons(32.66)).toBe('32.66 t');
    expect(formatTons(956.18)).toBe('956.18 t');
    expect(formatTons(0)).toBe('0.00 t');
  });

  it('rounds a 3 dp seed quantity for display without changing the stored value', () => {
    expect(formatTons(33.375)).toBe('33.38 t');
  });

  it('renders non-finite input as zero', () => {
    expect(formatTons(Number.NaN)).toBe('0.00 t');
  });
});

describe('formatDate', () => {
  it('formats an ISO date as a plain calendar date', () => {
    expect(formatDate('2026-07-29')).toBe('29 Jul 2026');
    expect(formatDate('2025-11-14')).toBe('14 Nov 2025');
  });

  it('does not shift the day across time zones', () => {
    // A naive `new Date('2026-01-01')` renders as 31 Dec west of UTC.
    expect(formatDate('2026-01-01')).toBe('01 Jan 2026');
  });

  it('passes malformed input straight through', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatMonth', () => {
  it('formats a YYYY-MM key', () => {
    expect(formatMonth('2026-07')).toBe('Jul 2026');
    expect(formatMonth('2025-11')).toBe('Nov 2025');
  });

  it('passes malformed input straight through', () => {
    expect(formatMonth('nope')).toBe('nope');
  });
});
