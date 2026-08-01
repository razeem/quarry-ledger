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
 * Strings that appear only in the bundled seed JSON, never in app code.
 *
 * The seed arrives as content-hashed chunks, so there is no stable filename to
 * match on — `delaySeedChunks` finds them by looking for these instead.
 */
const SEED_MARKERS = ['Hillview Granites', 'Northgate Crusher'];

/**
 * Hold back the lazily-imported seed chunks by `ms`, so the window where the app
 * is interactive but unseeded is wide enough to assert on.
 *
 * This is the CI-only race made reproducible: four separate e2e failures came
 * from tests acting inside that window, and none of them reproduced on a fast
 * machine even at 20x CPU throttle. Call this before `page.goto`.
 */
export async function delaySeedChunks(page: Page, ms: number): Promise<void> {
  await page.route(/chunk-[\w-]+\.js(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (SEED_MARKERS.some((marker) => body.includes(marker))) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    await route.fulfill({ response, body });
  });
}

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

// --- Party ledger ------------------------------------------------------------

/** The party seed ships 35 verified rows across 5 parties. */
export const PARTY_SEED_ROWS = 35;

/**
 * Grand totals from `data/party-golden-totals.json`, as the UI renders them
 * (whole rupees, en-IN grouping).
 */
export const PARTY_GOLDEN_RECEIVABLE = '8,55,175';
export const PARTY_GOLDEN_PAYABLE = '6,18,897';
export const PARTY_GOLDEN_RENT = '1,67,801';
export const PARTY_GOLDEN_PROFIT = '75,045';

/** Switch to the seeded sample party book via the sidebar account switcher. */
export async function openPartyBook(page: Page): Promise<void> {
  await page.getByTestId('account-switcher').click();
  await page.getByTestId('account-item-party-sample').click();
  await expect(page).toHaveURL(/\/party\/entry$/);
}

/**
 * Pick a party and wait for its rate config to autopopulate the rate cells —
 * the party twin of `setCrusher`, guarding the same lazy-seed window.
 */
export async function setParty(page: Page, name: string): Promise<void> {
  await page.getByTestId('party-entry-party').fill(name);
  await expect(page.getByTestId('party-entry-quary-rate')).not.toHaveValue('0');
}

/** Save the party entry form; the cleared quantity is the durability signal. */
export async function savePartyEntry(page: Page): Promise<void> {
  await page.getByTestId('party-entry-save').click();
  await expect(page.getByTestId('party-entry-qty')).toHaveValue('');
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
