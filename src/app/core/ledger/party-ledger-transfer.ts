import { Injectable } from '@angular/core';
import type { Workbook } from 'exceljs';
import type { Vehicle } from '../../../domain/types';
import type {
  PartyLedgerRow,
  PartyProfitShare,
  PartyRateConfig,
} from '../../../domain/party/types';
import type { PartyLedgerSnapshot } from './party-ledger-store';

/**
 * Export and import for one party book: a consolidated `.xlsx` for humans and
 * `.json` for exact backups, parsed back into a `PartyLedgerSnapshot` for
 * merge-import — the party twin of `LedgerTransfer`, same contracts:
 *
 *  - The `id` column is exported on every row and read back on import. It is
 *    the merge key; a row arriving without one is skipped, never invented.
 *  - The profit split serialises as a compact text cell, `Name:₹/t` pairs
 *    joined by `;` (e.g. `Owner:40; Adjust:20`), so the whole split survives a
 *    single spreadsheet column and hand-editing stays possible.
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const SHEET_ROWS = 'Party Ledger';
const SHEET_RATES = 'Party Rates';
const SHEET_VEHICLES = 'Vehicles';

/** Column order of the consolidated sheet. `id` comes first so it is never lost. */
const ROW_COLUMNS = [
  { header: 'id', key: 'id', width: 16 },
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Party', key: 'party', width: 26 },
  { header: 'Item', key: 'item', width: 10 },
  { header: 'Vehicle', key: 'vehicle', width: 18 },
  { header: 'Owner', key: 'owner', width: 20 },
  { header: 'Qty (t)', key: 'qty', width: 10 },
  { header: 'With Rent', key: 'withRent', width: 11 },
  { header: 'Quary Rate', key: 'quaryRate', width: 12 },
  { header: 'Bill Rate', key: 'billRate', width: 11 },
  { header: 'Rent Rate', key: 'rentRate', width: 11 },
  { header: 'Profit Split', key: 'profitShares', width: 24 },
] as const;

interface ExcelJsModule {
  Workbook: new () => Workbook;
}

/** Same CJS/ESM interop shim as LedgerTransfer — see the note there. */
async function loadExcelJs(): Promise<ExcelJsModule> {
  const mod = (await import('exceljs')) as unknown as ExcelJsModule & {
    default?: ExcelJsModule;
  };
  return mod.default ?? mod;
}

function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown): string {
  if (value == null) return '';
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

/** Excel dates arrive as UTC `Date`s; read UTC parts to avoid a day shift. */
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

/** With-rent cell: an Excel boolean, or any of the usual spreadsheet spellings. */
function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = str(value).toLowerCase();
  return text === 'true' || text === 'yes' || text === 'with' || text === '1';
}

/** `Owner:40; Adjust:20` -> shares. The rate sits after the LAST colon. */
export function parseShares(text: string): PartyProfitShare[] {
  return text
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.lastIndexOf(':');
      if (at < 1) return null;
      const name = part.slice(0, at).trim();
      const perTon = num(part.slice(at + 1));
      return name ? { name, perTon } : null;
    })
    .filter((share): share is PartyProfitShare => share !== null);
}

/** Shares -> `Owner:40; Adjust:20`. */
export function formatShares(shares: readonly PartyProfitShare[]): string {
  return shares.map((share) => `${share.name}:${share.perTon}`).join('; ');
}

@Injectable({ providedIn: 'root' })
export class PartyLedgerTransfer {
  // --- Export -----------------------------------------------------------------

  /** Build and download a three-sheet workbook. Returns the blob for tests. */
  async exportXlsx(
    snapshot: PartyLedgerSnapshot,
    fileName = defaultName('xlsx'),
  ): Promise<Blob> {
    const { Workbook } = await loadExcelJs();
    const workbook = new Workbook();
    workbook.creator = 'Quarry Ledger';

    const rows = workbook.addWorksheet(SHEET_ROWS);
    rows.columns = ROW_COLUMNS.map((c) => ({ ...c }));
    for (const row of snapshot.rows) {
      rows.addRow({
        ...row,
        profitShares: formatShares(row.profitShares ?? []),
      });
    }

    const rates = workbook.addWorksheet(SHEET_RATES);
    rates.columns = [
      { header: 'Party', key: 'party', width: 26 },
      { header: 'Quary Rate', key: 'quaryRate', width: 12 },
      { header: 'Rent Rate', key: 'rentRate', width: 11 },
      { header: 'With Rent Bill', key: 'wrBill', width: 14 },
      { header: 'With Rent Split', key: 'wrShares', width: 24 },
      { header: 'Without Rent Bill', key: 'worBill', width: 16 },
      { header: 'Without Rent Split', key: 'worShares', width: 24 },
    ];
    for (const entry of snapshot.rates) {
      rates.addRow({
        party: entry.party,
        quaryRate: entry.quaryRate,
        rentRate: entry.rentRate,
        wrBill: entry.withRent.billRate,
        wrShares: formatShares(entry.withRent.shares),
        worBill: entry.withoutRent.billRate,
        worShares: formatShares(entry.withoutRent.shares),
      });
    }

    const vehicles = workbook.addWorksheet(SHEET_VEHICLES);
    vehicles.columns = [
      { header: 'Vehicle', key: 'num', width: 18 },
      { header: 'Owner', key: 'owner', width: 24 },
    ];
    for (const vehicle of snapshot.vehicles) vehicles.addRow(vehicle);

    for (const sheet of [rows, rates, vehicles]) {
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: XLSX_MIME });
    download(blob, fileName);
    return blob;
  }

  /** Download an exact JSON backup (the restore path reproduces it verbatim). */
  exportJson(snapshot: PartyLedgerSnapshot, fileName = defaultName('json')): Blob {
    const payload = {
      app: 'quarry-ledger',
      kind: 'party-ledger',
      schema: 1,
      exportedAt: new Date().toISOString(),
      ...snapshot,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    download(blob, fileName);
    return blob;
  }

  // --- Import -----------------------------------------------------------------

  /** Parse a `.json` or `.xlsx` file into a snapshot ready for merge or restore. */
  async parseFile(file: File): Promise<Partial<PartyLedgerSnapshot>> {
    if (/\.json$/i.test(file.name)) return this.parseJson(await file.text());
    if (/\.xlsx$/i.test(file.name)) return this.parseXlsx(await file.arrayBuffer());
    throw new Error('Unsupported file — choose a .xlsx or .json export.');
  }

  parseJson(text: string): Partial<PartyLedgerSnapshot> {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('That file is not a party ledger backup.');
    }
    const doc = parsed as Record<string, unknown>;
    const rawRows = Array.isArray(doc['rows'])
      ? doc['rows']
      : Array.isArray(parsed)
        ? (parsed as unknown[])
        : [];

    return {
      rows: (rawRows as Record<string, unknown>[]).map(normaliseRow).filter((r) => r.id !== ''),
      rates: Array.isArray(doc['rates'])
        ? (doc['rates'] as Record<string, unknown>[]).map(normaliseRate)
        : undefined,
      vehicles: Array.isArray(doc['vehicles'])
        ? (doc['vehicles'] as Record<string, unknown>[]).map(normaliseVehicle)
        : undefined,
    };
  }

  async parseXlsx(buffer: ArrayBuffer): Promise<Partial<PartyLedgerSnapshot>> {
    const { Workbook } = await loadExcelJs();
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer);

    const rows: PartyLedgerRow[] = [];
    const rowsSheet = workbook.getWorksheet(SHEET_ROWS) ?? workbook.worksheets[0];
    if (rowsSheet) {
      const headers = headerIndex(rowsSheet);
      rowsSheet.eachRow((sheetRow, rowNumber) => {
        if (rowNumber === 1) return;
        const cell = (name: string) => {
          const at = headers.get(name.toLowerCase());
          return at ? sheetRow.getCell(at).value : undefined;
        };
        const id = str(cell('id'));
        if (!id) return; // no merge key — skip rather than invent one
        const withRent = bool(cell('with rent'));
        rows.push({
          id,
          date: isoDate(cell('date')),
          party: str(cell('party')),
          item: str(cell('item')) || 'Rock',
          vehicle: str(cell('vehicle')),
          owner: str(cell('owner')),
          qty: num(cell('qty (t)') ?? cell('qty')),
          withRent,
          quaryRate: num(cell('quary rate')),
          billRate: num(cell('bill rate')),
          rentRate: withRent ? num(cell('rent rate')) : 0,
          profitShares: parseShares(str(cell('profit split'))),
        });
      });
    }

    const ratesSheet = workbook.getWorksheet(SHEET_RATES);
    const rates: PartyRateConfig[] = [];
    if (ratesSheet) {
      const headers = headerIndex(ratesSheet);
      ratesSheet.eachRow((sheetRow, rowNumber) => {
        if (rowNumber === 1) return;
        const cell = (name: string) => {
          const at = headers.get(name.toLowerCase());
          return at ? sheetRow.getCell(at).value : undefined;
        };
        const party = str(cell('party'));
        if (!party) return;
        rates.push({
          party,
          quaryRate: num(cell('quary rate')),
          rentRate: num(cell('rent rate')),
          withRent: {
            billRate: num(cell('with rent bill')),
            shares: parseShares(str(cell('with rent split'))),
          },
          withoutRent: {
            billRate: num(cell('without rent bill')),
            shares: parseShares(str(cell('without rent split'))),
          },
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
      rates: rates.length ? rates : undefined,
      vehicles: vehicles.length ? vehicles : undefined,
    };
  }
}

// --- helpers ---------------------------------------------------------------

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

function normaliseRow(raw: Record<string, unknown>): PartyLedgerRow {
  const withRent = bool(raw['withRent']);
  return {
    id: str(raw['id']),
    date: isoDate(raw['date']),
    party: str(raw['party']),
    item: str(raw['item']) || 'Rock',
    vehicle: str(raw['vehicle']),
    owner: str(raw['owner']),
    qty: num(raw['qty']),
    withRent,
    quaryRate: num(raw['quaryRate']),
    billRate: num(raw['billRate']),
    rentRate: withRent ? num(raw['rentRate']) : 0,
    profitShares: Array.isArray(raw['profitShares'])
      ? (raw['profitShares'] as Record<string, unknown>[]).map((share) => ({
          name: str(share['name']),
          perTon: num(share['perTon']),
        }))
      : [],
  };
}

function normaliseRate(raw: Record<string, unknown>): PartyRateConfig {
  const mode = (value: unknown): PartyRateConfig['withRent'] => {
    const doc = (value ?? {}) as Record<string, unknown>;
    return {
      billRate: num(doc['billRate']),
      shares: Array.isArray(doc['shares'])
        ? (doc['shares'] as Record<string, unknown>[]).map((share) => ({
            name: str(share['name']),
            perTon: num(share['perTon']),
          }))
        : [],
    };
  };
  return {
    party: str(raw['party']),
    quaryRate: num(raw['quaryRate']),
    rentRate: num(raw['rentRate']),
    withRent: mode(raw['withRent']),
    withoutRent: mode(raw['withoutRent']),
  };
}

function normaliseVehicle(raw: Record<string, unknown>): Vehicle {
  return { num: str(raw['num']), owner: str(raw['owner']) };
}

function defaultName(extension: string): string {
  const today = new Date();
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  return `party-ledger-${stamp}.${extension}`;
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
