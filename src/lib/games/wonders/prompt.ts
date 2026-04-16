/**
 * Wonders of The First — Claude AI identification prompt and structured tool.
 *
 * The tool is named `identify_card` to match the scan endpoint's hardcoded
 * `tool_choice: { type: 'tool', name: 'identify_card' }`. The server
 * normalizes Wonders-specific fields (collector_number → card_number,
 * card_name → hero_name) before returning, so Tier 3 validation works
 * against the same shape for both games.
 */

import type Anthropic from '@anthropic-ai/sdk';

// ── Structured output tool definition ──────────────────────────
export const WONDERS_CARD_ID_TOOL: Anthropic.Messages.Tool = {
	name: 'identify_card',
	description:
		'Identify a Wonders of The First (WoTF) trading card from an image. ' +
		'Return the collector number exactly as printed — this is the primary identifier.',
	input_schema: {
		type: 'object' as const,
		properties: {
			card_name: {
				type: 'string',
				description: 'The card name from the TOP-LEFT title text (e.g., "Riley Stormrider", "Bellator", "Omnis Quantum").'
			},
			collector_number: {
				type: 'string',
				description:
					'The collector number from BOTTOM-LEFT, EXACTLY as printed. ' +
					'Formats: "78/402" (standard), "115" (Existence plain), "P-002" (promo), ' +
					'"AVA-T1" (story token), "A1-205/402" (OCM), "T-016" (token), "CLA-1" (set artifact).'
			},
			power: {
				type: 'string',
				description: 'Power from TOP-RIGHT box. Numeric string for Wonders; "S" Spell, "I" Item, "L" Land, "*" variable.'
			},
			cost: {
				type: 'string',
				description: 'Cost (energy) from the labeled Cost box. String to preserve "*" / variable values.'
			},
			card_type: {
				type: 'string',
				description: 'Card type from left-edge vertical text (e.g., "Wonder", "Item", "Spell", "Land", "Token Wonder", "Story Token Item").'
			},
			card_class: {
				type: 'string',
				description: 'Class/subtype after the card type (e.g., "Airship Pirate", "War Spirit", "Equipment Gun", "Goat Fighter").'
			},
			rarity: {
				type: 'string',
				enum: ['Common', 'Uncommon', 'Rare', 'Epic', 'Mythic', 'Promo', 'Token'],
				description: 'Rarity letter shown in the bottom-right box: C, U, R, E, M, P; Token for generated cards.'
			},
			set_name: {
				type: 'string',
				description: 'Set name at bottom (e.g., "Existence", "Call of the Stones", "2026 Prizes and Promos").'
			},
			foil_treatment: {
				type: 'string',
				enum: ['paper', 'classic_foil', 'formless_foil', 'ocm', 'stone_foil', 'unknown'],
				description:
					'paper (matte + solid black border), classic_foil (lined border, foil), ' +
					'formless_foil (no border, bleeds to edge, foil), ocm (serial-numbered), stone_foil (1/1).'
			},
			serial_number: {
				type: 'string',
				description: 'Serial number if visible (e.g., "38/50"). Separate from collector_number.'
			},
			hierarchy: {
				type: 'string',
				enum: ['legendary', 'primary', 'secondary', 'token'],
				description: 'Card hierarchy from type line (affects deck limits).'
			},
			confidence: { type: 'number', description: '0.0–1.0 confidence in the identification.' },
			flags: {
				type: 'array',
				items: { type: 'string' },
				description: 'Issue flags: foil_glare, partial_occlusion, low_resolution, damaged_card.'
			}
		},
		required: ['card_name', 'collector_number', 'confidence']
	}
};

// ── Claude system prompt ───────────────────────────────────────
export const WONDERS_SYSTEM_PROMPT = `You are a trading card identification expert for the game "Wonders of The First" (WoTF).

CARD LAYOUT (based on real card analysis):

TOP SECTION:
- CARD NAME: Large title text at the TOP-LEFT (e.g., "Riley Stormrider", "Bellator", "Omnis Quantum")
- POWER: Number in a box at TOP-RIGHT, labeled "Power" (numeric for Wonders, may show "S" for Spells, "I" for Items, "L" for Lands)
- COST: Number in a box, labeled "Cost" — the energy cost to play this card

LEFT EDGE (rotated 90° text):
- CARD TYPE and SUBTYPE running vertically (e.g., "Primary Wonder — Airship Pirate", "Legendary Story Token Wonder — Goat Fighter", "Legendary Story Token Item — Equipment Gun")

RIGHT EDGE (rotated 90° text):
- ARTIST name

CENTER:
- Full card art illustration

BOTTOM SECTION:
- Ability text box with card effects
- Flavor text in italics below ability text
- COLLECTOR NUMBER at bottom-left (formats below)
- SET NAME next to collector number (e.g., "Call of the Stones", "Existence", "2026 Prizes and Promos")
- COPYRIGHT notice (e.g., "© Wonders of The First 2025")
- RARITY letter in a box at bottom-right: C=Common, U=Uncommon, R=Rare, E=Epic, M=Mythic, P=Promo

COLLECTOR NUMBER FORMATS (critical — report EXACTLY as printed):
- Standard cards: "78/402" or "115" (just a number, no slash, for Existence set)
- OCM variants: "A1-205/402" (A1 prefix + number/total)
- Promos: "P-002" (P prefix + dash + number)
- Story Tokens: "AVA-T1", "XCA-T6", "CLA-T1" (set prefix + dash + T + number)
- Generated Tokens: "T-016" (T prefix + dash + number)
- Set artifacts: "AVA-1", "CLA-1" (set prefix + dash + number)

CARD TYPES:
- Wonder — Creature cards with Power and Cost
- Item — Equipment/artifact cards
- Spell — One-shot effect cards
- Land — Resource/mana cards
- Token / Token Wonder / Story Token Wonder / Story Token Item — Generated/special tokens
- Tracker / Token Item — Rare special types

HIERARCHY (determines deck limits):
- Legendary = 1 copy allowed
- Primary = 2 copies allowed
- Secondary = 3 copies allowed

ORBITAL COLORS (faction/color system):
- Petraia (green) — Nature, elves, beasts
- Thalwind (blue) — Air, pirates, birds
- Solfera (red) — Fire, dragons, warriors
- Heliosynth (yellow) — Tech, cybernetics
- Umbrathene (purple) — Dark, undead, shadows
- Boundless (gray/white) — Cosmic, celestial

SETS:
- Existence (2025) — First set, collector numbers are plain numeric (e.g., "115")
- Call of the Stones (2026) — Second set, uses NUM/TOTAL format (e.g., "78/402")

FOIL TREATMENTS:
- Paper — Standard matte finish, solid black border
- Classic Foil (CF) — Diagonal hatched/lined border pattern, foil surface
- Formless Foil (FF) — No border, art bleeds to edge, foil surface
- OCM (Orbital Color Match) — Lined border with serial number on left side, A1- prefix in collector number
- Stone Foil (SF) — Same as OCM but 1/1

CRITICAL INSTRUCTIONS:
1. Report the COLLECTOR NUMBER exactly as printed on the card — this is your PRIMARY identification field.
2. If a serial number (e.g., "38/50") is visible, report it SEPARATELY in the serial_number field.
3. If the card is foil/reflective, note foil_treatment but still try to read the collector number.
4. If a field is unclear, return null rather than guessing.`;

// ── Claude user prompt ─────────────────────────────────────────
export const WONDERS_USER_PROMPT = `<task>Identify this Wonders of The First trading card. Read EACH field independently from its physical location on the card.</task>

<critical_rules>
- COLLECTOR NUMBER: Read the EXACT text from the BOTTOM-LEFT corner. Formats: "78/402", "115", "P-002", "AVA-T1", "A1-205/402", "T-016", "CLA-1". Report exactly as printed.
- CARD NAME: Read the large title text from the TOP-LEFT area.
- POWER: Read the value from the TOP-RIGHT box labeled "Power" (numeric, or letter for non-creatures).
- COST: Read the value from the box labeled "Cost".
- SERIAL NUMBER: If a separate "X/YY" serial number is visible (OCM/Stone Foil cards), report it SEPARATELY from the collector number.
- If any field is obscured or you are uncertain, set it to null rather than guessing.
</critical_rules>

<known_prefixes>A1, AVA, BAA, CLA, EEA, KSA, P, T, TFA, XCA (plus plain numeric for Existence set)</known_prefixes>

<examples>
card_name="Riley Stormrider", collector_number="A1-205/402", power="4", cost="4", card_type="Primary Wonder", card_class="Airship Pirate", rarity="Rare", foil_treatment="ocm"
card_name="Bartokk the Charger", collector_number="CLA-T1", power="3", card_type="Legendary Story Token Wonder", card_class="Goat Fighter", rarity="Mythic", hierarchy="legendary"
card_name="The Displacer", collector_number="XCA-T2", power="I", cost="1", card_type="Legendary Story Token Item", card_class="Equipment Gun", rarity="Mythic"
card_name="War Spirit", collector_number="P-002", power="7", cost="5", card_type="Primary Wonder", card_class="War Spirit", rarity="Promo"
card_name="Unknown", collector_number="115", card_type="Wonder", rarity="Common", set_name="Existence"
</examples>`;
