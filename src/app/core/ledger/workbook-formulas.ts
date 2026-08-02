/**
 * Helpers for writing **live** Excel formulas into an exported workbook.
 *
 * The exports used to be a data dump: every cell a literal, no summaries. That
 * makes a fine backup and a poor continuity plan — the business runs its
 * accounting in Excel, so a workbook they can keep working in (add a row, watch
 * the totals move) is worth more than a snapshot of ours.
 *
 * Two rules make that safe:
 *
 * 1. **Every formula ships with its cached result** (`{ formula, result }`).
 *    A formula-only cell renders blank in Google Sheets, Numbers and Excel's
 *    mobile preview until something forces a recalculation, which reads as a
 *    broken file. With the cached value the workbook opens correct everywhere
 *    and recalculates the moment it is edited.
 * 2. **The cached value comes from the domain engine**, so the workbook is also
 *    a cross-check: if Excel's own recalculation ever disagrees with what we
 *    cached, the engine and the contract have diverged.
 *
 * Formulas mirror `src/domain/calc.ts` and `src/domain/party/calc.ts` cell for
 * cell — including `ROUND(x,-1)` and `ROUND(x,0)`, which is where the golden
 * contract came from in the first place.
 */

/** A cell exceljs writes as a formula carrying a pre-computed value. */
export interface FormulaCell {
  formula: string;
  result: number;
}

/** Pair a formula with the value our own engine computed for it. */
export function formulaCell(formula: string, result: number): FormulaCell {
  return { formula, result: Number.isFinite(result) ? result : 0 };
}

/** 1-based column index to its spreadsheet letter: 1 -> 'A', 27 -> 'AA'. */
export function colLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * An absolute cross-sheet column range, e.g. `'Daily Ledger'!$F$2:$F$144`.
 *
 * The sheet name is always quoted because every sheet in these workbooks has a
 * space in it, and absolute so the summary formulas survive being dragged.
 */
export function colRange(sheet: string, column: string, firstRow: number, lastRow: number): string {
  return `'${sheet}'!$${column}$${firstRow}:$${column}$${lastRow}`;
}

/** What a numeric cell may hold: a live formula, or a plain literal. */
export type NumericCell = number | FormulaCell;

/**
 * Wrap a range-based formula so an empty book stays valid.
 *
 * With no data rows the range would be `$F$2:$F$1` — backwards, and Excel shows
 * `#REF!`. A book with nothing in it should just read zero.
 */
export function overRows(rowCount: number, build: () => FormulaCell): NumericCell {
  return rowCount > 0 ? build() : 0;
}

/** Escape a value used as a literal string criterion inside a formula. */
export function criterion(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
