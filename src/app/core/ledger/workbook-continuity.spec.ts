import { beforeAll, describe, expect, it } from 'vitest';
import type { Worksheet } from 'exceljs';
import { LedgerTransfer } from './ledger-transfer';
import { PartyLedgerTransfer } from './party-ledger-transfer';
import type { LedgerSnapshot } from './ledger-store';
import type { PartyLedgerSnapshot } from './party-ledger-store';
import ledgerRows from '@data/ledger-rows.json';
import rateChart from '@data/rate-chart.json';
import vehicles from '@data/vehicles.json';
import golden from '@data/golden-totals.json';
import partyRows from '@data/party-ledger-rows.json';
import partyRates from '@data/party-rates.json';
import partyVehicles from '@data/party-vehicles.json';
import partyGolden from '@data/party-golden-totals.json';
import { DEFAULT_SETTINGS } from '../../../domain/types';
import type { LedgerRow, RateChartEntry, Vehicle } from '../../../domain/types';
import type { PartyLedgerRow, PartyRateConfig } from '../../../domain/party/types';

/**
 * The continuity workbook: the exported `.xlsx` is not a snapshot, it is a
 * workbook the business can keep working in if the app goes away.
 *
 * Two properties make that true, and both are asserted here:
 *
 * 1. **Every derived cell is a live formula carrying a cached result.** The
 *    formula makes the sheet recalculate when a row is edited; the cached value
 *    makes it render correctly in viewers that do not recalculate on open
 *    (Google Sheets, Numbers, Excel mobile), where a formula-only cell shows
 *    blank and reads as a broken file.
 * 2. **Those cached values reproduce the golden totals exactly.** The goldens
 *    came from the customer's own workbook, so this is the round trip closing:
 *    workbook -> engine -> workbook. If Excel's own recalculation ever
 *    disagreed with what we cached, the engine and the contract would have
 *    diverged — and the same tolerance as the golden suites (±0.01, since the
 *    goldens record aggregates to 2 dp) applies.
 */

const SNAPSHOT: LedgerSnapshot = {
  rows: ledgerRows as LedgerRow[],
  rateChart: rateChart as RateChartEntry[],
  vehicles: vehicles as Vehicle[],
  settings: DEFAULT_SETTINGS,
};

const PARTY_SNAPSHOT: PartyLedgerSnapshot = {
  rows: partyRows as PartyLedgerRow[],
  rates: partyRates as PartyRateConfig[],
  vehicles: partyVehicles as Vehicle[],
};

beforeAll(() => {
  // jsdom lacks the blob-URL APIs the download helper touches.
  URL.createObjectURL ??= () => 'blob:test';
  URL.revokeObjectURL ??= () => undefined;
});

/** Same CJS/ESM interop shim the transfers use — see `loadExcelJs` there. */
async function workbookCtor(): Promise<new () => import('exceljs').Workbook> {
  const mod = (await import('exceljs')) as unknown as {
    Workbook: new () => import('exceljs').Workbook;
    default?: { Workbook: new () => import('exceljs').Workbook };
  };
  return mod.default?.Workbook ?? mod.Workbook;
}

/** A cell exceljs read back as a formula, with the value we cached into it. */
interface ReadFormula {
  formula?: string;
  result?: unknown;
}

function isFormula(value: unknown): value is ReadFormula {
  return typeof value === 'object' && value !== null && 'formula' in value;
}

/** The cached result of a formula cell, by its row label in column A. */
function labelled(sheet: Worksheet, label: string): number {
  let found: number | undefined;
  sheet.eachRow((row) => {
    if (String(row.getCell(1).value ?? '').trim() !== label) return;
    const cell = row.getCell(2).value;
    found = isFormula(cell) ? Number(cell.result) : Number(cell);
  });
  if (found === undefined) throw new Error(`no row labelled "${label}"`);
  return found;
}

/**
 * Every cached result present in the workbook must be a usable number.
 *
 * Note what this does NOT require: that every formula cell has a cached result
 * at all. **exceljs drops a cached result of exactly `0`** — it serialises the
 * formula with no `<v>` element — so a zero-valued derived cell comes back with
 * `result` undefined. Verified directly against the library, not inferred.
 *
 * That is left alone deliberately. Writing a literal `0` instead would restore
 * the cached value but kill the formula, and these cells exist to stay live: a
 * without-rent row whose rent is 0 today must still recalculate if someone
 * flips its With Rent flag in Excel. The visible cost is that such a cell shows
 * blank rather than `0` in a viewer that never recalculates, which in an
 * accounting sheet reads the same way.
 *
 * A non-zero value losing its cache is a real regression, and the golden
 * assertions below catch it: `labelled()` yields NaN for an uncached cell.
 */
function expectCachedResultsUsable(sheets: readonly Worksheet[]): void {
  const bad: string[] = [];
  for (const sheet of sheets) {
    sheet.eachRow((row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        if (!isFormula(cell.value)) return;
        const result = cell.value.result;
        if (result === undefined || result === null) return; // the zero case above
        if (typeof result !== 'number' || !Number.isFinite(result)) {
          bad.push(`${sheet.name}!${colNumber},${rowNumber} = ${String(result)}`);
        }
      });
    });
  }
  expect(bad).toEqual([]);
}

describe('daily continuity workbook', () => {
  it('reproduces the golden all-time totals in cached formula results', async () => {
    const transfer = new LedgerTransfer();
    const blob = await transfer.exportXlsx(SNAPSHOT, 'continuity-test.xlsx');

    const workbook = new (await workbookCtor())();
    await workbook.xlsx.load(await blob.arrayBuffer());

    const summary = workbook.getWorksheet('Summary');
    if (!summary) throw new Error('no Summary sheet');

    const all = golden.all_time;
    expect(labelled(summary, 'Qty (t)')).toBeCloseTo(all.qty, 2);
    expect(labelled(summary, 'Crusher Amount')).toBeCloseTo(all.crusherAmount, 2);
    expect(labelled(summary, 'Quary Amount')).toBeCloseTo(all.quaryAmount, 2);
    expect(labelled(summary, 'Vehicle Rent')).toBeCloseTo(all.vehicleRent, 2);
    expect(labelled(summary, 'Pass Qty (t)')).toBeCloseTo(all.passQty, 2);
    expect(labelled(summary, 'Pass Profit')).toBeCloseTo(all.passProfit, 2);
    expect(labelled(summary, 'WO Pass Qty (t)')).toBeCloseTo(all.woQty, 2);
    expect(labelled(summary, 'WO Pass Profit')).toBeCloseTo(all.woProfit, 2);
    expect(labelled(summary, 'Commission Qty (t)')).toBeCloseTo(all.discQty, 2);
    expect(labelled(summary, 'Commission')).toBeCloseTo(all.discount, 2);

    // Grand profit is not passProfit + woProfit: the one row with no pass type
    // counts towards the total but towards neither split. Encoded, not fixed.
    expect(labelled(summary, 'Profit')).toBeCloseTo(
      all.crusherAmount - all.quaryAmount - all.vehicleRent,
      2,
    );
    expect(all.passQty + all.woQty).toBeLessThan(all.qty);

    expectCachedResultsUsable(workbook.worksheets);
  }, 60_000);

  it('leaves the stored columns literal so the file still merge-imports', async () => {
    const transfer = new LedgerTransfer();
    const blob = await transfer.exportXlsx(SNAPSHOT, 'continuity-roundtrip.xlsx');
    const parsed = await transfer.parseXlsx(await blob.arrayBuffer());
    expect(parsed.rows).toEqual(SNAPSHOT.rows);
  }, 60_000);

  it('round-trips typed-over amounts, keeping absent distinct from zero', async () => {
    const transfer = new LedgerTransfer();
    const rows: LedgerRow[] = [
      // Settled to the rupee — unreachable from any rate, since round10 only
      // ever yields multiples of 10.
      { ...SNAPSHOT.rows[0], id: 'ov1', qty: 29.02, quaryRate: 610, quaryAmountOverride: 17702 },
      // A trip where no rent was paid despite a rate being on file.
      { ...SNAPSHOT.rows[1], id: 'ov2', rentRate: 220, vehicleRentOverride: 0 },
      // No overrides at all: the keys must come back ABSENT, not as 0.
      { ...SNAPSHOT.rows[2], id: 'ov3' },
    ];
    const blob = await transfer.exportXlsx({ ...SNAPSHOT, rows }, 'continuity-override.xlsx');
    const parsed = await transfer.parseXlsx(await blob.arrayBuffer());

    expect(parsed.rows).toEqual(rows);
    expect(parsed.rows?.[1].vehicleRentOverride).toBe(0);
    expect('quaryAmountOverride' in (parsed.rows?.[2] ?? {})).toBe(false);
  }, 60_000);
});

describe('party continuity workbook', () => {
  it('reproduces the golden grand totals in cached formula results', async () => {
    const transfer = new PartyLedgerTransfer();
    const blob = await transfer.exportXlsx(PARTY_SNAPSHOT, 'party-continuity.xlsx');

    const workbook = new (await workbookCtor())();
    await workbook.xlsx.load(await blob.arrayBuffer());

    const summary = workbook.getWorksheet('Party Summary');
    if (!summary) throw new Error('no Party Summary sheet');

    // The Total row is the last one; read its cached results across the columns.
    const totalRow = summary.getRow(summary.rowCount);
    const cell = (col: number) => {
      const value = totalRow.getCell(col).value;
      return isFormula(value) ? Number(value.result) : Number(value);
    };
    expect(String(totalRow.getCell(1).value)).toBe('Total');

    const all = partyGolden.all;
    expect(cell(2)).toBe(all.loads);
    expect(cell(3)).toBeCloseTo(all.qty, 2);
    expect(cell(4)).toBe(all.quarryPayable);
    expect(cell(5)).toBe(all.receivable);
    expect(cell(6)).toBe(all.rentPayable);
    expect(cell(7)).toBe(all.profitTotal);

    expectCachedResultsUsable(workbook.worksheets);
  }, 60_000);

  it('leaves the stored columns literal so the file still merge-imports', async () => {
    const transfer = new PartyLedgerTransfer();
    const blob = await transfer.exportXlsx(PARTY_SNAPSHOT, 'party-roundtrip.xlsx');
    const parsed = await transfer.parseXlsx(await blob.arrayBuffer());
    expect(parsed.rows).toEqual(PARTY_SNAPSHOT.rows);
  }, 60_000);
});
