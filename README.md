# ALPHA FEED

A premium, editorial-style financial newspaper for Indian readers — by **Jatin Singh**.
Single-file edition (`index.html`) with per-section pages, a global indices board,
30-minute refresh and 24-hour news retention.

## How it stays fresh (automatic — no AI tokens, no API keys)

1. **Scheduled refresh job** — `.github/workflows/hourly-refresh.yml` runs
   `node scripts/fetch-edition.mjs` every 30 minutes on GitHub Actions. It:
   - pulls RSS feeds (BBC, Economic Times, Moneycontrol, RBI, Al Jazeera, The Verge;
     Reuters is kept but returned HTTP 401 on 19 Oct 2026 — check before relying),
   - keeps finance news only (sports / Bollywood / entertainment filtered out),
   - keeps only stories published in the last 24 hours, deduped by title,
   - fetches market data from Yahoo Finance's unofficial endpoint
     (NIFTY 50, SENSEX, NIFTY BANK, USD/INR, global indices S&P 500 / NASDAQ /
     Dow / FTSE 100 / DAX / Nikkei 225 / Hang Seng / KOSPI / Shanghai, Brent, WTI,
     gold & silver spot, US 10Y yield, and COMEX-derived MCX Gold/Silver/Crude —
     **derived, not an official MCX feed**),
   - writes `data/edition.json` and `data/market.json`, then commits them.
2. **The page picks the new data up itself** — on open and on every Refresh /
   30-minute check, `index.html` fetches `data/edition.json` + `data/market.json`
   (served with `Cache-Control: no-store`, see `vercel.json`) and re-renders every
   section, the ticker, the Global Markets indices board, and the earnings/IPO
   news lists. The compiled snapshot stays as the instant offline fallback.
3. **Manual run** — Actions → "ALPHA FEED — Auto Edition Refresh" → Run workflow.

## Costs (estimates — verify on each vendor's current pricing before relying)

- GitHub Actions on this public repo: unlimited free minutes for public repos
  (per github.com/pricing). The job takes ~30–60 s per run.
- Muse tokens after go-live: 0 — the refresh is plain code, not AI.
- No API keys in this repo. If a licensed feed is ever added, its key goes in
  GitHub Secrets, never committed.

## Data honesty

- Yahoo Finance endpoint is unofficial: no SLA, may change or rate-limit. If it
  fails, market cells show "Not connected" — prices are never invented.
- MCX Gold/Silver/Crude are derived from COMEX futures × USD/INR and labelled
  as such. For official MCX quotes, add a licensed feed.
- Indian indices freeze on exchange holidays (e.g. Dussehra) and weekends — that
  is normal; global indices keep moving and are shown on the Global Markets board.
