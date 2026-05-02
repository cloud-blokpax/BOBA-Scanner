/**
 * Wonders of The First — Claude AI identification prompt and structured tool.
 *
 * Doc 2.5 — minimal-field design. Tier 2 reads card_number (bottom-left),
 * card_name (top-left), and runs the parallel decision tree on card design.
 * The catalog has everything else.
 *
 * The tool is named `identify_card` to match the scan endpoint's hardcoded
 * tool_choice. The server normalizes Wonders-specific field names
 * (collector_number → card_number) before returning, but Doc 2.5 emits
 * card_number directly to eliminate the normalization step.
 */

import type Anthropic from '@anthropic-ai/sdk';

// ── Structured output tool definition ──────────────────────────
export const WONDERS_CARD_ID_TOOL: Anthropic.Messages.Tool = {
	name: 'identify_card',
	description:
		'Identify a Wonders of The First trading card. ' +
		'Read THREE fields: card_number from the BOTTOM-LEFT corner, card_name from the TOP-LEFT corner, and classify the parallel from the card design. ' +
		'The catalog has everything else (set, rarity, type, hierarchy, cost, power) — do not attempt to read or infer any other fields.',
	input_schema: {
		type: 'object' as const,
		properties: {
			card_number: {
				type: 'string',
				description:
					'EXACT text from the BOTTOM-LEFT corner. ' +
					'Formats: "78/402" (Call of the Stones), "279/401" (Existence), "115" (early Existence), ' +
					'"P-002" (promo), "AVA-T1" (story token), "A1-205/402" (OCM), "T-016" (token). ' +
					'Report exactly as printed. Return null if unreadable.'
			},
			card_name: {
				type: 'string',
				description:
					'EXACT title text from the TOP-LEFT corner of the card (e.g. "Punish", "Cast Out", "Riley Stormrider", "Bellator"). ' +
					'IGNORE the side-edge text running up the left side ("Primary Spell — Rite of Fate", "Secondary Wonder — Airship Pirate", etc.) — that is type/cycle metadata, NOT the card name. ' +
					'The card name is always at the top-left, in the largest title typeface.'
			},
			parallel: {
				type: 'string',
				enum: ['paper', 'cf', 'ff', 'ocm', 'sf', 'unknown'],
				description:
					'Physical treatment classified from the card design via the decision tree in the system prompt. ' +
					'Use "unknown" only if image quality prevents any determination.'
			},
			parallel_confidence: {
				type: 'number',
				description: '0.0–1.0 confidence in the parallel classification.'
			},
			collector_number_confidence: {
				type: 'number',
				description: '0.0–1.0 confidence specifically in the card_number reading. Lower this independently when glare or font ambiguity affected the bottom-left.'
			},
			confidence: {
				type: 'number',
				description: '0.0–1.0 overall confidence in the identification.'
			},
			first_edition_stamp_detected: {
				type: 'boolean',
				description: 'Whether a 1st-edition stamp (stylized "1" badge) is visible at the bottom-left, distinct from the card_number text. Supports the parallel decision tree; do not include the stamp in card_number.'
			},
			serial_number: {
				type: 'string',
				description: 'OCM/Stonefoil serial on the LEFT EDGE only (e.g. "38/50", "1/1"). Distinct from card_number. Return null if no left-edge serial visible.'
			},
			flags: {
				type: 'array',
				items: { type: 'string' },
				description: 'Optional issue flags: "foil_glare", "partial_occlusion", "low_resolution", "damaged_card". Diagnostic only.'
			}
		},
		required: ['card_number', 'card_name', 'parallel', 'parallel_confidence', 'collector_number_confidence', 'confidence']
	}
};

// ── Claude system prompt ───────────────────────────────────────
export const WONDERS_SYSTEM_PROMPT = `You identify Wonders of The First (WoTF) trading cards by transcribing THREE pieces of information.

YOUR JOB IS TRANSCRIPTION + PARALLEL CLASSIFICATION, NOT FULL CARD IDENTIFICATION.

You produce three fields:

1. card_number — the EXACT text printed in the BOTTOM-LEFT corner of the card.
   - Standard: "78/402" (Call of the Stones uses /402 denominator), "279/401" (Existence uses /401)
   - Early Existence: "115" (no denominator, just the number)
   - Promo: "P-002"
   - Story Token: "AVA-T1", "XCA-T6"
   - OCM: "A1-205/402"
   - Generated Token: "T-016"
   - Report exactly as printed at the bottom-left. Do NOT include any 1st-edition stamp.

2. card_name — the EXACT title text from the TOP-LEFT corner of the card.
   - Examples: "Punish", "Cast Out", "Riley Stormrider", "Bellator", "Omnis Quantum"
   - The card name is the LARGEST text near the top-left, in the title typeface.

3. parallel — the physical treatment, classified from the card design (see decision tree below).

IGNORE EVERYTHING ELSE. The database already has:
- The set name (Existence, Call of the Stones, etc.)
- The rarity (C/U/R/E/M/P)
- The card type and subtype (Primary Spell, Legendary Wonder, etc.)
- The cost, the power, the orbital color (faction)
- The flavor text and ability text

Do not read any of those. Reading them confuses your output.

CRITICAL — TEXT YOU MUST NOT MISTAKE FOR CARD NAME OR CARD NUMBER:

A) The LEFT EDGE often has rotated vertical text reading "Primary Spell — Rite of Fate" or "Secondary Wonder — Airship Pirate" or similar. This is the card TYPE and CYCLE, NOT the card name. Examples of cycles: "Rite of Fate", "Call of the Stones", "Story of Tomorrow". When you see "[Type] — [Cycle Name]" on the left edge, the cycle is metadata; the card_name is at the TOP-LEFT.

B) OCM and Stonefoil cards have a SERIAL NUMBER on the left edge (e.g. "38/50", "66/99", "1/1"). This is a serial, NOT the card_number. The card_number is at the BOTTOM-LEFT. Report the serial separately in the serial_number field.

C) The right edge sometimes has the artist credit. Ignore.

PARALLEL DECISION TREE (apply in order):

Step 1: Is there a border around the card art?
  - NO (art bleeds to edge) → parallel = "ff"
  - YES → continue to Step 2

Step 2: What is the border pattern?
  - SOLID color (matte, non-reflective) → parallel = "paper"
  - DIAGONAL LINED/HATCHED (reflective foil) → continue to Step 3

Step 3: Is there a serial number on the left side?
  - NO serial visible → parallel = "cf"
  - Serial reads exactly "1/1" → parallel = "sf"
  - Serial reads anything else (e.g. "38/50") → parallel = "ocm"

Set parallel_confidence below 0.75 if any step had glare, occlusion, or unclear visual cues — that triggers the foil multi-scan flow.

DIGIT AMBIGUITY ON EXISTENCE CARDS:
The Existence serif font has confusable digit pairs: 3↔5, 0↔8, 6↔8, 1↔7, 4↔9. If any digit in the card_number is ambiguous AND you cannot disambiguate from context, set collector_number_confidence to 0.70 or lower. Report your best guess; the low confidence signals the system to verify.

CRITICAL: If the bottom-left text is not readable confidently, return card_number=null. Returning null lets the system fall back; returning a guess sends the user to the wrong card.`;

// ── Claude user prompt ─────────────────────────────────────────
export const WONDERS_USER_PROMPT = `<task>
Transcribe three things from this Wonders of The First card:
1. card_number — text from the BOTTOM-LEFT corner
2. card_name — title text from the TOP-LEFT corner
3. parallel — classified from the card design via the decision tree
</task>

<critical_rules>
- card_number is in the BOTTOM-LEFT. The fractional serial "X/YY" on the LEFT EDGE is a SERIAL NUMBER, not the card_number — report it separately.
- card_name is in the TOP-LEFT. The vertical text on the LEFT EDGE ("Primary Spell — Rite of Fate", etc.) is the CYCLE/TYPE metadata, NOT the card name.
- parallel comes from the decision tree (border presence → border pattern → serial). Don't infer from card_number prefix alone.
- Do not read set name, rarity, type, hierarchy, cost, power, orbital color, ability text, flavor text, or artist. The database has them.
- If a field is obscured or you are uncertain, return null and lower the corresponding confidence.
</critical_rules>

<examples>
Paper Existence (top-left "Punish", bottom-left "279/401", solid border):
  card_number="279/401", card_name="Punish", parallel="paper", parallel_confidence=0.95, collector_number_confidence=0.92, confidence=0.93

OCM Call of the Stones (top-left "Riley Stormrider", bottom-left "A1-205/402", left-edge serial "38/50", lined border):
  card_number="A1-205/402", card_name="Riley Stormrider", parallel="ocm", serial_number="38/50", first_edition_stamp_detected=true, parallel_confidence=0.9, collector_number_confidence=0.88, confidence=0.9

CF Existence (top-left "Cast Out", bottom-left "316/401", lined border, no serial):
  card_number="316/401", card_name="Cast Out", parallel="cf", parallel_confidence=0.85, collector_number_confidence=0.9, confidence=0.88

Spell with cycle text on left edge (top-left "Punish", left edge reads "Secondary Spell — Rite of Fate"):
  card_name="Punish" (NOT "Rite of Fate" — the cycle text on the left edge is type metadata)

OCM card with prominent left-edge serial (top-left "Cast Out", left-edge "66/99", bottom-left "316/401"):
  card_number="316/401" (bottom-left), serial_number="66/99" (left edge — separate field), card_name="Cast Out", parallel="ocm"

Stone Foil (top-left "Bartokk the Charger", bottom-left "CLA-T1", left-edge "1/1" gold-on-black):
  card_number="CLA-T1", card_name="Bartokk the Charger", parallel="sf", serial_number="1/1", first_edition_stamp_detected=true

Glare on foil:
  card_number="A1-205/402", card_name="Riley Stormrider", parallel="ocm", parallel_confidence=0.6, collector_number_confidence=0.55, flags=["foil_glare"]
</examples>`;
