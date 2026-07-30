// Pure calculation engine — mirrors the Daily Ledger formulas exactly.
// crusherAmount = QTY * Crusher Rate                     (col K)
// quaryAmount   = ROUND(QTY * Quary Rate, -1)            (col L)
// vehicleTon    = rentRate > 0 ? QTY : 0                 (col N)
// vehicleRent   = vehicleTon * rentRate                  (col O)
// profit        = crusherAmount - quaryAmount - rent     (cols AR / AT)
// discount      = commRate > 0 ? QTY * commRate : 0      (col AV)

function excelRound10(x) {
  // Excel ROUND(x,-1): round half away from zero to nearest 10 (values here are positive)
  return Math.round(x / 10) * 10;
}

function computeRow(row) {
  const qty = Number(row.qty) || 0;
  const quaryRate = Number(row.quaryRate) || 0;
  const crusherRate = Number(row.crusherRate) || 0;
  const rentRate = Number(row.rentRate) || 0;
  const commRate = Number(row.commRate) || 0;
  const crusherAmount = qty * crusherRate;
  const quaryAmount = excelRound10(qty * quaryRate);
  const vehicleTon = rentRate > 0 ? qty : 0;
  const vehicleRent = vehicleTon * rentRate;
  const profit = crusherAmount - quaryAmount - vehicleRent;
  const discountQty = commRate > 0 ? qty : 0;
  const discount = commRate > 0 ? qty * commRate : 0;
  return { crusherAmount, quaryAmount, vehicleTon, vehicleRent, profit, discountQty, discount };
}

function summarize(rows) {
  const s = { qty: 0, crusherAmount: 0, quaryAmount: 0, vehicleRent: 0,
    passQty: 0, passProfit: 0, woQty: 0, woProfit: 0, discQty: 0, discount: 0 };
  for (const r of rows) {
    const c = computeRow(r);
    s.qty += Number(r.qty) || 0;
    s.crusherAmount += c.crusherAmount;
    s.quaryAmount += c.quaryAmount;
    s.vehicleRent += c.vehicleRent;
    if (r.passType === 'Pass') { s.passQty += Number(r.qty) || 0; s.passProfit += c.profit; }
    if (r.passType === 'WO Pass') { s.woQty += Number(r.qty) || 0; s.woProfit += c.profit; }
    s.discQty += c.discountQty; s.discount += c.discount;
  }
  return s;
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

if (typeof module !== 'undefined') module.exports = { excelRound10, computeRow, summarize, groupBy };
