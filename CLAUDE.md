# CLAUDE.md — Quarry Ledger

Offline-first PWA for a rock quarry brokerage ledger. Read `WORK_PLAN.md` for the full
spec, phases, and acceptance criteria before making changes.

The product is named generically throughout: **Quarry Ledger** (app title, PWA manifest,
package name, IndexedDB `quarry-ledger-db`, transfer marker `QLD1:`). The customer's name
appears nowhere — not in the spec, the source workbook filename, or the prototype. Keep it
that way; refer to the business as "the business" or "the quarry".

**Status: Phase 1 complete.** All four tabs are live, seeded from `data/*.json` on first
run, fully offline, verified against `data/golden-totals.json` by both unit and e2e tests.
Phase 2 (Supabase sync) is next — see WORK_PLAN.md §5.

## Non-negotiables

- **The Daily Ledger row is the single source of truth.** Reports are pure functions
  over rows — never store derived values.
- **Rates are snapshots.** Editing the rate chart must never mutate existing rows.
- **Calculation engine is contract-bound.** `data/golden-totals.json` values were
  verified against the original Excel workbook; the test suite must always reproduce
  them exactly. If a change breaks a golden test, the change is wrong — not the test.
- `quaryAmount` rounds to the nearest 10, half away from zero (Excel `ROUND(x,-1)`).
  Everything else is stored/summed unrounded; only display is rounded (₹, en-IN).
- Row `id` is immutable — it is the merge key for cross-device import. Never
  regenerate ids on edit.
- Don't normalise vehicle numbers or crusher names; they are free-text business keys.

## Data quirks the engine must preserve

These are real properties of the seed data, encoded in the golden totals. Do not "fix" them.

- **One row has `passType: null`** — 'Outside site No Profit', 2025-11-29. It counts
  towards `qty`, the amount totals and grand-total `profit`, but is excluded from **both**
  the Pass and WO Pass splits. Hence `passQty + woQty < qty`, and
  `passProfit + woProfit < profit`. `passType` is typed `PassType | null` for this reason.
- **Some quantities carry 3 decimals** (e.g. `33.375`), though the spec says 2. Stored as
  entered; only display rounds. `golden-totals.json` records aggregates to 2 dp, which is
  why the golden assertions use the spec's ±0.01 tolerance rather than exact equality.
- **The float shortfall in `round10` is load-bearing.** `2.3 × 650` is exactly `1495` but
  the IEEE-754 product is `1494.9999999999998`; a naive `floor(x/10 + 0.5)` would bill
  ₹1490 where Excel bills ₹1500. 129 realistic qty/rate pairs hit this. Keep the epsilon
  nudge in `round10`.

## Stack

Angular 22 (standalone, **zoneless**, signals, `@if`/`@for`, `inject()`, `OnPush`
everywhere, no NgModules, no `.component`/`.service` filename suffixes) · Angular Material 3
only where warranted, with its `--mat-sys-*` tokens bridged onto the app's own design
tokens · **Tailwind v4 utilities are the default styling method** — reach for them in the
template first; a new feature should ideally ship with no `.scss` · IndexedDB via `idb`
behind `StorageService` · Vitest for pure logic, Playwright (`data-testid` selectors only)
for flows · Node 24.18.0 (`.nvmrc`).

Scaffolded from the `angular-pwa-starter` skill. WORK_PLAN.md §4 suggests React; §4 also
permits another stack provided the domain layer and acceptance criteria stand unchanged —
they do.

## Layering

```
src/domain/            pure types + calc + summaries + reports + merge + formatting.
                       No framework, no I/O, no Angular imports. 100% tested.
src/app/core/ledger/   LedgerStore (the persistence facade) + LedgerTransfer (xlsx/json).
src/app/core/          storage (IndexedDB), preferences, cross-device transfer (code/QR).
src/app/shared/ui/     presentational primitives (page-header, section-card, stat-tile).
src/app/features/      one folder per tab: entry, ledger, reports, settings.
```

- UI never computes business values itself and never touches IndexedDB directly. It reads
  `src/domain` functions and injects `LedgerStore`.
- **`LedgerStore` is the only Phase-2 seam.** Everything persisted goes through it; swapping
  its internals for Supabase sync must need no UI or domain change.
- `data/` is the single source of truth for seed + fixtures; import it via the `@data/*`
  path alias rather than copying files into `src/`. The seed modules are dynamically
  imported so they stay out of the initial bundle.
- `PILLARS` in `src/app/app.routes.ts` drives both the sidebar and the routes — add a tab
  there plus a matching lazy `loadComponent`.
- New persisted collection? Register its key + version in **both** `COLLECTION_VERSIONS`
  (`ledger-store.ts`) and `KNOWN_COLLECTIONS` (`transfer.model.ts`), or it will not
  round-trip through a transfer.

## Two traps worth remembering

- **Wait for `store.initialised()`, never `store.ready()`, before deriving a default from
  the rows.** On a fresh device every collection hydrates to its empty default almost
  instantly, so `ready()` is true well before the first-run seed lands — a feature seeding
  a date filter off `ready()` latches onto an empty row set. `initialised()` means
  "hydrated *and* seeded".
- **Row writes must be durable before you confirm them.** `StorageService` debounces writes
  250 ms; entering a load and immediately navigating (or Android killing a backgrounded
  PWA) would drop it. `LedgerStore.addRow` / `updateRow` / `deleteRow` are `async` and
  resolve only once the write has landed — always await them before showing a toast,
  resetting the form, or navigating. Losing entered data is the exact failure this app
  exists to prevent.

## Commands

- `npm start` (dev server) · `npm run build` · `npm test` · `npm run lint` · `npm run e2e`
- `npm test` runs Vitest via `ng test`; add `--no-watch` in non-interactive shells.
- Run `npm test` after **every** change to `src/domain` or `src/app/core`.
- `npm run e2e` builds and serves `dist/` on port 4300, always starting its own server
  (`reuseExistingServer: false`). If it reports the port is in use, clear it:
  `lsof -ti:4300 | xargs kill -9`.

## Context

- Users: 2–3 people on Android phones, often offline at the quarry. Mobile-first,
  fast entry (< 10 seconds per load), large touch targets.
- Currency ₹ (en-IN digit grouping), quantities in tons (2 dp, e.g. `32.66 t`).
  Format only via `src/domain/format.ts`; never feed a formatted value back into a
  calculation.
