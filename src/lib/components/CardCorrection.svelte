<script lang="ts">
	import type { Card } from '$lib/types';
	import { searchCards } from '$lib/services/card-db';
	import { showToast } from '$lib/stores/toast';

	let { card, onCorrect, onClose }: {
		card: Partial<Card>;
		onCorrect?: (correctedCard: Partial<Card>) => void;
		onClose?: () => void;
	} = $props();

	let searchQuery = $state('');
	let searchResults = $state<Partial<Card>[]>([]);
	let searching = $state(false);
	let initialized = false;

	// Seed search query from card prop (and update when card changes)
	$effect(() => {
		const num = card.card_number || '';
		if (!initialized) {
			searchQuery = num;
			initialized = true;
		}
	});

	async function handleSearch() {
		if (!searchQuery.trim()) return;
		searching = true;
		try {
			searchResults = await searchCards(searchQuery.trim(), 10);
		} catch {
			searchResults = [];
		}
		searching = false;
	}

	function selectCorrection(corrected: Partial<Card>) {
		onCorrect?.(corrected);
		showToast('Card corrected', '✓');
		onClose?.();
	}
</script>

<div class="card-corrections">
	<div class="corrections-header">
		<h3>Correct Card ID</h3>
		<button class="close-btn" onclick={() => onClose?.()}>x</button>
	</div>

	<p class="current-info">
		Current: <strong>{card.card_number || 'Unknown'}</strong>
		{#if card.hero_name} — {card.hero_name}{/if}
	</p>

	<div class="search-row">
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Search by card number or name..."
			onkeydown={(e) => { if (e.key === 'Enter') handleSearch(); }}
		/>
		<button class="btn-primary" onclick={handleSearch} disabled={searching}>
			{searching ? '...' : 'Search'}
		</button>
	</div>

	{#if searchResults.length > 0}
		<div class="results-list">
			{#each searchResults as result}
				<button class="result-item" onclick={() => selectCorrection(result)}>
					<div class="result-title">{result.hero_name || result.name || 'Unknown'}</div>
					<div class="result-subtitle">
						{result.card_number || ''} · {result.set_code || ''}
					</div>
				</button>
			{/each}
		</div>
	{:else if searchQuery && !searching}
		<p class="no-results">No matching cards found.</p>
	{/if}
</div>

<style>
	.card-corrections { padding: 1rem; }
	.corrections-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}
	h3 { font-size: 1rem; font-weight: 600; }
	.close-btn {
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		font-size: 1.25rem;
	}
	.current-info {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}
	.search-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
	}
	.results-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 300px;
		overflow-y: auto;
	}
	.result-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-primary);
		cursor: pointer;
	}
	.result-item:hover { background: var(--bg-hover); }
	.result-title { font-weight: 600; font-size: 0.9rem; }
	.result-subtitle { font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px; }
	.no-results {
		text-align: center;
		color: var(--text-tertiary);
		padding: 1rem;
		font-size: 0.85rem;
	}
</style>
