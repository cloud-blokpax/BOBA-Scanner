/**
 * Regression tests for the harvest-candidate post-processing in
 * `$lib/server/harvester/candidates.ts`. Lock down the Bug A + E fix:
 * queue parallel wins over catalog parallel, and null-parallel rows are
 * dropped instead of falling back to lowercase 'paper'.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/diagnostics', () => ({
	logEvent: vi.fn().mockResolvedValue(undefined)
}));

import { getNextCandidates } from '../src/lib/server/harvester/candidates';

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

function stubAdmin(rpcReturn: RpcResult) {
	return {
		rpc: vi.fn().mockResolvedValue(rpcReturn)
	} as unknown as Parameters<typeof getNextCandidates>[0];
}

describe('getNextCandidates — parallel precedence and fallback', () => {
	it('uses the queue parallel (r.parallel) when it differs from card_parallel_name', async () => {
		const admin = stubAdmin({
			data: [{
				id: 'abc', hero_name: null, name: 'Progo', card_number: '362',
				athlete_name: null, card_parallel_name: 'Paper', weapon_type: null,
				parallel: 'Orbital Color Match', priority: 1
			}],
			error: null
		});
		const result = await getNextCandidates(admin, 10, '2026-05-12', 'wonders');
		expect(result).toHaveLength(1);
		expect(result[0].parallel).toBe('Orbital Color Match');
	});

	it('falls through to card_parallel_name when queue parallel is null', async () => {
		const admin = stubAdmin({
			data: [{
				id: 'abc', hero_name: 'Bojax', name: 'Bojax', card_number: 'BBF-1',
				athlete_name: 'Bo Jackson', card_parallel_name: 'Blue Battlefoil',
				weapon_type: 'Ice', parallel: null, priority: 1
			}],
			error: null
		});
		const result = await getNextCandidates(admin, 10, '2026-05-12', 'boba');
		expect(result).toHaveLength(1);
		expect(result[0].parallel).toBe('Blue Battlefoil');
	});

	it('drops rows where both parallel fields are null instead of defaulting to lowercase "paper"', async () => {
		const admin = stubAdmin({
			data: [
				{ id: 'good', name: 'X', hero_name: 'X', card_number: '1', athlete_name: null,
				  card_parallel_name: 'Paper', weapon_type: null, parallel: 'Paper', priority: 1 },
				{ id: 'broken', name: 'Y', hero_name: 'Y', card_number: '2', athlete_name: null,
				  card_parallel_name: null, weapon_type: null, parallel: null, priority: 1 }
			],
			error: null
		});
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await getNextCandidates(admin, 10, '2026-05-12', 'boba');
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('good');
		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining('candidate has null parallel')
		);
		consoleError.mockRestore();
	});

	it('never emits the lowercase literal "paper" regardless of input shape', async () => {
		const admin = stubAdmin({
			data: [{
				id: 'a', name: 'A', hero_name: 'A', card_number: '1', athlete_name: null,
				card_parallel_name: 'Paper', weapon_type: null, parallel: 'Paper', priority: 1
			}],
			error: null
		});
		const result = await getNextCandidates(admin, 10, '2026-05-12', 'wonders');
		for (const row of result) {
			expect(row.parallel).not.toBe('paper');
		}
	});

	it('returns empty array on RPC error and logs the failure', async () => {
		const admin = stubAdmin({
			data: null,
			error: { message: 'fake permission error', code: '42501' }
		});
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await getNextCandidates(admin, 10, '2026-05-12', 'boba');
		expect(result).toEqual([]);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it('preserves game_id from the row, falling through to the gameId argument', async () => {
		const admin = stubAdmin({
			data: [{
				id: 'a', name: 'A', hero_name: 'A', card_number: '1', athlete_name: null,
				card_parallel_name: 'Paper', weapon_type: null, parallel: 'Paper', priority: 1
			}],
			error: null
		});
		const result = await getNextCandidates(admin, 10, '2026-05-12', 'wonders');
		expect(result[0].game_id).toBe('wonders');
	});
});
