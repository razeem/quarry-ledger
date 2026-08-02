import { test, expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openPartyBook,
  PARTY_GOLDEN_PAYABLE,
  PARTY_GOLDEN_RECEIVABLE,
  PARTY_GOLDEN_RENT,
  PARTY_SEED_ROWS,
  savePartyEntry,
  setParty,
  syncPartyDrafts,
  waitForToast,
} from './helpers';

// The party book: account switching, seeded golden totals, the entry flow and
// snapshot semantics. Select by data-testid only; use the helpers for every
// wait (the party seed arrives as lazy chunks exactly like the daily seed).

test('switches to the party book and back, and the choice survives a reload', async ({
  page,
}) => {
  await page.goto('/entry');
  await openPartyBook(page);

  // The sidebar now shows the party tab set — five tabs, Ledger included.
  await expect(page.getByTestId('nav-party/ledger')).toBeVisible();
  await expect(page.getByTestId('nav-party/statements')).toBeVisible();
  await expect(page.getByTestId('nav-entry')).toHaveCount(0);

  // The switch is durable before navigation, so a reload stays in the book.
  await page.reload();
  await expect(page.getByTestId('nav-party/statements')).toBeVisible();

  await page.getByTestId('account-switcher').click();
  await page.getByTestId('account-item-default').click();
  await expect(page).toHaveURL(/\/entry$/);
  await expect(page.getByTestId('entry-save')).toBeVisible();
});

test('reproduces the golden cross-party totals from the seed', async ({ page }) => {
  await page.goto('/entry');
  await openPartyBook(page);
  await page.getByTestId('nav-party/reports').click();

  const table = page.getByTestId('party-summary-table');
  await expect(table).toBeVisible();
  await expect(table.locator('tfoot')).toContainText(String(PARTY_SEED_ROWS));
  await expect(table.locator('tfoot')).toContainText(PARTY_GOLDEN_PAYABLE);
  await expect(table.locator('tfoot')).toContainText(PARTY_GOLDEN_RECEIVABLE);
});

test('autofills rates + owner, saves a load, and the statement picks it up', async ({
  page,
}) => {
  await page.goto('/entry');
  await openPartyBook(page);

  // Rates resolve from the party config once the seed lands.
  await setParty(page, 'Lakeside Crushers');
  await expect(page.getByTestId('party-entry-quary-rate')).toHaveValue('580');
  await expect(page.getByTestId('party-entry-bill-rate')).toHaveValue('850');
  await expect(page.getByTestId('party-entry-rent-rate')).toHaveValue('210');
  await expect(page.getByTestId('party-entry-shares')).toContainText('Owner ₹40/t');

  // The owner autofills from the vehicle master.
  await page.getByTestId('party-entry-vehicle').fill('KL 00 AS 7477');
  await expect(page.getByTestId('party-entry-owner')).toHaveValue('Sooraj');

  await page.getByTestId('party-entry-qty').fill('10');
  await savePartyEntry(page);

  // 10 t × ₹580 = ₹5,800 quarry payable on the staged row above the entry row.
  const stagedRow = page.locator('.sheet__saved').last();
  await expect(stagedRow).toContainText('₹5,800');
  await expect(stagedRow).toContainText('draft');

  // Statements only see synced rows, so sync the draft across first.
  await syncPartyDrafts(page);

  // The statement now includes the new load: 290.51 + 10 = 300.51 t.
  await page.getByTestId('nav-party/statements').click();
  await page.getByTestId('statement-party').selectOption('Lakeside Crushers');
  await expect(page.getByTestId('statement-rows')).toContainText('10.00');
});

test('a without-rent load snapshots the without-rent rates and no rent', async ({ page }) => {
  await page.goto('/entry');
  await openPartyBook(page);

  await setParty(page, 'Lakeside Crushers');
  await page.getByTestId('party-entry-without-rent').click();
  // The mode switch re-resolves the snapshot: bill 650, rent locked to 0.
  await expect(page.getByTestId('party-entry-bill-rate')).toHaveValue('650');
  await expect(page.getByTestId('party-entry-shares')).toContainText('Owner ₹50/t');

  await page.getByTestId('party-entry-qty').fill('2');
  await savePartyEntry(page);
  // Saved with the without-rent snapshot: billed 2 × ₹650, no vehicle rent.
  const stagedRow = page.locator('.sheet__saved').last();
  await expect(stagedRow).toContainText('W/O');
  await expect(stagedRow).toContainText('₹1,300');
});

test('editing the setup never mutates an existing row (rates are snapshots)', async ({
  page,
}) => {
  await page.goto('/entry');
  await openPartyBook(page);
  await page.getByTestId('nav-party/setup').click();

  // Change Lakeside's quarry rate 580 → 600 and save.
  const quaryInput = page.locator('#setup-quary-rate-0');
  await expect(quaryInput).toHaveValue('580');
  await quaryInput.fill('600');
  await page.getByTestId('setup-save-rates').click();
  await waitForToast(page, /rates saved/i);

  // The statement still reproduces the golden payable from the stored snapshots.
  await page.getByTestId('nav-party/statements').click();
  await page.getByTestId('statement-party').selectOption('Lakeside Crushers');
  await expect(page.getByText('₹1,68,496')).toBeVisible();

  // But a new entry now autofills the changed rate.
  await page.getByTestId('nav-party/entry').click();
  await setParty(page, 'Lakeside Crushers');
  await expect(page.getByTestId('party-entry-quary-rate')).toHaveValue('600');
});

test('exports a consolidated xlsx and imports it into another book', async ({ page }) => {
  await page.goto('/entry');
  await openPartyBook(page);

  // Export the sample book. The button is gated on initialised(), so this also
  // waits out the lazy seed.
  await page.getByTestId('nav-party/setup').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('party-export-xlsx').click();
  const download = await downloadPromise;
  // Keep the .xlsx extension — the importer routes by it; the raw download
  // path is an extension-less temp file.
  const filePath = join(tmpdir(), download.suggestedFilename());
  await download.saveAs(filePath);

  // Create a fresh, empty book and merge the export into it.
  await page.getByTestId('account-switcher').click();
  await page.getByTestId('account-new').click();
  await page.getByTestId('new-account-name').fill('Import Target');
  await page.getByTestId('new-account-submit').click();
  await expect(page).toHaveURL(/\/party\/entry$/);

  await page.getByTestId('nav-party/setup').click();
  await page.getByTestId('party-import-merge').setInputFiles(filePath);
  await waitForToast(page, new RegExp(`${PARTY_SEED_ROWS} added`));

  // The imported book reproduces the sample's golden totals — ids, rates,
  // splits and vehicles all survived the spreadsheet round trip.
  await page.getByTestId('nav-party/reports').click();
  const tfoot = page.getByTestId('party-summary-table').locator('tfoot');
  await expect(tfoot).toContainText(PARTY_GOLDEN_PAYABLE);
  await expect(tfoot).toContainText(PARTY_GOLDEN_RECEIVABLE);

  // Importing the same file twice adds nothing (dedup by row id).
  await page.getByTestId('nav-party/setup').click();
  await page.getByTestId('party-import-merge').setInputFiles(filePath);
  await waitForToast(page, /0 added · 0 updated · 35 unchanged/);
});

test('the party Ledger tab filters, paginates and round-trips an edit', async ({ page }) => {
  await page.goto('/entry');
  await openPartyBook(page);

  await page.getByTestId('nav-party/ledger').click();
  await page.getByTestId('party-ledger-show-all').click();
  await expect(page.getByTestId('party-ledger-summary')).toContainText(
    `${PARTY_SEED_ROWS} loads`,
  );
  // 35 rows at 25/page = 2 pages, and page 2 holds the remainder.
  await expect(page.getByTestId('pager-label')).toHaveText(/1 \/ 2/);
  await expect(page.getByTestId('party-ledger-table').locator('tbody tr')).toHaveCount(25);
  await page.getByTestId('pager-next').click();
  await expect(page.getByTestId('party-ledger-table').locator('tbody tr')).toHaveCount(10);

  // Filtering by party narrows to that party's loads only.
  await page.getByTestId('party-ledger-filter-party').selectOption('Lakeside Crushers');
  const partyCells = await page
    .getByTestId('party-ledger-table')
    .locator('tbody tr td:nth-child(2)')
    .allTextContents();
  expect(partyCells.length).toBeGreaterThan(0);
  expect(partyCells.every((c) => c.trim() === 'Lakeside Crushers')).toBe(true);

  // Edit round-trips through the entry sheet's ?edit= flow.
  await page.locator('[data-testid^="party-ledger-row-edit-"]').first().click();
  await expect(page).toHaveURL(/\/party\/entry\?edit=/);
  await expect(page.getByTestId('party-entry-party')).toHaveValue('Lakeside Crushers');
});

test('deleting from the party Ledger can be undone, keeping the row count', async ({ page }) => {
  await page.goto('/entry');
  await openPartyBook(page);
  await page.getByTestId('nav-party/ledger').click();
  await page.getByTestId('party-ledger-show-all').click();
  await expect(page.getByTestId('party-ledger-summary')).toContainText(
    `${PARTY_SEED_ROWS} loads`,
  );

  await page.locator('[data-testid^="party-ledger-row-delete-"]').first().click();
  await waitForToast(page, 'Row deleted');
  await expect(page.getByTestId('party-ledger-summary')).toContainText(
    `${PARTY_SEED_ROWS - 1} loads`,
  );

  // Undo restores the original id, so the seed count is exact after a reload.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('party-ledger-summary')).toContainText(
    `${PARTY_SEED_ROWS} loads`,
  );
  await page.reload();
  await page.getByTestId('party-ledger-show-all').click();
  await expect(page.getByTestId('party-ledger-summary')).toContainText(
    `${PARTY_SEED_ROWS} loads`,
  );
});

test('a party row already in the ledger edits in place on the sheet', async ({ page }) => {
  // The party twin of the daily sheet's inline editing — same client report,
  // same fix: a saved row is a live cell where it is visible.
  await page.goto('/entry');
  await openPartyBook(page);
  await page.getByTestId('party-entry-date').fill('2026-07-30');
  await setParty(page, 'Lakeside Crushers');
  await page.getByTestId('party-entry-qty').fill('8');
  await savePartyEntry(page);
  await syncPartyDrafts(page);

  await expect(page.locator('.sheet__saved--draft')).toHaveCount(0);

  const qty = page.locator('[data-testid^="party-row-qty-"]').first();
  await expect(qty).toHaveValue('8');
  await qty.fill('11');
  await page.locator('[data-testid^="party-row-owner-"]').first().fill('Ratheesh 8334');

  // Durable: the sheet reopens on today, so return to the date under test.
  await page.reload();
  await page.getByTestId('party-entry-date').fill('2026-07-30');
  await expect(page.locator('[data-testid^="party-row-qty-"]').first()).toHaveValue('11');

  // One row, not a fork.
  await page.getByTestId('nav-party/ledger').click();
  await page.getByTestId('party-ledger-show-all').click();
  await expect(page.getByTestId('party-ledger-summary')).toContainText(
    `${PARTY_SEED_ROWS + 1} loads`,
  );
});

test('prints the party reports with the golden totals', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __printCalls: number }).__printCalls = 0;
    window.print = () => {
      (window as unknown as { __printCalls: number }).__printCalls += 1;
    };
  });
  const printCalls = () =>
    page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls);

  await page.goto('/entry');
  await openPartyBook(page);
  await page.getByTestId('nav-party/reports').click();

  await page.getByTestId('party-reports-print').click();
  // Both sections come pre-ticked; print as offered.
  await page.getByTestId('print-confirm').click();
  await expect.poll(printCalls, { timeout: 15_000 }).toBe(1);

  const printed = (await page.getByTestId('party-report-print').textContent()) ?? '';
  expect(printed).toContain('Cross-party summary');
  expect(printed).toContain('Vehicle rent by owner');
  expect(printed).toContain(PARTY_GOLDEN_PAYABLE);
  expect(printed).toContain(PARTY_GOLDEN_RECEIVABLE);
  expect(printed).toContain(PARTY_GOLDEN_RENT);

  // Print media hides the shell and interactive UI, revealing only the report.
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('party-report-print')).toBeVisible();
  await expect(page.getByTestId('party-reports-print')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });

  // Statements print exists too and cancelling prints nothing.
  await page.getByTestId('nav-party/statements').click();
  await page.getByTestId('party-statements-print').click();
  await page.getByTestId('print-cancel').click();
  await expect.poll(printCalls).toBe(1);
});

test('creates a new empty party book, fully separate from the sample', async ({ page }) => {
  await page.goto('/entry');
  await page.getByTestId('account-switcher').click();
  await page.getByTestId('account-new').click();
  await page.getByTestId('new-account-name').fill('Second Book');
  await page.getByTestId('new-account-submit').click();

  await expect(page).toHaveURL(/\/party\/entry$/);
  // Empty book: no saved rows on the sheet, and no parties configured.
  await expect(page.getByTestId('party-entry-save')).toBeVisible();
  await expect(page.locator('.sheet__saved')).toHaveCount(0);

  await page.getByTestId('nav-party/reports').click();
  await expect(page.getByTestId('party-summary-empty')).toBeVisible();

  // The sample book still has its data — books are isolated.
  await page.getByTestId('account-switcher').click();
  await page.getByTestId('account-item-party-sample').click();
  await page.getByTestId('nav-party/reports').click();
  await expect(page.getByTestId('party-summary-table')).toBeVisible();
});
