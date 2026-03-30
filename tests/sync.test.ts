/**
 * Unit tests for the sync service — bidirectional collection sync.
 *
 * Tests merge conflict resolution, tombstone handling, and lock behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────

const { mockSupabase, mockIdb, mockUser, mockCollectionItems, mockSetCollectionItems, mockClearLocalModifications, mockGetLocalModifiedAt, mockFetchCollection } = vi.hoisted(() => {
	const mockUpsert = vi.fn().mockResolvedValue({ error: null });
	const mockDelete = vi.fn().mockReturnValue({
		eq: vi.fn().mockReturnValue({
			in: vi.fn().mockResolvedValue({ error: null })
		})
	});
	const mockSupabase = {
		from: vi.fn().mockReturnValue({
			upsert: mockUpsert,
			delete: mockDelete
		}),
		_upsert: mockUpsert,
		_delete: mockDelete
	};

	const mockIdb = {
		getTombstones: vi.fn().mockResolvedValue([]),
		clearTombstones: vi.fn().mockResolvedValue(undefined),
		getMeta: vi.fn().mockResolvedValue(null),
		setMeta: vi.fn().mockResolvedValue(undefined)
	};

	const mockUser = vi.fn().mockReturnValue({ id: 'user-1' });
	const mockCollectionItems = vi.fn().mockReturnValue([]);
	const mockSetCollectionItems = vi.fn();
	const mockClearLocalModifications = vi.fn();
	const mockGetLocalModifiedAt = vi.fn().mockReturnValue(undefined);
	const mockFetchCollection = vi.fn().mockResolvedValue([]);

	return {
		mockSupabase, mockIdb, mockUser, mockCollectionItems,
		mockSetCollectionItems, mockClearLocalModifications,
		mockGetLocalModifiedAt, mockFetchCollection
	};
});

// ── Module mocks ────────────────────────────────────────────

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/services/supabase', () => ({
	getSupabase: vi.fn().mockReturnValue(mockSupabase)
}));

vi.mock('$lib/stores/auth.svelte', () => ({
	user: mockUser
}));

vi.mock('$lib/stores/collection.svelte', () => ({
	collectionItems: mockCollectionItems,
	setCollectionItems: mockSetCollectionItems,
	getLocalModifiedAt: mockGetLocalModifiedAt,
	clearLocalModifications: mockClearLocalModifications
}));

vi.mock('$lib/services/idb', () => ({
	idb: mockIdb
}));

vi.mock('$lib/services/collection-service', () => ({
	fetchCollection: mockFetchCollection
}));

import { fullSync, schedulePush } from '../src/lib/services/sync';

// ── Tests ───────────────────────────────────────────────────

describe('sync service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUser.mockReturnValue({ id: 'user-1' });
		mockCollectionItems.mockReturnValue([]);
		mockFetchCollection.mockResolvedValue([]);
		mockIdb.getTombstones.mockResolvedValue([]);
		mockIdb.getMeta.mockResolvedValue(null);
	});

	describe('fullSync — merge conflict resolution', () => {
		it('keeps remote-only items', async () => {
			const remoteItem = {
				card_id: 'card-1', condition: 'near_mint', quantity: 1,
				notes: null, added_at: '2026-01-01T00:00:00Z'
			};
			mockFetchCollection.mockResolvedValue([remoteItem]);
			mockCollectionItems.mockReturnValue([]);

			await fullSync();

			expect(mockSetCollectionItems).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ card_id: 'card-1' })])
			);
		});

		it('keeps local-only items that were never synced', async () => {
			const localItem = {
				card_id: 'card-2', condition: 'near_mint', quantity: 1,
				notes: null, added_at: '2026-01-02T00:00:00Z'
			};
			mockCollectionItems.mockReturnValue([localItem]);
			mockFetchCollection.mockResolvedValue([]);
			mockIdb.getMeta.mockResolvedValue(null); // No previous sync keys

			await fullSync();

			expect(mockSetCollectionItems).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ card_id: 'card-2' })])
			);
		});

		it('removes local items that were deleted remotely', async () => {
			const localItem = {
				card_id: 'card-3', condition: 'near_mint', quantity: 1,
				notes: null, added_at: '2026-01-01T00:00:00Z'
			};
			mockCollectionItems.mockReturnValue([localItem]);
			mockFetchCollection.mockResolvedValue([]); // Not on remote anymore
			// Was previously synced
			mockIdb.getMeta.mockResolvedValue(['card-3:near_mint']);

			await fullSync();

			// Should NOT include card-3 (deleted remotely)
			expect(mockSetCollectionItems).toHaveBeenCalledWith([]);
		});

		it('resolves conflicts by keeping the newer timestamp', async () => {
			const localItem = {
				card_id: 'card-4', condition: 'near_mint', quantity: 2,
				notes: 'local edit', added_at: '2026-01-01T00:00:00Z'
			};
			const remoteItem = {
				card_id: 'card-4', condition: 'near_mint', quantity: 1,
				notes: 'remote', added_at: '2026-01-05T00:00:00Z'
			};
			mockCollectionItems.mockReturnValue([localItem]);
			mockFetchCollection.mockResolvedValue([remoteItem]);
			mockGetLocalModifiedAt.mockReturnValue(undefined); // No local modification timestamp

			await fullSync();

			// Remote is newer (Jan 5 > Jan 1), so remote wins
			expect(mockSetCollectionItems).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ notes: 'remote' })])
			);
		});

		it('prefers local when local modification is more recent', async () => {
			const localItem = {
				card_id: 'card-5', condition: 'near_mint', quantity: 3,
				notes: 'local update', added_at: '2026-01-01T00:00:00Z'
			};
			const remoteItem = {
				card_id: 'card-5', condition: 'near_mint', quantity: 1,
				notes: 'remote', added_at: '2026-01-03T00:00:00Z'
			};
			mockCollectionItems.mockReturnValue([localItem]);
			mockFetchCollection.mockResolvedValue([remoteItem]);
			// Local modification timestamp is after remote
			mockGetLocalModifiedAt.mockReturnValue(new Date('2026-01-10T00:00:00Z').getTime());

			await fullSync();

			// Local is newer due to modification timestamp, so local wins
			expect(mockSetCollectionItems).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ notes: 'local update' })])
			);
		});
	});

	describe('fullSync — lock behavior', () => {
		it('prevents concurrent sync operations', async () => {
			let resolveFirst: () => void;
			const slowFetch = new Promise<never[]>((resolve) => {
				resolveFirst = () => resolve([]);
			});
			mockFetchCollection.mockReturnValueOnce(slowFetch);

			const sync1 = fullSync();
			const sync2 = fullSync(); // Should be blocked by lock

			resolveFirst!();
			await sync1;
			await sync2;

			// fetchCollection should only be called once (second sync was locked out)
			expect(mockFetchCollection).toHaveBeenCalledTimes(1);
		});
	});

	describe('fullSync — tombstone handling', () => {
		it('pushes tombstones to remote and clears on success', async () => {
			mockIdb.getTombstones.mockResolvedValue([
				{ cardId: 'card-del-1' },
				{ cardId: 'card-del-2' }
			]);

			await fullSync();

			// Should have called delete on the supabase client
			const fromCall = mockSupabase.from;
			expect(fromCall).toHaveBeenCalledWith('collections');
			// Should clear tombstones after successful push
			expect(mockIdb.clearTombstones).toHaveBeenCalled();
		});
	});

	describe('fullSync — no user/supabase', () => {
		it('skips sync when user is not authenticated', async () => {
			mockUser.mockReturnValue(null);

			await fullSync();

			expect(mockFetchCollection).not.toHaveBeenCalled();
			expect(mockSetCollectionItems).not.toHaveBeenCalled();
		});
	});
});
