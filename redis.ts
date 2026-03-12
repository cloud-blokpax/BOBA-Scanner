/**
 * BOBA (Bo Jackson Battle Arena) collection adapter.
 *
 * Replaces legacy src/collections/boba/boba-adapter.js.
 * Implements the CollectionAdapter interface for BOBA cards.
 */

import type { Card } from '$lib/types';
import type {
	CollectionAdapter,
	FieldDefinition,
	OcrRegion,
	ScanConfig,
	SearchResult
} from '$lib/services/collection-adapter';
import { getAthleteForHero } from '$lib/data/boba-heroes';

export class BobaAdapter implements CollectionAdapter {
	readonly id = 'boba';
	readonly displayName = 'Bo Jackson Battle Arena';

	getFieldDefinitions(): FieldDefinition[] {
		return [
			{ key: 'card_number', label: 'Card Number', type: 'text' },
			{ key: 'hero_name', label: 'Hero Name', type: 'text' },
			{ key: 'athlete_name', label: 'Athlete Name', type: 'text' },
			{ key: 'set_code', label: 'Set', type: 'text' },
			{ key: 'power', label: 'Power', type: 'number' },
			{ key: 'rarity', label: 'Rarity', type: 'select', options: ['common', 'uncommon', 'rare', 'ultra_rare', 'legendary'] },
			{ key: 'weapon_type', label: 'Weapon', type: 'select', options: ['Fire', 'Ice', 'Steel', 'Hex', 'Glow'] },
			{ key: 'battle_zone', label: 'Battle Zone', type: 'text' },
			{ key: 'variant', label: 'Variant', type: 'select', options: ['base', 'foil', 'holographic', 'battlefoil', 'paper'] }
		];
	}

	normalizeDbRecord(raw: Record<string, unknown>): Partial<Card> {
		return {
			id: raw.id as string,
			name: raw.name as string || `${raw.hero_name || 'Unknown'} ${raw.card_number || ''}`.trim(),
			hero_name: raw.hero_name as string || null,
			athlete_name: raw.athlete_name as string || null,
			set_code: raw.set_code as string || null,
			card_number: raw.card_number as string || null,
			power: raw.power as number || null,
			rarity: raw.rarity as Card['rarity'] || null,
			weapon_type: raw.weapon_type as string || null,
			battle_zone: raw.battle_zone as string || null,
			image_url: raw.image_url as string || null
		};
	}

	buildCardFromMatch(match: Partial<Card>, scanMeta?: Record<string, unknown>): Partial<Card> {
		const card: Partial<Card> = { ...match };

		// Resolve athlete from hero name if missing
		if (card.hero_name && !card.athlete_name) {
			card.athlete_name = getAthleteForHero(card.hero_name);
		}

		// Attach scan metadata
		if (scanMeta) {
			Object.assign(card, scanMeta);
		}

		return card;
	}

	getAIPrompt(dualImage = false): string {
		if (dualImage) {
			return `Two images are provided:
1. Full card image (front of a Bo Jackson Battle Arena trading card)
2. Zoomed crop of the bottom section where the card number is printed

Identify this BoBA card. Return ONLY valid JSON:
{
  "hero": "BoBA hero name",
  "athlete": "real athlete name if known",
  "set": "set identifier",
  "cardNumber": "number on card (e.g. BF-108, PL-46, 76)",
  "pose": "describe pose/action",
  "weapon": "Fire/Ice/Steel/Hex/Glow",
  "power": null or number,
  "year": null or 4-digit year
}`;
		}

		return `Identify this Bo Jackson Battle Arena (BoBA) trading card.
Return ONLY valid JSON:
{
  "hero": "BoBA hero name",
  "athlete": "real athlete name if known",
  "set": "set identifier (e.g. Alpha Edition, Alpha Blast)",
  "cardNumber": "number on card (e.g. BF-108, PL-46, 76)",
  "pose": "describe pose/action",
  "weapon": "Fire/Ice/Steel/Hex/Glow",
  "power": null or number,
  "year": null or 4-digit year
}

Common card number formats: "BF-108", "BLBF-84", "PL-46", "BBF-56", "BPL-7".
Common OCR confusions: 6↔8, 0↔O, 1↔I, B↔8, S↔5.`;
	}

	buildEbayQuery(card: Partial<Card>): string {
		const parts = ['bo jackson battle arena'];
		if (card.card_number) parts.push(card.card_number);
		if (card.hero_name) parts.push(card.hero_name);
		if (card.athlete_name && card.athlete_name !== 'Unknown') parts.push(card.athlete_name);
		return parts.join(' ');
	}

	getOCRRegions(): OcrRegion[] {
		return [
			{ x: 0, y: 0.85, w: 0.4, h: 0.15, label: 'bottom-left' },
			{ x: 0.6, y: 0.85, w: 0.4, h: 0.15, label: 'bottom-right' },
			{ x: 0, y: 0.85, w: 1.0, h: 0.15, label: 'full-strip' }
		];
	}

	getCardNumberCropRegion(): OcrRegion {
		return { x: 0, y: 0.85, w: 0.4, h: 0.15 };
	}

	getScanConfig(): ScanConfig {
		return {
			quality: 0.85,
			threshold: 0.3,
			maxSize: 1000,
			aiCost: 0.003
		};
	}

	getSearchableFields(): Record<string, string> {
		return {
			cardNumber: 'card_number',
			hero: 'hero_name',
			athlete: 'athlete_name',
			set: 'set_code',
			name: 'name'
		};
	}

	formatSearchResult(dbRecord: Record<string, unknown>): SearchResult {
		const cardNum = dbRecord.card_number || '';
		const set = dbRecord.set_code || '';
		const hero = dbRecord.hero_name || '';

		return {
			title: `${hero}`,
			subtitle: `${cardNum} · ${set}`.trim(),
			id: dbRecord.id as string
		};
	}

	getAIResponseFields(): string[] {
		return ['hero', 'athlete', 'set', 'cardNumber', 'pose', 'weapon', 'power', 'year'];
	}
}
