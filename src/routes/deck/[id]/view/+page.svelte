<script lang="ts">
	let { data } = $props();

	const heroCount = $derived(data.deck.hero_card_ids?.length ?? 0);
	const playCount = $derived(data.deck.play_entries?.length ?? 0);
	const totalDbs = $derived(
		data.deck.play_entries?.reduce((sum, p) => sum + (p.dbs || 0), 0) ?? 0
	);

	let copied = $state(false);

	function copyShareUrl() {
		navigator.clipboard.writeText(window.location.href).then(
			() => {
				copied = true;
				setTimeout(() => { copied = false; }, 2000);
			},
			() => { /* clipboard unavailable */ }
		);
	}
</script>

<svelte:head>
	<title>{data.deck.name} | BOBA Scanner</title>
	<meta property="og:title" content="{data.deck.name} — {data.deck.format_id} Deck" />
	<meta property="og:description" content="{heroCount} Heroes • DBS {totalDbs}/1000 • {playCount} Plays" />
	<meta property="og:url" content="https://boba.cards/deck/{data.deck.id}/view" />
</svelte:head>

<div class="deck-view">
	<div class="deck-view-header">
		<h1>{data.deck.name}</h1>
		<span class="format-badge">{data.deck.format_id}</span>
	</div>

	<div class="deck-view-stats">
		<div class="stat">{heroCount} Heroes</div>
		<div class="stat">{playCount} Plays</div>
		<div class="stat">DBS {totalDbs}/1,000</div>
	</div>

	{#if data.deck.hero_card_ids?.length}
		<h2>Hero Cards</h2>
		<div class="card-id-list">
			{#each data.deck.hero_card_ids as cardId}
				<span class="card-id-chip">{cardId}</span>
			{/each}
		</div>
	{/if}

	{#if data.deck.play_entries?.length}
		<h2>Playbook</h2>
		<div class="play-list">
			{#each data.deck.play_entries as play}
				<div class="play-item">
					<span class="play-name">{play.name || play.cardNumber}</span>
					<span class="play-dbs">{play.dbs || '?'}</span>
				</div>
			{/each}
		</div>
	{/if}

	<button class="share-btn" onclick={copyShareUrl}>
		{copied ? 'Copied!' : 'Copy Share URL'}
	</button>
</div>

<style>
	.deck-view {
		max-width: 700px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.deck-view-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.deck-view-header h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary, #f1f5f9);
	}

	.format-badge {
		padding: 0.25rem 0.625rem;
		border-radius: 12px;
		background: rgba(59, 130, 246, 0.15);
		color: #60a5fa;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.deck-view-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.stat {
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		color: var(--text-secondary, #94a3b8);
		font-size: 0.85rem;
	}

	h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-secondary, #94a3b8);
		margin: 1rem 0 0.5rem;
	}

	.card-id-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.card-id-chip {
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		font-size: 0.75rem;
		color: var(--text-secondary, #94a3b8);
		font-family: monospace;
	}

	.play-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.play-item {
		display: flex;
		justify-content: space-between;
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		font-size: 0.85rem;
	}

	.play-name { color: var(--text-primary, #f1f5f9); }
	.play-dbs { color: var(--accent-gold, #f59e0b); font-weight: 600; }

	.share-btn {
		display: block;
		margin: 1.5rem auto 0;
		padding: 0.625rem 1.5rem;
		border-radius: 8px;
		border: 1px solid var(--accent-primary, #3b82f6);
		background: rgba(59, 130, 246, 0.1);
		color: var(--accent-primary, #3b82f6);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}

	.share-btn:hover { background: rgba(59, 130, 246, 0.2); }
</style>
