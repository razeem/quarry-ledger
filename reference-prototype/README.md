# Quarry Ledger — PWA

Offline-first ledger app. The **Daily Ledger is the single source of truth**; every report
(Daily Summary, Vehicle Rent, Crusher wise, Monthly Commission) is computed live from it.

Comes pre-loaded with 143 rows (Nov-25, Mar-26, 29-Jul-26), the rate chart, and 91 vehicles
from `source-workbook-v5.xlsx`.

## How to run

The app is static files — any web host works. A service worker (offline mode + install prompt)
requires HTTPS or localhost.

**Easiest (free hosting, ~2 minutes):**
1. Go to https://app.netlify.com/drop (or GitHub Pages / Cloudflare Pages)
2. Drag the whole `quarry-ledger-app` folder onto the page
3. Open the URL it gives you on your phone → browser menu → **Add to Home Screen**

**Local test on your computer:**
```
cd quarry-ledger-app
python -m http.server 8080     # then open http://localhost:8080
```

Opening `index.html` directly (file://) also works for a quick look, but offline caching
and install are disabled in that mode.

## Daily use

- **Entry** — pick crusher + Pass/WO Pass and rates auto-fill from the Rate Chart
  (editable per entry). Amounts, profit, and discount preview live. Save.
- **Ledger** — browse/edit/delete rows, filtered by date range.
- **Reports** — Daily summary, Vehicle Rent by date, Crusher-wise totals, Monthly commission.
- **Settings** — edit the rate chart and vehicle list, export, import, erase.

## Backup & team workflow (important)

Data is stored **on the device** (browser IndexedDB). Protect it:

- **Export Excel** or **Backup JSON** regularly (Settings tab).
- Every row has a hidden unique ID, so **Import / Merge** combines files without duplicates:
  teammates export their file, send it to you (WhatsApp etc.), you import → merged.
- Clearing the browser's site data erases the ledger — export first.

## Formula reference (identical to the spreadsheet)

| Value | Formula |
|---|---|
| Crusher Amount | QTY × Crusher Rate |
| SUN Quary Amount | ROUND(QTY × Quary Rate, -1) |
| Vehicle Rent | QTY × Rent rate (own vehicles: 0) |
| Profit | Crusher Amount − Quary Amount − Vehicle Rent |
| Monthly Discount | QTY × Commission rate (₹20/ton where applicable) |
