<script lang="ts">
	import { goto } from '$app/navigation';

	let { data } = $props();

	function changePage(page: number) {
		const params = new URLSearchParams(window.location.search);
		params.set('page', String(page));
		goto(`/decks?${params.toString()}`);
	}

	function changeSort(sort: string) {
		const params = new URLSearchParams(window.location.search);
		params.set('sort', sort);
		params.delete('page');
		goto(`/decks?${params.toString()}`);
	}

	function changeFormat(format: string) {
		const params = new URLSearchParams(window.location.search);
		if (format) params.set('format', format);
		else params.delete('format');
		params.delete('page');
		goto(`/decks?${params.toString()}`);
	}

	function calcDbs(playEntries: Array<{ dbs?: number }>): number {
		return playEntries?.reduce((sum, p) => sum + (p.dbs || 0), 0) ?? 0;
	}
</script>

<svelte:head>
	<title>Community Decks | BOBA Scanner</title>
</svelte:head>

<div class="decks-page">
	<h1>Community Decks</h1>
	<p class="subtitle">Browse decks shared by the BoBA community</p>

	<!-- Filters -->
	<div class="filters">
		<select value={data.formatFilter} onchange={(e) => changeFormat((e.target as HTMLSelectElement).value)} class="filter-select">
			<option value="">All Formats</option>
			<option value="apex_playmaker">Apex Playmaker</option>
			<option value="spec_playmaker">SPEC Playmaker</option>
			<option value="spec_plus">SPEC+ Playmaker</option>
			<option value="elite_playmaker">Elite Playmaker</option>
			<option value="apex_madness">Apex Madness</option>
		</select>

		<div class="sort-btns">
			<button class:active={data.sortBy === 'newest'} onclick={() => changeSort('newest')}>Newest</button>
			<button class:active={data.sortBy === 'popular'} onclick={() => changeSort('popular')}>Popular</button>
		</div>
	</div>

	<!-- Deck list -->
	<div class="deck-grid">
		{#each data.decks as deck (deck.id)}
			<a href="/deck/view/{deck.id}" class="deck-card">
				<div class="deck-card-header">
					<span class="deck-name">{deck.name}</span>
					<span class="format-badge">{deck.format_id.replace(/_/g, ' ')}</span>
				</div>
				<div class="deck-card-stats">
					<span>{deck.hero_card_ids?.length ?? 0} Heroes</span>
					<span>{deck.play_entries?.length ?? 0} Plays</span>
					<span>DBS {calcDbs(deck.play_entries)}/1000</span>
				</div>
				<div class="deck-card-meta">
					<span>{deck.view_count || 0} views</span>
					<span>{new Date(deck.created_at).toLocaleDateString()}</span>
				</div>
			</a>
		{:else}
			<p class="empty-msg">No decks found. Be the first to share one!</p>
		{/each}
	</div>

	<!-- Pagination -->
	{#if data.total > 20}
		<div class="pagination">
			{#if data.pageNum > 1}
				<button onclick={() => changePage(data.pageNum - 1)}>Previous</button>
			{/if}
			<span class="page-info">Page {data.pageNum} of {Math.ceil(data.total / 20)}</span>
			{#if data.pageNum * 20 < data.total}
				<button onclick={() => changePage(data.pageNum + 1)}>Next</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.decks-page {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 0.25rem;
	}

	.subtitle {
		color: var(--text-secondary, #94a3b8);
		font-size: 0.9rem;
		margin-bottom: 1.5rem;
	}

	.filters {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.filter-select {
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #e2e8f0);
		font-size: 0.85rem;
	}

	.sort-btns {
		display: flex;
		gap: 0.25rem;
	}

	.sort-btns button {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border-color, #1e293b);
		background: transparent;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.sort-btns button.active {
		background: rgba(59, 130, 246, 0.1);
		border-color: var(--primary, #3b82f6);
		color: var(--primary, #3b82f6);
	}

	.deck-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.deck-card {
		display: block;
		padding: 0.875rem;
		border-radius: 10px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		text-decoration: none;
		color: inherit;
		transition: border-color 0.15s, transform 0.15s;
	}

	.deck-card:hover {
		border-color: var(--primary, #3b82f6);
		transform: translateY(-1px);
	}

	.deck-card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.deck-name {
		font-weight: 600;
		font-size: 1rem;
		color: var(--text-primary, #e2e8f0);
	}

	.format-badge {
		padding: 0.2rem 0.5rem;
		border-radius: 10px;
		background: rgba(59, 130, 246, 0.1);
		color: #60a5fa;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: capitalize;
	}

	.deck-card-stats {
		display: flex;
		gap: 0.75rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 0.375rem;
	}

	.deck-card-meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--text-muted, #475569);
	}

	.empty-msg {
		text-align: center;
		color: var(--text-secondary, #94a3b8);
		padding: 3rem;
		font-size: 0.9rem;
	}

	.pagination {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 1rem;
		margin-top: 1.5rem;
	}

	.pagination button {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: transparent;
		color: var(--text-primary, #e2e8f0);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.page-info {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
	}
</style>
