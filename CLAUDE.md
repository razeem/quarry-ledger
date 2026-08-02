# CLAUDE.md — Quarry Ledger

Offline-first PWA for a rock quarry brokerage ledger. Read `WORK_PLAN.md` for the full
spec, phases, and acceptance criteria before making changes.

The product is named generically throughout: **Quarry Ledger** (app title, PWA manifest,
package name, IndexedDB `quarry-ledger-db`, transfer marker `QLD1:`). The customer's name
appears nowhere — not in the spec, the source workbook filename, or the prototype. Keep it
that way; refer to the business as "the business" or "the quarry".

> Sections below describe **what is true now**, not when it changed — git history covers
> that. Keep it that way: file a new fact under the capability it belongs to rather than
> appending a dated block.

## Status

**Phase 1 is complete.** The daily tabs are live, seeded from `data/*.json` on first run,
fully offline, and verified against `data/golden-totals.json` by both unit and e2e tests.
Phase 2 (Supabase sync) is next — see WORK_PLAN.md §5.

**Multi-account books are a prototype awaiting client sign-off.** The app hosts several
self-contained **accounts ("books")**: the original Daily Ledger plus any number of
**party ledgers** (modelled on the business's second workbook). Both book types share the
same entry-sheet, ledger-page and printing machinery; the sidebar switcher swaps the whole
workspace.

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
- **Reuse before rebuild.** The app will keep growing (the client iterates feature by
  feature), so every new feature must first look for an existing primitive, helper or
  pattern to reuse or extend — `src/app/shared/` (paginator, undo-delete, paging,
  print dialog/flow, option-filter, account-name dialog), `src/styles/_sheet.scss`,
  and the domain functions. Duplicating a behaviour that exists elsewhere is a bug:
  the two copies will drift, and shared lazy chunks are also what keeps the bundle
  small. Extract on the second use, not the third.
- **Edited always beats autofill.** A cell the user typed keeps their value no matter
  what re-triggers autopopulation afterwards (changing crusher/party/pass/rent-mode);
  only untouched cells re-populate. Encoded via the `overridden` sets in the entry
  rows and the baseline comparison in `draftRatePatch` for inline draft edits.

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
src/domain/party/      the party-ledger domain, same purity rules: types, round0/
                       sumRounded calc, prefill, statements/reports, merge.
src/app/core/ledger/   LedgerStore + PartyLedgerStore (the persistence facades) +
                       LedgerTransfer / PartyLedgerTransfer (consolidated xlsx/json;
                       the party Profit Split cell is `Name:₹/t; …` text, and cell
                       coercion trims EDGE whitespace only — internal quirks survive).
src/app/core/accounts/ AccountsStore — the book registry + per-account key scheme.
src/app/core/          storage (IndexedDB), preferences, cross-device transfer (code/QR).
src/app/shared/ui/     presentational primitives (page-header, section-card, stat-tile,
                       paginator) + filterOptions for the type-ahead pickers.
src/app/shared/ledger/ pageOf() paging helper + deleteRowWithUndo (id-preserving undo).
src/app/shared/print/  the generalized print-options dialog + handoffToPrint()/printStamp().
src/app/shared/accounts/ account-name-dialog (create + rename prompts).
src/app/features/      one folder per tab set: entry, ledger, reports, settings (daily);
                       party/ (entry, ledger, statements, reports, setup).
src/styles/_sheet.scss the spreadsheet-grid styles both entry sheets share (global).
```

- UI never computes business values itself and never touches IndexedDB directly. It reads
  `src/domain` functions and injects `LedgerStore`.
- **`LedgerStore` is the only Phase-2 seam.** Everything persisted goes through it; swapping
  its internals for Supabase sync must need no UI or domain change.
- `data/` is the single source of truth for seed + fixtures; import it via the `@data/*`
  path alias rather than copying files into `src/`. The seed modules are dynamically
  imported so they stay out of the initial bundle.
- `PILLARS` / `PARTY_PILLARS` in `src/app/app.routes.ts` drive both the sidebar and the
  routes — the shell renders the set matching the active account's type. Add a tab there
  plus a matching lazy `loadComponent`. Multi-segment pillar paths must bind as
  `[routerLink]="'/' + pillar.path"` — the array form encodes the `/` and 404s.
- The sidenav is `autosize` so collapsing it to the rail re-measures the content, and
  `.app-shell--rail` raises `--app-page-max` by the reclaimed 182px. Collapsing therefore
  widens every page, not just the full-bleed (`.app-page--wide`) ones.
- New persisted collection? Register its key + version in **both** `COLLECTION_VERSIONS`
  (`ledger-store.ts`, or `PARTY_COLLECTION_VERSIONS` in `party-ledger-store.ts`) and
  `KNOWN_COLLECTIONS` (`transfer.model.ts`, by base name), or it will not round-trip
  through a transfer.

## Accounts and books

- `AccountsStore` (`src/app/core/accounts/`) holds the book registry + active book. Two
  built-ins always exist: `default` (type `daily`) and `party-sample` (type `party`,
  seeded from `data/party-*.json` on first activation). Users can create more party
  books; those start empty.
- **Key scheme:** the default book keeps the app's original un-prefixed IndexedDB keys
  (zero migration for existing devices); every other book stores its collections under
  `acc:<accountId>:<collection>`. `KNOWN_COLLECTIONS` registers **base** names; the
  transfer summary strips the prefix before classifying, so whole-DB transfers carry
  every book.
- **Any book can be renamed**, built-ins included — the pencil beside each book in the
  sidebar switcher, or the "This book" card on that book's Settings (daily) / Setup
  (party) page. Only the label changes: the id is the key scheme's root and is immutable,
  so renaming never touches stored data. `withBuiltIns` preserves a renamed built-in's
  label across reloads.
- `PartyLedgerStore` is the party twin of `LedgerStore` — same non-negotiables: it is
  the only persistence seam, every mutator is async-durable, wait on `initialised()`
  (never `ready()`), and rate/split edits never mutate saved rows.

## The party ledger

Per-party rates, a with/without-rent flag per load, vehicle-owner rent payables, and
multi-way profit splits — the business's second workbook, computed live.

- **The party engine's rounding contract differs from the daily one.** `round0` is Excel
  `ROUND(x, 0)` (nearest rupee, half away from zero, epsilon-nudged — `290.51 × 850` is
  a true `.5` tie). Quarry payable rounds **per row**; receivable, owner rent and profit
  round **on the aggregate** via `sumRounded` (group by rate → round each product once).
  Both behaviours are encoded in `data/party-golden-totals.json` — same rule as the daily
  goldens: if a change breaks them, the change is wrong.
- The party goldens were cross-asserted against every internally-consistent cell of the
  source workbook; that workbook's own bugs (a SUMMARY reading the wrong fixed cells, a
  profit total missing its last share line, two hand-typed amounts contradicting
  qty × rate) are documented in the golden file's `corrections` and deliberately NOT
  reproduced.
- A party row snapshots `quaryRate`, `billRate` (resolved by the `withRent` flag),
  `rentRate` (0 when without rent) and the resolved `profitShares` list. `owner` is also
  a per-row snapshot: the same physical vehicle is attributed to different owners on
  different parties' loads in the real data, so the row's value always wins over the
  vehicle master.
- Owner names are free-text business keys like everything else — the seed deliberately
  preserves a real spelling drift (`Ratheeesh 8334` on rows vs ` Ratheesh 8334` in the
  master) so the rent report demonstrably surfaces it rather than papering over it.

## The entry sheets

Both books enter loads through a spreadsheet-style sheet sharing `src/styles/_sheet.scss`:
the header pins to the top, the entry row pins to the bottom, the date's saved rows stack
above it, and the grid scrolls sideways inside its own box (the page never does, even at
375px). Optimised for tablet and laptop, where this data gets entered.

- A rate cell is badged `auto` (from the chart/setup), `saved` (an existing row's
  snapshot) or `edited` (typed over). Saved rows highlight any rate that no longer matches
  the chart — which means "differs from today's chart", since a row does not record
  whether it was typed over or the chart changed later.
- **Draft rows are live cells** — every field edits in place (no pencil), each change
  persisting through `updateDraft`. A crusher/party typed into a draft re-resolves the
  chart/setup for its untouched rate cells only (`draftRatePatch`). Synced ledger rows
  stay read-only on the sheet; their pencil loads the entry row deliberately.
- Deleting any row (draft or synced) goes through `deleteRowWithUndo`, so every delete is
  undoable and the undo restores the ORIGINAL id.
- The crusher/party/vehicle pickers are `mat-autocomplete` + the shared
  `filterOptions` (`src/app/shared/ui/option-filter.ts`), NOT `<datalist>`: a chosen
  value must reopen with the FULL option list, which datalists cannot do. In e2e,
  press Escape after filling a picker before clicking elsewhere — the open panel can
  otherwise intercept the click (`setCrusher`/`setParty` already do this).
- Numeric columns are pinned to a fixed width and only the free-text ones carry
  `flex: true`, so surplus width on a wide screen goes where it is useful instead of
  bloating every cell.

## Drafts and sync

The client receives partial data from the quarry first (no crusher / no party), so both
entry sheets stage new rows as **drafts** — durable immediately (collections
`entry-drafts` / `party-entry-drafts`, per book), but invisible to the Ledger pages,
statements, reports and goldens until "Save N to ledger" syncs them.

- A draft only needs `qty > 0`; `isDraftComplete` / `isPartyDraftComplete` decide what
  sync may move across (crusher/party present). Incomplete drafts stay staged, flagged
  on the sheet, and are completed later by editing them in place.
- **Sync copies values verbatim and keeps each draft's id** — the id is minted at draft
  creation and is already the cross-device merge key, so double-syncing (or syncing from
  two devices) dedupes instead of duplicating. Never recompute rates at sync time.
- Undo of any delete (row or draft) restores under the ORIGINAL id via
  `mergeImport`/`restoreDraft` — `deleteRowWithUndo` in `src/app/shared/ledger/` is the
  only delete path the UI uses.
- Drafts ride every transfer path: registered in both version maps and
  `KNOWN_COLLECTIONS`, included in `snapshot()`/`replaceAll()`/JSON backups. The xlsx
  export stays ledger-only.
- In e2e, remember: after `saveEntry`/`savePartyEntry` the row is a DRAFT — call
  `syncDrafts`/`syncPartyDrafts` (helpers.ts) before asserting on Ledger/report counts.

## Ledger pages, reports and printing

- Each book has a **Ledger page**: one flat table of every synced row, newest date first,
  25 rows/page via the shared `pageOf` + `<app-paginator>`. Filters are date range plus
  the book's own keys (daily: crusher, pass type, vehicle substring; party: party, owner,
  vehicle substring, rent mode), applied by the pure `filterLedgerRows` /
  `filterPartyRows`. **The totals line always covers the whole filtered set**, never just
  the visible page, and changing any filter resets to page 1.
- Free-text filters match the RAW stored string (substring for vehicles, exact for
  crusher/party/owner). No trimming or case-folding — that is what keeps `KL00T5450` and
  `KL 00 T 5450` distinguishable, and what makes the owner spelling drift visible.
- **Printing is shared.** `src/app/shared/print/` holds the section-picker dialog (generic
  over its section keys) and `handoffToPrint()`; the `@media print` CSS in `styles.scss`
  is global. A page prints by rendering a hidden `.report-print` block and marking its
  interactive UI `.no-print`. Daily Reports, party Reports and party Statements all use
  this same path — add a printable page by supplying `choices` and a print block, not by
  writing new print plumbing.

## Rates and the chart

- The rate chart autopopulates **all four** rate cells — quary, crusher, rent and comm.
  `comm` is a per-entry column (v2) because several crushers genuinely run at ₹0; when an
  entry has no `comm` (a v1 chart or an older import) it falls back to the global
  `discountRatePerTon`. It is only a default: `Riverside Crusher Pass` and `Hillview Granites Pass` have
  historically used both ₹0 and ₹20, so the row's own snapshot always wins.
- The `item` column is hidden (one commodity these days) and every row saves as `Rock`.
  The field stays on `LedgerRow`, so restoring the column is a UI-only change.

## Seed data — sample labels, verified numbers

The seed is what a first-time user sees, so it carries **no real crusher names and no
real vehicle registrations**. Those labels were relabelled to plainly-fictional
placeholders ('Northgate Crusher', `KL 00 …` — district 00 is unassigned, so no synthetic
plate can be a real vehicle). Owner first names were kept: the business owner confirmed
they are fine.

Everything else is **byte-identical to the verified original**: every quantity, rate,
date, pass type and row id. Names never enter a calculation, so all of
`golden-totals.json` still reproduces exactly — which is why this was a relabelling and
not a regeneration. **Never "refresh" the seed with plausible-looking random numbers**:
that would break the golden contract, and the contract is the thing that proves the engine
matches the customer's workbook.

The format quirks below are deliberately preserved through the relabelling, because the
app must never normalise a free-text business key: mixed spacing (`KL00T5450` vs
`KL 00 T 5450`), lower-case variants (`Kl 00 Q 1062`), a leading-zero pair
(`KL 00 L 0213` / `KL 00 L 213` — the same vehicle written two ways), plates with no series
letter (`KL 00 1042`), and the `KI` state-code typo.

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

## Traps worth remembering

Each of these was a real bug caught by the test suite, not a hypothetical.

- **Wait for `store.initialised()`, never `store.ready()`, before deriving a default from
  the rows.** On a fresh device every collection hydrates to its empty default almost
  instantly, so `ready()` is true well before the first-run seed lands — a feature seeding
  a date filter off `ready()` latches onto an empty row set. `initialised()` means
  "hydrated *and* seeded".
- **Every write must be durable before you confirm it.** `StorageService` debounces writes
  250 ms; entering a load and immediately navigating (or Android killing a backgrounded
  PWA) would drop it. So **all** `LedgerStore` mutators — rows *and* drafts *and* reference
  data *and* the seed itself — are `async` and resolve only once the write has landed.
  Always await them before showing a toast, resetting a form, or navigating. Losing entered
  data is the exact failure this app exists to prevent.
  - The seed flushes too: without it, navigating within 250 ms of a first load lost the
    `seeded` flag, re-ran the seed, and overwrote a rate the user had just edited.
- **An async default must not clobber a user action.** The Ledger's default date range is
  applied after seeding, so it tracks `rangeTouched` and backs off if the user has already
  changed the filter. Any "apply a default once loaded" effect needs the same guard.
- **Don't let the bundler constant-fold a float in a test.** `2.3 * 650` is evaluated at
  build time, hiding the IEEE-754 shortfall the test exists to prove; route it through
  `Number('2.3')`.
- **In e2e, use `e2e/helpers.ts` — never hand-roll the waits.** The seed arrives as lazy
  chunks, so on a slow runner (CI, notably) the rate cells read `0` for a window after the
  form is interactive. Reading or asserting a rate before `setCrusher()` resolves captures
  that `0`; saving before it snapshots a row with zero rates. **Pressing Enter** in that
  window does nothing at all: the save button is the form's default button and it is
  disabled until `initialised()`, and HTML blocks implicit submission when the default
  button is disabled — so the keystroke is silently dropped. Four separate CI failures were
  all this one assumption. Likewise `saveEntry` / `saveEdit` / `waitForToast` wait on the
  app's own durability signals rather than on a timeout.
- **To reproduce that window locally, use `delaySeedChunks()`** — CPU throttling does not
  do it (not even 20×), because the seed is network-bound, not compute-bound. The helper
  route-matches the seed chunks **by content** (`SEED_MARKERS`), since their filenames are
  content-hashed and change every build. Pair it with `goto(url, {waitUntil: 'commit'})`:
  waiting for `load` sits out the entire delay, which is exactly why this window stayed
  invisible on a fast machine. `entry-sheet.spec.ts` guards the invariant that matters —
  a row is never saved with zero rates — and was verified to fail with the same
  `Expected: "" Received: "9"` CI produced before the fix.

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
