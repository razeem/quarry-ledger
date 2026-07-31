/**
 * Regenerate `public/og-image.png` — the link-preview card.
 *
 *   node scripts/generate-og-image.mjs
 *
 * The card is defined as HTML here rather than checked in as an opaque binary, so
 * it can be re-rendered when the palette or the tagline changes. It reuses the
 * app's own design tokens (see src/styles.scss) and the favicon's rock mark.
 *
 * Rendered with the Playwright chromium already installed for e2e. Only system
 * fonts are used: a web font would have to load over the network mid-screenshot,
 * which silently falls back and shifts the layout.
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og-image.png');

/** Matches --accent-1/--accent-2 and the dark --bg in src/styles.scss. */
const ACCENT_1 = '#e07a1f';
const ACCENT_2 = '#f5c33b';
const BG = '#0b1120';

/** 1.91:1, the ratio Open Graph and Twitter both render at. */
const WIDTH = 1200;
const HEIGHT = 630;

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        background: ${BG};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: #f8fafc;
        overflow: hidden;
        position: relative;
      }
      /* The app's ambient glow, dialled up for a 1200px canvas. */
      .glow {
        position: absolute;
        border-radius: 50%;
        filter: blur(90px);
      }
      .glow--1 {
        width: 620px; height: 620px; top: -260px; left: -160px;
        background: color-mix(in srgb, ${ACCENT_1} 34%, transparent);
      }
      .glow--2 {
        width: 520px; height: 520px; bottom: -240px; right: -120px;
        background: color-mix(in srgb, ${ACCENT_2} 22%, transparent);
      }
      /* Faint ledger ruling, so the card reads as a book of rows. */
      .rules {
        position: absolute; inset: 0;
        background: repeating-linear-gradient(
          to bottom,
          transparent 0 63px,
          rgba(248, 250, 252, 0.045) 63px 64px
        );
      }
      .card {
        position: relative;
        height: 100%;
        /* Generous margins: previews get cropped to squarer ratios in some feeds. */
        padding: 72px 76px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .top { display: flex; align-items: center; gap: 26px; }
      .mark { width: 96px; height: 96px; border-radius: 23px; flex: none; }
      .wordmark {
        font-size: 27px; font-weight: 600; letter-spacing: 0.16em;
        text-transform: uppercase; color: rgba(248, 250, 252, 0.62);
      }
      h1 {
        font-size: 84px; line-height: 1.04; font-weight: 800; letter-spacing: -0.035em;
      }
      h1 .accent {
        background: linear-gradient(120deg, ${ACCENT_1}, ${ACCENT_2});
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      /* One line, not two: a wrapped subtitle crowds the chips below it. */
      p {
        margin-top: 24px; font-size: 30px; font-weight: 400;
        color: rgba(248, 250, 252, 0.76); white-space: nowrap;
      }
      .chips { display: flex; gap: 14px; }
      .chip {
        font-size: 24px; font-weight: 500;
        padding: 14px 26px; border-radius: 999px;
        color: rgba(248, 250, 252, 0.88);
        background: rgba(248, 250, 252, 0.07);
        border: 1px solid rgba(248, 250, 252, 0.14);
      }
      .chip--lead {
        color: ${BG}; font-weight: 700; border-color: transparent;
        background: linear-gradient(120deg, ${ACCENT_1}, ${ACCENT_2});
      }
    </style>
  </head>
  <body>
    <div class="glow glow--1"></div>
    <div class="glow glow--2"></div>
    <div class="rules"></div>
    <div class="card">
      <div class="top">
        <!-- The favicon's mark: two rock loads stacked over a ledger baseline. -->
        <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="${ACCENT_1}" />
              <stop offset="1" stop-color="${ACCENT_2}" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="15" fill="url(#g)" />
          <path d="M14 40 L23 25 L32 40 Z" fill="#fff" fill-opacity=".95" />
          <path d="M30 40 L40 21 L50 40 Z" fill="#fff" />
          <rect x="12" y="44" width="40" height="4" rx="2" fill="#fff" fill-opacity=".8" />
        </svg>
        <span class="wordmark">Quarry Ledger</span>
      </div>

      <div>
        <h1>Every load,<br /><span class="accent">counted once.</span></h1>
        <p>Offline-first ledger for quarry load brokerage.</p>
      </div>

      <div class="chips">
        <span class="chip chip--lead">Works offline</span>
        <span class="chip">Installs as an app</span>
        <span class="chip">Rent, commission &amp; profit</span>
      </div>
    </div>
  </body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  // Render at 2x then downscale, so the text edges stay clean.
  deviceScaleFactor: 2,
});
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: OUT, scale: 'css' });
await browser.close();

console.log(`Wrote ${OUT} (${WIDTH}x${HEIGHT})`);
