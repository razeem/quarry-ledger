import { test, expect } from '@playwright/test';

// App-shell smoke tests: routing, theming, the PWA manifest and offline serving.
// Select by data-testid, never by CSS class. Each test gets a fresh Playwright
// context, so IndexedDB state never leaks between tests.

/** An element unique to each tab, used to confirm the route actually rendered. */
const TAB_MARKER: Record<string, string> = {
  entry: 'entry-save',
  ledger: 'ledger-range-summary',
  reports: 'reports-view',
  settings: 'settings-discount-rate',
};

test('lands on the Entry tab', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/entry$/);
  await expect(page.getByTestId('entry-save')).toBeVisible();
  await expect(page).toHaveTitle(/Entry · Quarry Ledger/);
});

test('navigates between all four tabs', async ({ page }) => {
  await page.goto('/entry');
  for (const tab of ['ledger', 'reports', 'settings', 'entry']) {
    await page.getByTestId(`nav-${tab}`).click();
    await expect(page).toHaveURL(new RegExp(`/${tab}$`));
    await expect(page.getByTestId(TAB_MARKER[tab])).toBeVisible();
  }
});

test('falls back to Entry for an unknown route', async ({ page }) => {
  await page.goto('/no-such-tab');
  await expect(page).toHaveURL(/\/entry$/);
});

test('persists the theme choice across a reload', async ({ page }) => {
  await page.goto('/entry');

  // Default is 'system' (no data-theme attribute); one click cycles it to 'light'.
  // `toHaveAttribute` retries, so this does not race the zoneless effect flush.
  await page.getByTestId('theme-cycle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // The write-through to IndexedDB is debounced; let it settle before reloading.
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('opens the settings dialog', async ({ page }) => {
  await page.goto('/entry');
  await page.getByTestId('settings-gear').click();
  await expect(page.getByTestId('theme-toggle')).toBeVisible();
});

test('serves an installable PWA manifest and icons', async ({ page, request }) => {
  await page.goto('/entry');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    'manifest.webmanifest',
  );

  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);

  const body = (await manifest.json()) as {
    name: string;
    start_url: string;
    display: string;
    icons: { sizes: string; purpose?: string }[];
  };
  expect(body.name).toBe('Quarry Ledger');
  expect(body.display).toBe('standalone');
  // Installability needs a 192px and a 512px icon, plus a maskable one.
  expect(body.icons.map((i) => i.sizes)).toContain('192x192');
  expect(body.icons.map((i) => i.sizes)).toContain('512x512');
  expect(body.icons.some((i) => i.purpose?.includes('maskable'))).toBe(true);

  for (const icon of ['/icon-192.png', '/icon-512.png', '/favicon.svg']) {
    expect((await request.get(icon)).ok(), icon).toBe(true);
  }
});

test('serves a link-preview card with absolute URLs', async ({ page, request }) => {
  await page.goto('/entry');

  const meta = (property: string) =>
    page.locator(`meta[property="${property}"]`).getAttribute('content');

  expect(await meta('og:title')).toBe('Quarry Ledger');
  expect(await meta('og:image:width')).toBe('1200');
  expect(await meta('og:image:height')).toBe('630');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    'content',
    'summary_large_image',
  );

  // A relative og:image is the classic way a preview silently stops rendering:
  // crawlers do not resolve <base href>, which the Pages build rewrites anyway.
  const image = await meta('og:image');
  expect(image).toMatch(/^https:\/\//);
  expect(await meta('og:url')).toMatch(/^https:\/\//);

  // The card itself has to be on disk at the name the tag points at.
  const card = await request.get('/og-image.png');
  expect(card.ok()).toBe(true);
  expect(card.headers()['content-type']).toContain('image/png');
  expect(image?.endsWith('/og-image.png')).toBe(true);
});

test('serves the app shell offline once the service worker has installed', async ({
  page,
  context,
}) => {
  await page.goto('/entry');

  // Registration is deferred until the app reports stable, then the worker has to
  // install and prefetch the shell before it can serve anything.
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker?.getRegistration())?.active,
    null,
    { timeout: 60_000 },
  );

  // The worker only controls the page from the next navigation onwards.
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
    timeout: 30_000,
  });

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByTestId('entry-save')).toBeVisible();
    // Lazy route chunks must come from the cache too, not the network.
    await page.getByTestId('nav-reports').click();
    await expect(page.getByTestId('reports-view')).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('works on a 375px-wide phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/entry');

  // The sidebar becomes an overlay; the hamburger is what opens it.
  await expect(page.getByTestId('nav-open-mobile')).toBeVisible();
  await page.getByTestId('nav-open-mobile').click();
  await page.getByTestId('nav-reports').click();
  await expect(page.getByTestId('reports-view')).toBeVisible();

  // Nothing may overflow horizontally on the narrowest supported screen.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
