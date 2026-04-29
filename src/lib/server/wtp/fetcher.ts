/**
 * Bulk fetcher for Wonders Trading Post public listings.
 *
 * Calls WTP's PostgREST endpoint with their published anon JWT (extracted
 * from their public JS bundle — same key any visitor's browser uses).
 * Read-only; never writes back to WTP.
 */

const WTP_REST = 'https://lkqahprsomuyjwunxaot.supabase.co/rest/v1';
// Public anon JWT — extracted from WTP's bundle, exp 2036
const WTP_ANON =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrcWFocHJzb211eWp3dW54YW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2OTI4MDYsImV4cCI6MjA5MTI2ODgwNn0.fKOaQXEjffXcRw35EnFD-rmHrDM_5B1zWNnjFLvZxls';
const UA = 'CardScanner/1.0 (boba.cards; admin-scrape-test; contact: jamespoto@gmail.com)';

export interface WtpListing {
	id: string;
	card_name: string;
	rarity: string;
	condition: string;
	price: number;
	treatment: string;
	orbital: string;
	special_attribute: string;
	set: string;
	quantity: number;
	status: 'active' | 'sold';
	listing_type: 'card' | 'other';
	accepting_offers: boolean;
	open_to_trade: boolean;
	description: string | null;
	image_url: string | null;
	image_urls: string[] | null;
	created_at: string;
	updated_at: string;
}

export async function fetchAllWtpListings(): Promise<WtpListing[]> {
	const r = await fetch(`${WTP_REST}/listings?select=*&limit=5000`, {
		headers: { apikey: WTP_ANON, Authorization: `Bearer ${WTP_ANON}`, 'User-Agent': UA },
		cache: 'no-store'
	});
	if (!r.ok) {
		throw new Error(`WTP fetch failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
	}
	return r.json();
}
