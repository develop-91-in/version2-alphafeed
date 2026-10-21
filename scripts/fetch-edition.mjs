// ALPHA FEED — Automatic edition fetcher (GitHub Actions, every 30 min) — v2.1
// Runs with Node 20/24, no API key, no AI tokens. Parses RSS XML directly.
// This is the REAL refresh job: it fetches fresh RSS for every news section and
// fresh market data (Indian + global indices), then writes data/edition.json,
// data/market.json, data/ipos.json, data/earnings.json and data/macro.json.
// The page loads those files on open and on every refresh.
//
// Rules: finance only (sports / Bollywood / entertainment filtered out), keep only
// ORIGINAL pubDate within last 24h, dedup by normalised title, preserve source + link.
// Market: Yahoo Finance UNOFFICIAL chart endpoint — no SLA, may change / rate-limit.
// If it fails, market.json keeps DATA NOT CONNECTED; prices are never invented.
// MCX: Yahoo has NO official MCX symbol. MCX Gold/Silver/Crude are DERIVED from
// COMEX futures (GC=F, SI=F, CL=F) x USD/INR and labelled as such. For official MCX
// quotes, add a licensed feed. US 10Y yield: Yahoo ^TNX is quoted x10; we divide.

import fs from "node:fs";

const RETENTION = 24 * 60 * 60 * 1000;

// Exact spec order (Macro & Stats is a table, not a news feed, so not in FEEDS).
// EACH FEED URL APPEARS EXACTLY ONCE, in its primary section. Duplicate feeds across
// sections + global dedup starved later sections (v2 bug). IPO / Earnings have NO
// dedicated feeds — they are populated by reassignment from markets / business /
// top-stories (see reassignSection).
// Reuters feeds returned HTTP 401 on 19 Oct 2026 check — kept (may recover) but
// BBC / ET / Al Jazeera carry the edition in the meantime. Do not claim Reuters
// is working.
const FEEDS = [
  {section:"top-stories", name:"Reuters Top", url:"https://www.reuters.com/rssFeed/topNews"},
  {section:"top-stories", name:"BBC News", url:"https://feeds.bbci.co.uk/news/rss.xml"},
  {section:"indian-markets", name:"Economic Times Markets", url:"https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"},
  {section:"indian-markets", name:"Moneycontrol Markets", url:"https://www.moneycontrol.com/rss/marketstats.xml"},
  {section:"indian-economy", name:"Economic Times Economy", url:"https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms"},
  {section:"indian-economy", name:"RBI Press Releases", url:"https://www.rbi.org.in/Scripts/RSS.aspx"},
  {section:"global-markets", name:"Reuters Business", url:"https://www.reuters.com/rssFeed/businessNews"},
  {section:"global-markets", name:"BBC Business", url:"https://feeds.bbci.co.uk/news/business/rss.xml"},
  {section:"global-news", name:"Reuters World", url:"https://www.reuters.com/rssFeed/worldNews"},
  {section:"global-news", name:"BBC World", url:"https://feeds.bbci.co.uk/news/world/rss.xml"},
  {section:"global-news", name:"Al Jazeera", url:"https://www.aljazeera.com/xml/rss/all.xml"},
  {section:"technology", name:"BBC Technology", url:"https://feeds.bbci.co.uk/news/technology/rss.xml"},
  {section:"technology", name:"The Verge", url:"https://www.theverge.com/rss/index.xml"},
  {section:"business", name:"Economic Times Industry", url:"https://economictimes.indiatimes.com/industry/rssfeeds/13357270.cms"},
];
const LABELS = {"top-stories":"Top Stories","indian-markets":"Indian Markets","indian-economy":"Indian Economy","ipo-centre":"IPO Centre","earnings-calls":"Earnings Calls","global-markets":"Global Markets","global-news":"Global News","technology":"Technology","business":"Business"};

// ---- Finance-only filter (word boundaries on short keywords — bare "war" matched
// "warrant"/"awarded", bare "oil" matched "foil", etc.) ----
const BLOCKED_RE = /\b(cricket|football|soccer|tennis|badminton|hockey|ipl|afcon|fifa|uefa|caf\b|world cup|premier league|champions league|man city|manchester|arsenal|chelsea|haaland|sport| sports|bollywood|hollywood|actor|actress|singer|rapper|movie|film star|web series|bigg boss|reality show|celebrity|gossip|beauty pageant|miss universe|oscar|grammy|concert|stand-?up comedy|esports|video game|playstation|xbox|netflix show|tv show|soap opera|daily soap|fashion week|red carpet|wedding of|marriage of|divorce of|separation|baby shower)\b/i;
const FINANCE_RE = /(\bmarket(s)?\b|\bnifty\b|\bsensex\b|\bstock(s)?\b|\bshare(s)?\b|economy|\bgdp\b|inflation|\brbi\b|\bbank(s)?\b|finance|investment|\bipo\b|earnings|profit|revenue|\btrade\b|\btariff(s)?\b|\brupee\b|\bdollar(s)?\b|\bgold\b|\bsilver\b|\bcrude\b|\boil\b|\bbond(s)?\b|\byield(s)?\b|interest rate|fiscal|\bbudget\b|\btax\b|startup|funding|merger|acquisition|\bdeal(s)?\b|business|industry|commodit|forex|central bank|\bfed\b(?!\s+up\b)|\bfederal reserve\b|\becb\b|\bimf\b|world bank|\bsebi\b|\bnse\b|\bbse\b|mutual fund|insurance|pension|\bdebt\b|deficit|exports|imports|manufacturing|services pmi|forex reserves)/i;
const GEO_FINANCE_RE = /(\btrade\b|\btariff(s)?\b|\bsanction(s)?\b|\bwar\b|\bconflict\b|\bceasefire\b|\benergy\b|\boil\b|\bgas\b|supply chain|central bank|interest rate|inflation|\brecession\b|\bdebt\b|\btreaty\b|\bembargo\b|\bblockade\b|\bmilitary\b|geopolitic|diplomac|\bsummit\b|\bmarket(s)?\b|economy|finance|investment|commodit|\bpipeline\b|\bstrait\b|\bnato\b|united nations|\bg7\b|\bg20\b|\bbrics\b|\bopec\b|european union)/i;
const TECH_FINANCE_RE = /(ai\b|artificial intelligence|semiconductor|\bchip(s)?\b|fintech|startup|funding|\bipo\b|earnings|acquisition|merger|investment|valuation|data centre|datacenter|\bcloud\b|openai|nvidia|microsoft|google|amazon|\bmeta\b|reliance jio|\bjio\b|telecom|\b5g\b|digital economy|cybersecurity|blockchain|quantum|robotics|electric vehicle|\bev\b|battery|satellite.*deal|space.*deal)/i;
const GADGET_DEAL_RE = /(\$\d+\s*off|is \$\d+ off|deal.*sale|discount.*deal|best buy.*deal|price cut.*deal)/i;
const IPO_RE = /(?:\bipo\b|initial public offering|listing gains?|listing date|listing price|stock market listing|market listing|dual-listing|to list on|lists? on (?:the )?(?:bse|nse|nasdaq|nyse|stock exchange)|\ballotment\b|\bsubscription\b|grey market|\bgmp\b|price band|book-?built|offer for sale|\bdrhp\b|\brhp\b|prospectus|anchor investor)/i;
const EARNINGS_RE = /\b(earnings|quarterly results|quarterly profit|net profit|profit (rises|rose|falls|fell|jumps|dips)|revenue (rises|rose|falls|fell)|results (beat|miss)|investor presentation|earnings call|q[1-4]\b.*(profit|revenue|results)|board meeting.*results)\b/i;
const SPORTS_URL_RE = /\/(sports?|entertainment|showbiz|bollywood|celebrity)\//i;

function isBlocked(a){
  const t = (a.title + " " + (a.desc || "")).toLowerCase();
  if (BLOCKED_RE.test(t)) return true;
  if (SPORTS_URL_RE.test(a.link || "")) return true;
  if (a.section === "technology" && GADGET_DEAL_RE.test(t)) return true;
  return false;
}
function passesSectionFilter(a){
  const t = a.title + " " + (a.desc || "");
  if (a.section === "top-stories") return FINANCE_RE.test(t) || /economic times/i.test(a.source || "");
  if (a.section === "global-news") return GEO_FINANCE_RE.test(t.replace(/tear gas/gi, " "));
  // BBC Business also carries lifestyle/consumer pieces ("dating", "bus music
  // fines") whose descriptions mention a "market" — require the finance /
  // geopolitics signal in the TITLE itself for this section.
  if (a.section === "global-markets") return FINANCE_RE.test(a.title) || GEO_FINANCE_RE.test(a.title.replace(/tear gas/gi, " "));
  if (a.section === "technology") return TECH_FINANCE_RE.test(t);
  return true;
}
function reassignSection(a){
  // Guard: never steal from Indian Economy, Global News or Technology — an economy
  // article mentioning "profit" is still an economy article. Only markets /
  // business / top-stories feed IPO Centre and Earnings Calls.
  if (a.section === "indian-economy" || a.section === "global-news" || a.section === "technology") return a.section;
  const t = a.title + " " + (a.desc || "");
  if (IPO_RE.test(t)) return "ipo-centre";
  if (EARNINGS_RE.test(t)) return "earnings-calls";
  return a.section;
}

function pick(tag, xml){
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]+>/g,"").trim() : "";
}
function pickLink(xml){
  const m = xml.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || xml.match(/<link[^>]+href="([^"]+)"/i);
  return m ? m[1].trim() : "";
}
async function fetchFeed(f){
  try{
    const r = await fetch(f.url, {headers:{"User-Agent":"AlphaFeed/1.0 (news aggregator; contact: Jatin Singh)"}});
    if(!r.ok) return [];
    const text = await r.text();
    const items = [...text.matchAll(/<item>[\s\S]*?<\/item>/gi)].map(m=>m[0]);
    const entries = [...text.matchAll(/<entry>[\s\S]*?<\/entry>/gi)].map(m=>m[0]);
    const blocks = items.length ? items : entries;
    return blocks.map(b=>({
      title: pick("title", b),
      desc: pick("description", b) || pick("summary", b),
      link: pickLink(b),
      pubDate: pick("pubDate", b) || pick("published", b) || pick("updated", b),
      image: "",
      source: f.name,
      section: f.section,
      sectionLabel: LABELS[f.section] || f.section,
    })).filter(a=>a.title && a.link);
  }catch(e){ console.warn("Feed failed", f.name, e.message); return []; }
}

// ---- Market data (Yahoo Finance unofficial endpoint) ----
// INDIAN: NIFTY/SENSEX/NIFTY BANK/USDINR direct. MCX: derived from COMEX futures.
// GLOBAL: major world indices + commodities + US 10Y yield, so the Global Markets
// board and ticker keep moving even when Indian markets are closed (weekends,
// holidays like Dussehra). ^=index, .SS=Shanghai, =F futures. ^TNX is rescaled to
// % only when quoted x10 (see US 10Y YIELD handler).
async function yahooMeta(yahoo){
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=1d&range=5d`, {headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok) return null;
  const j = await r.json();
  return j?.chart?.result?.[0]?.meta ?? null;
}
async function fetchMarket(){
  const items = [];
  const push = async (symbol, yahoo, region, dec, unit, label) => {
    try{
      const meta = await yahooMeta(yahoo);
      if(!meta || meta.regularMarketPrice==null) return;
      let price = meta.regularMarketPrice, chg = meta.fulldayChange ?? 0, pct = meta.fulldayChangePercent ?? meta.regularMarketChangePercent ?? 0;
      // ^TNX: some responses quote it x10 (412.5 = 4.125%), others already in %
      // (5.14). A real 10Y yield sits well under 20 — only rescale the x10 form.
      if (symbol === "US 10Y YIELD" && price > 20){ price = price/10; chg = chg/10; }
      items.push({symbol, label: label || symbol, region, price:+price.toFixed(4), change:+Number(chg).toFixed(4), changePct:+Number(pct).toFixed(2), dec, unit: unit || "", timestamp:new Date().toISOString(), source:"Yahoo Finance (unofficial)"});
    }catch(e){ console.warn("Market failed", symbol, e.message); }
  };
  // Indian markets (values freeze on exchange holidays/weekends — normal)
  await push("NIFTY 50", "%5ENSEI", "India", 2);
  await push("SENSEX", "%5EBSESN", "India", 2);
  await push("NIFTY BANK", "%5ENSEBANK", "India", 2);
  await push("USD/INR", "INR=X", "India", 2);
  // Sector indices — used by the page to compose a live Sector Watch line
  await push("NIFTY IT", "%5ECNXIT", "Sector", 2);
  await push("NIFTY AUTO", "%5ECNXAUTO", "Sector", 2);
  await push("NIFTY PHARMA", "%5ECNXPHARMA", "Sector", 2);
  await push("NIFTY FMCG", "%5ECNXFMCG", "Sector", 2);
  await push("NIFTY METAL", "%5ECNXMETAL", "Sector", 2);
  await push("NIFTY ENERGY", "%5ECNXENERGY", "Sector", 2);
  await push("NIFTY REALTY", "%5ECNXREALTY", "Sector", 2);
  await push("NIFTY PSU BANK", "%5ECNXPSUBANK", "Sector", 2);
  await push("NIFTY MIDCAP 50", "%5ENSEMDCP50", "Sector", 2);
  await push("NIFTY INFRA", "%5ECNXINFRA", "Sector", 2);
  await push("NIFTY MEDIA", "%5ECNXMEDIA", "Sector", 2);
  // Global indices (move while India sleeps — the point of the global board)
  await push("S&P 500", "%5EGSPC", "United States", 2);
  await push("NASDAQ", "%5EIXIC", "United States", 2);
  await push("DOW JONES", "%5EDJI", "United States", 2);
  await push("FTSE 100", "%5EFTSE", "United Kingdom", 2);
  await push("DAX", "%5EGDAXI", "Germany", 2);
  await push("NIKKEI 225", "%5EN225", "Japan", 0);
  await push("HANG SENG", "%5EHSI", "Hong Kong", 2);
  await push("KOSPI", "%5EKS11", "South Korea", 0);
  await push("SHANGHAI COMP", "000001.SS", "China", 2);
  // Commodities & yields
  await push("BRENT", "BZ%3DF", "Global", 2, "$/bbl", "BRENT CRUDE");
  await push("WTI", "CL%3DF", "Global", 2, "$/bbl", "WTI CRUDE");
  await push("GOLD SPOT", "GC%3DF", "Global", 2, "$/oz");
  await push("SILVER SPOT", "SI%3DF", "Global", 3, "$/oz");
  await push("US 10Y YIELD", "%5ETNX", "United States", 2, "%");
  // COMEX-derived MCX (approx — not an official MCX feed)
  let usdinr = items.find(i=>i.symbol==="USD/INR")?.price;
  if(!usdinr){ const m = await yahooMeta("INR=X"); usdinr = m?.regularMarketPrice; }
  if(usdinr){
    try{
      const gc = await yahooMeta("GC%3DF");
      if(gc?.regularMarketPrice!=null){
        const price = gc.regularMarketPrice * usdinr / 31.1035 * 10;
        items.push({symbol:"MCX GOLD", label:"MCX GOLD", region:"India", price:+price.toFixed(0), change:+((gc.fulldayChange ?? 0) * usdinr / 31.1035 * 10).toFixed(0), changePct:+Number(gc.fulldayChangePercent ?? 0).toFixed(2), dec:0, unit:"₹/10g", timestamp:new Date().toISOString(), source:"Derived from COMEX GC=F x USD/INR — approx"});
      }
      const si = await yahooMeta("SI%3DF");
      if(si?.regularMarketPrice!=null){
        const price = si.regularMarketPrice * usdinr / 31.1035 * 1000;
        items.push({symbol:"MCX SILVER", label:"MCX SILVER", region:"India", price:+price.toFixed(0), change:+((si.fulldayChange ?? 0) * usdinr / 31.1035 * 1000).toFixed(0), changePct:+Number(si.fulldayChangePercent ?? 0).toFixed(2), dec:0, unit:"₹/kg", timestamp:new Date().toISOString(), source:"Derived from COMEX SI=F x USD/INR — approx"});
      }
      const cl = await yahooMeta("CL%3DF");
      if(cl?.regularMarketPrice!=null){
        const price = cl.regularMarketPrice * usdinr;
        items.push({symbol:"MCX CRUDE", label:"MCX CRUDE", region:"India", price:+price.toFixed(0), change:+((cl.fulldayChange ?? 0) * usdinr).toFixed(0), changePct:+Number(cl.fulldayChangePercent ?? 0).toFixed(2), dec:0, unit:"₹/bbl", timestamp:new Date().toISOString(), source:"Derived from WTI CL=F x USD/INR — approx"});
      }
    }catch(e){ console.warn("MCX derived failed", e.message); }
  }
  return {
    generatedAt:new Date().toISOString(),
    source:"Yahoo Finance unofficial endpoint — no SLA, may change",
    note:"Indian indices freeze on exchange holidays/weekends (normal). MCX Gold/Silver/Crude are DERIVED from COMEX futures x USD/INR, approx — not an official MCX feed. For official MCX, add a licensed feed.",
    items
  };
}

// ---- Shared helpers for the calendar / macro builders ----
const BROWSER_UA = {"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept":"text/html,application/json"};
function stripTags(s){ return String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#8377;/g, "₹").replace(/\s+/g, " ").trim(); }
function istTodayISO(){ return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10); }
function isoPlusDays(iso, n){ const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function fmtD(iso){ const d = new Date(iso + "T00:00:00Z"); return isNaN(d) ? "" : d.toLocaleDateString("en-IN", {day:"numeric", month:"short", year:"numeric", timeZone:"UTC"}); }
function fmtDRange(openISO, closeISO){
  const o = new Date(openISO + "T00:00:00Z"), c = new Date(closeISO + "T00:00:00Z");
  if (isNaN(o) || isNaN(c)) return "";
  if (o.getUTCFullYear() === c.getUTCFullYear() && o.getUTCMonth() === c.getUTCMonth())
    return o.getUTCDate() + " " + o.toLocaleDateString("en-IN", {month:"short", timeZone:"UTC"}) + " – " + c.getUTCDate() + " " + c.toLocaleDateString("en-IN", {month:"short", year:"numeric", timeZone:"UTC"});
  return fmtD(openISO) + " – " + fmtD(closeISO);
}
const MONTHS = {january:0, february:1, march:2, april:3, may:4, june:5, july:6, august:7, september:8, october:9, november:10, december:11, jan:0, feb:1, mar:2, apr:3, jun:5, jul:6, aug:7, sep:8, sept:8, oct:9, nov:10, dec:11};
function parseDateText(txt){
  const m = String(txt || "").match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return "";
  const mo = MONTHS[m[1].toLowerCase()];
  if (mo == null) return "";
  return m[3] + "-" + String(mo + 1).padStart(2, "0") + "-" + String(+m[2]).padStart(2, "0");
}

// ---- IPO calendar (Chittorgarh dashboard + detail pages, scraped, no key) ----
// If the scrape fails or parses too little, the previous data/ipos.json is kept
// untouched — good data is never overwritten by an empty parse. The page also
// computes each IPO's status from its dates at render time.
function parseCtgDetail(html){
  const fields = {};
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]));
    if (cells.length >= 2 && cells[0] && cells[1]){ const k = cells[0].toLowerCase(); if (!(k in fields)) fields[k] = cells[1]; }
  }
  const get = (...names) => { for (const n of names){ for (const k of Object.keys(fields)){ if (k.includes(n)) return fields[k]; } } return ""; };
  const ipoDateTxt = get("ipo date");
  let openISO = "", closeISO = "";
  const pad = (n) => String(n).padStart(2, "0");
  const rng = ipoDateTxt.match(/(\d{1,2})\s*(?:to|-|–)\s*(\d{1,2})\s+([A-Za-z]+),?\s*(\d{4})/);
  const rng2 = ipoDateTxt.match(/(\d{1,2})\s+([A-Za-z]+)\s*(?:to|-|–)\s*(\d{1,2})\s+([A-Za-z]+),?\s*(\d{4})/);
  if (rng && MONTHS[rng[3].toLowerCase()] != null){
    const mo = MONTHS[rng[3].toLowerCase()];
    openISO = rng[4] + "-" + pad(mo + 1) + "-" + pad(rng[1]);
    closeISO = rng[4] + "-" + pad(mo + 1) + "-" + pad(rng[2]);
  } else if (rng2 && MONTHS[rng2[2].toLowerCase()] != null && MONTHS[rng2[4].toLowerCase()] != null){
    openISO = rng2[5] + "-" + pad(MONTHS[rng2[2].toLowerCase()] + 1) + "-" + pad(rng2[1]);
    closeISO = rng2[5] + "-" + pad(MONTHS[rng2[4].toLowerCase()] + 1) + "-" + pad(rng2[3]);
  } else {
    const dm = ipoDateTxt.match(/([A-Za-z]+ \d{1,2}, \d{4})[\s\S]*?([A-Za-z]+ \d{1,2}, \d{4})/);
    if (dm){ openISO = parseDateText(dm[1]); closeISO = parseDateText(dm[2]); }
  }
  const listingISO = parseDateText(get("listing date"));
  let size = get("total issue size", "issue size");
  const crM = size.match(/₹\s*([\d,]+(?:\.\d+)?)\s*Cr/i) || size.match(/([\d,]+(?:\.\d+)?)\s*(?:Crores?|Cr)\b/i);
  if (crM) size = "₹" + Number(crM[1].replace(/,/g, "")).toLocaleString("en-IN") + " cr";
  else { const n = size.replace(/,/g, "").match(/([\d.]+)/); size = n ? "₹" + Number(n[1]).toLocaleString("en-IN") + " cr" : "—"; }
  let band = get("price band");
  const bnums = (band.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (bnums.length >= 2) band = "₹" + bnums[0].toLocaleString("en-IN") + " – ₹" + bnums[1].toLocaleString("en-IN");
  else if (bnums.length === 1) band = "₹" + bnums[0].toLocaleString("en-IN") + " (issue price)";
  else band = "—";
  return { openISO, closeISO, listingISO, size, band, listingAt: get("listing at"), issueType: get("issue type") };
}
async function fetchCtgLinks(url){
  const r = await fetch(url, { headers: BROWSER_UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return [];
  const t = await r.text();
  const out = [], seen = new Set();
  for (const m of t.matchAll(/<a[^>]+href="(\/ipo\/[a-z0-9\-]+\/\d+\/)"[^>]*>([\s\S]*?)<\/a>/gi)){
    if (seen.has(m[1])) continue; seen.add(m[1]);
    out.push({ href: m[1], name: stripTags(m[2]) });
  }
  return out;
}
async function fetchIpos(){
  try{
    let links = [];
    for (const u of ["https://www.chittorgarh.com/ipo/ipo_dashboard.asp", "https://www.chittorgarh.com/ipo/ipo_dashboard.asp?a=sme"]){
      try{ links.push(...await fetchCtgLinks(u)); }catch(e){ console.warn("IPO dashboard failed", u, e.message); }
    }
    const byHref = new Map(); for (const l of links) if (!byHref.has(l.href)) byHref.set(l.href, l);
    links = [...byHref.values()].slice(0, 26);
    if (!links.length) throw new Error("no IPO links found on dashboards");
    const today = istTodayISO();
    const keepFrom = isoPlusDays(today, -12);
    const entries = [];
    for (let i = 0; i < links.length; i += 5){
      const got = await Promise.all(links.slice(i, i + 5).map(async (l) => {
        try{
          const r = await fetch("https://www.chittorgarh.com" + l.href, { headers: BROWSER_UA, signal: AbortSignal.timeout(20000) });
          if (!r.ok) return null;
          const f = parseCtgDetail(await r.text());
          if (!f.openISO || !f.closeISO || f.closeISO < keepFrom) return null;
          let co = l.name || "";
          if (!co || co.length < 3) return null;
          const sme = /SME/i.test(f.listingAt) || /SME/i.test(f.issueType);
          const note = (f.listingAt || "BSE · NSE").replace(/,/g, " ·").replace(/\s+/g, " ").trim();
          return { co, note, size: f.size, band: f.band, dates: fmtDRange(f.openISO, f.closeISO),
                   listing: f.listingISO ? fmtD(f.listingISO) : "To be announced",
                   openISO: f.openISO, closeISO: f.closeISO, listingISO: f.listingISO, _sme: sme };
        }catch(e){ return null; }
      }));
      entries.push(...got.filter(Boolean));
    }
    if (entries.length < 3) throw new Error("too few IPOs parsed: " + entries.length);
    const rank = (e) => (e.openISO <= today && today <= e.closeISO) ? 0 : (e.openISO > today ? 1 : 2);
    const sortFn = (a, b) => (rank(a) - rank(b)) || (rank(a) === 2 ? (a.closeISO < b.closeISO ? 1 : -1) : (a.openISO < b.openISO ? -1 : 1));
    const clean = (e) => { const { _sme, ...rest } = e; return rest; };
    const mainboard = entries.filter(e => !e._sme).sort(sortFn).slice(0, 14).map(clean);
    const sme = entries.filter(e => e._sme).sort(sortFn).slice(0, 10).map(clean);
    fs.writeFileSync("data/ipos.json", JSON.stringify({ generatedAt: new Date().toISOString(), source: "Chittorgarh IPO dashboard + detail pages (scraped, unofficial) — verify in the RHP before applying", mainboard, sme }, null, 2));
    console.log(`IPOs: ${mainboard.length} mainboard + ${sme.length} SME -> data/ipos.json`);
    return true;
  }catch(e){ console.warn("IPO fetch failed (keeping previous data/ipos.json):", e.message); return false; }
}

// ---- Earnings calendar (NSE event calendar, unofficial API) ----
async function fetchEarningsCalendar(){
  try{
    const warm = await fetch("https://www.nseindia.com/", { headers: BROWSER_UA, signal: AbortSignal.timeout(20000) });
    const cookie = (warm.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
    const r = await fetch("https://www.nseindia.com/api/event-calendar", { headers: { ...BROWSER_UA, "Accept": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("NSE calendar HTTP " + r.status);
    const j = await r.json();
    const MON = {Jan:"01", Feb:"02", Mar:"03", Apr:"04", May:"05", Jun:"06", Jul:"07", Aug:"08", Sep:"09", Oct:"10", Nov:"11", Dec:"12"};
    const today = istTodayISO(), until = isoPlusDays(today, 8);
    const quarterOf = (desc) => /September 30/i.test(desc) ? "Q2 FY27 results announcement"
      : /June 30/i.test(desc) ? "Q1 FY27 results announcement"
      : /December 31/i.test(desc) ? "Q3 FY27 results announcement"
      : /March 31/i.test(desc) ? "Q4 FY26 results announcement" : "Financial results announcement";
    const entries = [];
    for (const e of j){
      if (!/financial results/i.test(e.purpose || "")) continue;
      const m = String(e.date || "").match(/(\d{2})-([A-Za-z]{3})-(\d{4})/);
      if (!m || !MON[m[2]]) continue;
      const iso = m[3] + "-" + MON[m[2]] + "-" + m[1];
      if (iso < today || iso > until) continue;
      entries.push({ dateISO: iso, co: e.company || e.symbol || "", tk: e.symbol || "", type: quarterOf(e.bm_desc || "") });
    }
    entries.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : (a.co < b.co ? -1 : 1)));
    if (entries.length < 5) throw new Error("too few earnings entries: " + entries.length);
    fs.writeFileSync("data/earnings.json", JSON.stringify({ generatedAt: new Date().toISOString(), source: "NSE event calendar (unofficial API) — board-meeting dates for financial results; call times are not published here", entries: entries.slice(0, 220) }, null, 2));
    console.log(`Earnings calendar: ${entries.length} result events (${today} to ${until}) -> data/earnings.json`);
    return true;
  }catch(e){ console.warn("Earnings calendar failed (keeping previous data/earnings.json):", e.message); return false; }
}

// ---- Macro & Stats (monthly official prints are curated; USD/INR is live) ----
// CPI / WPI / CFPI / repo change only on official release days, so those rows are
// curated values with their release labels. USD/INR is rewritten from the live
// market fetch on every run. The India 10Y G-Sec row has no reliable free live
// source, so it stays a clearly-dated manual snapshot instead of a fake live row.
function buildMacroJson(market){
  const inr = market.items.find(i => i.symbol === "USD/INR");
  const todayTxt = fmtD(istTodayISO());
  const inrRow = inr
    ? { ind:"USD / INR", val: inr.price.toFixed(2), prev: (inr.price - inr.change).toFixed(2), rel: todayTxt + " · Auto-updated from live market data", next:"—", pub:true, src:"Yahoo Finance (unofficial)", url:"https://finance.yahoo.com/quote/INR=X" }
    : { ind:"USD / INR", val:"94.75", prev:"94.97", rel:"19 Oct 2026 · Rupee +22 paise", next:"—", pub:true, src:"IANS via New Kerala", url:"" };
  const rows = [
    { ind:"Retail Inflation (CPI)", val:"5.54%", prev:"4.83%", rel:"Sep 2026 · Released 12 Oct 2026", next:"To be announced", pub:true, src:"NSO (MoSPI)", url:"" },
    { ind:"Wholesale Inflation (WPI)", val:"11.39%", prev:"9.92%", rel:"Sep 2026", next:"To be announced", pub:true, src:"Office of the Economic Adviser", url:"" },
    { ind:"Food Inflation (CFPI)", val:"7.74%", prev:"5.97%", rel:"Sep 2026 · Released 12 Oct 2026", next:"To be announced", pub:true, src:"NSO (MoSPI)", url:"" },
    { ind:"RBI Repo Rate", val:"5.50%", prev:"5.25%", rel:"MPC decision · 7 Oct 2026 (+25 bps)", next:"Next MPC: Dec 2026 (RBI calendar)", pub:true, src:"RBI", url:"" },
    { ind:"India 10-Year G-Sec Yield", val:"7.3551%", prev:"7.3789%", rel:"19 Oct 2026 · Manual snapshot — no free live source", next:"—", pub:true, src:"The Hindu BusinessLine (Reuters)", url:"" },
    inrRow
  ];
  fs.writeFileSync("data/macro.json", JSON.stringify({ generatedAt: new Date().toISOString(), source: "Official monthly prints (curated) + live USD/INR from market data", rows }, null, 2));
  console.log("Macro: data/macro.json written (USD/INR " + (inr ? "live @ " + inr.price : "fallback") + ")");
}

const all = [];
for(const f of FEEDS){ const it = await fetchFeed(f); all.push(...it); }
const cutoff = Date.now()-RETENTION;
const seen = new Set();
const kept = all.filter(a=>{
  if (isBlocked(a)) return false;
  if (!passesSectionFilter(a)) return false;
  const section = reassignSection(a);
  a.section = section; a.sectionLabel = LABELS[section] || section;
  const t = new Date(a.pubDate).getTime();
  if(isNaN(t) || t<cutoff) return false;
  const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  if(seen.has(key)) return false; seen.add(key); return true;
}).sort((a,b)=>new Date(b.pubDate)-new Date(a.pubDate));

// Top Stories is a CURATED VIEW, not an exclusive bucket: the 8 most recent
// finance / geopolitics-relevant articles, copied into Top Stories while keeping
// the originals in their sections.
const topCopies = kept.filter(a => a.section !== "top-stories" && (FINANCE_RE.test(a.title + " " + (a.desc || "")) || GEO_FINANCE_RE.test((a.title + " " + (a.desc || "")).replace(/tear gas/gi, " ")))).slice(0, 8).map(a => ({...a, section:"top-stories", sectionLabel:"Top Stories"}));
const finalArticles = [...topCopies, ...kept];

const market = await fetchMarket();
fs.mkdirSync("data",{recursive:true});
fs.writeFileSync("data/edition.json", JSON.stringify({generatedAt:new Date().toISOString(), articles:finalArticles, market}, null, 2));
fs.writeFileSync("data/market.json", JSON.stringify(market, null, 2));
console.log(`Kept ${kept.length} unique articles (24h, finance-only) + ${topCopies.length} Top Stories copies • Market items: ${market.items.length}`);
const bySec = {}; for (const a of finalArticles) bySec[a.section] = (bySec[a.section]||0)+1;
console.log("By section (incl. Top Stories copies):", JSON.stringify(bySec));
console.log("Market symbols:", market.items.map(i=>i.symbol).join(", "));
await fetchIpos();
await fetchEarningsCalendar();
buildMacroJson(market);
