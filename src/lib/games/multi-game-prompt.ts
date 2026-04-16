/**
 * Multi-game Claude AI prompt + tool for auto-detect scanning.
 *
 * Used by POST /api/scan when no `game_id` is provided. Claude first
 * determines which game the card belongs to, then fills in fields
 * common to both BoBA and Wonders. The server normalizes the output
 * into the unified shape Tier 3 validation expects.
 *
 * Tool name is `identify_card` to match the hardcoded tool_choice
 * in the scan endpoint.
 */

import type Anthropic from '@anthropic-ai/sdk';

// ── Structured output tool definition ──────────────────────────
export const MULTI_GAME_CARD_ID_TOOL: Anthropic.Messages.Tool = {
	name: 'identify_card',
	description:
		'Identify a trading card. First determine which game it belongs to (BoBA or Wonders of The First), then return fields appropriate to that game.',
	input_schema: {
		type: 'object' as const,
		properties: {
			game: {
				type: 'string',
				enum: ['boba', 'wonders'],
				description: 'Which game this card belongs to. BoBA = Bo Jackson Battle Arena (sports). Wonders = Wonders of The First (fantasy).'
			},
			card_name: {
				type: 'string',
				description:
					'BoBA: the hero/play name at the top. ' +
					'Wonders: the card name at the TOP-LEFT.'
			},
			card_number: {
				type: 'string',
				description:
					'BoBA: exact text from BOTTOM-LEFT (e.g., "130", "BF-108", "PL-46"). ' +
					'Wonders: collector number exactly as printed (e.g., "78/402", "115", "P-002", "AVA-T1", "A1-205/402").'
			},
			power: {
				type: 'string',
				description:
					'BoBA: large number from TOP-RIGHT (hero cards only; null otherwise). ' +
					'Wonders: value from the "Power" box (numeric for Wonders creatures; "S"/"I"/"L" for non-creatures).'
			},
			// BoBA-specific
			hero_name: { type: 'string', description: 'BoBA only — hero name (same as card_name for heroes; empty for play/bonus/hot_dog cards).' },
			athlete_name: { type: 'string', description: 'BoBA only — real athlete name if known.' },
			weapon_type: {
				type: 'string',
				enum: ['Fire', 'Ice', 'Steel', 'Hex', 'Glow', 'Brawl', 'Gum', 'Super', 'Alt', 'Cyber'],
				description: 'BoBA only — weapon type from color/icon.'
			},
			card_type: {
				type: 'string',
				description:
					'BoBA: hero | play | bonus_play | hot_dog. ' +
					'Wonders: Wonder | Item | Spell | Land | Token Wonder | Story Token Item | etc.'
			},
			// Wonders-specific
			collector_number: {
				type: 'string',
				description: 'Wonders alias for card_number — include if Wonders and this is clearer.'
			},
			cost: { type: 'string', description: 'Wonders only — energy cost value.' },
			card_class: { type: 'string', description: 'Wonders only — subtype after card_type (e.g., "Airship Pirate").' },
			set_name: { type: 'string', description: 'Wonders only — set name (e.g., "Existence", "Call of the Stones").' },
			foil_treatment: {
				type: 'string',
				enum: ['paper', 'classic_foil', 'formless_foil', 'ocm', 'stone_foil', 'unknown'],
				description: 'Wonders only — foil finish detection.'
			},
			hierarchy: {
				type: 'string',
				enum: ['legendary', 'primary', 'secondary', 'token'],
				description: 'Wonders only — deck-limit hierarchy.'
			},
			serial_number: { type: 'string', description: 'Separate X/YY serial if visible (OCM/Stone Foil).' },
			// Shared
			rarity: {
				type: 'string',
				description:
					'BoBA: common | uncommon | rare | ultra_rare | legendary. ' +
					'Wonders: Common | Uncommon | Rare | Epic | Mythic | Promo | Token.'
			},
			variant: {
				type: 'string',
				description:
					'BoBA parallel name (battlefoil, rad, blizzard, paper, etc.). ' +
					'For Wonders, leave unset — use foil_treatment instead.'
			},
			parallel: { type: 'string', description: 'BoBA only — specific parallel name if identifiable.' },
			confidence: { type: 'number', description: '0.0–1.0' },
			flags: { type: 'array', items: { type: 'string' }, description: 'Issues: blurry, glare, partial, foil_reflection, damaged_card, partial_occlusion, low_resolution.' }
		},
		required: ['game', 'card_name', 'card_number', 'confidence']
	}
};

// ── Multi-game system prompt ───────────────────────────────────
export const MULTI_GAME_SYSTEM_PROMPT = `You are a trading card identification expert for two games:

1. BoBA (Bo Jackson Battle Arena) — Sports-themed TCG
2. Wonders of The First (WoTF) — Fantasy-themed TCG

STEP 1: Determine which game this card is from.

Distinctive visual markers:
- BoBA cards have a card number in the BOTTOM-LEFT that is either numeric-only (e.g., "130") or has a BoBA parallel prefix (BF-, RAD-, PL-, HTD-, SBF-, BFA-, GBF-, etc.)
- BoBA cards have weapon color coding (red=Fire, blue=Ice, gray=Steel, purple=Hex, yellow-green=Glow, orange=Brawl, pink=Gum, gold=Super, cyan=Cyber)
- BoBA cards have hero names with associated athlete names
- BoBA cards show "© Bo Jackson Battle Arena" or "© IMC" in the copyright line
- Wonders cards have a card TYPE LINE running vertically along the LEFT EDGE (e.g., "Primary Wonder", "Legendary Story Token Item")
- Wonders cards have labeled "Power" and "Cost" boxes
- Wonders cards have a rarity letter (C, U, R, E, M, P) in a BOX at the BOTTOM-RIGHT
- Wonders cards show "© Wonders of The First" in the copyright line
- Wonders collector numbers often use formats like "78/402", "P-002", "AVA-T1", "A1-205/402" — distinctive from BoBA

STEP 2: Once you've identified the game, set the \`game\` field to either "boba" or "wonders" and fill in the card details according to that game's layout.

BoBA card details:
- card_name = hero name (or play name for PL/BPL/HTD cards)
- hero_name = same as card_name for heroes; empty string for play/bonus/hot_dog
- card_number = BOTTOM-LEFT text, EXACTLY as printed. Paper cards are numeric only (e.g., "130"). Parallels have PREFIX-NUMBER (e.g., "BF-108").
- power = large number from TOP-RIGHT (heroes only)
- weapon_type = Fire/Ice/Steel/Hex/Glow/Brawl/Gum/Super/Alt/Cyber
- rarity = common/uncommon/rare/ultra_rare/legendary
- variant = paper/battlefoil/rad/blizzard/etc.

Wonders card details:
- card_name = TOP-LEFT title
- card_number = collector number from BOTTOM-LEFT, exactly as printed (e.g., "78/402", "115", "P-002", "AVA-T1", "A1-205/402")
- Set collector_number to the same value for clarity.
- power = value from "Power" box (numeric, or "S"/"I"/"L")
- cost = value from "Cost" box
- card_type = "Wonder", "Item", "Spell", "Land", etc.
- card_class = class/subtype after the card_type (e.g., "Airship Pirate")
- rarity = Common/Uncommon/Rare/Epic/Mythic/Promo/Token
- foil_treatment = paper/classic_foil/formless_foil/ocm/stone_foil/unknown
- hierarchy = legendary/primary/secondary/token (from type line)
- set_name = "Existence" / "Call of the Stones" / "2026 Prizes and Promos"

If any field is unclear, return null rather than guessing. Report the CARD NUMBER exactly as printed — never fabricate a prefix.`;

// ── Multi-game user prompt ─────────────────────────────────────
export const MULTI_GAME_USER_PROMPT = `<task>Identify this trading card. First determine whether it is a BoBA or Wonders of The First card, then read all fields from their physical positions on the card.</task>

<critical_rules>
- GAME: Inspect the card for distinctive markers before deciding. BoBA = sports hero/athlete imagery, bottom-left card number with optional BoBA prefix. Wonders = fantasy art, vertical type line on left edge, labeled Power/Cost boxes, rarity letter bottom-right.
- CARD NUMBER: Read the EXACT text from the bottom-left corner. Never add a prefix that isn't there.
- Do NOT confuse the POWER value with the card number.
- If the card number is obscured or unreadable, return null.
- Do NOT confabulate from memory — only report what you can physically read.
</critical_rules>

<boba_prefixes>NONE (paper/base cards numeric only), BF, BFA, BBFA, BBF, BLBF, ABF, CBF, GBF, OBF, PBF, SBF, HBF, IBF, RBF, BGBF, RHBF, OHBF, MBFA, GLBF, PL, BPL, HTD, RAD, MIX, MI, BL, GGL, LOGO, FT, SF, SL, CHILL, ALT, CJ, PG, HD</boba_prefixes>

<wonders_prefixes>A1, AVA, BAA, CLA, EEA, KSA, P, T, TFA, XCA (plus plain numeric for Existence set)</wonders_prefixes>

<examples>
BoBA hero (paper): game="boba", card_name="Dart-Board", card_number="130", hero_name="Dart-Board", power="130", weapon_type="Steel", variant="paper"
BoBA hero (battlefoil): game="boba", card_name="BoJax", card_number="BF-108", hero_name="BoJax", power="200", weapon_type="Super", variant="battlefoil"
BoBA play: game="boba", card_name="Front Run", card_number="PL-46", hero_name="", power=null
Wonders OCM: game="wonders", card_name="Riley Stormrider", card_number="A1-205/402", power="4", cost="4", card_type="Primary Wonder", card_class="Airship Pirate", rarity="Rare", foil_treatment="ocm"
Wonders promo: game="wonders", card_name="War Spirit", card_number="P-002", power="7", cost="5", card_type="Primary Wonder", rarity="Promo"
Wonders Existence: game="wonders", card_name="(name from card)", card_number="115", card_type="Wonder", rarity="Common", set_name="Existence"
</examples>`;
