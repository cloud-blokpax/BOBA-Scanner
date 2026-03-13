/**
 * POST /api/ebay/sold — eBay sold/completed listings scraper
 *
 * Uses ScraperAPI for IP rotation when SCRAPERAPI_KEY env var is set.
 * Without it, eBay returns bot-detection pages.
 * Auth required.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	parseEbaySoldHtml,
	isEbayBlocked,
	deduplicateItems,
	filterRelevantItems,
	formatSoldResponse
} from '$lib/server/ebay-scraper';
import type { SoldResponse } from '$lib/server/ebay-scraper';
import type { RequestHandler } from './$types';

const EBAY_SEARCH = 'https://www.ebay.com/sch/i.html';

async function scrapeEbaySoldPage(
	query: string,
	cardNumber?: string,
	hero?: string,
	athlete?: string
): Promise<SoldResponse | 'BLOCKED' | null> {
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

	if (isEbayBlocked(html)) return 'BLOCKED';

	const soldItems = parseEbaySoldHtml(html);
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

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
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
