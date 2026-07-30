/* Quarry Ledger PWA — IndexedDB storage, xlsx export/import with merge */
'use strict';

// ---------------- storage ----------------
const DB_NAME = 'quarry-ledger', DB_VER = 1;
let db;
function openDB() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('rows')) d.createObjectStore('rows', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
const tx = (store, mode) => db.transaction(store, mode).objectStore(store);
const idbAll = s => new Promise((res, rej) => { const r = tx(s, 'readonly').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbPut = (s, v) => new Promise((res, rej) => { const r = tx(s, 'readwrite').put(v); r.onsuccess = res; r.onerror = () => rej(r.error); });
const idbDel = (s, k) => new Promise((res, rej) => { const r = tx(s, 'readwrite').delete(k); r.onsuccess = res; r.onerror = () => rej(r.error); });
const idbClear = s => new Promise((res, rej) => { const r = tx(s, 'readwrite').clear(); r.onsuccess = res; r.onerror = () => rej(r.error); });

// ---------------- state ----------------
let ROWS = [], RATES = [], VEHICLES = [], DISC = 20;
let editId = null, currentReport = 'daily';
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const rup = n => '₹' + Math.round(n).toLocaleString('en-IN');
const ton = n => (Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }) + ' t';
const fmtD = iso => { const d = new Date(iso + 'T00:00'); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); };
const todayISO = () => new Date().toLocaleDateString('sv-SE');

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }

async function loadState() {
  ROWS = await idbAll('rows');
  const meta = await idbAll('meta');
  const m = Object.fromEntries(meta.map(x => [x.key, x.value]));
  if (!m.rates) { // first run → seed
    RATES = SEED_RATES; VEHICLES = SEED_VEHICLES; DISC = SEED_DISCOUNT_RATE;
    await idbPut('meta', { key: 'rates', value: RATES });
    await idbPut('meta', { key: 'vehicles', value: VEHICLES });
    await idbPut('meta', { key: 'disc', value: DISC });
    if (ROWS.length === 0) {
      for (const r of SEED_ROWS) await idbPut('rows', r);
      ROWS = SEED_ROWS.slice();
      toast('Loaded ' + ROWS.length + ' rows from workbook seed');
    }
  } else { RATES = m.rates; VEHICLES = m.vehicles || []; DISC = m.disc ?? 20; }
  ROWS.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}
const saveMeta = async () => {
  await idbPut('meta', { key: 'rates', value: RATES });
  await idbPut('meta', { key: 'vehicles', value: VEHICLES });
  await idbPut('meta', { key: 'disc', value: DISC });
};

// ---------------- entry form ----------------
function crusherNames() {
  const s = new Set(RATES.map(r => r.crusher));
  ROWS.forEach(r => s.add(r.crusher));
  return [...s];
}
function fillEntryLists() {
  $('fCrusher').innerHTML = crusherNames().map(c => `<option>${c}</option>`).join('');
  $('vehList').innerHTML = [...new Set(VEHICLES.map(v => v.num).concat(ROWS.map(r => r.vehicle).filter(Boolean)))]
    .map(v => `<option value="${v}">`).join('');
}
function applyRates() {
  const cr = $('fCrusher').value, ty = $('fPass').value;
  const rate = RATES.find(r => r.crusher === cr && r.type === ty) || RATES.find(r => r.crusher === cr);
  if (rate) {
    $('fQuary').value = rate.quary ?? '';
    $('fCrusherRate').value = rate.crusherRate ?? '';
    $('fRent').value = rate.rent ?? '';
  }
  renderPreview();
}
function formRow() {
  return {
    id: editId || uid(),
    date: $('fDate').value, item: $('fItem').value || 'Rock',
    crusher: $('fCrusher').value, passType: $('fPass').value,
    qty: parseFloat($('fQty').value) || 0,
    quaryRate: parseFloat($('fQuary').value) || 0,
    crusherRate: parseFloat($('fCrusherRate').value) || 0,
    rentRate: parseFloat($('fRent').value) || 0,
    commRate: parseFloat($('fComm').value) || 0,
    vehicle: ($('fVehicle').value || '').trim()
  };
}
function renderPreview() {
  const c = computeRow(formRow());
  $('preview').innerHTML =
    `<div>Crusher Amount<br><b>${rup(c.crusherAmount)}</b></div>` +
    `<div>SUN Quary Amount<br><b>${rup(c.quaryAmount)}</b></div>` +
    `<div>Vehicle Rent<br><b>${rup(c.vehicleRent)}</b></div>` +
    `<div>Profit<br><b>${rup(c.profit)}</b></div>` +
    (c.discount ? `<div>Monthly Discount<br><b>${rup(c.discount)}</b></div>` : '');
}
async function saveEntry() {
  const row = formRow();
  if (!row.date) return toast('Set a date');
  if (!row.qty) return toast('Enter QTY');
  await idbPut('rows', row);
  const i = ROWS.findIndex(r => r.id === row.id);
  if (i >= 0) ROWS[i] = row; else ROWS.push(row);
  ROWS.sort((a, b) => a.date < b.date ? -1 : 1);
  toast(editId ? 'Row updated' : 'Saved — ' + ton(row.qty) + ' ' + row.crusher);
  if (editId) cancelEditMode(); else { $('fQty').value = ''; $('fVehicle').value = ''; }
  refreshAll();
}
function startEdit(row) {
  editId = row.id;
  $('entryTitle').textContent = 'Edit Entry';
  $('editNote').style.display = 'block';
  $('fDate').value = row.date; $('fItem').value = row.item;
  fillEntryLists();
  $('fCrusher').value = row.crusher; $('fPass').value = row.passType;
  $('fQty').value = row.qty; $('fVehicle').value = row.vehicle;
  $('fQuary').value = row.quaryRate; $('fCrusherRate').value = row.crusherRate;
  $('fRent').value = row.rentRate || ''; $('fComm').value = row.commRate || '';
  renderPreview();
  switchTab('entry');
}
function cancelEditMode() {
  editId = null;
  $('entryTitle').textContent = 'New Load Entry';
  $('editNote').style.display = 'none';
  $('fQty').value = ''; $('fVehicle').value = '';
  $('fDate').value = todayISO();
}

// ---------------- ledger list ----------------
function renderLedger() {
  const from = $('lFrom').value, to = $('lTo').value;
  let rows = ROWS.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
  let note = '';
  if (!from && !to) { // last 5 distinct days
    const days = [...new Set(rows.map(r => r.date))].sort().slice(-5);
    rows = rows.filter(r => days.includes(r.date));
    note = 'Showing last ' + days.length + ' day(s)';
  }
  const groups = groupBy(rows.slice().sort((a, b) => b.date < a.date ? -1 : 1), r => r.date);
  const dates = [...groups.keys()].sort().reverse();
  let html = note ? `<div class="muted" style="margin:0 4px 6px">${note}</div>` : '';
  for (const d of dates) {
    const g = groups.get(d), s = summarize(g);
    html += `<div class="datehead"><span>${fmtD(d)} · ${g.length} loads</span><span>${ton(s.qty)} · ${rup(s.crusherAmount)}</span></div><div class="card" style="padding:4px 12px">`;
    for (const r of g) {
      const c = computeRow(r);
      html += `<div class="rowitem" data-id="${r.id}">
        <div><div class="t1">${r.crusher}</div>
        <div class="t2">${r.vehicle || '—'} · <span class="pill ${r.passType === 'Pass' ? 'pass' : 'wo'}">${r.passType}</span></div></div>
        <div class="amt">${ton(r.qty)}<small>${rup(c.crusherAmount)}</small></div></div>`;
    }
    html += '</div>';
  }
  $('ledgerList').innerHTML = html || '<div class="card muted">No rows in range.</div>';
  $('ledgerList').querySelectorAll('.rowitem').forEach(el =>
    el.addEventListener('click', () => showRowDialog(el.dataset.id)));
}
function showRowDialog(id) {
  const r = ROWS.find(x => x.id === id); if (!r) return;
  const c = computeRow(r);
  $('dlgTitle').textContent = `${fmtD(r.date)} — ${r.crusher}`;
  $('dlgBody').innerHTML =
    `${r.passType} · ${ton(r.qty)} · ${r.vehicle || 'no vehicle'}<br>` +
    `Rates: quary ₹${r.quaryRate} / crusher ₹${r.crusherRate} / rent ₹${r.rentRate || 0} / comm ₹${r.commRate || 0}<br>` +
    `Crusher Amount <b>${rup(c.crusherAmount)}</b> · Quary <b>${rup(c.quaryAmount)}</b><br>` +
    `Rent <b>${rup(c.vehicleRent)}</b> · Profit <b>${rup(c.profit)}</b> · Discount <b>${rup(c.discount)}</b>`;
  const dlg = $('rowDlg');
  $('dlgEdit').onclick = () => { dlg.close(); startEdit(r); };
  $('dlgDel').onclick = async () => {
    if (!confirm('Delete this row?')) return;
    await idbDel('rows', r.id); ROWS = ROWS.filter(x => x.id !== r.id);
    dlg.close(); toast('Deleted'); refreshAll();
  };
  $('dlgClose').onclick = () => dlg.close();
  dlg.showModal();
}

// ---------------- reports ----------------
function kpi(l, v) { return `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`; }
function renderReport() {
  $('repDateCard').style.display = (currentReport === 'daily' || currentReport === 'vehicle') ? '' : 'none';
  const d = $('rDate').value;
  let html = '';
  if (currentReport === 'daily') {
    const rows = ROWS.filter(r => r.date === d);
    const s = summarize(rows);
    html = `<div class="kpis">${kpi('QTY', ton(s.qty))}${kpi('Crusher Amount', rup(s.crusherAmount))}
      ${kpi('SUN Quary Amount', rup(s.quaryAmount))}${kpi('Vehicle Rent', rup(s.vehicleRent))}
      ${kpi('Pass ' + ton(s.passQty), rup(s.passProfit) + ' profit')}${kpi('WO Pass ' + ton(s.woQty), rup(s.woProfit) + ' profit')}
      ${kpi('Discount qty', ton(s.discQty))}${kpi('Monthly Discount', rup(s.discount))}</div>`;
    const g = groupBy(rows, r => r.crusher);
    html += '<div class="card"><h2>By crusher</h2><div class="scroll"><table><tr><th>Crusher</th><th class="r">QTY</th><th class="r">Amount</th><th class="r">Profit</th></tr>';
    for (const [name, rs] of g) {
      const ss = summarize(rs);
      html += `<tr><td>${name}</td><td class="r">${ton(ss.qty)}</td><td class="r">${rup(ss.crusherAmount)}</td><td class="r">${rup(ss.passProfit + ss.woProfit)}</td></tr>`;
    }
    html += '</table></div></div>';
  } else if (currentReport === 'vehicle') {
    const rows = ROWS.filter(r => r.date === d && r.vehicle);
    const g = groupBy(rows, r => r.vehicle);
    html = '<div class="card"><h2>Vehicle rent — ' + (d ? fmtD(d) : 'pick a date') + '</h2><div class="scroll"><table><tr><th>Vehicle</th><th>Owner</th><th class="r">Trips</th><th class="r">QTY</th><th class="r">Rent</th></tr>';
    let tq = 0, tr_ = 0, tt = 0;
    for (const [veh, rs] of g) {
      const owner = (VEHICLES.find(v => v.num === veh) || {}).owner || '';
      const s = summarize(rs);
      tq += s.qty; tr_ += s.vehicleRent; tt += rs.length;
      html += `<tr><td>${veh}</td><td>${owner}</td><td class="r">${rs.length}</td><td class="r">${ton(s.qty)}</td><td class="r">${rup(s.vehicleRent)}</td></tr>`;
    }
    html += `<tr><th>Total</th><th></th><th class="r">${tt}</th><th class="r">${ton(tq)}</th><th class="r">${rup(tr_)}</th></tr></table></div></div>`;
  } else if (currentReport === 'crusher') {
    const g = groupBy(ROWS, r => r.crusher);
    html = '<div class="card"><h2>Crusher wise (all dates)</h2><div class="scroll"><table><tr><th>Crusher</th><th class="r">QTY</th><th class="r">Crusher Amt</th><th class="r">Quary Amt</th><th class="r">Rent</th><th class="r">Profit</th></tr>';
    let T = { q: 0, ca: 0, qa: 0, vr: 0, p: 0 };
    for (const [name, rs] of g) {
      const s = summarize(rs); const p = s.crusherAmount - s.quaryAmount - s.vehicleRent;
      T.q += s.qty; T.ca += s.crusherAmount; T.qa += s.quaryAmount; T.vr += s.vehicleRent; T.p += p;
      html += `<tr><td>${name}</td><td class="r">${ton(s.qty)}</td><td class="r">${rup(s.crusherAmount)}</td><td class="r">${rup(s.quaryAmount)}</td><td class="r">${rup(s.vehicleRent)}</td><td class="r">${rup(p)}</td></tr>`;
    }
    html += `<tr><th>Total</th><th class="r">${ton(T.q)}</th><th class="r">${rup(T.ca)}</th><th class="r">${rup(T.qa)}</th><th class="r">${rup(T.vr)}</th><th class="r">${rup(T.p)}</th></tr></table></div></div>`;
  } else { // monthly
    const g = groupBy(ROWS, r => r.date.slice(0, 7));
    const keys = [...g.keys()].sort();
    html = '<div class="card"><h2>Monthly commission / discount</h2><div class="scroll"><table><tr><th>Month</th><th class="r">QTY</th><th class="r">Disc QTY</th><th class="r">Discount</th><th class="r">Profit</th></tr>';
    for (const k of keys) {
      const s = summarize(g.get(k));
      const label = new Date(k + '-01T00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      html += `<tr><td>${label}</td><td class="r">${ton(s.qty)}</td><td class="r">${ton(s.discQty)}</td><td class="r">${rup(s.discount)}</td><td class="r">${rup(s.passProfit + s.woProfit)}</td></tr>`;
    }
    html += '</table></div></div>';
  }
  $('reportBody').innerHTML = html;
}

// ---------------- settings ----------------
function renderSettings() {
  $('discRate').value = DISC;
  $('rateTable').innerHTML = '<tr><th>Crusher</th><th>Type</th><th>Quary</th><th>Rent</th><th>Crusher ₹</th><th></th></tr>' +
    RATES.map((r, i) => `<tr>
      <td><input data-i="${i}" data-k="crusher" value="${r.crusher}" style="min-width:150px"></td>
      <td><select data-i="${i}" data-k="type"><option${r.type === 'Pass' ? ' selected' : ''}>Pass</option><option${r.type === 'WO Pass' ? ' selected' : ''}>WO Pass</option><option value=""${!r.type ? ' selected' : ''}>—</option></select></td>
      <td><input type="number" data-i="${i}" data-k="quary" value="${r.quary ?? ''}" style="width:70px"></td>
      <td><input type="number" data-i="${i}" data-k="rent" value="${r.rent ?? ''}" style="width:70px"></td>
      <td><input type="number" data-i="${i}" data-k="crusherRate" value="${r.crusherRate ?? ''}" style="width:70px"></td>
      <td><button data-del="${i}" style="border:0;background:none;color:var(--red);cursor:pointer">✕</button></td></tr>`).join('');
  $('vehTable').innerHTML = '<tr><th>Vehicle</th><th>Owner</th><th></th></tr>' +
    VEHICLES.map((v, i) => `<tr>
      <td><input data-vi="${i}" data-k="num" value="${v.num}" style="min-width:130px"></td>
      <td><input data-vi="${i}" data-k="owner" value="${v.owner}" style="min-width:150px"></td>
      <td><button data-vdel="${i}" style="border:0;background:none;color:var(--red);cursor:pointer">✕</button></td></tr>`).join('');
}
function bindSettings() {
  $('rateTable').addEventListener('input', async e => {
    const i = e.target.dataset.i, k = e.target.dataset.k;
    if (i === undefined) return;
    RATES[i][k] = (k === 'crusher' || k === 'type') ? e.target.value : (parseFloat(e.target.value) || null);
    await saveMeta(); fillEntryLists();
  });
  $('rateTable').addEventListener('click', async e => {
    if (e.target.dataset.del !== undefined) { RATES.splice(+e.target.dataset.del, 1); await saveMeta(); renderSettings(); }
  });
  $('vehTable').addEventListener('input', async e => {
    const i = e.target.dataset.vi; if (i === undefined) return;
    VEHICLES[i][e.target.dataset.k] = e.target.value; await saveMeta(); fillEntryLists();
  });
  $('vehTable').addEventListener('click', async e => {
    if (e.target.dataset.vdel !== undefined) { VEHICLES.splice(+e.target.dataset.vdel, 1); await saveMeta(); renderSettings(); }
  });
  $('addRate').onclick = async () => { RATES.push({ crusher: '', type: 'Pass', quary: null, rent: null, crusherRate: null }); await saveMeta(); renderSettings(); };
  $('addVeh').onclick = async () => { VEHICLES.push({ num: '', owner: '' }); await saveMeta(); renderSettings(); };
  $('discRate').addEventListener('input', async e => { DISC = parseFloat(e.target.value) || 0; await saveMeta(); });
  $('wipeBtn').onclick = async () => {
    if (!confirm('Erase ALL rows, rates and vehicles on this device? Export a backup first!')) return;
    await idbClear('rows'); await idbClear('meta');
    location.reload();
  };
}

// ---------------- export / import ----------------
const XLSX_HEADERS = ['ID', 'Date', 'Item Name', 'Crusher', 'Pass/with out pass', 'QTY (ton)',
  'Quary Rate', 'Crusher Rate', 'Vehicle Rent rate', 'Monthly Commission Rate', 'Vehicle number',
  'Crusher Amount', 'SUN Quary Amount', 'Vehicle Ton', 'Vehicle Rent', 'Profit', 'Monthly Discount'];
function exportXlsx() {
  if (typeof XLSX === 'undefined') return toast('Excel library offline — connect once to cache it');
  const data = [XLSX_HEADERS];
  for (const r of ROWS.slice().sort((a, b) => a.date < b.date ? -1 : 1)) {
    const c = computeRow(r);
    data.push([r.id, r.date, r.item, r.crusher, r.passType, r.qty, r.quaryRate, r.crusherRate,
      r.rentRate || 0, r.commRate || 0, r.vehicle, c.crusherAmount, c.quaryAmount, c.vehicleTon,
      c.vehicleRent, c.profit, c.discount]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'Daily Ledger');
  const rc = [['Crusher', 'Type', 'Quary', 'Vehicle Rent', 'Crusher Rate']].concat(
    RATES.map(r => [r.crusher, r.type, r.quary, r.rent, r.crusherRate]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rc), 'Rate Chart');
  const vl = [['Vehicle Number', 'Name']].concat(VEHICLES.map(v => [v.num, v.owner]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vl), 'Vehicles');
  XLSX.writeFile(wb, 'Quarry-Ledger-' + todayISO() + '.xlsx');
  toast('Excel exported');
}
function exportJson() {
  const blob = new Blob([JSON.stringify({ rows: ROWS, rates: RATES, vehicles: VEHICLES, disc: DISC }, null, 1)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Quarry-Ledger-backup-' + todayISO() + '.json';
  a.click(); toast('JSON backup downloaded');
}
async function mergeRows(incoming) {
  let added = 0, updated = 0;
  const byId = new Map(ROWS.map(r => [r.id, r]));
  for (const r of incoming) {
    if (!r.id) r.id = uid();
    if (byId.has(r.id)) {
      const old = byId.get(r.id);
      if (JSON.stringify(old) !== JSON.stringify(r)) { await idbPut('rows', r); Object.assign(old, r); updated++; }
    } else { await idbPut('rows', r); ROWS.push(r); byId.set(r.id, r); added++; }
  }
  ROWS.sort((a, b) => a.date < b.date ? -1 : 1);
  toast(`Merged: ${added} new, ${updated} updated`);
  refreshAll();
}
async function importFile(file) {
  if (file.name.endsWith('.json')) {
    const j = JSON.parse(await file.text());
    if (j.rates) { RATES = j.rates; VEHICLES = j.vehicles || VEHICLES; DISC = j.disc ?? DISC; await saveMeta(); }
    await mergeRows(j.rows || []);
  } else {
    if (typeof XLSX === 'undefined') return toast('Excel library not loaded — go online once');
    const wb = XLSX.read(await file.arrayBuffer());
    const ws = wb.Sheets['Daily Ledger'] || wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    const head = aoa[0].map(h => String(h || '').trim());
    const ix = n => head.indexOf(n);
    const rows = [];
    for (const a of aoa.slice(1)) {
      if (!a || a[ix('QTY (ton)')] == null) continue;
      let dt = a[ix('Date')];
      if (typeof dt === 'number') { const d = XLSX.SSF.parse_date_code(dt); dt = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
      rows.push({
        id: a[ix('ID')] ? String(a[ix('ID')]) : uid(),
        date: String(dt).slice(0, 10), item: a[ix('Item Name')] || 'Rock',
        crusher: a[ix('Crusher')] || '', passType: a[ix('Pass/with out pass')] || 'Pass',
        qty: +a[ix('QTY (ton)')] || 0, quaryRate: +a[ix('Quary Rate')] || 0,
        crusherRate: +a[ix('Crusher Rate')] || 0, rentRate: +a[ix('Vehicle Rent rate')] || 0,
        commRate: +a[ix('Monthly Commission Rate')] || 0, vehicle: a[ix('Vehicle number')] || ''
      });
    }
    await mergeRows(rows);
  }
  renderSettings(); fillEntryLists();
}

// ---------------- tabs / wiring ----------------
function switchTab(t) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + t));
  if (t === 'ledger') renderLedger();
  if (t === 'reports') renderReport();
  if (t === 'settings') renderSettings();
}
function refreshAll() {
  $('rowCount').textContent = ROWS.length + ' rows';
  fillEntryLists(); renderLedger(); renderReport();
}

async function init() {
  db = await openDB();
  await loadState();
  $('fDate').value = todayISO();
  const lastDate = ROWS.length ? ROWS[ROWS.length - 1].date : todayISO();
  $('rDate').value = lastDate;
  fillEntryLists(); applyRates();
  refreshAll();

  document.querySelectorAll('nav button').forEach(b => b.onclick = () => switchTab(b.dataset.t));
  $('repSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
    currentReport = b.dataset.r;
    $('repSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    renderReport();
  });
  ['fCrusher', 'fPass'].forEach(id => $(id).addEventListener('change', applyRates));
  ['fQty', 'fQuary', 'fCrusherRate', 'fRent', 'fComm'].forEach(id => $(id).addEventListener('input', renderPreview));
  $('saveBtn').onclick = saveEntry;
  $('cancelEdit').onclick = e => { e.preventDefault(); cancelEditMode(); };
  ['lFrom', 'lTo'].forEach(id => $(id).addEventListener('change', renderLedger));
  $('rDate').addEventListener('change', renderReport);
  $('expXlsx').onclick = exportXlsx;
  $('expJson').onclick = exportJson;
  $('impBtn').onclick = () => $('impFile').click();
  $('impFile').addEventListener('change', e => { if (e.target.files[0]) importFile(e.target.files[0]).catch(err => toast('Import failed: ' + err.message)); e.target.value = ''; });
  bindSettings();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
