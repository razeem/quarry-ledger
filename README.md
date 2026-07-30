# Quarry Ledger

Offline-first PWA for a rock quarry brokerage ledger. Every rock load is one ledger row;
every report is a pure computation over those rows.

- **Spec:** `WORK_PLAN.md` — domain model, business rules, phases, acceptance criteria.
- **Conventions:** `CLAUDE.md` — non-negotiables, data quirks, layering, commands.
- **Behaviour reference:** `reference-prototype/` — a working vanilla-JS prototype.

## Status

**Phase 1 complete** — the app is usable end to end, entirely offline:

- **Entry** — a spreadsheet row in the source workbook's own column order. You fill date,
  crusher, pass type, quantity and vehicle; the four rate cells autopopulate from the rate
  chart and stay editable, and the right-hand cells compute live. Each added row stacks
  directly above the entry row, so the sheet fills up as you work. Built for tablet and
  laptop, but the grid scrolls sideways inside its own box so it still works on a phone.
- **Ledger** — date-range filter defaulting to the last 5 *active* days, rows grouped by
  date with day subtotals, tap through to a full breakdown, edit or delete with undo.
- **Reports** — daily summary, vehicle rent by date, crusher-wise all-time, monthly, plus
  **Print / PDF**: pick which sections to include and the browser's print dialog does the
  rest (each section starts on its own page).
- **Settings** — editable rate chart and vehicle list, discount rate, `.xlsx` export,
  JSON backup, merge-import deduped by row `id`, and erase-all behind a confirm.

Verified by 116 unit tests and 40 Playwright tests, including the golden-totals contract,
an export→wipe→import round trip, a double-import producing zero duplicates, and the
service worker serving the app shell offline.

Phase 2 (Supabase sync across 2–3 devices) is next.

## Getting started

Requires Node 24.18.0 (see `.nvmrc`).

```bash
nvm use            # or: nvm install 24.18.0
npm ci
npm start          # dev server on http://localhost:4200
```

## Commands

| Command | What it does |
|---|---|
| `npm start` | Dev server |
| `npm run build` | Production build to `dist/` (service worker + manifest included) |
| `npm test` | Vitest unit tests — the golden-totals contract suite lives here |
| `npm run lint` | ESLint over TS + templates |
| `npm run e2e` | Builds, serves `dist/` on :4300, runs Playwright |
| `npm run format` | Prettier |

Run `npm test` after every change to `src/domain` or `src/app/core`.

## Layout

```
data/                  seed rows, rate chart, vehicles, golden fixtures (single source of truth)
src/domain/            pure calc + summaries + formatting; no framework, 100% tested
src/app/core/          storage (IndexedDB), preferences, cross-device transfer
src/app/shared/ui/     presentational primitives
src/app/features/      one folder per tab
```
