<script lang="ts">
	import { onMount } from 'svelte';
	import { collectionItems } from '$lib/stores/collection.svelte';
	import { searchCards } from '$lib/services/card-db';
	import { showToast } from '$lib/stores/toast.svelte';
	import { buildEbaySoldUrl } from '$lib/services/ebay';

	interface SetProgress {
		setKey: string;
		setName: string;
		owned: number;
		total: number;
		percent: number;
		missing: { card_number: string; hero_name: string | null }[];
	}

	let sets = $state<SetProgress[]>([]);
	let loading = $state(true);
	let expandedSet = $state<string | null>(null);

	async function analyzeCompletion() {
		loading = true;
		try {
			// Get all unique set codes from collection
			const items = collectionItems();
			const ownedBySet = new Map<string, Set<string>>();

			for (const item of items) {
				const card = item.card;
				if (!card?.set_code) continue;
				const key = card.set_code.toUpperCase();
				if (!ownedBySet.has(key)) ownedBySet.set(key, new Set());
				if (card.card_number) ownedBySet.get(key)!.add(card.card_number.toUpperCase());
			}

			// For each set, search the card database for total cards
			const results: SetProgress[] = [];

			for (const [setKey, ownedCards] of ownedBySet) {
				const allInSet = await searchCards(setKey, 500);
				const setCards = allInSet.filter(
					(c) => c.set_code?.toUpperCase() === setKey
				);

				if (setCards.length === 0) continue;

				const total = setCards.length;
				const owned = ownedCards.size;
				const percent = total > 0 ? Math.round((owned / total) * 100) : 0;

				const missing = setCards
					.filter((c) => c.card_number && !ownedCards.has(c.card_number.toUpperCase()))
					.map((c) => ({ card_number: c.card_number!, hero_name: c.hero_name ?? null }));

				results.push({
					setKey,
					setName: setKey,
					owned,
					total,
					percent,
					missing
				});
			}

			sets = results.sort((a, b) => b.percent - a.percent);
			if (sets.length === 0) {
				showToast('No sets found in collection', 'info');
			}
		} catch (err) {
			console.debug('[set-completion] Set analysis failed:', err);
			showToast('Failed to analyze sets', 'x');
		}
		loading = false;
	}

	function progressColor(percent: number): string {
		if (percent >= 80) return '#22c55e';
		if (percent >= 50) return '#eab308';
		return '#6b7280';
	}

	// Run once on mount; re-run when collectionItems() changes
	let _prevItemCount = -1;
	onMount(() => { analyzeCompletion(); });
	$effect(() => {
		const count = collectionItems().length;
		if (count !== _prevItemCount && _prevItemCount !== -1) {
			analyzeCompletion();
		}
		_prevItemCount = count;
	});
</script>

<svelte:head>
	<title>Set Completion - BOBA Scanner</title>
</svelte:head>

<div class="set-page">
	<header class="page-header">
		<h1>Set Completion</h1>
		<p class="subtitle">Track your progress toward completing each set</p>
	</header>

	{#if loading}
		<div class="loading">Analyzing your collection...</div>
	{:else if sets.length === 0}
		<div class="empty">
			<p>No sets found. Add cards to your collection first.</p>
		</div>
	{:else}
		<div class="sets-list">
			{#each sets as set}
				<div class="set-card">
					<button
						class="set-header"
						onclick={() => (expandedSet = expandedSet === set.setKey ? null : set.setKey)}
					>
						<div class="set-info">
							<div class="set-name">{set.setName}</div>
							<div class="set-counts">{set.owned} / {set.total} cards</div>
						</div>
						<div class="set-percent" style="color: {progressColor(set.percent)}">
							{set.percent}%
						</div>
					</button>

					<div class="progress-bar">
						<div
							class="progress-fill"
							style="width: {set.percent}%; background: {progressColor(set.percent)}"
						></div>
					</div>

					{#if expandedSet === set.setKey && set.missing.length > 0}
						<div class="missing-section">
							<h3>Missing Cards ({set.missing.length})</h3>
							<div class="missing-grid">
								{#each set.missing as card}
									<div class="missing-card-group">
										<a
											href={buildEbaySoldUrl({ card_number: card.card_number, hero_name: card.hero_name })}
											target="_blank"
											rel="noopener noreferrer"
											class="missing-card"
										>
											<span class="missing-number">{card.card_number}</span>
											{#if card.hero_name}
												<span class="missing-name">{card.hero_name}</span>
											{/if}
										</a>
										<a href="/deck/shop?search={encodeURIComponent(card.card_number || card.hero_name || '')}" class="find-btn">
											Find in Shop
										</a>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.set-page {
		max-width: 600px;
		margin: 0 auto;
		padding: 1rem;
	}
	.page-header { margin-bottom: 1.5rem; }
	h1 { font-size: 1.5rem; font-weight: 700; }
	.subtitle {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}
	.loading, .empty {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}
	.sets-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.set-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		overflow: hidden;
	}
	.set-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		padding: 1rem;
		background: none;
		border: none;
		color: var(--text-primary);
		cursor: pointer;
		text-align: left;
	}
	.set-name { font-weight: 600; font-size: 0.95rem; }
	.set-counts {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-top: 2px;
	}
	.set-percent { font-size: 1.25rem; font-weight: 700; }
	.progress-bar {
		height: 4px;
		background: var(--bg-base);
		margin: 0 1rem 0.75rem;
		border-radius: 2px;
	}
	.progress-fill {
		height: 100%;
		border-radius: 2px;
		transition: width 0.3s ease;
	}
	.missing-section {
		padding: 0 1rem 1rem;
	}
	.missing-section h3 {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}
	.missing-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.missing-card {
		display: inline-flex;
		flex-direction: column;
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		background: var(--bg-base);
		text-decoration: none;
		color: var(--text-primary);
		font-size: 0.8rem;
		transition: background 0.15s;
	}
	.missing-card:hover { background: var(--bg-hover); }
	.missing-number { font-weight: 600; }
	.missing-name {
		font-size: 0.7rem;
		color: var(--text-tertiary);
	}
	.missing-card-group {
		display: inline-flex;
		flex-direction: column;
		gap: 2px;
	}
	.find-btn {
		font-size: 0.65rem;
		color: var(--accent-primary, #3b82f6);
		text-decoration: none;
		text-align: center;
		padding: 2px 4px;
		border-radius: 4px;
	}
	.find-btn:hover { text-decoration: underline; }
</style>
