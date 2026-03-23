/**
 * Shared Anthropic API client singleton.
 *
 * Centralizes API key resolution and client creation so all endpoints
 * use the same key priority and share the same client instance.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';

let _client: Anthropic | null = null;

/**
 * Get the Anthropic API client. Throws if no API key is configured.
 * Checks ANTHROPIC_API_KEY first, then CLAUDE_API_KEY as fallback.
 */
export function getAnthropicClient(): Anthropic {
	if (_client) return _client;

	const apiKey = env.ANTHROPIC_API_KEY ?? env.CLAUDE_API_KEY ?? '';
	if (!apiKey) {
		throw new Error('Anthropic API key not configured (set ANTHROPIC_API_KEY or CLAUDE_API_KEY)');
	}

	_client = new Anthropic({ apiKey });
	return _client;
}
