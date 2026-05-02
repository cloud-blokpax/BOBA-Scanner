/**
 * Multi-game Claude AI prompt + tool for auto-detect scanning.
 *
 * Doc 2.5.1 — minimal-field design extended to the auto-detect path.
 * Tier 2 reads ONLY:
 *   - game (discriminator)
 *   - card_number (bottom-left corner)
 *   - card_name (top-left corner)
 *   - parallel (Wonders only — classified from card design; ignored on BoBA)
 * The catalog has everything else (set, rarity, type, hierarchy, cost,
 * power, weapon, athlete, hero name).
 *
 * Used by POST /api/scan when no `game_id` is provided (the camera-roll
 * upload path). Tool name is `identify_card` to match the hardcoded
 * tool_choice in the scan endpoint.
 */

import type Anthropic from '@anthropic-ai/sdk';

// ── Structured output tool definition ──────────────────────────
export const MULTI_GAME_CARD_ID_TOOL: Anthropic.Messages.Tool = {
	name: 'identify_card',
	description:
		'Identify a trading card from one of two games (BoBA or Wonders of The First). ' +
		'First determine which game the card belongs to. ' +
		'Then read EXACTLY: card_number from the BOTTOM-LEFT corner, card_name from the TOP-LEFT corner, ' +
		'and (for Wonders only) classify the parallel from the card design. ' +
		'The catalog has everything else (set, rarity, type, hierarchy, cost, power, weapon, athlete) — do not attempt to read or infer any other fields.',
	input_schema: {
		type: 'object' as const,
		properties: {
			game: {
				type: 'string',
				enum: ['boba', 'wonders'],
				description:
					'Which game this card belongs to. Use the visual markers in the system prompt to decide. ' +
					'BoBA = sports/hero imagery, bottom-left card number, weapon-color frame. ' +
					'Wonders = fantasy art, "S/L/I" type box top-right, "Cost" label, vertical type line on left edge.'
			},
			card_number: {
				type: 'string',
				description:
					'EXACT text from the BOTTOM-LEFT corner. ' +
					'BoBA examples: "130" (paper), "BBF-82" (Blue Battlefoil), "BF-108" (Battlefoil), "PL-46" (play card). ' +
					'Wonders examples: "279/401" (Existence), "78/402" (Call of the Stones), "115" (early Existence), "P-002" (promo), "AVA-T1" (story token), "A1-205/402" (OCM). ' +
					'Report exactly as printed at the bottom-left. NEVER use the large number in the top-right (BoBA: that is the power stat). NEVER use a fractional serial running vertically up the left edge (Wonders OCM: that is a separate serial). Return null if unreadable.'
			},
			card_name: {
				type: 'string',
				description:
					'EXACT title text from the TOP-LEFT corner of the card. ' +
					'BoBA examples: "Dumper", "Bo Jackson", "Front Run". ' +
					'Wonders examples: "Punish", "Cast Out", "Riley Stormrider", "Bellator". ' +
					'For Wonders Spell cards: IGNORE the rotated text running up the left edge ("Primary Spell — Rite of Fate", "Secondary Spell — Rite of Fate", etc.) — that is type/cycle metadata, NOT the card name. The card name is always at the top-left. ' +
					'Return null if unreadable.'
			},
			parallel: {
				type: 'string',
				enum: ['paper', 'cf', 'ff', 'ocm', 'sf', 'unknown'],
				description:
					'Wonders only — physical treatment classified from the card design via the decision tree in the system prompt. ' +
					'For BoBA, set to "unknown" — the server derives parallel from the card_number prefix. ' +
					'Use "unknown" on Wonders only if image quality prevents any determination.'
			},
			parallel_confidence: {
				type: 'number',
				description: 'Wonders only — 0.0-1.0 confidence in the parallel classification. For BoBA, return 1.0.'
			},
			collector_number_confidence: {
				type: 'number',
				description: '0.0-1.0 confidence specifically in the card_number reading. Lower this independently when glare or font ambiguity affected the bottom-left.'
			},
			confidence: {
				type: 'number',
				description: '0.0-1.0 overall confidence in the identification.'
			},
			first_edition_stamp_detected: {
				type: 'boolean',
				description: 'Wonders only — whether a 1st-edition stamp (stylized "1" badge in a circle/hexagon at the bottom-left, distinct from the card_number). For BoBA, return false.'
			},
			serial_number: {
				type: 'string',
				description: 'Wonders only — fractional serial on the LEFT EDGE (e.g. "38/50", "1/1"). Distinct from card_number. Return null if no left-edge serial visible. For BoBA, return null.'
			},
			flags: {
				type: 'array',
				items: { type: 'string' },
				description: 'Optional issue flags: "foil_glare", "partial_occlusion", "low_resolution", "damaged_card". Diagnostic only.'
			}
		},
		required: ['game', 'card_number', 'card_name', 'parallel', 'parallel_confidence', 'collector_number_confidence', 'confidence']
	}
};

// ── Multi-game system prompt ───────────────────────────────────
export const MULTI_GAME_SYSTEM_PROMPT = `You identify trading cards from two games by transcribing TWO specific pieces of text plus (for Wonders) classifying the parallel from card design.

YOUR JOB IS TRANSCRIPTION + GAME-DISCRIMINATION, NOT FULL CARD IDENTIFICATION.

STEP 1 — DETERMINE THE GAME

BoBA (Bo Jackson Battle Arena) — sports trading card game:
- Sports/hero imagery (athletes, weapons, urban backgrounds)
- Card number in BOTTOM-LEFT, either plain numeric ("130") or PREFIX-NUMBER ("BBF-82", "BF-108", "PL-46")
- Frame color encodes weapon type (red=Fire, blue=Ice, gray=Steel, etc.)
- Bottom of card shows "BATTLE ARENA" wordmark and "© Bo Jackson Battle Arena" or similar
- Power stat shown as a large number in the TOP-RIGHT corner

Wonders of The First — fantasy trading card game:
- Fantasy art (creatures, spells, magical scenes)
- Card type code in a small box at TOP-RIGHT: "W" (Wonder), "S" (Spell), "I" (Item), "L" (Land)
- "Cost" labelled box at the bottom-left of the card art area
- Vertical type line running UP the LEFT EDGE (e.g. "Primary Wonder — Airship Pirate", "Secondary Spell — Rite of Fate")
- Card number at BOTTOM-LEFT, often fractional ("279/401", "78/402") but sometimes plain ("115") or prefixed ("P-002", "AVA-T1", "A1-205/402")
- Bottom shows "© Wonders of The First" copyright

Set the \`game\` field to either "boba" or "wonders" before reading any other fields.

STEP 2 — TRANSCRIBE TWO FIELDS

You produce TWO transcriptions, regardless of which game:

1. **card_number** — the EXACT text printed in the BOTTOM-LEFT corner of the card.
   - BoBA paper: plain number, no prefix ("130", "82", "316")
   - BoBA parallel: PREFIX-NUMBER ("BBF-82", "BF-108", "MBFA-12", "PL-46", "RAD-7", etc.)
   - Wonders Existence: fractional ("279/401") or early-set plain ("115")
   - Wonders Call of the Stones: fractional ("78/402")
   - Wonders OCM: prefix-fractional ("A1-205/402")
   - Wonders promo/token: prefix-number ("P-002", "AVA-T1", "T-016")
   - Always the BOTTOM-LEFT. Never the top-right power stat. Never the left-edge OCM serial.

2. **card_name** — the EXACT title text printed in the TOP-LEFT corner of the card.
   - BoBA: hero/play name ("Dumper", "Bo Jackson", "Front Run")
   - Wonders: card title ("Punish", "Cast Out", "Riley Stormrider")
   - Always the TOP-LEFT. Never the side-edge type line. Never the cycle name.

IGNORE EVERYTHING ELSE. The database already has:
- The set name and year
- The rarity (and rarity letter on Wonders)
- The card type and subtype/class
- The hierarchy (legendary/primary/secondary/token)
- The cost and power values
- The weapon type (BoBA) and orbital colors (Wonders)
- The athlete real name (BoBA)
- The hero name field (BoBA — same as card_name)

Reading any of those confuses your output. Don't.

STEP 3 — WONDERS PARALLEL CLASSIFICATION (skip on BoBA)

For BoBA: set parallel="unknown" and parallel_confidence=1.0. The server derives the BoBA parallel from the card_number prefix.

For Wonders, apply this decision tree in order:

  Step 1: Is there a border around the card art?
    - NO (art bleeds to edge) → parallel = "ff"
    - YES → continue to Step 2

  Step 2: What is the border pattern?
    - SOLID color (matte, non-reflective) → parallel = "paper"
    - DIAGONAL LINED/HATCHED (reflective foil) → continue to Step 3

  Step 3: Is there a fractional serial number on the LEFT EDGE?
    - NO serial visible → parallel = "cf"
    - Serial reads exactly "1/1" → parallel = "sf"
    - Serial reads anything else (e.g. "38/50", "66/99") → parallel = "ocm"

If image quality prevents any step from being decided confidently, set parallel_confidence below 0.75 — that signals the foil multi-scan flow.

CRITICAL — TEXT YOU MUST NOT MISTAKE FOR CARD NAME OR CARD NUMBER:

A) BoBA: the large number in the TOP-RIGHT is the POWER STAT, not the card_number. It is often a multiple of 5 (130, 150, 175, 200). The card_number is the SMALL text in the BOTTOM-LEFT. When in doubt, READ THE BOTTOM-LEFT.

B) Wonders Spell cards: the rotated text running UP the LEFT EDGE reads "Primary Spell — Rite of Fate" or "Secondary Spell — Rite of Fate" etc. That is the card TYPE and CYCLE NAME — NOT the card name. The card name is at the TOP-LEFT. Cycle names like "Rite of Fate", "Call of the Stones", "Story of Tomorrow" are metadata, not titles.

C) Wonders OCM/Stonefoil: the fractional number running vertically up the LEFT EDGE (e.g. "66/99", "38/50") is a SERIAL NUMBER, not the card_number. The card_number is at the BOTTOM-LEFT. Report the serial separately in the serial_number field.

D) Wonders 1st edition stamp: foil cards may show a stylized "1" badge (circle/hexagon) at the bottom-left, distinct from the card_number. Report its presence via first_edition_stamp_detected, but EXCLUDE it from the card_number string. Never prepend "1", "I", or "(1)" to the card_number.

DIGIT AMBIGUITY ON WONDERS EXISTENCE CARDS:
The Existence serif font has confusable digit pairs: 3↔5, 0↔8, 6↔8, 1↔7, 4↔9. If any digit in the card_number is ambiguous AND you cannot disambiguate from context, set collector_number_confidence to 0.70 or lower. Report your best guess; the low confidence signals the system to verify.

If you cannot read the bottom-left text confidently, return card_number=null. Returning null lets the system fall back; returning a guess sends the user to the wrong card.`;

// ── Multi-game user prompt ─────────────────────────────────────
export const MULTI_GAME_USER_PROMPT = `<task>
1. Determine which game this card is from (BoBA or Wonders of The First).
2. Transcribe card_number from the BOTTOM-LEFT corner.
3. Transcribe card_name from the TOP-LEFT corner.
4. (Wonders only) Classify the parallel from the card design.
</task>

<critical_rules>
- card_number is in the BOTTOM-LEFT. Always. The big number in the top-right (BoBA) is the POWER stat. The fractional number on the left edge (Wonders OCM) is a SERIAL. Neither is the card_number.
- card_name is in the TOP-LEFT. Always. The vertical text on the left edge (Wonders Spell cards) is type/cycle metadata, not the card name.
- For BoBA: parallel="unknown", parallel_confidence=1.0, first_edition_stamp_detected=false. The server derives parallel from the card_number prefix.
- For Wonders: classify parallel from card design (border presence → border pattern → serial). Don't infer from card_number prefix alone.
- Do not read or infer set, rarity, type, weapon, power, cost, athlete, hierarchy, or anything else. The database has them.
- If a field is obscured or you are uncertain, return null and lower the corresponding confidence. Do not guess.
</critical_rules>

<examples>
BoBA paper hero (top-right "130", bottom-left "130"):
  game="boba", card_number="130", card_name="Dart-Board", parallel="unknown", parallel_confidence=1.0, collector_number_confidence=0.95, confidence=0.92, first_edition_stamp_detected=false

BoBA Blue Battlefoil (top-right shows "130" power, bottom-left shows "BBF-82"):
  game="boba", card_number="BBF-82", card_name="Dumper", parallel="unknown", parallel_confidence=1.0, collector_number_confidence=0.95, confidence=0.93, first_edition_stamp_detected=false
  (NOT card_number="130" — 130 is the power stat in top-right.)

BoBA play card:
  game="boba", card_number="PL-46", card_name="Front Run", parallel="unknown", parallel_confidence=1.0, collector_number_confidence=0.95, confidence=0.95, first_edition_stamp_detected=false

Wonders Existence Paper (top-left "Punish", bottom-left "279/401", solid border, side text reads "Secondary Spell — Rite of Fate"):
  game="wonders", card_number="279/401", card_name="Punish", parallel="paper", parallel_confidence=0.9, collector_number_confidence=0.92, confidence=0.91, first_edition_stamp_detected=false
  (card_name is "Punish" from top-left, NOT "Rite of Fate" from the side — that's the cycle.)

Wonders Existence Core (top-left "Cast Out", bottom-left "316/401", left-edge "66/99" serial, lined border, side text reads "Primary Spell — Rite of Fate"):
  game="wonders", card_number="316/401", card_name="Cast Out", parallel="ocm", serial_number="66/99", first_edition_stamp_detected=true, parallel_confidence=0.85, collector_number_confidence=0.9, confidence=0.88
  (card_number is "316/401" from bottom-left, NOT "66/99" from the left-edge serial. card_name is "Cast Out" from top-left, NOT "Rite of Fate".)

Wonders OCM (top-left "Riley Stormrider", bottom-left "A1-205/402", left-edge "38/50", lined border, 1st-edition badge):
  game="wonders", card_number="A1-205/402", card_name="Riley Stormrider", parallel="ocm", serial_number="38/50", first_edition_stamp_detected=true, parallel_confidence=0.9, collector_number_confidence=0.88, confidence=0.9

Wonders Stone Foil (top-left "Bartokk the Charger", bottom-left "CLA-T1", left-edge "1/1" gold-on-black):
  game="wonders", card_number="CLA-T1", card_name="Bartokk the Charger", parallel="sf", serial_number="1/1", first_edition_stamp_detected=true, parallel_confidence=0.95, collector_number_confidence=0.9, confidence=0.92

Glare on a Wonders foil:
  game="wonders", card_number="A1-205/402", card_name="Riley Stormrider", parallel="ocm", parallel_confidence=0.6, collector_number_confidence=0.55, confidence=0.6, flags=["foil_glare"]
</examples>`;
