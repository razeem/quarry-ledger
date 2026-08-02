#!/usr/bin/env node
/**
 * Compare a source workbook's derived cells against this app's engine.
 *
 *     node scripts/reconcile-workbook.mjs "data/<workbook>.xlsx" [out.xlsx]
 *
 * The business's workbook stores its amounts; this app never does — every
 * figure is recomputed from the row. That difference is the point of the app,
 * and it is also why a migration needs a reconciliation first: wherever an
 * amount was typed in rather than left to a formula, it can have drifted away
 * from the quantity and rate beside it.
 *
 * The output workbook lists every cell where the two disagree, and says whether
 * that cell was typed in or still calculated — which is what makes a difference
 * diagnosable rather than merely alarming.
 *
 * Neither this script nor its output is committed: both carry real crusher
 * names and vehicle registrations (see CLAUDE.md's privacy rules). `*.xlsx` is
 * gitignored for exactly this reason.
 */

import ExcelJS from 'exceljs';

function round10(x) {
  if (!Number.isFinite(x)) return 0;
  const s = x / 10, m = Math.abs(s);
  return Math.sign(s) * Math.floor(m + 0.5 + Number.EPSILON * m) * 10;
}

const wb = new ExcelJS.Workbook();
const [, , SOURCE, OUT = 'data/reconciliation.xlsx'] = process.argv;
if (!SOURCE) {
  console.error('usage: node scripts/reconcile-workbook.mjs <workbook.xlsx> [out.xlsx]');
  process.exit(1);
}
await wb.xlsx.readFile(SOURCE);
const ws = wb.getWorksheet('Daily Ledger');
const cellv = (r, c) => ws.getRow(r).getCell(c).value;
const raw = (r, c) => { const v = cellv(r, c); return v && typeof v === 'object' ? (v.result ?? v.text ?? v) : v; };
const num = (r, c) => { const n = Number(raw(r, c)); return Number.isFinite(n) ? n : 0; };
const st = (r, c) => { const v = raw(r, c); return v == null ? '' : String(v).trim(); };
const iso = (r) => { const v = raw(r, 1); if (v instanceof Date) return [v.getUTCFullYear(), String(v.getUTCMonth()+1).padStart(2,'0'), String(v.getUTCDate()).padStart(2,'0')].join('-'); const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(v??'')); return m?`${m[1]}-${m[2]}-${m[3]}`:''; };
const isFormula = (r, c) => { const v = cellv(r, c); return !!(v && typeof v === 'object' && (v.formula || v.sharedFormula)); };

const rows = [];
for (let r = 3; r <= ws.rowCount; r++) {
  const date = iso(r), qty = num(r, 6);
  if (!date || !qty) continue;
  rows.push({
    r, date, crusher: st(r, 3), pass: st(r, 4), qty,
    qr: num(r, 7), cr: num(r, 8), rr: num(r, 9), comm: num(r, 10), vehicle: st(r, 13),
    xlCA: num(r, 11), xlQA: num(r, 12), xlVT: num(r, 14), xlVR: num(r, 15),
    qaTyped: !isFormula(r, 12), vrTyped: !isFormula(r, 15), caTyped: !isFormula(r, 11),
  });
}

// Does our engine reproduce every row the workbook still computes with a LIVE
// ROUND(F*G,-1) formula? If so, the rule has not changed — the disagreements
// are typed values that drifted away from it.
const live = rows.filter((x) => !x.qaTyped);
const liveBad = live.filter((x) => Math.abs(round10(x.qty * x.qr) - x.xlQA) > 0.005);
console.log('=== against rows the workbook still calculates ===');
console.log('live-formula rows:', live.length, '| our engine disagrees on:', liveBad.length);

const typed = rows.filter((x) => x.qaTyped);
const typedBad = typed.filter((x) => Math.abs(round10(x.qty * x.qr) - x.xlQA) > 0.005);
console.log('hand-typed rows:', typed.length, '| disagree with qty x rate:', typedBad.length);

// Money impact.
let ourQA = 0, theirQA = 0, ourVR = 0, theirVR = 0, ourCA = 0, theirCA = 0;
for (const x of rows) {
  ourQA += round10(x.qty * x.qr); theirQA += x.xlQA;
  const vt = x.rr > 0 ? x.qty : 0;
  ourVR += vt * x.rr; theirVR += x.xlVR;
  ourCA += x.qty * x.cr; theirCA += x.xlCA;
}
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
console.log('\n=== totals: engine vs workbook ===');
console.log('crusher amount  engine', inr(ourCA), ' workbook', inr(theirCA), ' diff', inr(ourCA - theirCA));
console.log('quary amount    engine', inr(ourQA), ' workbook', inr(theirQA), ' diff', inr(ourQA - theirQA));
console.log('vehicle rent    engine', inr(ourVR), ' workbook', inr(theirVR), ' diff', inr(ourVR - theirVR));
const ourProfit = ourCA - ourQA - ourVR, theirProfit = theirCA - theirQA - theirVR;
console.log('profit          engine', inr(ourProfit), ' workbook', inr(theirProfit), ' diff', inr(ourProfit - theirProfit));

// --- The reconciliation workbook ---------------------------------------------
const out = new ExcelJS.Workbook();
out.creator = 'Quarry Ledger';
const sheet = out.addWorksheet('Differences');
sheet.columns = [
  { header: 'Excel row', key: 'r', width: 10 },
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Crusher', key: 'crusher', width: 26 },
  { header: 'Pass', key: 'pass', width: 11 },
  { header: 'Vehicle', key: 'vehicle', width: 16 },
  { header: 'Qty (t)', key: 'qty', width: 10 },
  { header: 'Quary rate', key: 'qr', width: 11 },
  { header: 'Rent rate', key: 'rr', width: 10 },
  { header: 'Field', key: 'field', width: 15 },
  { header: 'Workbook says', key: 'theirs', width: 14 },
  { header: 'Calculated', key: 'ours', width: 14 },
  { header: 'Difference', key: 'diff', width: 13 },
  { header: 'Cell was', key: 'origin', width: 12 },
];
let n = 0;
for (const x of rows) {
  const ourQ = round10(x.qty * x.qr);
  if (Math.abs(ourQ - x.xlQA) > 0.005) {
    sheet.addRow({ ...x, field: 'Quary amount', theirs: x.xlQA, ours: ourQ, diff: +(x.xlQA - ourQ).toFixed(2), origin: x.qaTyped ? 'typed in' : 'formula' });
    n++;
  }
  const vt = x.rr > 0 ? x.qty : 0, ourR = vt * x.rr;
  if (Math.abs(ourR - x.xlVR) > 0.005) {
    sheet.addRow({ ...x, field: 'Vehicle rent', theirs: x.xlVR, ours: +ourR.toFixed(2), diff: +(x.xlVR - ourR).toFixed(2), origin: x.vrTyped ? 'typed in' : 'formula' });
    n++;
  }
  const ourC = x.qty * x.cr;
  if (Math.abs(ourC - x.xlCA) > 0.005) {
    sheet.addRow({ ...x, field: 'Crusher amount', theirs: x.xlCA, ours: +ourC.toFixed(2), diff: +(x.xlCA - ourC).toFixed(2), origin: x.caTyped ? 'typed in' : 'formula' });
    n++;
  }
}
sheet.getRow(1).font = { bold: true };
sheet.views = [{ state: 'frozen', ySplit: 1 }];
await out.xlsx.writeFile(OUT);
console.log('\nwrote', OUT, 'with', n, 'differing cells across', rows.length, 'loads');
