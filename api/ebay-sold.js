// api/ebay-sold.js — Vercel serverless proxy for eBay sold/completed listings
//
// Uses ScraperAPI for IP rotation when SCRAPERAPI_KEY env var is set.
// Without it, eBay returns "Pardon Our Interruption" bot-detection page.

const EBAY_SEARCH = 'https://www.ebay.com/sch/i.html';

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://boba-scanner.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const expectedToken = process.env.BOBA_API_SECRET;
  if (expectedToken) {
    if (req.headers['x-api-token'] !== expectedToken) return res.status(401).json({ error: 'Unauthorized' });
  }

  const { query, cardNumber, hero, athlete } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: 'Missing query' });

  try {
    const scrapeResult = await scrapeEbaySoldPage(query, cardNumber, hero, athlete);

    if (scrapeResult === 'BLOCKED') {
      return res.status(200).json({ blocked: true });
    }

    if (scrapeResult && scrapeResult.soldCount > 0) {
      console.log(`Returning ${scrapeResult.soldCount} sold items`);
      return res.status(200).json(scrapeResult);
    }

    return res.status(200).json({ lastSold: null, soldCount: 0, avgSoldPrice: null, soldItems: [] });

  } catch (err) {
    console.error('ebay-sold error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function scrapeEbaySoldPage(query, cardNumber, hero, athlete) {
  const ebayUrl = `${EBAY_SEARCH}?_nkw=${encodeURIComponent(query)}&_sacat=0&LH_Complete=1&LH_Sold=1&_sop=13&rt=nc&LH_TitleDesc=0`;
  const scraperApiKey = process.env.SCRAPERAPI_KEY;

  // render=true + premium=true: residential proxies + JS execution.
  // eBay's sold page loads results via async XHR — render=true is required.
  // premium=true uses residential IPs that are less detectable by eBay's bot filters.
  // Costs 25 ScraperAPI credits/request on premium+render.
  const fetchUrl = scraperApiKey
    ? `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(ebayUrl)}&country_code=us&render=true&premium=true&wait=8000`
    : ebayUrl;

  const headers = scraperApiKey ? {} : {
    'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control':   'no-cache',
    'Referer':         'https://www.google.com/',
  };

  let html;
  try {
    const response = await fetch(fetchUrl, { headers });
    if (!response.ok) { console.warn('eBay HTTP error:', response.status); return null; }
    html = await response.text();
  } catch (err) {
    console.warn('eBay network error:', err.message);
    return null;
  }

  console.log(`eBay HTML length: ${html.length} chars`);
  console.log('eBay HTML preview:', html.slice(0, 300).replace(/\s+/g, ' '));

  if (
    html.includes('Pardon Our Interruption') ||
    html.includes('captcha') ||
    html.includes('Robot Check') ||
    html.includes('h-captcha')
  ) {
    console.warn('eBay bot-detection page — SCRAPERAPI_KEY may not be set correctly');
    return 'BLOCKED';
  }

  if (html.length < 5000) {
    console.warn('HTML too short — likely blocked or redirected');
    return 'BLOCKED';
  }

  // ── Diagnostic: understand the HTML structure ───────────────────────────
  const hasSItem       = html.includes('s-item');
  const hasSCard       = html.includes('s-card');
  const hasSItemPrice  = html.includes('s-item__price');
  const hasSCardPrice  = html.includes('s-card__price');
  const hasSuCardPrice = html.includes('su-card__price');
  const hasPositive    = html.includes('POSITIVE');
  const sItemCount     = (html.match(/s-item/g) || []).length;
  const sCardCount     = (html.match(/s-card/g) || []).length;
  const srpResultsCount = (html.match(/srp-results/g) || []).length;
  const liCount        = (html.match(/<li\b/g) || []).length;
  console.log(`Diagnostics: s-item=×${sItemCount}, s-card=×${sCardCount}, s-item__price=${hasSItemPrice}, s-card__price=${hasSCardPrice}, su-card__price=${hasSuCardPrice}, POSITIVE=${hasPositive}, srp-results=×${srpResultsCount}, li=×${liCount}`);

  // Log the first ACTUAL <li class="s-card..."> element (not CSS occurrences)
  const liCardMatch = html.match(/<li\b[^>]*class="[^"]*s-card[^"]*"[^>]*>([\s\S]{0,600})/);
  if (liCardMatch) {
    console.log('First s-card li HTML:', (liCardMatch[0].slice(0, 700)).replace(/\s+/g, ' '));
  }

  const soldItems = [];

  // ── Strategy 1: Split on <li> s-card or s-item elements ─────────────────
  // Use lookahead split so the <li> opening tag stays in each chunk — needed
  // because aria-label (title) lives on the <li> tag itself in eBay's new markup.
  const itemChunks = html.split(/(?=<li\b[^>]*\b(?:s-card|s-item)\b)/i);
  console.log(`Item chunks: ${itemChunks.length - 1}`);
  if (itemChunks.length > 1) {
    console.log('First chunk preview:', itemChunks[1].slice(0, 700).replace(/\s+/g, ' '));
  }

  for (let i = 1; i < itemChunks.length; i++) {
    const raw = itemChunks[i];

    // The chunk starts with the <li> opening tag — grab it separately
    const liTagEnd = raw.indexOf('>');
    const liTag    = liTagEnd !== -1 ? raw.slice(0, liTagEnd + 1) : '';
    const body     = liTagEnd !== -1 ? raw.slice(liTagEnd + 1)    : raw;

    // Find the end of this item by tracking nested <li> depth
    let depth = 1, pos = 0, itemHtml = body;
    while (pos < body.length && depth > 0) {
      const nextOpen  = body.indexOf('<li', pos);
      const nextClose = body.indexOf('</li>', pos);
      if (nextClose === -1) { itemHtml = body; break; }
      if (nextOpen !== -1 && nextOpen < nextClose) { depth++; pos = nextOpen + 3; }
      else { depth--; if (depth === 0) itemHtml = body.slice(0, nextClose); pos = nextClose + 5; }
    }

    const fullItem = liTag + itemHtml;

    // Skip nav/placeholder items that have no price
    if (!fullItem.includes('$')) continue;

    // Extract URL — try href first, then build from data-listingid on <li>
    const urlMatch = fullItem.match(/href="(https?:\/\/www\.ebay\.com\/itm\/[^"]+)"/)
                  || fullItem.match(/href="([^"]*ebay\.com\/itm\/[^"]+)"/);
    const listingId = liTag.match(/data-listingid[=: ]*["']?(\d+)/i);
    const url = urlMatch ? urlMatch[1].split('?')[0]
              : listingId ? `https://www.ebay.com/itm/${listingId[1]}` : null;

    // Extract title — check <li> aria-label first, then new/old class names
    const titleMatch = liTag.match(/aria-label="([^"]+)"/)
                    || fullItem.match(/class="s-card__title[^"]*"[^>]*>(?:<[^>]+>)?([^<]+)/)
                    || fullItem.match(/class="s-item__title[^"]*"[^>]*>(?:<[^>]+>)?([^<]+)/)
                    || fullItem.match(/role="heading"[^>]*>([^<]+)</)
                    || fullItem.match(/aria-label="([^"]+)"/);
    const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

    // Extract price
    const price = extractPrice(fullItem);
    if (!price) continue;

    // Extract sold date
    const date = extractDate(fullItem);

    soldItems.push({ title, price, url, date });
  }

  // Log first parsed item for diagnostics
  if (soldItems.length > 0) {
    console.log(`Sample item[0]: title="${soldItems[0].title}" price=${soldItems[0].price} url=${soldItems[0].url}`);
  }

  console.log(`Strategy 1 (s-card split): ${soldItems.length} items`);

  // ── Strategy 2: Direct price+date extraction (if strategy 1 found nothing) ──
  if (soldItems.length === 0 && (hasSItemPrice || hasSCardPrice || hasSuCardPrice)) {
    console.log('Trying strategy 2: direct price regex...');
    const priceRegex = /s-item__price[^>]*>([\s\S]{0,150}?\$([\d,]+\.?\d*)[\s\S]{0,400}?(?:Sold|POSITIVE|endedDate)[\s\S]{0,200}?<)/gi;
    let m;
    while ((m = priceRegex.exec(html)) !== null) {
      const price = parseFloat(m[2].replace(/,/g, ''));
      if (isNaN(price) || price <= 0) continue;
      const context = html.slice(Math.max(0, m.index - 300), m.index + 600);
      const date = extractDate(context);
      const urlM = context.match(/href="(https?:\/\/www\.ebay\.com\/itm\/[^"]+)"/);
      const titleM = context.match(/role="heading"[^>]*>([^<]+)</) || context.match(/aria-label="([^"]+)"/);
      soldItems.push({
        price,
        date,
        url:   urlM ? urlM[1].split('?')[0] : null,
        title: titleM ? decodeEntities(titleM[1].trim()) : '',
      });
    }
    console.log(`Strategy 2 (direct regex): ${soldItems.length} items`);
  }

  // ── Strategy 3: Embedded JSON state ──────────────────────────────────────
  if (soldItems.length === 0) {
    console.log('Trying strategy 3: embedded JSON...');
    const jsonItems = extractFromEmbeddedJson(html);
    soldItems.push(...jsonItems);
    console.log(`Strategy 3 (embedded JSON): ${jsonItems.length} items`);
  }

  console.log(`Total raw items: ${soldItems.length}`);

  if (soldItems.length === 0) return null;

  const relevant = filterRelevantItems(soldItems, cardNumber, hero, athlete);
  console.log(`After filtering: ${relevant.length} items`);

  return formatSoldResponse(relevant);
}

// ── Price extraction helper ───────────────────────────────────────────────────
function extractPrice(html) {
  // Try all known eBay price class names (s-item__price = old, s-card__price / su-card__price = new)
  const blockMatch = html.match(/class="(?:s-item__|s-card__|su-card__)price"[^>]*>([\s\S]{0,200}?)<\/span>/i)
                  || html.match(/class='(?:s-item__|s-card__|su-card__)price'[^>]*>([\s\S]{0,200}?)<\/span>/i)
                  || html.match(/(?:s-item__|s-card__|su-card__)price[^>]*>([\s\S]{0,200}?)<\/(?:span|div)>/i);
  if (blockMatch) {
    const m = blockMatch[1].match(/\$?([\d,]+\.?\d*)/);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
  }
  // Last resort: any dollar amount in the item HTML
  const dollarMatch = html.match(/\$([\d,]+\.?\d{2})\b/);
  if (dollarMatch) return parseFloat(dollarMatch[1].replace(/,/g, ''));
  return null;
}

// ── Date extraction helper ────────────────────────────────────────────────────
function extractDate(html) {
  const m = html.match(/class="[^"]*POSITIVE[^"]*"[^>]*>[\s\S]*?(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i)
         || html.match(/class="[^"]*s-item__endedDate[^"]*"[^>]*>[\s\S]*?(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i)
         || html.match(/class="[^"]*s-item__caption[^"]*"[^>]*>[\s\S]*?(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i)
         || html.match(/Sold\s+(\w{3}\s+\d{1,2},?\s*\d{4})/i)
         || html.match(/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i);
  return m ? m[1].trim() : null;
}

// ── Embedded JSON extraction ──────────────────────────────────────────────────
function extractFromEmbeddedJson(html) {
  const items = [];

  // Patterns for eBay's various embedded state formats
  const patterns = [
    // eBay Marko / SRP state
    /"itemSummaries"\s*:\s*(\[[\s\S]{1,500000}?\])\s*[,}]/,
    /"listItems"\s*:\s*(\[[\s\S]{1,500000}?\])\s*[,}]/,
    /"items"\s*:\s*(\[[\s\S]{1,200000}?\])\s*[,}]/,
    /"searchResults"\s*:\s*\{[^}]{0,500}"items"\s*:\s*(\[[\s\S]{1,200000}?\])/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    try {
      const arr = JSON.parse(match[1]);
      if (!Array.isArray(arr) || arr.length === 0) continue;
      for (const item of arr) {
        const title = item.title || item.itemTitle || '';
        const priceVal = item.price?.value
                      || item.sellingStatus?.currentPrice?.value
                      || item.convertedCurrentPrice?.value
                      || null;
        const price = priceVal ? parseFloat(priceVal) : 0;
        if (isNaN(price) || price <= 0) continue;
        items.push({
          title,
          price,
          url:  item.itemWebUrl || item.viewItemURL || null,
          date: formatDate(item.itemEndDate || item.endTime || item.soldDate)
        });
      }
      if (items.length > 0) {
        console.log(`Found ${items.length} items in embedded JSON`);
        break;
      }
    } catch (e) { /* parse failed, try next pattern */ }
  }

  return items;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function filterRelevantItems(items, cardNumber, hero, athlete) {
  const cn = (cardNumber || '').toUpperCase();
  const h  = (hero || '').toUpperCase();
  const a  = (athlete || '').toUpperCase();
  if (!cn && (!h || h.length <= 2) && (!a || a.length <= 2)) return items;
  return items.filter(item => {
    const t = (item.title || '').toUpperCase();
    if (cn && t.includes(cn)) return true;
    if (h && h.length > 2 && t.includes(h)) return true;
    if (a && a.length > 2 && t.includes(a)) return true;
    return false;
  });
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return null; }
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/');
}

function formatSoldResponse(soldItems) {
  const validItems = soldItems.filter(i => !isNaN(i.price) && i.price > 0);
  if (validItems.length === 0) return { lastSold: null, soldCount: 0, avgSoldPrice: null, soldItems: [] };
  const prices = validItems.map(i => i.price);
  const avgSold = parseFloat((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2));
  const lastItem = validItems[0];
  return {
    lastSold:      { price: lastItem.price, date: lastItem.date, title: lastItem.title, url: lastItem.url },
    soldCount:     validItems.length,
    avgSoldPrice:  avgSold,
    lowSoldPrice:  parseFloat(Math.min(...prices).toFixed(2)),
    highSoldPrice: parseFloat(Math.max(...prices).toFixed(2)),
    soldItems:     validItems.slice(0, 10)
  };
}
