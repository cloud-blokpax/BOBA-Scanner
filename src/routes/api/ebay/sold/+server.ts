/**
 * POST /api/ebay/sold — eBay sold/completed listings scraper
 *
 * Uses ScraperAPI for IP rotation when SCRAPERAPI_KEY env var is set.
 * Without it, eBay returns bot-detection pages.
 * Auth required.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const EBAY_SEARCH = 'https://www.ebay.com/sch/i.html';

interface SoldItem {
	title: string;
	price: number;
	url: string | null;
	date: string | null;
}

function extractPrice(html: string): number | null {
	const blockMatch =
		html.match(
			/class="(?:s-item__|s-card__|su-card__)price"[^>]*>([\s\S]{0,200}?)<\/span>/i
		) ||
		html.match(
			/(?:s-item__|s-card__|su-card__)price[^>]*>([\s\S]{0,200}?)<\/(?:span|div)>/i
		);
	if (blockMatch) {
		const m = blockMatch[1].match(/\$?([\d,]+\.?\d*)/);
		if (m) return parseFloat(m[1].replace(/,/g, ''));
	}

	const dollarRegex = /\$([\d,]+\.?\d{2})\b/g;
	let dollarMatch;
	while ((dollarMatch = dollarRegex.exec(html)) !== null) {
		const start = Math.max(0, dollarMatch.index - 150);
		const end = Math.min(html.length, dollarMatch.index + dollarMatch[0].length + 150);
		const context = html.slice(start, end).toLowerCase();
		if (
			context.includes('shipping') ||
			context.includes('delivery') ||
			context.includes('postage') ||
			context.includes('tax') ||
			context.includes('was ') ||
			context.includes('strikethrough') ||
			context.includes('line-through') ||
			context.includes('similar') ||
			context.includes('sponsored')
		) {
			continue;
		}
		return parseFloat(dollarMatch[1].replace(/,/g, ''));
	}
	return null;
}

function extractDate(html: string): string | null {
	const m =
		html.match(
			/class="[^"]*POSITIVE[^"]*"[^>]*>[\s\S]*?(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i
		) ||
		html.match(
			/class="[^"]*s-item__endedDate[^"]*"[^>]*>[\s\S]*?(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i
		) ||
		html.match(/Sold\s+(\w{3}\s+\d{1,2},?\s*\d{4})/i) ||
		html.match(
			/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i
		);
	return m ? m[1].trim() : null;
}

function decodeEntities(str: string): string {
	return str
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/&#x2F;/g, '/');
}

function extractFromEmbeddedJson(html: string): SoldItem[] {
	const items: SoldItem[] = [];
	const patterns = [
		/"itemSummaries"\s*:\s*(\[[\s\S]{1,500000}?\])\s*[,}]/,
		/"listItems"\s*:\s*(\[[\s\S]{1,500000}?\])\s*[,}]/,
		/"items"\s*:\s*(\[[\s\S]{1,200000}?\])\s*[,}]/
	];

	for (const pattern of patterns) {
		const match = html.match(pattern);
		if (!match) continue;
		try {
			const arr = JSON.parse(match[1]);
			if (!Array.isArray(arr) || arr.length === 0) continue;
			for (const item of arr) {
				const title = item.title || item.itemTitle || '';
				const priceVal =
					item.price?.value || item.sellingStatus?.currentPrice?.value || null;
				const price = priceVal ? parseFloat(priceVal) : 0;
				if (isNaN(price) || price <= 0) continue;
				items.push({
					title,
					price,
					url: item.itemWebUrl || item.viewItemURL || null,
					date: formatDate(item.itemEndDate || item.endTime || item.soldDate)
				});
			}
			if (items.length > 0) break;
		} catch {
			/* parse failed, try next pattern */
		}
	}
	return items;
}

function formatDate(dateStr: string | undefined): string | null {
	if (!dateStr) return null;
	try {
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return null;
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	} catch {
		return null;
	}
}

function deduplicateItems(items: SoldItem[]): SoldItem[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (item.url) {
			const idMatch = item.url.match(/\/itm\/(\d+)/);
			const key = idMatch ? `url:${idMatch[1]}` : `url:${item.url}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		}
		const key = `pt:${item.price}:${(item.title || '').slice(0, 60)}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function filterRelevantItems(
	items: SoldItem[],
	cardNumber?: string,
	hero?: string,
	athlete?: string
): SoldItem[] {
	const cn = (cardNumber || '').toUpperCase();
	const h = (hero || '').toUpperCase();
	const a = (athlete || '').toUpperCase();
	if (!cn && (!h || h.length <= 2) && (!a || a.length <= 2)) return items;
	return items.filter((item) => {
		const t = (item.title || '').toUpperCase();
		if (!t) return true;
		if (cn && t.includes(cn)) return true;
		if (h && h.length > 2 && t.includes(h)) return true;
		if (a && a.length > 2 && t.includes(a)) return true;
		return false;
	});
}

function formatSoldResponse(soldItems: SoldItem[]) {
	const validItems = soldItems.filter((i) => !isNaN(i.price) && i.price > 0);
	if (validItems.length === 0) {
		return { lastSold: null, soldCount: 0, avgSoldPrice: null, soldItems: [] };
	}

	const uniquePrices = new Set(validItems.map((i) => i.price));
	if (validItems.length >= 5 && uniquePrices.size === 1) {
		return { lastSold: null, soldCount: 0, avgSoldPrice: null, soldItems: [] };
	}

	const prices = validItems.map((i) => i.price);
	const avgSold = parseFloat((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2));
	const lastItem = validItems[0];

	return {
		lastSold: {
			price: lastItem.price,
			date: lastItem.date,
			title: lastItem.title,
			url: lastItem.url
		},
		soldCount: validItems.length,
		avgSoldPrice: avgSold,
		lowSoldPrice: parseFloat(Math.min(...prices).toFixed(2)),
		highSoldPrice: parseFloat(Math.max(...prices).toFixed(2)),
		soldItems: validItems.slice(0, 10)
	};
}

async function scrapeEbaySoldPage(
	query: string,
	cardNumber?: string,
	hero?: string,
	athlete?: string
): Promise<ReturnType<typeof formatSoldResponse> | 'BLOCKED' | null> {
	const ebayUrl = `${EBAY_SEARCH}?_nkw=${encodeURIComponent(query)}&_sacat=0&LH_Complete=1&LH_Sold=1&_sop=13&rt=nc&LH_TitleDesc=0`;
	const scraperApiKey = env.SCRAPERAPI_KEY ?? '';

	const fetchUrl = scraperApiKey
		? `https://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(ebayUrl)}&country_code=us&render=true&premium=true&wait=8000`
		: ebayUrl;

	const headers: Record<string, string> = scraperApiKey
		? {}
		: {
				'User-Agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.9',
				'Cache-Control': 'no-cache',
				Referer: 'https://www.google.com/'
			};

	let html: string;
	try {
		const response = await fetch(fetchUrl, { headers });
		if (!response.ok) return null;
		html = await response.text();
	} catch {
		return null;
	}

	if (
		html.includes('Pardon Our Interruption') ||
		html.includes('captcha') ||
		html.includes('Robot Check') ||
		html.includes('h-captcha')
	) {
		return 'BLOCKED';
	}

	if (html.length < 5000) return 'BLOCKED';

	const soldItems: SoldItem[] = [];

	// Strategy 1: Split on <li> s-card or s-item elements
	const itemChunks = html.split(/(?=<li\b[^>]*\b(?:s-card|s-item)\b)/i);
	for (let i = 1; i < itemChunks.length; i++) {
		const raw = itemChunks[i];
		const liTagEnd = raw.indexOf('>');
		const liTag = liTagEnd !== -1 ? raw.slice(0, liTagEnd + 1) : '';
		const body = liTagEnd !== -1 ? raw.slice(liTagEnd + 1) : raw;

		let depth = 1,
			pos = 0,
			itemHtml = body;
		while (pos < body.length && depth > 0) {
			const nextOpen = body.indexOf('<li', pos);
			const nextClose = body.indexOf('</li>', pos);
			if (nextClose === -1) {
				itemHtml = body;
				break;
			}
			if (nextOpen !== -1 && nextOpen < nextClose) {
				depth++;
				pos = nextOpen + 3;
			} else {
				depth--;
				if (depth === 0) itemHtml = body.slice(0, nextClose);
				pos = nextClose + 5;
			}
		}

		const fullItem = liTag + itemHtml;
		if (!fullItem.includes('$')) continue;

		const urlMatch =
			fullItem.match(/href="(https?:\/\/(?:www\.)?ebay\.com\/itm\/(\d+)[^"]*)"/) ||
			fullItem.match(/href=(https?:\/\/(?:www\.)?ebay\.com\/itm\/(\d+)\S*)/);
		let url: string | null = null;
		if (urlMatch) {
			url = `https://www.ebay.com/itm/${urlMatch[2]}`;
		} else {
			const listingId = liTag.match(/data-listingid[=: ]*["']?(\d+)/i);
			if (listingId) url = `https://www.ebay.com/itm/${listingId[1]}`;
		}
		if (!url) continue;

		const titleMatch =
			liTag.match(/aria-label="([^"]+)"/) ||
			fullItem.match(/class="s-card__title[^"]*"[^>]*>(?:<[^>]+>)?([^<]+)/) ||
			fullItem.match(/class="s-item__title[^"]*"[^>]*>(?:<[^>]+>)?([^<]+)/) ||
			fullItem.match(/role="heading"[^>]*>([^<]+)</);
		const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

		const price = extractPrice(fullItem);
		if (!price) continue;

		const date = extractDate(fullItem);
		soldItems.push({ title, price, url, date });
	}

	// Strategy 2: Direct price+date extraction
	if (soldItems.length === 0) {
		const priceRegex =
			/s-item__price[^>]*>([\s\S]{0,150}?\$([\d,]+\.?\d*)[\s\S]{0,400}?(?:Sold|POSITIVE|endedDate)[\s\S]{0,200}?<)/gi;
		let m;
		while ((m = priceRegex.exec(html)) !== null) {
			const price = parseFloat(m[2].replace(/,/g, ''));
			if (isNaN(price) || price <= 0) continue;
			const context = html.slice(Math.max(0, m.index - 300), m.index + 600);
			const date = extractDate(context);
			const urlM = context.match(/href="(https?:\/\/www\.ebay\.com\/itm\/[^"]+)"/);
			const titleM =
				context.match(/role="heading"[^>]*>([^<]+)</) ||
				context.match(/aria-label="([^"]+)"/);
			soldItems.push({
				price,
				date,
				url: urlM ? urlM[1].split('?')[0] : null,
				title: titleM ? decodeEntities(titleM[1].trim()) : ''
			});
		}
	}

	// Strategy 3: Embedded JSON state
	if (soldItems.length === 0) {
		const jsonItems = extractFromEmbeddedJson(html);
		soldItems.push(...jsonItems);
	}

	if (soldItems.length === 0) return null;

	const deduped = deduplicateItems(soldItems);
	const relevant = filterRelevantItems(deduped, cardNumber, hero, athlete);
	const finalItems = relevant.length > 0 ? relevant : deduped;

	return formatSoldResponse(finalItems);
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const query = typeof body.query === 'string' ? body.query.trim().slice(0, 200) : '';
	const cardNumber = typeof body.cardNumber === 'string' ? body.cardNumber.slice(0, 20) : undefined;
	const hero = typeof body.hero === 'string' ? body.hero.slice(0, 100) : undefined;
	const athlete = typeof body.athlete === 'string' ? body.athlete.slice(0, 100) : undefined;

	if (!query) {
		throw error(400, 'Missing query');
	}

	try {
		const scrapeResult = await scrapeEbaySoldPage(query, cardNumber, hero, athlete);

		if (scrapeResult === 'BLOCKED') {
			return json({ blocked: true });
		}

		if (scrapeResult && scrapeResult.soldCount > 0) {
			return json(scrapeResult);
		}

		return json({ lastSold: null, soldCount: 0, avgSoldPrice: null, soldItems: [] });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('ebay-sold error:', err);
		throw error(500, 'eBay sold listing lookup failed');
	}
};
