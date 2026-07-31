import { test, expect, type Page } from '@playwright/test';

/**
 * The spreadsheet-style entry row, and printing the reports.
 *
 * Entry is used on a tablet or laptop, but must still work on a phone: the grid
 * scrolls sideways inside its own box while the page itself never does.
 */

async function saveEntry(page: Page): Promise<void> {
  // The button is disabled until the store is seeded, so this also waits out the
  // first-run load rather than saving a row with un-populated rates.
  await page.getByTestId('entry-save').click();
  // The quantity clears only once the write has landed.
  await expect(page.getByTestId('entry-qty')).toHaveValue('');
}

/**
 * Pick a crusher and wait for the chart to autopopulate the rate cells.
 *
 * Saving before the chart lands would snapshot every rate as 0, so any test that
 * asserts on rates must wait for the prefill rather than assume it. A zero quary
 * rate is the tell that it has not arrived yet.
 */
async function setCrusher(page: Page, name: string): Promise<void> {
  await page.getByTestId('entry-crusher').fill(name);
  await expect(page.getByTestId('entry-quary-rate')).not.toHaveValue('0');
}

test.describe('sheet entry row', () => {
  test('autopopulates the rate cells from the chart and badges them', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-crusher').fill('AVK');

    // WO Pass is the default; AVK WO Pass is ₹610 quary in the seeded chart.
    await expect(page.getByTestId('entry-quary-rate')).toHaveValue('610');
    await expect(page.getByTestId('entry-crusher-rate')).not.toHaveValue('0');

    // Untouched auto cells are badged 'auto'.
    const quaryCell = page.getByTestId('entry-quary-rate').locator('xpath=..');
    await expect(quaryCell).toContainText('auto');
  });

  test('takes the comm rate from the rate chart, per crusher and pass type', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-crusher').fill('AVK');

    // AVK WO Pass carries the usual ₹20 commission...
    await expect(page.getByTestId('entry-comm-rate')).toHaveValue('20');

    // ...while AVK Pass runs at ₹0 in the seeded chart. A single global rate could
    // not express that, which is why comm lives on the chart entry.
    await page.getByTestId('entry-pass-type').selectOption('Pass');
    await expect(page.getByTestId('entry-comm-rate')).toHaveValue('0');
  });

  test('a comm rate edited in Settings autopopulates the next row', async ({ page }) => {
    await page.goto('/settings');
    // Row 0 of the seeded chart is MR Granites / Pass.
    await expect(page.getByTestId('rate-crusher-0')).toHaveValue('MR Granites');
    await page.getByTestId('rate-comm-0').fill('35');
    await expect(page.getByTestId('rate-comm-0')).toHaveValue('35');
    // The edit is durable-on-write; wait for the confirmation before navigating.
    await expect(page.getByTestId('settings-saved')).toBeVisible();

    await page.goto('/entry');
    await page.getByTestId('entry-crusher').fill('MR Granites');
    await page.getByTestId('entry-pass-type').selectOption('Pass');
    await expect(page.getByTestId('entry-comm-rate')).toHaveValue('35');
  });

  test('re-autopopulates when the pass type changes', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-crusher').fill('AVK');
    await expect(page.getByTestId('entry-quary-rate')).toHaveValue('610');

    await page.getByTestId('entry-pass-type').selectOption('Pass');
    // Pass rows use a different quary rate than WO Pass.
    await expect(page.getByTestId('entry-quary-rate')).not.toHaveValue('610');
  });

  test('an overridden rate cell is marked edited and survives re-render', async ({ page }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-crusher').fill('AVK');
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
    await setCrusher(page, 'AVK');
    await page.getByTestId('entry-quary-rate').fill('700');
    await page.getByTestId('entry-qty').fill('10');
    await saveEntry(page);

    // 10 t x ₹700 = ₹7,000 quary amount, from the typed rate rather than the chart's 610.
    const sheet = page.locator('.sheet__saved').first();
    await expect(sheet).toContainText('700');
  });

  test('changing crusher drops a stale override so new chart rates apply', async ({ page }) => {
    await page.goto('/entry');
    await setCrusher(page, 'AVK');
    await page.getByTestId('entry-quary-rate').fill('999');
    await expect(page.getByTestId('entry-quary-rate')).toHaveValue('999');

    // A different crusher means different chart rates; the old override must not stick.
    await page.getByTestId('entry-crusher').fill('Al Falah metal crusher');
    await expect(page.getByTestId('entry-quary-rate')).not.toHaveValue('999');
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
    await setCrusher(page, 'AVK');

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
    await expect(flagged).toHaveText('777');
    // The legend counts it too.
    await expect(page.locator('body')).toContainText('Differs from the chart');
  });

  test('the highlight survives a reload, since it is derived from the snapshot', async ({
    page,
  }) => {
    await page.goto('/entry');
    await page.getByTestId('entry-date').fill('2026-07-30');
    await setCrusher(page, 'AVK');
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
    await page.getByTestId('entry-crusher').fill('AVK');
    await page.getByTestId('entry-qty').fill('9');
    await page.getByTestId('entry-qty').press('Enter');

    await expect(page.getByTestId('entry-qty')).toHaveValue('');
    await expect(page.locator('.sheet__saved')).toHaveCount(1);
  });

  test('the grid scrolls sideways but the page does not, even at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/entry');

    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow, 'the page must not scroll horizontally').toBeLessThanOrEqual(1);

    // The sheet itself is wider than its box — that is where the scrolling happens.
    const scrollable = await page.evaluate(() => {
      const box = document.querySelector('.sheet-scroll');
      return box ? box.scrollWidth > box.clientWidth : false;
    });
    expect(scrollable, 'the sheet box should scroll horizontally').toBe(true);
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
