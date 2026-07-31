import { expect, type Page } from '@playwright/test';

/**
 * Shared e2e helpers.
 *
 * These exist because the app has two asynchronous facts every test has to
 * respect, and duplicating the waits per spec is how they get forgotten:
 *
 * 1. **The first-run seed is lazy.** `data/*.json` arrives as dynamically
 *    imported chunks, so the entry form is interactive before the rate chart
 *    exists. On a slow runner the rate cells read `0` for a noticeable window —
 *    read or assert one before `setCrusher` resolves and you capture a `0`.
 * 2. **Writes are durable before they are confirmed.** The app only clears the
 *    quantity, navigates, or shows a toast once IndexedDB has the change, so
 *    those are the signals to wait on. Navigating earlier races the write.
 *
 * Select by `data-testid` only — never by CSS class.
 */

/** The seed ships 143 verified rows. */
export const SEED_ROWS = 143;

/**
 * All-time figures from `data/golden-totals.json`, as the UI renders them
 * (whole rupees, en-IN grouping). profit = 3062202.03 − 2686790 − 250775.75.
 */
export const GOLDEN_ALL_TIME_PROFIT = '1,24,636';
export const GOLDEN_ALL_TIME_DISCOUNT = '74,354';

/**
 * Pick a crusher and wait for the rate chart to autopopulate the rate cells.
 *
 * Use this before reading, asserting on, or overriding any rate. A zero quary
 * rate is the tell that the seeded chart has not landed yet.
 */
export async function setCrusher(page: Page, name: string): Promise<void> {
  await page.getByTestId('entry-crusher').fill(name);
  await expect(page.getByTestId('entry-quary-rate')).not.toHaveValue('0');
}

/**
 * Save the entry form and wait until the write has actually landed.
 *
 * The button stays disabled until the store is seeded, so this also waits out the
 * first-run load rather than saving a row with un-populated rates. The quantity
 * clears only after the row is on disk, which is the durability signal.
 */
export async function saveEntry(page: Page): Promise<void> {
  await page.getByTestId('entry-save').click();
  await expect(page.getByTestId('entry-qty')).toHaveValue('');
}

/**
 * Save an edit and wait for the write to land. Updating returns to the Ledger, so
 * arriving there is the durability signal.
 */
export async function saveEdit(page: Page): Promise<void> {
  await page.getByTestId('entry-save').click();
  await expect(page).toHaveURL(/\/ledger$/);
}

/** Wait for a snackbar message — shown only after the action's write completes. */
export async function waitForToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 30_000 });
}

/** Open the Ledger tab and widen the filter to every row on record. */
export async function openFullLedger(page: Page): Promise<void> {
  await page.goto('/ledger');
  await page.getByTestId('ledger-show-all').click();
}

/** The "Showing N loads" count from the Ledger tab's range summary. */
export async function visibleLoadCount(page: Page): Promise<number> {
  const text = (await page.getByTestId('ledger-range-summary').textContent()) ?? '';
  return Number(/Showing\s+(\d+)/.exec(text)?.[1] ?? '-1');
}

export async function expectLoadCount(page: Page, expected: number): Promise<void> {
  await expect.poll(() => visibleLoadCount(page), { timeout: 15_000 }).toBe(expected);
}
