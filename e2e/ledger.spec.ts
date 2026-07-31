import { test, expect } from '@playwright/test';
import {
  expectLoadCount,
  GOLDEN_ALL_TIME_DISCOUNT,
  GOLDEN_ALL_TIME_PROFIT,
  openFullLedger,
  saveEdit,
  saveEntry,
  SEED_ROWS,
  setCrusher,
  visibleLoadCount,
  waitForToast,
} from './helpers';

/**
 * Phase 1 acceptance tests (WORK_PLAN.md §5).
 *
 * Each test gets a fresh Playwright context, so IndexedDB starts empty and the
 * first-run seed re-runs per test. See ./helpers.ts for why the waits matter.
 */

test.describe('seeding', () => {
  test('imports the bundled seed data on first run', async ({ page }) => {
    await openFullLedger(page);
    await expectLoadCount(page, SEED_ROWS);

    // 24 rate entries and 91 vehicles come from the same seed.
    await page.goto('/settings');
    await expect(page.getByTestId('settings-rate-table').locator('tbody tr')).toHaveCount(24);
    await expect(page.getByTestId('settings-vehicle-table').locator('tbody tr')).toHaveCount(91);
  });

  test('defaults the Ledger filter to the most recent active days, not a calendar window', async ({
    page,
  }) => {
    await page.goto('/ledger');
    // The seed's newest date is 2026-07-29 and its dates are sparse bursts, so a
    // plain "last 5 calendar days" filter would show nothing at all.
    await expect(page.getByTestId('ledger-to')).toHaveValue('2026-07-29');
    await expect(page.getByTestId('ledger-from')).toHaveValue('2026-03-06');
    await expect.poll(() => visibleLoadCount(page), { timeout: 15_000 }).toBeGreaterThan(0);
  });
});

test.describe('create, edit, delete', () => {
  test('a new load persists across a reload', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-date').fill('2026-07-30');
    await setCrusher(page, 'AVK');
    await page.getByTestId('entry-qty').fill('30.45');
    await page.getByTestId('entry-vehicle').fill('KL 61 D 5401');

    // Rates pre-fill from the chart, so the preview is live before saving.
    await expect(page.getByTestId('preview-crusher-amount')).not.toHaveText('₹0');
    await saveEntry(page);

    await openFullLedger(page);
    await expectLoadCount(page, SEED_ROWS + 1);

    await page.reload();
    await page.getByTestId('ledger-show-all').click();
    await expectLoadCount(page, SEED_ROWS + 1);
  });

  test('the entry form keeps the crusher and rates for the next load', async ({ page }) => {
    await page.goto('/entry');
    // setCrusher waits for the chart, so the captured rate is the real one and not
    // the 0 the cell shows before the seed lands.
    await setCrusher(page, 'AVK');
    await page.getByTestId('entry-qty').fill('10');
    const quaryRate = await page.getByTestId('entry-quary-rate').inputValue();
    expect(quaryRate).not.toBe('0');
    await saveEntry(page);

    // Only the quantity clears — consecutive loads from one crusher are the norm.
    await expect(page.getByTestId('entry-qty')).toHaveValue('');
    await expect(page.getByTestId('entry-crusher')).toHaveValue('AVK');
    await expect(page.getByTestId('entry-quary-rate')).toHaveValue(quaryRate);
  });

  test('editing a row through the detail dialog persists the change', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-date').fill('2026-07-30');
    await page.getByTestId('entry-crusher').fill('EditMe Crusher');
    await page.getByTestId('entry-qty').fill('11');
    await saveEntry(page);

    await page.goto('/ledger');
    await page.getByTestId('ledger-from').fill('2026-07-30');
    await page.getByTestId('ledger-to').fill('2026-07-30');

    const table = page.getByTestId('ledger-table-2026-07-30');
    await expect(table).toContainText('EditMe Crusher');
    await table.locator('tbody tr').first().getByRole('button').click();
    await page.getByTestId('row-edit').click();

    // The edit form is pre-loaded with the row's own snapshotted values.
    await expect(page.getByTestId('entry-qty')).toHaveValue('11');
    await page.getByTestId('entry-qty').fill('22');
    await saveEdit(page);

    await page.reload();
    await page.goto('/ledger');
    await page.getByTestId('ledger-from').fill('2026-07-30');
    await page.getByTestId('ledger-to').fill('2026-07-30');
    await expect(page.getByTestId('ledger-table-2026-07-30')).toContainText('22.00 t');
    // The edit replaced the row rather than forking it.
    await expect(page.getByTestId('ledger-table-2026-07-30')).not.toContainText('11.00 t');
  });

  test('deleting a row keeps it deleted after a reload', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-date').fill('2026-07-30');
    await page.getByTestId('entry-crusher').fill('DeleteMe Crusher');
    await page.getByTestId('entry-qty').fill('7');
    await saveEntry(page);

    await page.goto('/ledger');
    await page.getByTestId('ledger-from').fill('2026-07-30');
    await page.getByTestId('ledger-to').fill('2026-07-30');
    await page
      .getByTestId('ledger-table-2026-07-30')
      .locator('tbody tr')
      .first()
      .getByRole('button')
      .click();
    await page.getByTestId('row-delete').click();
    await waitForToast(page, 'Row deleted');

    await openFullLedger(page);
    await expectLoadCount(page, SEED_ROWS);

    await page.reload();
    await page.getByTestId('ledger-show-all').click();
    await expectLoadCount(page, SEED_ROWS);
  });
});

test.describe('reports', () => {
  test('reproduce the golden all-time totals in the UI', async ({ page }) => {
    await page.goto('/reports');

    // Crusher-wise all-time profit must equal the golden all-time figure.
    await page.getByTestId('reports-tab-crusher').click();
    await expect(page.getByTestId('crusher-total-profit')).toContainText(GOLDEN_ALL_TIME_PROFIT);

    // Monthly discount total likewise.
    await page.getByTestId('reports-tab-monthly').click();
    await expect(page.getByTestId('monthly-total-discount')).toContainText(
      GOLDEN_ALL_TIME_DISCOUNT,
    );
  });

  test('vehicle rent for a date matches the golden day total', async ({ page }) => {
    await page.goto('/reports');
    await page.getByTestId('reports-tab-rent').click();
    await page.getByTestId('rent-date').fill('2026-07-29');
    // golden by_date['2026-07-29'].vehicleRent = 137756.05 -> ₹1,37,756
    await expect(page.getByTestId('rent-total')).toContainText('1,37,756');
  });

  test('a date with no rent shows an empty vehicle-rent report', async ({ page }) => {
    await page.goto('/reports');
    await page.getByTestId('reports-tab-rent').click();
    // The golden totals record zero vehicle rent on this date.
    await page.getByTestId('rent-date').fill('2025-11-14');
    await expect(page.getByTestId('rent-empty')).toBeVisible();
  });
});

test.describe('export, wipe and import', () => {
  test('a JSON backup round-trips to identical data, and re-importing adds no duplicates', async ({
    page,
  }, testInfo) => {
    await openFullLedger(page);
    await expectLoadCount(page, SEED_ROWS);

    // --- export
    await page.goto('/settings');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('settings-export-json').click();
    const backupPath = testInfo.outputPath('backup.json');
    await (await downloadPromise).saveAs(backupPath);

    // --- wipe
    await page.getByTestId('settings-erase').click();
    await page.getByTestId('settings-erase-confirm').click();
    await waitForToast(page, 'Everything erased');
    await openFullLedger(page);
    await expectLoadCount(page, 0);

    // --- import back
    await page.goto('/settings');
    await page.getByTestId('settings-import-merge').setInputFiles(backupPath);
    await waitForToast(page, /rows total/);
    await openFullLedger(page);
    await expectLoadCount(page, SEED_ROWS);

    // Values survived the round trip exactly, not just the row count.
    await page.goto('/reports');
    await page.getByTestId('reports-tab-crusher').click();
    await expect(page.getByTestId('crusher-total-profit')).toContainText(GOLDEN_ALL_TIME_PROFIT);

    // --- import the very same file again: zero duplicates (deduped by row id)
    await page.goto('/settings');
    await page.getByTestId('settings-import-merge').setInputFiles(backupPath);
    await waitForToast(page, /rows total/);
    await openFullLedger(page);
    await expectLoadCount(page, SEED_ROWS);

    await page.reload();
    await page.getByTestId('ledger-show-all').click();
    await expectLoadCount(page, SEED_ROWS);
  });

  test('an .xlsx export round-trips through merge-import with no duplicates', async ({
    page,
  }, testInfo) => {
    await page.goto('/settings');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('settings-export-xlsx').click();
    const workbookPath = testInfo.outputPath('ledger.xlsx');
    await (await downloadPromise).saveAs(workbookPath);

    // Re-importing an untouched export must be a complete no-op.
    await page.getByTestId('settings-import-merge').setInputFiles(workbookPath);
    await waitForToast(page, /rows total/);
    await openFullLedger(page);
    await expectLoadCount(page, SEED_ROWS);

    // The id column round-tripped, so the numbers are untouched too.
    await page.goto('/reports');
    await page.getByTestId('reports-tab-crusher').click();
    await expect(page.getByTestId('crusher-total-profit')).toContainText(GOLDEN_ALL_TIME_PROFIT);
  });
});

test.describe('rate snapshots', () => {
  test('editing the rate chart never alters an existing row', async ({ page }) => {
    // Record what an existing AVK row is worth today.
    await page.goto('/reports');
    await page.getByTestId('reports-tab-crusher').click();
    const before = await page.getByTestId('crusher-total-profit').textContent();

    // Change the chart drastically.
    await page.goto('/settings');
    const quary = page.getByTestId('rate-quary-0');
    await quary.fill('9999');
    await expect(quary).toHaveValue('9999');

    // Saved rows keep their own snapshotted rates, so nothing moves.
    await page.goto('/reports');
    await page.getByTestId('reports-tab-crusher').click();
    await expect(page.getByTestId('crusher-total-profit')).toHaveText(before ?? '');
  });
});

test.describe('mobile', () => {
  test('every tab is usable and never scrolls sideways at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    for (const tab of ['entry', 'ledger', 'reports', 'settings']) {
      await page.goto(`/${tab}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${tab} overflows horizontally`).toBeLessThanOrEqual(1);
    }
  });

  test('a load can be entered from the phone-width form', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/entry');
    await setCrusher(page, 'AVK');
    await page.getByTestId('entry-qty').fill('12.5');
    await saveEntry(page);

    await page.goto('/ledger');
    await page.getByTestId('ledger-show-all').click();
    await expectLoadCount(page, SEED_ROWS + 1);
  });
});
