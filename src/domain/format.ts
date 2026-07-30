/**
 * Display formatting only.
 *
 * Values are stored and summed unrounded; rounding to whole rupees happens
 * here and nowhere else. Never feed a formatted value back into a calculation.
 */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const TONS = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `₹1,23,456` — whole rupees, en-IN digit grouping. */
export function formatInr(value: number): string {
  return INR.format(Number.isFinite(value) ? value : 0);
}

/** `32.66 t` — tons to 2 dp. */
export function formatTons(value: number): string {
  return `${TONS.format(Number.isFinite(value) ? value : 0)} t`;
}

/** `29 Jul 2026` from an ISO 'YYYY-MM-DD'. Parsed as a plain calendar date (no TZ shift). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `Jul 2026` from a 'YYYY-MM' month key. */
export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
