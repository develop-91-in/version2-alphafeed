# ALPHA FEED — The World of Money, Decoded.

A financial newspaper by Jatin Singh. Developed by Jatin Singh.

Premium financial newspaper for Indian readers, in the GlobalPulse-style UI:
per-section pages (Top Stories, Indian Markets, Indian Economy, IPO Centre,
Earnings Calls, Global Markets, Global News, Technology, Macro & Stats
India-only, Business), centred masthead, search, Refresh, light/dark mode,
and a global indices board in Global Markets.

## Build

v2 is a **single-file build**: `index.html` is the whole site (HTML + CSS + JS
+ the edition snapshot embedded). `app.js` / `styles.css` are reference-only
stubs — the page does not load them. News summaries are short excerpts with
original source and link. No IPO terms, earnings-call times, macro values or
index levels are invented — only values present in the edition are shown.

## Refresh

- While the page is open, the in-page edition re-check runs every **30
  minutes** and prunes expired (>24h) stories.
- The scheduled workflow (`.github/workflows/hourly-refresh.yml`, cron
  `*/30 * * * *`) validates the snapshot on GitHub — it does **not** fetch
  new RSS. A fresh news edition is produced by re-exporting the approved
  preview and pushing the new `index.html`.

## Deploy via Vercel

1. In the Vercel dashboard, import this repo (`develop-91-in/version2-alphafeed`).
2. No build command needed (static). Deploy.
3. Every later push to `main` redeploys automatically once the project is
   git-linked to this repo.
