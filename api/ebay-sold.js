// api/ebay-sold.js — Vercel serverless proxy for eBay sold/completed listings
//
// Strategy 1: eBay Finding API (findCompletedItems) — works for older dev accounts
// Strategy 2: Scrape eBay's sold listings HTML — eBay server-renders <li class="s-item">
//             elements for SEO, so we can parse them without a headless browser.
//
// Requires: EBAY_CLIENT_ID in Vercel env vars.
// Optionally: BOBA_API_SECRET for request authentication.

const FINDING_API   = 'https://svcs.ebay.com/services/search/FindingService/v1';
const EBAY_SEARCH   = 'https://www.ebay.com/sch/i.html';

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

  const appId = process.env.EBAY_CLIENT_ID;

  try {
    // ── Strategy 1: eBay Finding API (works for older developer accounts) ──
    if (appId) {
      const result = await findCompletedItems(appId, query, cardNumber, hero, athlete);
      if (result && result.soldCount > 0) {
        console.log(`Finding API returned ${result.soldCount} sold items`);
        return res.status(200).json(result);
      }
    }

    // ── Strategy 2: Scrape eBay sold listings page ─────────────────────────
    // eBay server-renders item data in <li class="s-item"> for SEO
    const scrapeResult = await scrapeEbaySoldPage(query, cardNumber, hero, athlete);
    if (scrapeResult && scrapeResult.soldCount > 0) {
      console.log(`HTML scrape returned ${scrapeResult.soldCount} sold items`);
      return res.status(200).json(scrapeResult);
    }

    // No data from either strategy
    return res.status(200).json({
      lastSold: null, soldCount: 0, avgSoldPrice: null, soldItems: []
    });

  } catch (err) {
    console.error('ebay-sold error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Strategy 1: Finding API (findCompletedItems) ────────────────────────────
async function findCompletedItems(appId, query, cardNumber, hero, athlete) {
  const params = new URLSearchParams({
    'OPERATION-NAME':     'findCompletedItems',
    'SERVICE-VERSION':    '1.13.0',
    'SECURITY-APPNAME':   appId,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD':       '',
    'keywords':           query,
    'sortOrder':          'EndTimeSoonest',
    'paginationInput.entriesPerPage': '30',
    'itemFilter(0).name':  'SoldItemsOnly',
    'itemFilter(0).value': 'true',
  });

  const url = `${FINDING_API}?${params.toString()}`;

  let response;
  try {
    response = await fetch(url, {
      headers: { 'X-EBAY-SOA-GLOBAL-ID': 'EBAY-US' }
    });
  } catch (err) {
    console.warn('Finding API network error:', err.message);
    return null;
  }

  if (!response.ok) {
    console.warn('Finding API HTTP error:', response.status);
    return null;
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.warn('Finding API JSON parse error:', err.message);
    return null;
  }

  const searchResult = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0];
  if (!searchResult || searchResult['@count'] === '0') {
    const ack = data?.findCompletedItemsResponse?.[0]?.ack?.[0];
    if (ack === 'Failure') {
      const errMsg = data?.findCompletedItemsResponse?.[0]?.errorMessage?.[0]?.error?.[0]?.message?.[0];
      console.warn('Finding API error:', errMsg || 'Unknown');
    }
    return null; // Fall through to scraping
  }

  const rawItems = searchResult.item || [];
  const soldItems = filterRelevantItems(rawItems.map(item => ({
    title: item.title?.[0] || '',
    price: parseFloat(
      item.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.__value__
      || item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__
      || '0'
    ),
    url:  item.viewItemURL?.[0] || null,
    date: formatDate(item.listingInfo?.[0]?.endTime?.[0])
  })), cardNumber, hero, athlete);

  return formatSoldResponse(soldItems);
}

// ── Strategy 2: Scrape eBay sold listings HTML ──────────────────────────────
// eBay server-renders search results as <li class="s-item"> for SEO/accessibility.
// We fetch the sold listings page and parse these elements with regex.
async function scrapeEbaySoldPage(query, cardNumber, hero, athlete) {
  const searchUrl = `${EBAY_SEARCH}?_nkw=${encodeURIComponent(query)}&_sacat=0&LH_Complete=1&LH_Sold=1&_sop=13&rt=nc&LH_TitleDesc=0`;

  let html;
  try {
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      }
    });
    if (!response.ok) {
      console.warn('eBay scrape HTTP error:', response.status);
      return null;
    }
    html = await response.text();
  } catch (err) {
    console.warn('eBay scrape network error:', err.message);
    return null;
  }

  console.log(`eBay HTML length: ${html.length} chars`);

  const soldItems = [];

  // ── Parse approach 1: Extract from <li class="s-item"> elements ─────────
  // eBay renders items as: <li ... class="s-item s-item__pl-on-bottom">
  // Inside each item:
  //   <a class="s-item__link" href="URL">
  //   <span role="heading">TITLE</span>
  //   <span class="s-item__price">$XX.XX</span>
  //   <span class="POSITIVE">Sold  DATE</span>
  const itemRegex = /<li[^>]*class="[^"]*s-item\s[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(html)) !== null) {
    const itemHtml = itemMatch[1];

    // Skip the first "s-item" which is often a template/placeholder with no real data
    if (itemHtml.includes('class="s-item__image-placeholder"') && !itemHtml.includes('s-item__price')) continue;

    // Extract URL from <a class="s-item__link" href="...">
    const urlMatch = itemHtml.match(/class="s-item__link"[^>]*href="([^"]+)"/);
    const url = urlMatch ? urlMatch[1].split('?')[0] : null; // strip tracking params

    // Extract title from <span role="heading"> or <div class="s-item__title">
    const titleMatch = itemHtml.match(/role="heading"[^>]*>([^<]+)</)
                    || itemHtml.match(/class="s-item__title"[^>]*>(?:<span[^>]*>)?([^<]+)/);
    const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

    // Extract price from <span class="s-item__price">$XX.XX</span>
    const priceMatch = itemHtml.match(/class="s-item__price"[^>]*>\s*\$?([\d,]+\.?\d*)/);
    if (!priceMatch) continue; // skip items without a parseable price
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (isNaN(price) || price <= 0) continue;

    // Extract sold date from <span class="POSITIVE">Sold  Mon DD, YYYY</span>
    // or <span class="s-item__endedDate">
    const dateMatch = itemHtml.match(/(?:class="POSITIVE"|class="s-item__endedDate")[^>]*>[^<]*?(\w{3}\s+\d{1,2},?\s*\d{4})/i)
                   || itemHtml.match(/Sold\s+(\w{3}\s+\d{1,2},?\s*\d{4})/i);
    const date = dateMatch ? dateMatch[1].trim() : null;

    if (title || url) {
      soldItems.push({ title, price, url, date });
    }
  }

  // ── Parse approach 2: Look for embedded JSON state ──────────────────────
  // Some eBay pages embed data as JSON in <script> tags
  if (soldItems.length === 0) {
    console.log('No items from HTML parsing, trying embedded JSON...');
    const jsonItems = extractFromEmbeddedJson(html);
    if (jsonItems.length > 0) {
      soldItems.push(...jsonItems);
    }
  }

  console.log(`Scraped ${soldItems.length} raw items from eBay HTML`);

  if (soldItems.length === 0) return null;

  // Filter to relevant items
  const relevant = filterRelevantItems(soldItems, cardNumber, hero, athlete);
  console.log(`${relevant.length} relevant items after filtering`);

  return formatSoldResponse(relevant);
}

// ── Extract sold items from embedded JSON in eBay HTML ──────────────────────
function extractFromEmbeddedJson(html) {
  const items = [];

  // Look for __NEXT_DATA__ or similar hydration scripts
  const patterns = [
    /"itemSummaries"\s*:\s*(\[[\s\S]*?\])\s*[,}]/,
    /"items"\s*:\s*(\[[\s\S]*?\])\s*[,}]/,
    /"searchResults"\s*:\s*\{[^}]*"items"\s*:\s*(\[[\s\S]*?\])/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    try {
      const arr = JSON.parse(match[1]);
      for (const item of arr) {
        const title = item.title || '';
        const price = parseFloat(item.price?.value || item.sellingStatus?.currentPrice?.value || '0');
        if (isNaN(price) || price <= 0) continue;
        items.push({
          title,
          price,
          url:  item.itemWebUrl || item.viewItemURL || null,
          date: formatDate(item.itemEndDate || item.endTime)
        });
      }
      if (items.length > 0) break;
    } catch { /* parse failed, try next pattern */ }
  }

  return items;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function filterRelevantItems(items, cardNumber, hero, athlete) {
  const cn = (cardNumber || '').toUpperCase();
  const h  = (hero || '').toUpperCase();
  const a  = (athlete || '').toUpperCase();

  // If we have no filter criteria, return all items
  if (!cn && (!h || h.length <= 2) && (!a || a.length <= 2)) return items;

  return items.filter(item => {
    const titleUpper = (item.title || '').toUpperCase();
    if (cn && titleUpper.includes(cn)) return true;
    if (h && h.length > 2 && titleUpper.includes(h)) return true;
    if (a && a.length > 2 && titleUpper.includes(a)) return true;
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
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function formatSoldResponse(soldItems) {
  // Filter out items with valid prices
  const validItems = soldItems.filter(i => !isNaN(i.price) && i.price > 0);
  if (validItems.length === 0) {
    return { lastSold: null, soldCount: 0, avgSoldPrice: null, soldItems: [] };
  }

  const prices = validItems.map(i => i.price);
  const avgSold = parseFloat((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2));
  const lastItem = validItems[0];

  return {
    lastSold: {
      price: lastItem.price,
      date:  lastItem.date,
      title: lastItem.title,
      url:   lastItem.url
    },
    soldCount:     validItems.length,
    avgSoldPrice:  avgSold,
    lowSoldPrice:  parseFloat(Math.min(...prices).toFixed(2)),
    highSoldPrice: parseFloat(Math.max(...prices).toFixed(2)),
    soldItems:     validItems.slice(0, 10)
  };
}
