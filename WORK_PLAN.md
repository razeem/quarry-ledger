# Quarry Ledger — Work Plan

> **How to use this file:** open this folder in your IDE and tell Claude:
> *"Read WORK_PLAN.md and CLAUDE.md, then start Phase 0."*
> Work phase by phase; do not start a phase until the previous phase's acceptance
> criteria pass.

## 1. Project context

The business is a rock quarry brokerage operation in Kerala, India. Rock loads leave the
quarry and are delivered to various **crushers** using hired or own **vehicles**.
Each load is one ledger row. The business previously ran on a Google Sheet; a tab
deletion lost months of data, which motivated this app.

**Core principle: the Daily Ledger is the single source of truth.** Every report
(daily summary, vehicle rent, crusher-wise, monthly commission) is a pure computation
over ledger rows. Nothing derived is ever stored.

A working vanilla-JS prototype lives in `reference-prototype/` — use it to resolve any
ambiguity about behaviour, but build fresh; do not copy its code.

## 2. Domain model

### Ledger row (the only stored record)
```ts
interface LedgerRow {
  id: string;          // unique, immutable — enables cross-device export/merge
  date: string;        // ISO 'YYYY-MM-DD'
  item: string;        // always 'Rock' today; keep flexible
  crusher: string;     // e.g. 'Riverside Crusher', 'Eastfield Metal Crusher', 'Lakeside Crusher'
  passType: 'Pass' | 'WO Pass';   // with / without quarry pass
  qty: number;         // tons, 2 decimals
  quaryRate: number;   // ₹/ton paid to quarry (snapshot at entry time)
  crusherRate: number; // ₹/ton charged to crusher (snapshot)
  rentRate: number;    // ₹/ton vehicle rent; 0 for own/crusher vehicles
  commRate: number;    // ₹/ton monthly commission ('monthly discount'); 0 or 20
  vehicle: string;     // registration, e.g. 'KL 00 V 1087'; may be ''
}
```
**Rates are snapshotted onto the row at entry.** The rate chart only pre-fills the
form; editing the chart must never change existing rows.

### Reference data (editable in Settings)
- `data/rate-chart.json` — per crusher+passType: quary rate, rent rate, crusher rate.
- `data/vehicles.json` — vehicle registration → owner name.
- Monthly discount rate: ₹20/ton (global setting).

## 3. Business rules — the calculation engine (CRITICAL)

All derived values, per row:

| Value | Formula |
|---|---|
| crusherAmount | `qty × crusherRate` |
| quaryAmount | `round10(qty × quaryRate)` — nearest 10, **half away from zero** (Excel `ROUND(x,-1)`) |
| vehicleTon | `rentRate > 0 ? qty : 0` |
| vehicleRent | `vehicleTon × rentRate` |
| profit | `crusherAmount − quaryAmount − vehicleRent` |
| discountQty | `commRate > 0 ? qty : 0` |
| discount | `commRate > 0 ? qty × commRate : 0` |

Aggregations (daily/monthly/crusher/vehicle) are plain sums of the above, with
pass/WO-pass splits keyed on `passType`.

**Verification is non-negotiable:** `data/golden-totals.json` contains expected
aggregate values for 2025-11-14, 2026-03-10, 2026-07-29, all-time totals, and three
fully-computed single rows. These were verified against the original Excel workbook
via LibreOffice recalculation. Write unit tests that load `data/ledger-rows.json`
and reproduce every golden number exactly (±0.01). Currency is **displayed** rounded
to whole rupees (`₹1,23,456`, en-IN grouping) but **stored/summed unrounded**.

Domain quirks to preserve (do not "fix"):
- Pass rows currently use quary ₹650, WO Pass ₹610 — except Eastfield Pass at ₹640.
- Some crushers (Hillview Granites, Hillview Depot, Lakeside Own) use vehicles with no rent.
- Vehicle numbers are messy strings ('KI 00 Q 1011', 'KL00 H 1057') — never normalise
  or validate them away; they must match the vehicles list loosely (exact string match
  for owner lookup, missing owner is fine).

## 4. Recommended stack

Vite + React + TypeScript, Dexie.js (IndexedDB), `vite-plugin-pwa`, Vitest,
SheetJS (`xlsx`) for export/import, plain CSS or Tailwind. Zustand or React context
for state. If you (the developer) strongly prefer another stack, the domain layer
(§2–3) and acceptance criteria stand unchanged.

Architecture requirement: keep three isolated layers so Phase 2 can swap storage
without touching UI —
```
src/domain/   pure calc + types (no imports from other layers; 100% unit-tested)
src/storage/  repository interface + Dexie implementation + import/export/merge
src/ui/       components, tabs, reports
```

## 5. Phases

### Phase 0 — Scaffold
Vite React TS project; PWA manifest + service worker (offline app shell);
Vitest wired; `domain/calc.ts` implemented; golden-totals test suite green.
**Acceptance:** `npm test` passes reproducing every value in golden-totals.json.

### Phase 1 — Feature parity with prototype (offline-first)
1. **Seeding:** first run imports `data/*.json` into IndexedDB (143 rows, 24 rates, 91 vehicles).
2. **Entry tab:** date (default today), crusher dropdown, Pass/WO Pass, qty, vehicle
   (datalist with free text), four rate fields auto-filled from rate chart on
   crusher/passType change but editable; live computed preview; save; edit mode.
3. **Ledger tab:** date-range filter (default: last 5 active days), rows grouped by
   date with day subtotals, tap → detail dialog → edit/delete.
4. **Reports tab:** Daily summary (KPIs + per-crusher table, date picker) ·
   Vehicle Rent by date (vehicle, owner, trips, qty, rent, totals) ·
   Crusher-wise all-time (qty, crusher amt, quary amt, rent, profit) ·
   Monthly (qty, discount qty, discount ₹, profit).
5. **Settings tab:** editable rate chart + vehicle list + discount rate;
   Export .xlsx (Daily Ledger + Rate Chart + Vehicles sheets, includes `id` column);
   Backup/restore JSON; **Import/Merge** (.xlsx or .json) deduped by row `id` —
   identical rows skipped, changed rows updated, new rows added, with a merge report
   toast; erase-all with confirm.
6. **PWA:** installable, fully functional offline after first load.

**Acceptance:** all golden tests still green · create/edit/delete rows persist across
reload · export→wipe→import round-trips to identical data · importing the same file
twice adds zero duplicates · Lighthouse PWA installable check passes · works on a
375px-wide phone screen.

### Phase 2 — Shared sync backend (2–3 users)
Supabase (free tier): `ledger_rows` table mirroring the row schema +
`updated_at`/`deleted` (soft delete, tombstones); email/OTP auth; RLS restricted to
an allow-listed team; sync = push local changes, pull remote since last cursor,
last-write-wins on `updated_at`; offline queue drains on reconnect; storage layer
swap only — UI and domain untouched. Keep export/import as the fallback path.

**Acceptance:** two devices converge after concurrent offline edits; deletes
propagate; app remains fully usable offline.

### Phase 3 (optional backlog)
Photo attachment per row (weighbridge slip), per-crusher monthly statements (PDF),
date-range xlsx export matching the original workbook's summary tab layouts,
Malayalam labels toggle.

## 6. Files in this package

| Path | Contents |
|---|---|
| `data/ledger-rows.json` | 143 verified rows: Nov-2025, Mar-2026, 29-Jul-2026 |
| `data/rate-chart.json` | 24 crusher/passType rate entries |
| `data/vehicles.json` | 91 vehicles with owners |
| `data/golden-totals.json` | expected aggregates + sample row computations for tests |
| `reference-prototype/` | working vanilla-JS PWA — behaviour reference only |
| `source-workbook-v5.xlsx` | rebuilt Excel workbook — the origin of all data files; formula reference |
| `CLAUDE.md` | drop into the new repo root |
