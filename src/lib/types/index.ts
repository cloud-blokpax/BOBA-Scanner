// ── Card Types ──────────────────────────────────────────────────

export interface Card {
	id: string;
	name: string;
	hero_name: string | null;
	athlete_name: string | null;
	set_code: string;
	card_number: string | null;
	power: number | null;
	rarity: CardRarity | null;
	weapon_type: string | null;
	battle_zone: string | null;
	image_url: string | null;
	created_at: string;
}

export type CardRarity = 'common' | 'uncommon' | 'rare' | 'ultra_rare' | 'legendary';

export type CardCondition = 'mint' | 'near_mint' | 'excellent' | 'good' | 'fair' | 'poor';

// ── Collection Types ────────────────────────────────────────────

export interface CollectionItem {
	id: string;
	user_id: string;
	card_id: string;
	quantity: number;
	condition: CardCondition;
	notes: string | null;
	added_at: string;
	card?: Card;
}

// ── Scan Types ──────────────────────────────────────────────────

export type ScanMethod = 'hash_cache' | 'tesseract' | 'claude';

export interface ScanResult {
	id?: string;
	card_id: string | null;
	card: Card | null;
	scan_method: ScanMethod;
	confidence: number;
	processing_ms: number;
	variant?: string | null;
}

export interface ScanPipelineState {
	status: 'idle' | 'capturing' | 'processing' | 'tier1' | 'tier2' | 'tier3' | 'complete' | 'error';
	currentTier: 1 | 2 | 3 | null;
	result: ScanResult | null;
	error: string | null;
}

// ── Claude API Response ─────────────────────────────────────────

export interface ClaudeCardResponse {
	card_name: string;
	hero_name: string;
	athlete_name: string | null;
	set_code: string;
	card_number: string;
	power: number | null;
	rarity: CardRarity;
	variant: string;
	weapon_type: string | null;
	confidence: number;
}

// ── Price Types ─────────────────────────────────────────────────

export interface PriceData {
	card_id: string;
	source: string;
	price_low: number | null;
	price_mid: number | null;
	price_high: number | null;
	listings_count: number | null;
	fetched_at: string;
}

// ── Hash Cache ──────────────────────────────────────────────────

export interface HashCacheEntry {
	phash: string;
	card_id: string;
	confidence: number;
	scan_count: number;
	last_seen: string;
}

// ── Image Processing ────────────────────────────────────────────

export interface BlurCheckResult {
	isBlurry: boolean;
	variance: number;
}

export interface OcrResult {
	text: string;
	confidence: number;
	words: Array<{ text: string; confidence: number }>;
}
