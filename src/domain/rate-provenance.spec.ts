import { describe, expect, it } from 'vitest';
import {
  baselineOf,
  computeRatesFrom,
  formatRatesFrom,
  parseRatesFrom,
  wasTypedOver,
  type RateProvenanceInput,
} from './rate-provenance';

/** The chart rates the daily entry sheet would autofill for a crusher + pass. */
const CHART = { quaryRate: 650, crusherRate: 900, rentRate: 250, commRate: 20 };

/** Inputs for all four daily rate cells, autofilled from `CHART` unless overridden. */
function daily(values: Partial<typeof CHART>): RateProvenanceInput[] {
  return (Object.keys(CHART) as (keyof typeof CHART)[]).map((field) => ({
    field,
    value: values[field] ?? CHART[field],
    autofill: CHART[field],
  }));
}

describe('parseRatesFrom / formatRatesFrom', () => {
  it('round-trips a set of baselines', () => {
    const text = 'quaryRate:650;rentRate:250';
    expect(formatRatesFrom(parseRatesFrom(text))).toBe(text);
  });

  it('reads absent, empty and blank as no provenance at all', () => {
    for (const input of [undefined, null, '']) {
      expect(parseRatesFrom(input).size).toBe(0);
    }
    expect(formatRatesFrom(new Map())).toBeUndefined();
  });

  it('writes keys in a canonical order whatever order they arrived in', () => {
    const forwards = new Map([
      ['quaryRate', 650],
      ['commRate', 20],
    ]);
    const backwards = new Map([
      ['commRate', 20],
      ['quaryRate', 650],
    ]);
    // Two devices recording the same edits must produce the same string, or the
    // last-write-wins tie-break cannot agree on a winner.
    expect(formatRatesFrom(forwards)).toBe(formatRatesFrom(backwards));
    expect(formatRatesFrom(forwards)).toBe('commRate:20;quaryRate:650');
  });

  it('carries an empty value as a null baseline — typed with nothing to compare', () => {
    const parsed = parseRatesFrom('quaryRate:');
    expect(parsed.get('quaryRate')).toBeNull();
    expect(formatRatesFrom(parsed)).toBe('quaryRate:');
    // Distinct from a baseline of zero, which is a real rate someone moved off.
    expect(parseRatesFrom('quaryRate:0').get('quaryRate')).toBe(0);
  });

  it('ignores unreadable pairs rather than throwing on a hand-edited cell', () => {
    // The workbook cell is user-editable, so this must degrade, not fail.
    const parsed = parseRatesFrom('quaryRate:650;nonsense;:900;rentRate:abc');
    expect([...parsed.keys()]).toEqual(['quaryRate']);
  });

  it('exposes single-field lookups', () => {
    expect(baselineOf('quaryRate:650', 'quaryRate')).toBe(650);
    expect(baselineOf('quaryRate:650', 'rentRate')).toBeUndefined();
    expect(wasTypedOver('quaryRate:650', 'quaryRate')).toBe(true);
    expect(wasTypedOver(undefined, 'quaryRate')).toBe(false);
  });
});

describe('computeRatesFrom', () => {
  it('records nothing when every cell matches the chart', () => {
    expect(computeRatesFrom(undefined, daily({}))).toBeUndefined();
  });

  it('records the chart value for each cell typed over', () => {
    const result = computeRatesFrom(undefined, daily({ quaryRate: 675, rentRate: 280 }));
    expect(result).toBe('quaryRate:650;rentRate:250');
  });

  it('treats typing the autofilled value as agreement, not an override', () => {
    // Same rule as the settled amounts: pinning a value the user did not mean to
    // pin would freeze the row against a later correction.
    expect(computeRatesFrom(undefined, daily({ quaryRate: 650 }))).toBeUndefined();
  });

  it('keeps the original baseline when the cell is edited again', () => {
    const first = computeRatesFrom(undefined, daily({ quaryRate: 675 }));
    const second = computeRatesFrom(first, daily({ quaryRate: 690 }));
    // 650 is what it was typed over FROM — not the intermediate 675.
    expect(second).toBe('quaryRate:650');
  });

  it('drops the entry when the cell is typed back to its baseline', () => {
    const edited = computeRatesFrom(undefined, daily({ quaryRate: 675 }));
    expect(computeRatesFrom(edited, daily({ quaryRate: 650 }))).toBeUndefined();
  });

  /**
   * The scenario this field exists for. The chart moves; the untouched row must
   * not start claiming it was edited, and the edited row must not start claiming
   * it was automatic.
   */
  it('survives the chart moving to the value a row was typed to', () => {
    const untouched = computeRatesFrom(undefined, daily({}));
    const typedOver = computeRatesFrom(undefined, daily({ quaryRate: 675 }));

    // Next month the chart itself becomes 675.
    const moved: typeof CHART = { ...CHART, quaryRate: 675 };
    const rebuild = (row: string | undefined, value: number) =>
      computeRatesFrom(
        row,
        (Object.keys(moved) as (keyof typeof moved)[]).map((field) => ({
          field,
          value: field === 'quaryRate' ? value : moved[field],
          autofill: moved[field],
        })),
      );

    expect(rebuild(untouched, 650)).toBe('quaryRate:675');
    expect(rebuild(typedOver, 675)).toBe('quaryRate:650');
  });

  it('records a null baseline when there is no chart entry to compare', () => {
    const noChart: RateProvenanceInput[] = [
      { field: 'quaryRate', value: 675, autofill: null },
      { field: 'rentRate', value: 0, autofill: null },
    ];
    // The typed cell is flagged with no delta claimed; the untouched one is not.
    expect(computeRatesFrom(undefined, noChart)).toBe('quaryRate:');
  });

  it('leaves provenance for fields the caller did not look at', () => {
    // A party sheet patching only its own rate cells must not wipe a daily one,
    // and a partial patch must not drop what it never inspected.
    const existing = 'billRate:850;quaryRate:650';
    const result = computeRatesFrom(existing, [
      { field: 'quaryRate', value: 650, autofill: 650 },
    ]);
    expect(result).toBe('billRate:850');
  });
});
