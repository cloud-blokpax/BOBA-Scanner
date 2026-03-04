// api/ebay-sold.js — Vercel serverless proxy for eBay sold/completed listings
//
// Strategy: Scrape eBay's sold listings HTML — eBay server-renders <li class="s-item">
//           elements for SEO, so we can parse them without a headless browser.
//           Falls back to extracting embedded JSON state from hydration scripts.
//
// Note: The eBay Finding API (findCompletedItems) was decommissioned October 2024
//       and no longer returns results.

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
    if (scrapeResult && scrapeResult.soldCount > 0) {
      console.log(`HTML scrape returned ${scrapeResult.soldCount} sold items`);
      return res.status(200).json(scrapeResult);
    }

    return res.status(200).json({
      lastSold: null, soldCount: 0, avgSoldPrice: null, soldItems: []
    });

  } catch (err) {
    console.error('ebay-sold error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Scrape eBay sold listings HTML ──────────────────────────────────────────
async function scrapeEbaySoldPage(query, cardNumber, hero, athlete) {
  const searchUrl = `${EBAY_SEARCH}?_nkw=${encodeURIComponent(query)}&_sacat=0&LH_Complete=1&LH_Sold=1&_sop=13&rt=nc&LH_TitleDesc=0`;

  let html;
  try {
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control':   'no-cache',
        'Pragma':          'no-cache',
        'Referer':         'https://www.google.com/',
        'Upgrade-Insecure-Requests': '1',
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
  console.log('eBay HTML preview:', html.slice(0, 300).replace(/\s+/g, ' '));

  if (html.includes('captcha') || html.includes('Robot Check') || html.includes('gs.securecode') || html.includes('h-captcha')) {
    console.warn('eBay returned a bot-detection/captcha page');
    return null;
  }
  if (html.length < 5000) {
    console.warn('eBay HTML suspiciously short — may be blocked or redirected');
    return null;
  }

  const soldItems = [];

  // ── Parse: Extract from <li class="s-item"> elements ────────────────────
  const itemChunks = html.split(/<li[^>]*class="[^"]*s-item[\s"][^"]*"[^>]*>/i);

  for (let i = 1; i < itemChunks.length; i++) {
    const raw = itemChunks[i];

    // Walk forward counting <li>/<li> depth to find the true closing </li>
    let depth = 1;
    let pos = 0;
    let itemHtml = raw;

    while (pos < raw.length && depth > 0) {
      const nextOpen  = raw.indexOf('<li', pos);
      const nextClose = raw.indexOf('</li>', pos);
      if (nextClose === -1) { itemHtml = raw; break; }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 3;
      } else {
        depth--;
        if (depth === 0) itemHtml = raw.slice(0, nextClose);
        pos = nextClose + 5;
      }
    }

    // Skip placeholder items
    if (itemHtml.includes('class="s-item__image-placeholder"') && !itemHtml.includes('s-item__price')) continue;

    // Extract URL
    const urlMatch = itemHtml.match(/href="([^"]+)"[^>]*class="s-item__link"/)
                  || itemHtml.match(/class="s-item__link"[^>]*href="([^"]+)"/);
    const url = urlMatch ? urlMatch[1].split('?')[0] : null;

    // Extract title
    const titleMatch = itemHtml.match(/role="heading"[^>]*>([^<]+)</)
                    || itemHtml.match(/class="s-item__title"[^>]*>(?:<span[^>]*>)?([^<]+)/);
    const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

    // Extract price — handle nested spans
    const priceBlockMatch = itemHtml.match(/class="s-item__price"[^>]*>([\s\S]*?)<\/span>/);
    const priceMatch = priceBlockMatch ? priceBlockMatch[1].match(/\$?([\d,]+\.?\d*)/) : null;
    if (!priceMatch) continue;
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (isNaN(price) || price <= 0) continue;

    // Extract sold date — try multiple class patterns used across eBay page versions
    const dateMatch = itemHtml.match(/class="[^"]*POSITIVE[^"]*"[^>]*>([\s\S]*?(\b\w{3}\s{1,3}\d{1,2},?\s*\d{4}))/i)
                   || itemHtml.match(/class="s-item__endedDate"[^>]*>([\s\S]*?(\b\w{3}\s{1,3}\d{1,2},?\s*\d{4}))/i)
                   || itemHtml.match(/class="[^"]*s-item__caption--signal[^"]*"[^>]*>([\s\S]*?(\b\w{3}\s{1,3}\d{1,2},?\s*\d{4}))/i)
                   || itemHtml.match(/Sold\s{1,3}(\w{3}\s{1,3}\d{1,2},?\s*\d{4})/i);
    const date = dateMatch ? (dateMatch[2] || dateMatch[1]).trim() : null;

    if (title || url) {
      soldItems.push({ title, price, url, date });
    }
  }

  // ── Fallback: Look for embedded JSON state ───────────────────────────────
  if (soldItems.length === 0) {
    console.log('No items from HTML parsing, trying embedded JSON...');
    const jsonItems = extractFromEmbeddedJson(html);
    if (jsonItems.length > 0) {
      soldItems.push(...jsonItems);
    }
  }

  console.log(`Scraped ${soldItems.length} raw items from eBay HTML`);

  if (soldItems.length === 0) return null;

  const relevant = filterRelevantItems(soldItems, cardNumber, hero, athlete);
  console.log(`${relevant.length} relevant items after filtering`);

  return formatSoldResponse(relevant);
}

// ── Extract sold items from embedded JSON in eBay HTML ──────────────────────
function extractFromEmbeddedJson(html) {
  const items = [];

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
