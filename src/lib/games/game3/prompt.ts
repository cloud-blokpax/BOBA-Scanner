/**
 * Game 3 — Claude AI identification prompt + tool schema (skeleton).
 *
 * Replace with a real prompt and tool schema when the third game is defined.
 * The tool is named `identify_card` to match the scan endpoint's
 * hardcoded `tool_choice`.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const GAME3_CARD_ID_TOOL: Anthropic.Messages.Tool = {
	name: 'identify_card',
	description: 'Game 3 identification tool — placeholder until the real game is defined.',
	input_schema: {
		type: 'object' as const,
		properties: {
			card_name: { type: 'string', description: 'Card name' },
			card_number: { type: 'string', description: 'Card number / collector number' },
			confidence: { type: 'number', description: '0.0–1.0' },
		},
		required: ['card_name', 'card_number', 'confidence'],
	},
};

export const GAME3_SYSTEM_PROMPT =
	'Game 3 is not yet configured. Return confidence 0 and decline to identify.';

export const GAME3_USER_PROMPT = '<task>Game 3 not yet configured.</task>';
