import { test, expect, type Page } from '@playwright/test';
import {
  delaySeedChunks,
  expectLoadCount,
  saveEntry,
  SEED_ROWS,
  setCrusher,
  syncDrafts,
  waitForToast,
} from './helpers';

/**
 * The spreadsheet-style entry row, and printing the reports.
 *
 * Entry is used on a tablet or laptop, but must still work on a phone: the grid
 * scrolls sideways inside its own box while the page itself never does.
 * See ./helpers.ts for why the seed/durability waits matter.
 */

test.describe('sheet entry row', () => {
  test('autopopulates the rate cells from the chart and badges them', async ({ page }) => {
    await page.goto('/entry');
    await setCrusher(page, 'Riverside Crusher');

    // WO Pass is the default; Riverside Crusher WO Pass is ₹610 quary in the seeded chart.
    await expect(page.getByTestId('entry-quary-rate')).toHaveValue('610');
    await expect(page.getByTestId('entry-crusher-rate')).not.toHaveValue('0');

    // Untouched auto cells are badged 'auto'.
    const quaryCell = page.getByTestId('entry-quary-rate').locator('xpath=..');
    await expect(quaryCell).toContainText('auto');
  });

  test('takes the comm rate from the rate chart, per crusher and pass type', async ({ page }) => {
    await page.goto('/entry');
    await setCrusher(page, 'Riverside Crusher');

    // Riverside Crusher WO Pass carries the usual ₹20 commission...
    await expect(page.getByTestId('entry-comm-rate')).toHaveValue('20');

    // ...while Riverside Crusher Pass runs at ₹0 in the seeded chart. A single global rate could
    // not express that, which is why comm lives on the chart entry.
    await page.getByTestId('entry-pass-type').selectOption('Pass');
    await expect(page.getByTestId('entry-comm-rate')).toHaveValue('0');
  });

  test('a comm rate edited in Settings autopopulates the next row', async ({ page }) => {
    await page.goto('/settings');
    // Row 0 of the seeded chart is Hillview Granites / Pass.
    await expect(page.getByTestId('rate-crusher-0')).toHaveValue('Hillview Granites');
    await page.getByTestId('rate-comm-0').fill('35');
    await expect(page.getByTestId('rate-comm-0')).toHaveValue('35');
    // The edit is durable-on-write; wait for the confirmation before navigating.
    await expect(page.getByTestId('settings-saved')).toBeVisible();

    await page.goto('/entry');
    await setCrusher(page, 'Hillview Granites');
    await page.getByTestId('entry-pass-type').selectOption('Pass');
    await expect(page.getByTestId('entry-comm-rate')).toHaveValue('35');
  });

  test('re-autopopulates when the pass type changes', async ({ page }) => {
    await page.goto('/entry');
    await setCrusher(page, 'Riverside Crusher');
    await expect(page.getByTestId('entry-quary-rate')).toHaveValue('610');

    await page.getByTestId('entry-pass-type').selectOption('Pass');
    // Pass rows use a different quary rate than WO Pass.
    await expect(page.getByTestId('entry-quary-rate')).not.toHaveValue('610');
  });

  test('an overridden rate cell is marked edited and survives re-render', async ({ page }) => {
    await page.goto('/entry');
    await setCrusher(page, 'Riverside Crusher');
    await expect(page.getByTestId('entry-quary-rate')).toHaveValue('610');

    await page.getByTestId('entry-quary-rate').fill('700');
    const quaryCell = page.getByTestId('entry-quary-rate').locator('xpath=..');
    await expect(quaryCell).toContainText('edited');

    // Typing a quantity must not quietly reset the override back to the chart value.
    await page.getByTestId('entry-qty').fill('10');
    await expect(page.getByTestId('entry-quary-rate')).toHaveValue('700');
  });

  test('the override is snapshotted onto the saved row', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-date').fill('2026-07-30');
    await setCrusher(page, 'Riverside Crusher');
    await page.getByTestId('entry-quary-rate').fill('700');
    await page.getByTestId('entry-qty').fill('10');
    await saveEntry(page);

    // The staged row carries the typed rate rather than the chart's 610.
    await expect(page.locator('[data-testid^="draft-quaryRate-"]').first()).toHaveValue('700');
  });

  test('an edited rate survives a crusher change; untouched cells re-populate', async ({
    page,
  }) => {
    await page.goto('/entry');
    await setCrusher(page, 'Riverside Crusher');
    const crusherRateBefore = await page.getByTestId('entry-crusher-rate').inputValue();

    // Type over the quary rate, then switch crusher: the edited cell must stay
    // put (edited always beats autofill), while untouched cells re-resolve.
    await page.getByTestId('entry-quary-rate').fill('999');
    await page.getByTestId('entry-crusher').fill('Eastfield Metal Crusher');
    await expect(page.getByTestId('entry-quary-rate')).toHaveValue('999');
    await expect(page.getByTestId('entry-crusher-rate')).not.toHaveValue(crusherRateBefore);
  });

  test('an added row lands on the stack above the entry row', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-date').fill('2026-07-30');
    await page.getByTestId('entry-crusher').fill('Sheet Test Crusher');
    await page.getByTestId('entry-qty').fill('12.5');
    await saveEntry(page);

    await expect(page.locator('.sheet__saved')).toHaveCount(1);
    await expect(page.getByTestId('entry-day-summary')).toContainText('1 rows');

    // The next load carries everything but the quantity, so it is type-and-Enter.
    await expect(page.getByTestId('entry-crusher')).toHaveValue('Sheet Test Crusher');
    await page.getByTestId('entry-qty').fill('7.5');
    await saveEntry(page);

    await expect(page.locator('.sheet__saved')).toHaveCount(2);
    await expect(page.getByTestId('entry-day-summary')).toContainText('20.00 t');
  });

  test('highlights a saved rate that differs from the current chart', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-date').fill('2026-07-30');
    await setCrusher(page, 'Riverside Crusher');

    // Row 1: rates exactly as the chart fills them — nothing to flag.
    await page.getByTestId('entry-qty').fill('10');
    await saveEntry(page);
    await expect(page.locator('.sheet__saved')).toHaveCount(1);
    await expect(page.locator('.sheet__saved--differs')).toHaveCount(0);

    // Row 2: the quary rate typed over — that cell must stand out afterwards.
    await page.getByTestId('entry-quary-rate').fill('777');
    await page.getByTestId('entry-qty').fill('11');
    await saveEntry(page);

    await expect(page.locator('.sheet__saved')).toHaveCount(2);
    const flagged = page.locator('.sheet__saved--differs');
    await expect(flagged).toHaveCount(1);
    // A draft cell is a live input, so the flagged value is its value.
    await expect(flagged.locator('input')).toHaveValue('777');
    // The legend counts it too.
    await expect(page.locator('body')).toContainText('Differs from the chart');
  });

  test('the highlight survives a reload, since it is derived from the snapshot', async ({
    page,
  }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-date').fill('2026-07-30');
    await setCrusher(page, 'Riverside Crusher');
    await page.getByTestId('entry-rent-rate').fill('456');
    await page.getByTestId('entry-qty').fill('10');
    await saveEntry(page);
    await expect(page.locator('.sheet__saved--differs')).toHaveCount(1);

    await page.reload();
    await page.getByTestId('entry-date').fill('2026-07-30');
    await expect(page.locator('.sheet__saved--differs')).toHaveCount(1);
  });

  test('Enter adds the row without touching the button', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-date').fill('2026-07-30');
    // The save button is the form's default button, so Enter cannot submit while
    // it is still disabled waiting on the seed. setCrusher waits that out.
    await setCrusher(page, 'Riverside Crusher');
    await page.getByTestId('entry-qty').fill('9');
    await page.getByTestId('entry-qty').press('Enter');

    await expect(page.getByTestId('entry-qty')).toHaveValue('');
    await expect(page.locator('.sheet__saved')).toHaveCount(1);
  });

  test('a load pressed in before the seed lands is held, never saved with zero rates', async ({
    page,
  }) => {
    // Reproduces the CI-only window locally: interactive form, no rate chart yet.
    // 'commit' matters — waiting for 'load' would sit out the whole delay, which
    // is precisely how this window stayed invisible on a fast machine.
    await delaySeedChunks(page, 6000);
    await page.goto('/entry', { waitUntil: 'commit' });
    await page.getByTestId('entry-crusher').fill('Riverside Crusher');
    await page.getByTestId('entry-qty').fill('9');

    // Saving is refused rather than snapshotting a row with 0 rates, and the
    // reason is on screen rather than the keystroke vanishing silently.
    await expect(page.getByTestId('entry-save')).toBeDisabled();
    await expect(page.getByTestId('entry-quary-rate')).toHaveValue('0');
    await page.getByTestId('entry-qty').press('Enter');
    await expect(page.locator('.sheet__saved')).toHaveCount(0);
    await expect(page.getByText('Loading the rate chart…')).toBeVisible();

    // The typed quantity survives the wait, and the row saves with real rates.
    await expect(page.getByTestId('entry-save')).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByTestId('entry-qty')).toHaveValue('9');
    await expect(page.getByTestId('entry-quary-rate')).toHaveValue('610');
    await page.getByTestId('entry-qty').press('Enter');

    await expect(page.getByTestId('entry-qty')).toHaveValue('');
    await expect(page.locator('.sheet__saved')).toHaveCount(1);
    await expect(page.locator('[data-testid^="draft-quaryRate-"]').first()).toHaveValue('610');
  });

  test('the grid scrolls sideways but the page does not, even at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/entry');

    // The sheet itself is wider than its box — that is where the scrolling happens.
    // Polled, not sampled once: a bare evaluate() straight after goto can measure
    // before the grid has laid out and read an un-overflowed box.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const box = document.querySelector('.sheet-scroll');
            return box ? box.scrollWidth - box.clientWidth : 0;
          }),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    // Only meaningful once the grid is actually overflowing its box.
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow, 'the page must not scroll horizontally').toBeLessThanOrEqual(1);
  });

  test('focusing a cell scrolls it into view instead of leaving it off screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/entry');

    const scrollLeft = () =>
      page.evaluate(() => document.querySelector('.sheet-scroll')?.scrollLeft ?? -1);
    expect(await scrollLeft()).toBe(0);

    // The vehicle cell is far to the right of a 375px viewport.
    await page.getByTestId('entry-vehicle').focus();
    await expect.poll(scrollLeft, { timeout: 5000 }).toBeGreaterThan(0);
  });
});

test.describe('drafts, inline actions and sync', () => {
  test('a crusher-less load stages as a flagged draft and is held from sync', async ({
    page,
  }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-date').fill('2026-07-30');
    // No crusher at all — the quarry's raw data arrives without one.
    await page.getByTestId('entry-qty').fill('14');
    await saveEntry(page);

    // Staged as a draft with an empty (editable) crusher cell, and not syncable.
    await expect(page.locator('.sheet__saved--draft')).toHaveCount(1);
    await expect(page.locator('[data-testid^="draft-crusher-"]').first()).toHaveValue('');
    await expect(page.getByTestId('entry-sync-drafts')).toBeDisabled();
    await expect(page.getByTestId('entry-held-note')).toContainText('1 draft');

    // Durable like everything else: still there after a reload.
    await page.reload();
    await page.getByTestId('entry-date').fill('2026-07-30');
    await expect(page.locator('.sheet__saved--draft')).toHaveCount(1);

    // And the Ledger has NOT gained a row.
    await page.goto('/ledger');
    await page.getByTestId('ledger-show-all').click();
    await expectLoadCount(page, SEED_ROWS);
  });

  test('completing a draft inline and syncing moves it to the ledger', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-date').fill('2026-07-30');
    await page.getByTestId('entry-qty').fill('14');
    await saveEntry(page);
    await expect(page.locator('.sheet__saved--draft')).toHaveCount(1);

    // Draft cells are live: typing the crusher INTO THE ROW autofills its
    // rates from the chart — no pencil, no separate edit step.
    await page.locator('[data-testid^="draft-crusher-"]').first().fill('Riverside Crusher');
    await expect(page.locator('[data-testid^="draft-quaryRate-"]').first()).toHaveValue('610');
    await page.keyboard.press('Escape'); // close the type-ahead panel

    // Complete now — one syncable draft, no held note.
    await expect(page.getByTestId('entry-sync-drafts')).toBeEnabled();
    await expect(page.getByTestId('entry-sync-drafts')).toContainText('Save 1 to ledger');
    await syncDrafts(page);

    // The draft chip is gone (the row is a ledger row on the sheet now)...
    await expect(page.locator('.sheet__saved--draft')).toHaveCount(0);
    await expect(page.locator('.sheet__saved')).toHaveCount(1);
    // ...and the Ledger tab counts it.
    await page.goto('/ledger');
    await page.getByTestId('ledger-show-all').click();
    await expectLoadCount(page, SEED_ROWS + 1);
  });

  test('deleting a row from the sheet can be undone with the same id', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-date').fill('2026-07-30');
    await setCrusher(page, 'Riverside Crusher');
    await page.getByTestId('entry-qty').fill('9');
    await saveEntry(page);

    const savedRow = page.locator('.sheet__saved').first();
    const rowTestId = await savedRow.getAttribute('data-testid');
    expect(rowTestId).toBeTruthy();

    await page.locator('[data-testid^="entry-row-delete-"]').first().click();
    await waitForToast(page, 'Draft deleted');
    await expect(page.locator('.sheet__saved')).toHaveCount(0);

    // Undo restores the identical row — same data-testid means same id.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId(rowTestId!)).toBeVisible();
  });
});

test.describe('print and save as PDF', () => {
  /** Replace window.print so the browser dialog never blocks the run. */
  async function stubPrint(page: Page): Promise<void> {
    await page.addInitScript(() => {
      (window as unknown as { __printCalls: number }).__printCalls = 0;
      window.print = () => {
        (window as unknown as { __printCalls: number }).__printCalls += 1;
      };
    });
  }

  const printCalls = (page: Page) =>
    page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls);

  test('offers a section picker and prints the chosen sections', async ({ page }) => {
    await stubPrint(page);
    await page.goto('/reports');

    await page.getByTestId('reports-print').click();
    // The open report is pre-ticked; add the two all-time sections.
    await page.getByTestId('print-section-crusher').click();
    await page.getByTestId('print-section-monthly').click();
    await page.getByTestId('print-confirm').click();

    await expect.poll(() => printCalls(page), { timeout: 15_000 }).toBe(1);

    // The print block holds exactly the chosen sections.
    const printed = (await page.getByTestId('report-print').textContent()) ?? '';
    expect(printed).toContain('Daily summary');
    expect(printed).toContain('Crusher-wise');
    expect(printed).toContain('Monthly');
    expect(printed).not.toContain('Vehicle rent —');
  });

  test('prints the golden all-time totals', async ({ page }) => {
    await stubPrint(page);
    await page.goto('/reports');
    await page.getByTestId('reports-print').click();
    await page.getByTestId('print-section-crusher').click();
    await page.getByTestId('print-confirm').click();
    await expect.poll(() => printCalls(page), { timeout: 15_000 }).toBe(1);

    // Same figure the on-screen report and the golden totals carry.
    const printed = (await page.getByTestId('report-print').textContent()) ?? '';
    expect(printed).toContain('1,24,636');
  });

  test('cancelling prints nothing', async ({ page }) => {
    await stubPrint(page);
    await page.goto('/reports');
    await page.getByTestId('reports-print').click();
    await page.getByTestId('print-cancel').click();
    expect(await printCalls(page)).toBe(0);
  });

  test('cannot print with every section unticked', async ({ page }) => {
    await stubPrint(page);
    await page.goto('/reports');
    await page.getByTestId('reports-print').click();
    // Untick the pre-selected section, leaving nothing to print.
    await page.getByTestId('print-section-daily').click();
    await expect(page.getByTestId('print-confirm')).toBeDisabled();
  });

  test('print media hides the app shell and reveals the report', async ({ page }) => {
    await stubPrint(page);
    await page.goto('/reports');
    await page.getByTestId('reports-print').click();
    await page.getByTestId('print-section-crusher').click();
    await page.getByTestId('print-confirm').click();
    await expect.poll(() => printCalls(page), { timeout: 15_000 }).toBe(1);

    await page.emulateMedia({ media: 'print' });
    // The nav and the interactive report UI must not reach the paper.
    await expect(page.getByTestId('report-print')).toBeVisible();
    await expect(page.getByTestId('reports-view')).toBeHidden();
    await expect(page.getByTestId('reports-print')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
  });
});
