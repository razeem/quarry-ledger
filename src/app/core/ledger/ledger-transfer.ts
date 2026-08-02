import { Injectable } from '@angular/core';
import type { Workbook } from 'exceljs';
import type {
  LedgerRow,
  LedgerSettings,
  PassType,
  RateChartEntry,
  Vehicle,
} from '../../../domain/types';
import { DEFAULT_SETTINGS } from '../../../domain/types';
import { computeRow } from '../../../domain/calc';
import { summarize } from '../../../domain/summaries';
import { crusherReport, monthlyReport } from '../../../domain/reports';
import { colRange, criterion, formulaCell, overRows } from './workbook-formulas';
import type { LedgerSnapshot } from './ledger-store';

/**
 * Export and import for the whole ledger: `.xlsx` for humans, `.json` for exact
 * backups, and parsing of both back into a `LedgerSnapshot` for merge-import.
 *
 * The `id` column is exported on every row and read back on import — it is the
 * merge key, so a round trip must preserve it byte for byte.
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const SHEET_LEDGER = 'Daily Ledger';
const SHEET_RATES = 'Rate Chart';
const SHEET_VEHICLES = 'Vehicles';
const SHEET_SUMMARY = 'Summary';
const SHEET_BY_CRUSHER = 'By Crusher';
const SHEET_BY_MONTH = 'By Month';

/**
 * Column order of the Daily Ledger sheet. `id` comes first so it is never lost.
 *
 * Columns A–N are the stored row and stay **literal** — they are what
 * `parseXlsx` reads back, so a formula here would break the round trip. The
 * derived columns O–U are appended after them as live formulas.
 */
const LEDGER_COLUMNS = [
  { header: 'id', key: 'id', width: 16 },
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Item', key: 'item', width: 10 },
  { header: 'Crusher', key: 'crusher', width: 26 },
  { header: 'Pass Type', key: 'passType', width: 11 },
  { header: 'Qty (t)', key: 'qty', width: 10 },
  { header: 'Quary Rate', key: 'quaryRate', width: 12 },
  { header: 'Crusher Rate', key: 'crusherRate', width: 13 },
  { header: 'Rent Rate', key: 'rentRate', width: 11 },
  { header: 'Comm Rate', key: 'commRate', width: 11 },
  { header: 'Vehicle', key: 'vehicle', width: 18 },
  // Typed-over amounts. STORED, not derived: blank means "use the formula".
  { header: 'Quary Amount Override', key: 'quaryAmountOverride', width: 20 },
  { header: 'Vehicle Rent Override', key: 'vehicleRentOverride', width: 20 },
  // Which rates were typed over and what the chart said first, as
  // `quaryRate:650;rentRate:250`. STORED provenance — nothing computes from it,
  // and blank means every rate matched the chart when the row was entered.
  { header: 'Rate Changes', key: 'ratesFrom', width: 26 },
  // --- derived, written as formulas over the columns above -------------------
  { header: 'Crusher Amount', key: 'crusherAmount', width: 15 },
  { header: 'Quary Amount', key: 'quaryAmount', width: 14 },
  { header: 'Vehicle Ton', key: 'vehicleTon', width: 12 },
  { header: 'Vehicle Rent', key: 'vehicleRent', width: 13 },
  { header: 'Profit', key: 'profit', width: 13 },
  { header: 'Comm Qty', key: 'discountQty', width: 11 },
  { header: 'Commission', key: 'discount', width: 12 },
] as const;

/** Column letters of the Daily Ledger sheet, by meaning. */
const L = {
  id: 'A',
  date: 'B',
  crusher: 'D',
  passType: 'E',
  qty: 'F',
  quaryRate: 'G',
  crusherRate: 'H',
  rentRate: 'I',
  commRate: 'J',
  vehicle: 'K',
  quaryOverride: 'L',
  rentOverride: 'M',
  ratesFrom: 'N',
  crusherAmount: 'O',
  quaryAmount: 'P',
  vehicleTon: 'Q',
  vehicleRent: 'R',
  profit: 'S',
  discountQty: 'T',
  discount: 'U',
} as const;

interface ExcelJsModule {
  Workbook: new () => Workbook;
}

/**
 * exceljs is CommonJS; depending on the bundler's interop its constructor is
 * exposed either as a named export (dev) or under `.default` (prod/minified).
 * Normalise both so `new Workbook()` works in every build. It is dynamically
 * imported so its ~950 kB stays out of the initial bundle.
 */
async function loadExcelJs(): Promise<ExcelJsModule> {
  const mod = (await import('exceljs')) as unknown as ExcelJsModule & {
    default?: ExcelJsModule;
  };
  return mod.default ?? mod;
}

/** Coerce a spreadsheet cell to a number, tolerating '', null and text. */
function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Coerce a cell to a trimmed string. Business keys keep their internal spacing. */
function str(value: unknown): string {
  if (value == null) return '';
  // exceljs may hand back a rich-text or formula object rather than a primitive.
  if (typeof value === 'object') {
    const cell = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(cell.richText))
      return cell.richText
        .map((r) => r.text)
        .join('')
        .trim();
    if (cell.text != null) return String(cell.text).trim();
    if (cell.result != null) return String(cell.result).trim();
    return '';
  }
  return String(value).trim();
}

/**
 * Normalise a date cell to ISO 'YYYY-MM-DD'.
 *
 * Excel hands dates back as `Date` objects in UTC; formatting them with local
 * getters would shift the day for anyone east or west of UTC, so read UTC parts.
 */
function isoDate(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = str(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : text;
}

/** Map a pass-type cell onto the domain type; anything unrecognised becomes null. */
function passType(value: unknown): PassType | null {
  const text = str(value);
  if (text === 'Pass') return 'Pass';
  if (text === 'WO Pass') return 'WO Pass';
  return null;
}

@Injectable({ providedIn: 'root' })
export class LedgerTransfer {
  // --- Export -------------------------------------------------------------

  /**
   * Build and download the working workbook: the ledger with live derived
   * columns, its reference sheets, and formula-driven summaries.
   *
   * Tombstoned rows are left out — a deleted load is not part of the accounts.
   * Returns the blob for tests.
   */
  async exportXlsx(snapshot: LedgerSnapshot, fileName = defaultName('xlsx')): Promise<Blob> {
    const { Workbook } = await loadExcelJs();
    const workbook = new Workbook();
    workbook.creator = 'Quarry Ledger';

    const rows = snapshot.rows.filter((row) => !row.deleted);
    const last = rows.length + 1; // 1-based, row 1 is the header

    const ledger = workbook.addWorksheet(SHEET_LEDGER);
    ledger.columns = LEDGER_COLUMNS.map((c) => ({ ...c }));
    rows.forEach((row, index) => {
      const r = index + 2;
      const c = computeRow(row);
      ledger.addRow({
        ...row,
        // A null passType must round-trip as an empty cell, not the text 'null'.
        passType: row.passType ?? '',
        // Mirrors `computeRow` cell for cell — see src/domain/calc.ts.
        // Blank override cell => the formula applies; type a number in and it
        // wins. Editing the override in Excel recalculates the row, exactly as
        // it does in the app.
        quaryAmountOverride: row.quaryAmountOverride ?? null,
        vehicleRentOverride: row.vehicleRentOverride ?? null,
        ratesFrom: row.ratesFrom ?? null,
        crusherAmount: formulaCell(`${L.qty}${r}*${L.crusherRate}${r}`, c.crusherAmount),
        quaryAmount: formulaCell(
          `IF(${L.quaryOverride}${r}="",ROUND(${L.qty}${r}*${L.quaryRate}${r},-1),` +
            `${L.quaryOverride}${r})`,
          c.quaryAmount,
        ),
        vehicleTon: formulaCell(
          `IF(${L.rentRate}${r}>0,${L.qty}${r},0)`,
          c.vehicleTon,
        ),
        vehicleRent: formulaCell(
          `IF(${L.rentOverride}${r}="",${L.vehicleTon}${r}*${L.rentRate}${r},` +
            `${L.rentOverride}${r})`,
          c.vehicleRent,
        ),
        profit: formulaCell(
          `${L.crusherAmount}${r}-${L.quaryAmount}${r}-${L.vehicleRent}${r}`,
          c.profit,
        ),
        discountQty: formulaCell(
          `IF(${L.commRate}${r}>0,${L.qty}${r},0)`,
          c.discountQty,
        ),
        discount: formulaCell(
          `IF(${L.commRate}${r}>0,${L.qty}${r}*${L.commRate}${r},0)`,
          c.discount,
        ),
      });
    });

    this.addSummarySheet(workbook, rows, last);
    this.addCrusherSheet(workbook, rows, last);
    this.addMonthSheet(workbook, rows, last);

    const rates = workbook.addWorksheet(SHEET_RATES);
    rates.columns = [
      { header: 'Crusher', key: 'crusher', width: 26 },
      { header: 'Pass Type', key: 'type', width: 11 },
      { header: 'Quary Rate', key: 'quary', width: 12 },
      { header: 'Rent Rate', key: 'rent', width: 11 },
      { header: 'Crusher Rate', key: 'crusherRate', width: 13 },
      { header: 'Comm Rate', key: 'comm', width: 11 },
    ];
    for (const entry of snapshot.rateChart) rates.addRow(entry);

    const vehicles = workbook.addWorksheet(SHEET_VEHICLES);
    vehicles.columns = [
      { header: 'Vehicle', key: 'num', width: 18 },
      { header: 'Owner', key: 'owner', width: 24 },
    ];
    for (const vehicle of snapshot.vehicles) vehicles.addRow(vehicle);

    for (const sheet of workbook.worksheets) {
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: XLSX_MIME });
    download(blob, fileName);
    return blob;
  }

  /**
   * All-time totals, every figure a live formula over the ledger sheet.
   *
   * The Pass / WO Pass splits use `SUMIF` on the pass-type column, which
   * reproduces a real property of the data rather than hiding it: a row whose
   * pass type is blank counts towards qty and profit but towards neither split,
   * so `Pass Qty + WO Pass Qty` is legitimately less than `Qty`. The note row at
   * the bottom says so, because it otherwise reads as a broken sum.
   */
  private addSummarySheet(workbook: Workbook, rows: readonly LedgerRow[], last: number): void {
    const total = summarize(rows);
    const sheet = workbook.addWorksheet(SHEET_SUMMARY);
    sheet.columns = [
      { header: 'Figure', key: 'label', width: 24 },
      { header: 'Value', key: 'value', width: 18 },
    ];

    const sum = (column: string, result: number) =>
      overRows(rows.length, () =>
        formulaCell(`SUM(${colRange(SHEET_LEDGER, column, 2, last)})`, result),
      );
    const sumIf = (pass: string, column: string, result: number) =>
      overRows(rows.length, () =>
        formulaCell(
          `SUMIF(${colRange(SHEET_LEDGER, L.passType, 2, last)},${criterion(pass)},` +
            `${colRange(SHEET_LEDGER, column, 2, last)})`,
          result,
        ),
      );

    sheet.addRow({
      label: 'Loads',
      value: overRows(rows.length, () =>
        formulaCell(`COUNTA(${colRange(SHEET_LEDGER, L.id, 2, last)})`, total.loads),
      ),
    });
    sheet.addRow({ label: 'Qty (t)', value: sum(L.qty, total.qty) });
    sheet.addRow({ label: 'Crusher Amount', value: sum(L.crusherAmount, total.crusherAmount) });
    sheet.addRow({ label: 'Quary Amount', value: sum(L.quaryAmount, total.quaryAmount) });
    sheet.addRow({ label: 'Vehicle Rent', value: sum(L.vehicleRent, total.vehicleRent) });
    sheet.addRow({ label: 'Profit', value: sum(L.profit, total.profit) });
    sheet.addRow({ label: 'Pass Qty (t)', value: sumIf('Pass', L.qty, total.passQty) });
    sheet.addRow({ label: 'Pass Profit', value: sumIf('Pass', L.profit, total.passProfit) });
    sheet.addRow({ label: 'WO Pass Qty (t)', value: sumIf('WO Pass', L.qty, total.woQty) });
    sheet.addRow({ label: 'WO Pass Profit', value: sumIf('WO Pass', L.profit, total.woProfit) });
    sheet.addRow({ label: 'Commission Qty (t)', value: sum(L.discountQty, total.discQty) });
    sheet.addRow({ label: 'Commission', value: sum(L.discount, total.discount) });
    sheet.addRow({});
    sheet.addRow({
      label:
        'Note: loads with no pass type count towards Qty and Profit but towards ' +
        'neither split, so the two splits need not add up to the totals above.',
    });
  }

  /** All-time totals per crusher, most profitable first — live `SUMIF` formulas. */
  private addCrusherSheet(workbook: Workbook, rows: readonly LedgerRow[], last: number): void {
    const sheet = workbook.addWorksheet(SHEET_BY_CRUSHER);
    sheet.columns = [
      { header: 'Crusher', key: 'crusher', width: 26 },
      { header: 'Loads', key: 'loads', width: 9 },
      { header: 'Qty (t)', key: 'qty', width: 11 },
      { header: 'Crusher Amount', key: 'crusherAmount', width: 15 },
      { header: 'Quary Amount', key: 'quaryAmount', width: 14 },
      { header: 'Vehicle Rent', key: 'vehicleRent', width: 13 },
      { header: 'Profit', key: 'profit', width: 13 },
    ];

    const key = colRange(SHEET_LEDGER, L.crusher, 2, last);
    crusherReport(rows).forEach((line, index) => {
      const r = index + 2;
      const sumIf = (column: string, result: number) =>
        formulaCell(`SUMIF(${key},$A${r},${colRange(SHEET_LEDGER, column, 2, last)})`, result);
      sheet.addRow({
        crusher: line.crusher,
        loads: formulaCell(`COUNTIF(${key},$A${r})`, line.loads),
        qty: sumIf(L.qty, line.qty),
        crusherAmount: sumIf(L.crusherAmount, line.crusherAmount),
        quaryAmount: sumIf(L.quaryAmount, line.quaryAmount),
        vehicleRent: sumIf(L.vehicleRent, line.vehicleRent),
        profit: sumIf(L.profit, line.profit),
      });
    });
  }

  /**
   * Per-month totals, most recent first.
   *
   * Dates are written as ISO text, so a month matches with the `"2025-11*"`
   * wildcard rather than a date-range comparison — which also means the formula
   * keeps working if someone types a new date in by hand.
   */
  private addMonthSheet(workbook: Workbook, rows: readonly LedgerRow[], last: number): void {
    const sheet = workbook.addWorksheet(SHEET_BY_MONTH);
    sheet.columns = [
      { header: 'Month', key: 'month', width: 12 },
      { header: 'Loads', key: 'loads', width: 9 },
      { header: 'Qty (t)', key: 'qty', width: 11 },
      { header: 'Commission Qty (t)', key: 'discountQty', width: 17 },
      { header: 'Commission', key: 'discount', width: 13 },
      { header: 'Profit', key: 'profit', width: 13 },
    ];

    const key = colRange(SHEET_LEDGER, L.date, 2, last);
    monthlyReport(rows).forEach((line, index) => {
      const r = index + 2;
      const sumIf = (column: string, result: number) =>
        formulaCell(
          `SUMIF(${key},$A${r}&"*",${colRange(SHEET_LEDGER, column, 2, last)})`,
          result,
        );
      sheet.addRow({
        month: line.month,
        loads: formulaCell(`COUNTIF(${key},$A${r}&"*")`, line.loads),
        qty: sumIf(L.qty, line.qty),
        discountQty: sumIf(L.discountQty, line.discountQty),
        discount: sumIf(L.discount, line.discount),
        profit: sumIf(L.profit, line.profit),
      });
    });
  }

  /** Download an exact JSON backup (the restore path reproduces it verbatim). */
  exportJson(snapshot: LedgerSnapshot, fileName = defaultName('json')): Blob {
    const payload = {
      app: 'quarry-ledger',
      schema: 1,
      exportedAt: new Date().toISOString(),
      ...snapshot,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    download(blob, fileName);
    return blob;
  }

  // --- Import -------------------------------------------------------------

  /** Parse a `.json` or `.xlsx` file into a snapshot ready for merge or restore. */
  async parseFile(file: File): Promise<Partial<LedgerSnapshot>> {
    if (/\.json$/i.test(file.name)) return this.parseJson(await file.text());
    if (/\.xlsx$/i.test(file.name)) return this.parseXlsx(await file.arrayBuffer());
    throw new Error('Unsupported file — choose a .xlsx or .json export.');
  }

  parseJson(text: string): Partial<LedgerSnapshot> {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('That file is not a Quarry Ledger backup.');
    }
    const doc = parsed as Record<string, unknown>;
    // Accept both a wrapped backup and a bare array of rows.
    const rawRows = Array.isArray(doc['rows'])
      ? doc['rows']
      : Array.isArray(parsed)
        ? (parsed as unknown[])
        : [];

    return {
      rows: (rawRows as Record<string, unknown>[]).map(normaliseRow).filter((r) => r.id !== ''),
      rateChart: Array.isArray(doc['rateChart'])
        ? (doc['rateChart'] as Record<string, unknown>[]).map(normaliseRate)
        : undefined,
      vehicles: Array.isArray(doc['vehicles'])
        ? (doc['vehicles'] as Record<string, unknown>[]).map(normaliseVehicle)
        : undefined,
      settings: normaliseSettings(doc['settings']),
      // Staged entry-sheet rows; absent from backups made before drafts existed.
      drafts: Array.isArray(doc['drafts'])
        ? (doc['drafts'] as Record<string, unknown>[]).map(normaliseRow).filter((r) => r.id !== '')
        : undefined,
    };
  }

  async parseXlsx(buffer: ArrayBuffer): Promise<Partial<LedgerSnapshot>> {
    const { Workbook } = await loadExcelJs();
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer);

    const rows: LedgerRow[] = [];
    const ledger = workbook.getWorksheet(SHEET_LEDGER) ?? workbook.worksheets[0];
    if (ledger) {
      const headers = headerIndex(ledger);
      ledger.eachRow((sheetRow, rowNumber) => {
        if (rowNumber === 1) return; // header
        const cell = (name: string) => {
          const at = headers.get(name.toLowerCase());
          return at ? sheetRow.getCell(at).value : undefined;
        };
        const id = str(cell('id'));
        if (!id) return; // no merge key — skip rather than invent one
        rows.push({
          id,
          date: isoDate(cell('date')),
          item: str(cell('item')) || 'Rock',
          crusher: str(cell('crusher')),
          passType: passType(cell('pass type')),
          qty: num(cell('qty (t)') ?? cell('qty')),
          quaryRate: num(cell('quary rate')),
          crusherRate: num(cell('crusher rate')),
          rentRate: num(cell('rent rate')),
          commRate: num(cell('comm rate')),
          vehicle: str(cell('vehicle')),
          // Blank means "no override" and must stay absent, not become 0 —
          // a 0 override is a real instruction to settle at nothing.
          ...optionalNum('quaryAmountOverride', cell('quary amount override')),
          ...optionalNum('vehicleRentOverride', cell('vehicle rent override')),
          ...optionalStr('ratesFrom', cell('rate changes')),
        });
      });
    }

    const rateSheet = workbook.getWorksheet(SHEET_RATES);
    const rateChart: RateChartEntry[] = [];
    if (rateSheet) {
      const headers = headerIndex(rateSheet);
      rateSheet.eachRow((sheetRow, rowNumber) => {
        if (rowNumber === 1) return;
        const cell = (name: string) => {
          const at = headers.get(name.toLowerCase());
          return at ? sheetRow.getCell(at).value : undefined;
        };
        const crusher = str(cell('crusher'));
        const type = passType(cell('pass type'));
        if (!crusher || !type) return;
        const comm = cell('comm rate');
        rateChart.push({
          crusher,
          type,
          quary: num(cell('quary rate')),
          rent: num(cell('rent rate')),
          crusherRate: num(cell('crusher rate')),
          // Absent in exports predating the column — leave it undefined so the
          // global discount rate keeps applying rather than forcing a 0.
          ...(str(comm) === '' ? {} : { comm: num(comm) }),
        });
      });
    }

    const vehicleSheet = workbook.getWorksheet(SHEET_VEHICLES);
    const vehicles: Vehicle[] = [];
    if (vehicleSheet) {
      const headers = headerIndex(vehicleSheet);
      vehicleSheet.eachRow((sheetRow, rowNumber) => {
        if (rowNumber === 1) return;
        const cell = (name: string) => {
          const at = headers.get(name.toLowerCase());
          return at ? sheetRow.getCell(at).value : undefined;
        };
        const numPlate = str(cell('vehicle'));
        if (!numPlate) return;
        vehicles.push({ num: numPlate, owner: str(cell('owner')) });
      });
    }

    return {
      rows,
      rateChart: rateChart.length ? rateChart : undefined,
      vehicles: vehicles.length ? vehicles : undefined,
    };
  }
}

// --- helpers ---------------------------------------------------------------

/** Map lower-cased header text to its 1-based column index. */
function headerIndex(sheet: {
  getRow(n: number): { eachCell(cb: (cell: { value: unknown }, col: number) => void): void };
}): Map<string, number> {
  const index = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const key = str(cell.value).toLowerCase();
    if (key) index.set(key, col);
  });
  return index;
}

function normaliseRow(raw: Record<string, unknown>): LedgerRow {
  return {
    id: str(raw['id']),
    date: isoDate(raw['date']),
    item: str(raw['item']) || 'Rock',
    crusher: str(raw['crusher']),
    passType: passType(raw['passType']),
    qty: num(raw['qty']),
    quaryRate: num(raw['quaryRate']),
    crusherRate: num(raw['crusherRate']),
    rentRate: num(raw['rentRate']),
    commRate: num(raw['commRate']),
    vehicle: str(raw['vehicle']),
    ...optionalNum('quaryAmountOverride', raw['quaryAmountOverride']),
    ...optionalNum('vehicleRentOverride', raw['vehicleRentOverride']),
    ...optionalStr('ratesFrom', raw['ratesFrom']),
  };
}

/**
 * An optional text field, as a spreadable fragment.
 *
 * Blank means "nothing recorded" and must leave the key OFF the row: an empty
 * string would read as provenance that exists but says nothing, and would then
 * differ from an untouched row in the merge comparison.
 */
function optionalStr(key: 'ratesFrom', value: unknown): Partial<LedgerRow> {
  const text = str(value);
  return text === '' ? {} : { [key]: text };
}

/**
 * An optional numeric field, as a spreadable fragment.
 *
 * Absent and 0 mean different things for an override, so a blank cell must
 * leave the key OFF the row rather than setting it to 0.
 */
function optionalNum(
  key: 'quaryAmountOverride' | 'vehicleRentOverride',
  value: unknown,
): Partial<LedgerRow> {
  if (value === null || value === undefined || str(value) === '') return {};
  const parsed = Number(str(value));
  return Number.isFinite(parsed) ? { [key]: parsed } : {};
}

function normaliseRate(raw: Record<string, unknown>): RateChartEntry {
  return {
    crusher: str(raw['crusher']),
    type: passType(raw['type']) ?? 'Pass',
    quary: num(raw['quary']),
    rent: num(raw['rent']),
    crusherRate: num(raw['crusherRate']),
    // Optional: a backup predating the column must not be forced to 0.
    ...(raw['comm'] == null ? {} : { comm: num(raw['comm']) }),
  };
}

function normaliseVehicle(raw: Record<string, unknown>): Vehicle {
  return { num: str(raw['num']), owner: str(raw['owner']) };
}

function normaliseSettings(raw: unknown): LedgerSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rate = (raw as Record<string, unknown>)['discountRatePerTon'];
  if (rate == null) return undefined;
  return { ...DEFAULT_SETTINGS, discountRatePerTon: num(rate) };
}

function defaultName(extension: string): string {
  const today = new Date();
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  return `quarry-ledger-${stamp}.${extension}`;
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
