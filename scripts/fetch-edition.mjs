// ALPHA FEED — Automatic edition fetcher (GitHub Actions, every 30 min) — v2.1
// Runs with Node 20/24, no API key, no AI tokens. Parses RSS XML directly.
// This is the REAL refresh job: it fetches fresh RSS for every news section and
// fresh market data (Indian + global indices), then writes data/edition.json and
// data/market.json. The page loads those files on open and on every refresh.
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
