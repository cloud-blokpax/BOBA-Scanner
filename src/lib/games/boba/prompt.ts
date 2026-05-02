/**
 * BoBA Claude AI identification prompt and structured output tool.
 *
 * Doc 2.5 — minimal-field design. Tier 2 reads ONLY card_number (bottom-left)
 * and card_name (top-left). The catalog has everything else. Parallel is
 * derived from the card_number prefix server-side via cards.parallel and is
 * NOT requested from Claude.
 */

import type Anthropic from '@anthropic-ai/sdk';

// ── Structured output tool definition ──────────────────────────
export const BOBA_CARD_ID_TOOL: Anthropic.Messages.Tool = {
	name: 'identify_card',
	description:
		'Identify a BoBA (Bo Jackson Battle Arena) trading card. ' +
		'Read EXACTLY two fields from two specific locations: card_number from the BOTTOM-LEFT corner, and card_name from the TOP-LEFT corner. ' +
		'The catalog has everything else (set, rarity, weapon, power) — do not attempt to read or infer any other fields.',
	input_schema: {
		type: 'object' as const,
		properties: {
			card_number: {
				type: 'string',
				description:
					'EXACT text from the BOTTOM-LEFT corner of the card. ' +
					'Two formats only: ' +
					'(a) plain number with no prefix (e.g. "130", "82", "316") for paper/base cards; ' +
					'(b) PREFIX-NUMBER (e.g. "BBF-82", "BF-108", "MBFA-12") for parallels. ' +
					'NEVER use the large number in the top-right corner — that is the power stat, not the card_number. ' +
					'Return null if the bottom-left text is unreadable. Do not guess from memory.'
			},
			card_name: {
				type: 'string',
				description:
					'EXACT text from the TOP-LEFT corner of the card (e.g. "Dumper", "Bo Jackson", "Front Run"). ' +
					'Read only the title text at the top-left. Do not read play type ("Hot Dog", "Bonus Play") — those are typed labels elsewhere. ' +
					'Return null if unreadable.'
			},
			confidence: {
				type: 'number',
				description: '0.0–1.0 confidence in the card_number reading specifically. Lower this if glare or blur affected the bottom-left corner.'
			},
			flags: {
				type: 'array',
				items: { type: 'string' },
				description: 'Optional issue flags: "glare", "blur", "partial_occlusion", "foil_reflection". Diagnostic only.'
			}
		},
		required: ['card_number', 'card_name', 'confidence']
	}
};

// ── Claude system prompt ───────────────────────────────────────
export const BOBA_SYSTEM_PROMPT = `You identify BoBA (Bo Jackson Battle Arena) trading cards by transcribing TWO specific pieces of text from the card.

YOUR JOB IS TRANSCRIPTION, NOT IDENTIFICATION.

You read two fields:

1. card_number — the EXACT text printed in the BOTTOM-LEFT corner of the card.
   - Paper/base cards have a plain number with no prefix: "130", "82", "316".
   - Parallel cards have a PREFIX-NUMBER format: "BBF-82" (Blue Battlefoil), "BF-108" (Battlefoil), "MBFA-12" (Metallic Inspired Ink), etc.
   - The card_number is ALWAYS in the bottom-left, ALWAYS small text, and is the ONLY thing that goes in the card_number field.

2. card_name — the EXACT title text printed in the TOP-LEFT corner of the card.
   - This is the hero or play name. Examples: "Dumper", "Bo Jackson", "Cruze-Control", "Front Run".
   - The card_name is ALWAYS in the top-left.

IGNORE EVERYTHING ELSE. The database already has:
- The set name and year
- The rarity
- The weapon type and color
- The power value
- Whether it's a hero, play, bonus play, or hot dog card
- The athlete real name
- The parallel name (derived from the card_number prefix)

Do not read any of those. Reading them confuses your output.

CRITICAL — TWO PIECES OF TEXT YOU MUST NOT MISTAKE:

A) The big number in the TOP-RIGHT corner is the POWER STAT, not the card_number.
   - Power values are typically multiples of 5 (130, 150, 175, 200).
   - Some cards have a card_number that happens to equal the power (e.g. paper card #130 with power 130). When in doubt, READ THE BOTTOM-LEFT — that's the card_number, regardless of what the top-right says.

B) The bottom edge sometimes shows a year stamp ("2026") and a set name ("BATTLE ARENA"). Neither is the card_number. The card_number is the SMALL text directly in the bottom-LEFT corner, NOT the centered set name.

If you cannot read the bottom-left text confidently, return card_number=null. Returning null lets the system fall back; returning a guess sends the user to the wrong card.`;

// ── Claude user prompt ─────────────────────────────────────────
export const BOBA_USER_PROMPT = `<task>
Transcribe two pieces of text from this BoBA trading card:
1. card_number — the text in the BOTTOM-LEFT corner (e.g. "BBF-82" or "130")
2. card_name — the title text in the TOP-LEFT corner (e.g. "Dumper")
</task>

<critical_rules>
- card_number is in the BOTTOM-LEFT. Always. The big number in the top-right is the POWER stat — never the card_number.
- card_name is in the TOP-LEFT. Always. Read just the hero/play name, not anything else.
- Do not read or infer set name, rarity, weapon, power, parallel, athlete name, year, or anything else. The database has them.
- If a field is obscured or you are uncertain, return null. Do not guess from memory.
</critical_rules>

<examples>
Paper hero (top-right shows "130", bottom-left shows "BBF-82"):
  card_number="BBF-82", card_name="Dumper", confidence=0.95
  (NOT card_number="130" — 130 is the power stat in top-right.)

Paper hero where card_number happens to equal power (top-right "130", bottom-left "130"):
  card_number="130", card_name="Dart-Board", confidence=0.95
  (Bottom-left was the source of truth; happens to match top-right by coincidence.)

Battlefoil parallel (bottom-left "BF-108"):
  card_number="BF-108", card_name="Bo Jackson", confidence=0.92

Play card (no power value, bottom-left "PL-46"):
  card_number="PL-46", card_name="Front Run", confidence=0.95

Unreadable bottom-left:
  card_number=null, card_name="The Kid", confidence=0.4, flags=["foil_reflection"]
</examples>`;
