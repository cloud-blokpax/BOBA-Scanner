// api/ebay-sold.js — Vercel serverless proxy for eBay sold/completed listings
//
// Uses the eBay Browse API to search for recently sold items.
// The Browse API supports a "SOLD_ITEMS" fieldgroup that returns ended listings
// when combined with specific filters.
//
// Requires: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET in Vercel env vars.

let _ebayToken     = null;
let _ebayTokenExp  = 0;

async function getEbayToken() {
  if (_ebayToken && Date.now() < _ebayTokenExp) return _ebayToken;
  const clientId     = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('eBay credentials not configured');
  }
  const creds    = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method:  'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
  });
  if (!response.ok) throw new Error(`eBay auth failed: ${response.status}`);
  const data    = await response.json();
  _ebayToken    = data.access_token;
  _ebayTokenExp = Date.now() + (data.expires_in - 60) * 1000;
  return _ebayToken;
}

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
    const token = await getEbayToken();

    // Strategy: Use eBay Browse API with fieldgroups=EXTENDED to get more item data,
    // and filter for completed (sold) items by searching recently ended auctions.
    // The Browse API doesn't have a native "sold only" filter, so we use the
    // eBay website's completed listings search as our data source.

    // Approach: Fetch eBay sold listings page and parse the data.
    // This is the same approach used by 130point, CardMavin, etc.
    const searchQuery = encodeURIComponent(query);
    const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${searchQuery}&_sacat=0&LH_Complete=1&LH_Sold=1&_sop=13&_ipg=60`;

    const pageRes = await fetch(ebayUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!pageRes.ok) {
      return res.status(502).json({ error: `eBay page fetch failed: ${pageRes.status}` });
    }

    const html = await pageRes.text();

    // Parse sold listings from eBay HTML
    // eBay sold listings contain structured data we can extract
    const soldItems = parseEbaySoldListings(html, cardNumber, hero, athlete);

    if (soldItems.length === 0) {
      return res.status(200).json({
        lastSold: null,
        soldCount: 0,
        avgSoldPrice: null,
        soldItems: []
      });
    }

    // Calculate stats from sold items
    const prices = soldItems.map(i => i.price).filter(p => p > 0);
    const avgSold = prices.length ? parseFloat((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)) : null;
    const lastItem = soldItems[0]; // Already sorted newest first

    return res.status(200).json({
      lastSold: {
        price:  lastItem.price,
        date:   lastItem.date,
        title:  lastItem.title,
        url:    lastItem.url
      },
      soldCount:    soldItems.length,
      avgSoldPrice: avgSold,
      lowSoldPrice: prices.length ? Math.min(...prices) : null,
      highSoldPrice: prices.length ? Math.max(...prices) : null,
      soldItems:    soldItems.slice(0, 10) // Return up to 10 most recent
    });

  } catch (err) {
    console.error('ebay-sold error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// Parse eBay sold listings HTML to extract price, date, title, and URL
function parseEbaySoldListings(html, cardNumber, hero, athlete) {
  const items = [];

  // eBay sold listings use s-item class for each result
  // Extract using regex patterns that match the DOM structure
  const itemRegex = /<li[^>]*class="[^"]*s-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  const titleRegex = /<div[^>]*class="[^"]*s-item__title[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  const priceRegex = /<span[^>]*class="[^"]*s-item__price[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  const linkRegex = /<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*href="([^"]+)"/i;
  const dateRegex = /<span[^>]*class="[^"]*POSITIVE[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
  // Also try the "Sold" date format
  const soldDateRegex = /Sold\s+(\w+\s+\d+,?\s*\d*)/i;
  const endedDateRegex = /(\w{3}\s+\d{1,2},?\s+\d{4})/i;

  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const itemHtml = match[1];

    // Skip "shop on eBay" promotional items
    if (itemHtml.includes('Shop on eBay')) continue;

    // Extract title
    const titleMatch = titleRegex.exec(itemHtml);
    if (!titleMatch) continue;
    let title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    // Skip if title is empty or "New Listing" only
    if (!title || title === 'New Listing') continue;
    // Strip "New Listing" prefix
    title = title.replace(/^New Listing\s*/i, '').trim();

    // Filter to relevant cards — must contain card number or hero name
    const titleUpper = title.toUpperCase();
    const cn = (cardNumber || '').toUpperCase();
    const h  = (hero || '').toUpperCase();
    const a  = (athlete || '').toUpperCase();
    let isRelevant = false;
    if (cn && titleUpper.includes(cn)) isRelevant = true;
    if (h && h.length > 2 && titleUpper.includes(h)) isRelevant = true;
    if (a && a.length > 2 && titleUpper.includes(a)) isRelevant = true;
    if (!isRelevant && cn) continue; // Skip irrelevant results

    // Extract price — look for the actual sold price
    const priceMatch = priceRegex.exec(itemHtml);
    if (!priceMatch) continue;
    const priceText = priceMatch[1].replace(/<[^>]+>/g, '').trim();
    // Parse price: "$12.50" or "$12.50 to $25.00" (take first/lower)
    const priceNum = parseFloat(priceText.replace(/[^0-9.]/g, ''));
    if (isNaN(priceNum) || priceNum <= 0) continue;

    // Extract URL
    const linkMatch = linkRegex.exec(itemHtml);
    const url = linkMatch ? linkMatch[1].split('?')[0] : null; // Strip tracking params

    // Extract sold date
    let soldDate = null;
    const dateMatch1 = soldDateRegex.exec(itemHtml);
    const dateMatch2 = endedDateRegex.exec(itemHtml);
    if (dateMatch1) {
      soldDate = dateMatch1[1].trim();
    } else if (dateMatch2) {
      soldDate = dateMatch2[1].trim();
    }

    items.push({
      title,
      price: parseFloat(priceNum.toFixed(2)),
      url,
      date: soldDate
    });
  }

  return items;
}
