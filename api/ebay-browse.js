// api/ebay-browse.js — Vercel serverless proxy for eBay Browse API
// Fetches active listings for a given seller using Client Credentials OAuth.
// Requires: EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in Vercel env vars.
// Get credentials at: https://developer.ebay.com → My Apps → Create Application

let _ebayToken     = null;
let _ebayTokenExp  = 0;

async function getEbayToken() {
  if (_ebayToken && Date.now() < _ebayTokenExp) return _ebayToken;
  const clientId     = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('eBay credentials not configured. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to Vercel env vars.');
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
  const { seller } = req.body;
  if (!seller?.trim()) return res.status(400).json({ error: 'Missing seller username' });
  try {
    const token = await getEbayToken();
    const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    searchUrl.searchParams.set('q', 'bo jackson');
    searchUrl.searchParams.set('filter', `sellers:{${seller.trim()}}`);
    searchUrl.searchParams.set('limit', '200');
    const browseRes = await fetch(searchUrl.toString(), {
      headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }
    });
    if (!browseRes.ok) return res.status(502).json({ error: `eBay Browse API: ${browseRes.status}` });
    const data     = await browseRes.json();
    const listings = (data.itemSummaries || []).map(item => ({
      itemId: item.itemId,
      title:  item.title,
      price:  item.price?.value ? `$${item.price.value}` : 'N/A',
      url:    item.itemWebUrl,
      image:  item.image?.imageUrl || null
    }));
    return res.status(200).json({ listings, total: listings.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
