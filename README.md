# ALPHA FEED — The World of Money, Decoded

A premium editorial financial newspaper for Indian readers, by Jatin Singh.
Static site (single `index.html`) + a server-side refresh job that rewrites the
data files every 30 minutes. The page ships with a compiled snapshot as an
instant fallback and replaces it with fresh data on load and on every refresh.

## What auto-updates (every ~30 minutes)

`scripts/fetch-edition.mjs` (plain Node, no API key) writes five files under
`data/`, and `index.html` ingests all five:

| File | Contents | Source |
| --- | --- | --- |
| `data/edition.json` | News for all 9 sections (24h, finance-only, deduped) + Top Stories view | RSS: ET, Moneycontrol, RBI, BBC, Al Jazeera, The Verge, Reuters (feeds that respond) |
| `data/market.json` | NIFTY / SENSEX / NIFTY BANK / USD-INR, 11 NIFTY sector indices, global indices, Brent/WTI, gold/silver spot, US 10Y, COMEX-derived MCX trio | Yahoo Finance unofficial chart endpoint |
| `data/ipos.json` | IPO table (mainboard + SME): size, price band, open–close dates, listing date | Chittorgarh IPO dashboard + detail pages (scraped) |
| `data/earnings.json` | Results calendar, today → +8 days | NSE event calendar (unofficial API), "Financial Results" board meetings only |
| `data/macro.json` | Macro & Stats table: CPI / WPI / CFPI / repo (curated official prints), USD/INR (live from market data), India 10Y G-Sec (dated manual snapshot) | NSO / OEA / RBI releases + Yahoo |

On the page, the refresh also rebuilds: the ticker, the Indian Markets board
(indices, sector watch, MCX cards), the Global Markets boards, the IPO table
(statuses — Upcoming / Open now / Closed / Listed — are computed from the issue
dates at render time, so they stay correct between scrapes), the earnings
calendar, and the Macro table.

Refresh drivers (both run the same fetcher):
- A Muse cron every 30 min (IST) that pushes only `data/*.json`.
- GitHub Actions (`.github/workflows/hourly-refresh.yml`, cron `*/30`) as backup.

If a scrape fails or parses too little, the previous data file is kept —
good data is never overwritten by an empty parse, and prices are never invented.

## Data honesty

- Yahoo Finance endpoint is **unofficial** — no SLA; Indian indices freeze on
  exchange holidays/weekends (normal).
- MCX Gold/Silver/Crude are **COMEX-derived estimates** (futures × USD/INR,
  ex-duty), not official MCX quotes.
- Chittorgarh and NSE calendar are unofficial scrapes; IPO details should be
  verified in the RHP before applying.
- Market breadth (BSE advances/declines) has no connected live feed — the board
  labels it as a dated snapshot.
- Reuters RSS returned HTTP 401 in checks on 19 Oct 2026; feeds are kept in the
  list but BBC / ET / Al Jazeera carry the edition meanwhile.

## Costs

₹0 in API keys. Muse cron runs use a small amount of tokens every 30 minutes;
the GitHub Actions route is free within GitHub's limits.
