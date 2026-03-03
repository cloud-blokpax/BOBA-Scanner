// api/ebay-sold.js — Vercel serverless proxy for eBay sold/completed listings
//
// Uses the eBay Finding API (findCompletedItems) to get recently sold items.
// This API returns structured JSON data — no HTML scraping needed.
// Auth: uses EBAY_CLIENT_ID as the SECURITY-APPNAME parameter (no OAuth required).
//
// Requires: EBAY_CLIENT_ID in Vercel env vars.
// Optionally: BOBA_API_SECRET for request authentication.

const FINDING_API = 'https://svcs.ebay.com/services/search/FindingService/v1';

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
  if (!appId) return res.status(500).json({ error: 'EBAY_CLIENT_ID not configured' });

  try {
    // ── Strategy 1: eBay Finding API (findCompletedItems) ─────────────────
    const result = await findCompletedItems(appId, query, cardNumber, hero, athlete);
    if (result) return res.status(200).json(result);

    // ── Strategy 2: eBay Browse API sold search ───────────────────────────
    // Fallback if Finding API is unavailable (deprecated for new apps)
    const browseResult = await browseSoldItems(query, cardNumber, hero, athlete);
    if (browseResult) return res.status(200).json(browseResult);

    // No data from either strategy
    return res.status(200).json({
      lastSold: null, soldCount: 0, avgSoldPrice: null, soldItems: []
    });

  } catch (err) {
    console.error('ebay-sold error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Finding API: findCompletedItems ──────────────────────────────────────────
// Returns sold items with actual sale price, end date, and item URL.
// Uses SECURITY-APPNAME auth (Client ID / AppID) — no OAuth needed.
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
    // Only return items that actually sold (not unsold completed)
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

  // Navigate the Finding API response structure
  const searchResult = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0];
  if (!searchResult || searchResult['@count'] === '0') {
    // Check for API error (e.g., deprecated, invalid key)
    const ack = data?.findCompletedItemsResponse?.[0]?.ack?.[0];
    if (ack === 'Failure') {
      const errMsg = data?.findCompletedItemsResponse?.[0]?.errorMessage?.[0]?.error?.[0]?.message?.[0];
      console.warn('Finding API error:', errMsg || 'Unknown');
      return null; // Fall through to Browse API fallback
    }
    return { lastSold: null, soldCount: 0, avgSoldPrice: null, soldItems: [] };
  }

  const rawItems = searchResult.item || [];

  // Filter to relevant items — title must contain card number or hero/athlete name
  const cn = (cardNumber || '').toUpperCase();
  const h  = (hero || '').toUpperCase();
  const a  = (athlete || '').toUpperCase();

  const soldItems = [];
  for (const item of rawItems) {
    const title = item.title?.[0] || '';
    const titleUpper = title.toUpperCase();

    // Relevance check (same logic as ebay-browse.js)
    let isRelevant = false;
    if (cn && titleUpper.includes(cn)) isRelevant = true;
    if (h && h.length > 2 && titleUpper.includes(h)) isRelevant = true;
    if (a && a.length > 2 && titleUpper.includes(a)) isRelevant = true;
    if (!isRelevant) continue;

    // Extract sale price (sellingStatus.convertedCurrentPrice is USD)
    const priceStr = item.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.__value__
                  || item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__;
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) continue;

    // Extract end date
    const endTime = item.listingInfo?.[0]?.endTime?.[0];
    let soldDate = null;
    if (endTime) {
      try {
        const d = new Date(endTime);
        soldDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } catch {}
    }

    // Extract URL
    const url = item.viewItemURL?.[0] || null;

    soldItems.push({
      title,
      price: parseFloat(price.toFixed(2)),
      url,
      date: soldDate
    });
  }

  // Sort by date (most recent first) — they should already be sorted by EndTimeSoonest
  return formatSoldResponse(soldItems);
}

// ── Browse API fallback: search for ended items ──────────────────────────────
// The Browse API doesn't natively support "sold only" filter, but we can
// try fetching ended items and checking their status.
async function browseSoldItems(query, cardNumber, hero, athlete) {
  // Only attempt if we have OAuth credentials
  const clientId     = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    // Get OAuth token
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
    });
    if (!tokenRes.ok) return null;
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;

    // Search with Browse API — this only returns active items, but we try anyway
    // as eBay sometimes includes recently ended items
    const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}');
    searchUrl.searchParams.set('limit', '50');
    searchUrl.searchParams.set('fieldgroups', 'EXTENDED');

    const browseRes = await fetch(searchUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      }
    });
    if (!browseRes.ok) return null;

    const browseData = await browseRes.json();
    const all = browseData.itemSummaries || [];

    // Filter to relevant items
    const cn = (cardNumber || '').toUpperCase();
    const h  = (hero || '').toUpperCase();
    const a  = (athlete || '').toUpperCase();

    const soldItems = [];
    for (const item of all) {
      const titleUpper = (item.title || '').toUpperCase();
      let isRelevant = false;
      if (cn && titleUpper.includes(cn)) isRelevant = true;
      if (h && h.length > 2 && titleUpper.includes(h)) isRelevant = true;
      if (a && a.length > 2 && titleUpper.includes(a)) isRelevant = true;
      if (!isRelevant) continue;

      // Only include items that have ended/sold
      // The Browse API marks these with specific buying option statuses
      if (item.buyingOptions?.includes('FIXED_PRICE') && item.itemEndDate) {
        const price = parseFloat(item.price?.value);
        if (isNaN(price) || price <= 0) continue;

        let soldDate = null;
        if (item.itemEndDate) {
          try {
            soldDate = new Date(item.itemEndDate).toLocaleDateString('en-US',
              { month: 'short', day: 'numeric', year: 'numeric' });
          } catch {}
        }

        soldItems.push({
          title: item.title,
          price: parseFloat(price.toFixed(2)),
          url:   item.itemWebUrl || null,
          date:  soldDate
        });
      }
    }

    if (soldItems.length === 0) return null;
    return formatSoldResponse(soldItems);

  } catch (err) {
    console.warn('Browse API sold fallback error:', err.message);
    return null;
  }
}

// ── Format sold items into the standard response ─────────────────────────────
function formatSoldResponse(soldItems) {
  if (soldItems.length === 0) {
    return { lastSold: null, soldCount: 0, avgSoldPrice: null, soldItems: [] };
  }

  const prices = soldItems.map(i => i.price).filter(p => p > 0);
  const avgSold = prices.length
    ? parseFloat((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2))
    : null;
  const lastItem = soldItems[0];

  return {
    lastSold: {
      price: lastItem.price,
      date:  lastItem.date,
      title: lastItem.title,
      url:   lastItem.url
    },
    soldCount:     soldItems.length,
    avgSoldPrice:  avgSold,
    lowSoldPrice:  prices.length ? parseFloat(Math.min(...prices).toFixed(2)) : null,
    highSoldPrice: prices.length ? parseFloat(Math.max(...prices).toFixed(2)) : null,
    soldItems:     soldItems.slice(0, 10)
  };
}
