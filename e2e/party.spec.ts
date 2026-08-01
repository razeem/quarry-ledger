import { test, expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openPartyBook,
  PARTY_GOLDEN_PAYABLE,
  PARTY_GOLDEN_RECEIVABLE,
  PARTY_SEED_ROWS,
  savePartyEntry,
  setParty,
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

  // The sidebar now shows the party tab set.
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

  // 10 t × ₹580 = ₹5,800 quarry payable on today's saved-rows table.
  await expect(page.getByTestId('party-day-table')).toContainText('₹5,800');

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
  const dayTable = page.getByTestId('party-day-table');
  await expect(dayTable).toContainText('W/O');
  await expect(dayTable).toContainText('₹1,300');
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
  await page.getByTestId('new-account-create').click();
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

test('creates a new empty party book, fully separate from the sample', async ({ page }) => {
  await page.goto('/entry');
  await page.getByTestId('account-switcher').click();
  await page.getByTestId('account-new').click();
  await page.getByTestId('new-account-name').fill('Second Book');
  await page.getByTestId('new-account-create').click();

  await expect(page).toHaveURL(/\/party\/entry$/);
  // Empty book: no seeded rows for today, and no parties configured.
  await expect(page.getByTestId('party-day-empty')).toBeVisible();

  await page.getByTestId('nav-party/reports').click();
  await expect(page.getByTestId('party-summary-empty')).toBeVisible();

  // The sample book still has its data — books are isolated.
  await page.getByTestId('account-switcher').click();
  await page.getByTestId('account-item-party-sample').click();
  await page.getByTestId('nav-party/reports').click();
  await expect(page.getByTestId('party-summary-table')).toBeVisible();
});
