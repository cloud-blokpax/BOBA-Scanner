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
				enum: ['paper', 'cf', 'ff', 'ocm', 'sf', 'unknown'],
				description:
					'For Wonders cards, the detected physical treatment via the variant decision tree ' +
					'(paper=solid border, cf=lined border no serial, ff=no border, ocm=lined border with X/YY serial, sf=lined border with 1/1 serial). ' +
					'For BoBA cards, return "paper" — BoBA encodes variant in card_number, not as a separate attribute.'
			},
			variant_confidence: {
				type: 'number',
				description:
					'Wonders only — confidence in variant detection, 0.0-1.0. Values below 0.75 trigger the foil multi-scan flow. ' +
					'For BoBA, return 1.0.'
			},
			first_edition_stamp_detected: {
				type: 'boolean',
				description:
					'Wonders only — whether a 1st edition stamp (stylized "1" in a circle/badge) is visible ' +
					'at the bottom-left, distinct from the collector number. Paper cards never have this stamp. ' +
					'For BoBA, return false.'
			},
			collector_number_confidence: {
				type: 'number',
				description:
					'Confidence specifically in the card_number / collector_number reading, 0.0-1.0. ' +
					'Glare on foil cards can reduce this independently of overall scan confidence.'
			},
			parallel: { type: 'string', description: 'BoBA only — specific parallel name if identifiable.' },
			confidence: { type: 'number', description: '0.0–1.0' },
			flags: { type: 'array', items: { type: 'string' }, description: 'Issues: blurry, glare, partial, foil_reflection, damaged_card, partial_occlusion, low_resolution.' }
		},
		required: ['game', 'card_name', 'card_number', 'confidence', 'variant', 'variant_confidence', 'collector_number_confidence']
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
- variant = paper/cf/ff/ocm/sf/unknown (see VARIANT DECISION TREE below)
- hierarchy = legendary/primary/secondary/token (from type line)
- set_name = "Existence" / "Call of the Stones" / "2026 Prizes and Promos"

BoBA variant handling:
- For BoBA cards, always return variant="paper" and variant_confidence=1.0. BoBA's variant
  is encoded in the card_number itself via prefixes (BF-, RAD-, etc.) — there is no
  separate visual variant to detect. Return first_edition_stamp_detected=false.

WONDERS VARIANT DECISION TREE (apply in this order when game=wonders):

Step 1: Is there a border?
  - NO (art bleeds to edge) → variant="ff", skip to Step 4
  - YES → continue to Step 2

Step 2: What is the border pattern?
  - SOLID color → variant="paper", skip to Step 4
  - DIAGONAL LINED/HATCHED → continue to Step 3

Step 3: Is there a serial number on the left side of the card?
  - NO serial → variant="cf"
  - Serial reads "1/1" → variant="sf"
  - Serial reads anything else (e.g., "38/50", "12/100") → variant="ocm"

Step 4: Report the detected variant in the "variant" field along with your
  confidence in "variant_confidence". If any step of the decision tree was
  uncertain (glare obscured the border, serial unreadable, etc.), return
  variant_confidence below 0.75 so the app can trigger a foil multi-scan.

THE 1ST EDITION STAMP (WONDERS ONLY):

Foil Wonders cards (cf, ff, ocm, sf) commonly display a 1st edition stamp at the
bottom-left — a stylized "1" inside a circle or hexagonal badge, distinct from the
collector number. You MUST:

1. REPORT its presence via first_edition_stamp_detected=true. Paper cards never
   have this stamp, so its presence means the card is almost certainly foil.
2. EXCLUDE the stamp from the card_number / collector_number field. Do NOT
   prepend "1", "I", or "(1)" to the collector number. Report the collector
   number starting from the first alphanumeric character AFTER the stamp.

Example: "[1-badge] A1-205/402" → card_number="A1-205/402", first_edition_stamp_detected=true
  NEVER: card_number="1 A1-205/402" or "1A1-205/402"

The stamp is NOT universal on foil cards — some early CF/OCM cards shipped without it.
Absence of the stamp does NOT prove Paper. Use border pattern and serial number
as the primary variant indicators.

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
BoBA hero (paper): game="boba", card_name="Dart-Board", card_number="130", hero_name="Dart-Board", power="130", weapon_type="Steel", variant="paper", variant_confidence=1.0, first_edition_stamp_detected=false, collector_number_confidence=0.95
BoBA hero (battlefoil): game="boba", card_name="BoJax", card_number="BF-108", hero_name="BoJax", power="200", weapon_type="Super", variant="paper", parallel="battlefoil", variant_confidence=1.0, first_edition_stamp_detected=false, collector_number_confidence=0.9
Wonders Paper: game="wonders", card_name="Bellator", card_number="78/402", variant="paper", variant_confidence=0.95, first_edition_stamp_detected=false, collector_number_confidence=0.95
Wonders OCM: game="wonders", card_name="Riley Stormrider", card_number="A1-205/402", power="4", cost="4", variant="ocm", variant_confidence=0.9, first_edition_stamp_detected=true, collector_number_confidence=0.85, serial_number="38/50", card_type="Primary Wonder", rarity="Rare"
Wonders CF: game="wonders", card_name="Omnis Quantum", card_number="14/402", variant="cf", variant_confidence=0.88, first_edition_stamp_detected=true, collector_number_confidence=0.9
Wonders FF promo: game="wonders", card_name="War Spirit", card_number="P-002", variant="ff", variant_confidence=0.9, first_edition_stamp_detected=true, collector_number_confidence=0.95, rarity="Promo"
Wonders Stone Foil (1/1): game="wonders", card_name="Bartokk the Charger", card_number="CLA-T1", variant="sf", variant_confidence=0.85, first_edition_stamp_detected=true, serial_number="1/1"
Wonders Existence: game="wonders", card_name="(from card)", card_number="115", variant="paper", variant_confidence=0.9, first_edition_stamp_detected=false, collector_number_confidence=0.9, rarity="Common", set_name="Existence"
</examples>`;
