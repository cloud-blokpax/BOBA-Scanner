<script lang="ts">
	import { onMount } from 'svelte';
	import { user } from '$lib/stores/auth.svelte';
	import { myTopImageCount, myRank, loadMyReferenceStats } from '$lib/services/reference-images';

	interface LeaderboardEntry {
		user_id: string;
		name: string;
		top_images: number;
		avg_confidence: number;
		rank: number;
	}

	let leaderboard = $state<LeaderboardEntry[]>([]);
	let stats = $state<{ total_reference_images: number; total_contributors: number; coverage_percent: string } | null>(null);
	let loading = $state(true);

	const currentUserId = $derived(user()?.id ?? null);

	onMount(async () => {
		try {
			const url = currentUserId
				? `/api/reference-image/leaderboard?user_id=${currentUserId}`
				: '/api/reference-image/leaderboard';
			const res = await fetch(url);
			if (res.ok) {
				const data = await res.json();
				leaderboard = data.leaderboard || [];
				stats = data.stats || null;
			}

			if (currentUserId) {
				await loadMyReferenceStats(currentUserId);
			}
		} catch (err) {
			console.debug('[leaderboard] Load failed:', err);
		}
		loading = false;
	});
</script>

<svelte:head>
	<title>Leaderboard — BOBA Scanner</title>
	<meta name="description" content="Top card photographers in the BOBA Scanner community. Compete to capture the best reference image for every card." />
</svelte:head>

<div class="leaderboard-page">
	<header class="lb-header">
		<h1>Reference Image Leaderboard</h1>
		<p class="lb-subtitle">Scan cards to capture the best reference image. Beat the current champion to claim the top spot.</p>
	</header>

	{#if stats}
		<div class="stats-bar">
			<div class="stat">
				<span class="stat-value">{stats.total_reference_images.toLocaleString()}</span>
				<span class="stat-label">Reference Images</span>
			</div>
			<div class="stat">
				<span class="stat-value">{stats.coverage_percent}%</span>
				<span class="stat-label">Database Coverage</span>
			</div>
			<div class="stat">
				<span class="stat-value">{stats.total_contributors}</span>
				<span class="stat-label">Contributors</span>
			</div>
		</div>
	{/if}

	{#if currentUserId && $myTopImageCount !== null}
		<div class="my-stats-card">
			<div class="my-rank">
				{#if $myRank}
					<span class="rank-number">#{$myRank}</span>
				{:else}
					<span class="rank-number">—</span>
				{/if}
			</div>
			<div class="my-details">
				<div class="my-label">Your Top Images</div>
				<div class="my-value">{$myTopImageCount}</div>
			</div>
			{#if $myTopImageCount === 0}
				<div class="my-hint">Scan cards with high quality to earn your first reference image!</div>
			{/if}
		</div>
	{/if}

	{#if loading}
		<div class="loading">Loading leaderboard...</div>
	{:else if leaderboard.length === 0}
		<div class="empty-state">
			<p>No reference images yet. Be the first to contribute!</p>
			<a href="/scan" class="btn-scan">Start Scanning</a>
		</div>
	{:else}
		<p class="lb-description">
			Reference images improve scan accuracy for everyone.
			When you scan a card and the AI identifies it correctly, your scan is automatically
			submitted as a reference image if it's better than the current one.
		</p>
		<div class="lb-table">
			{#each leaderboard as entry, i}
				<div
					class="lb-row"
					class:highlight={entry.user_id === currentUserId}
					class:gold={i === 0}
					class:silver={i === 1}
					class:bronze={i === 2}
				>
					<div class="lb-rank">
						{#if i === 0}🥇
						{:else if i === 1}🥈
						{:else if i === 2}🥉
						{:else}#{entry.rank}
						{/if}
					</div>
					<div class="lb-name">
						{entry.name}
						{#if entry.user_id === currentUserId}
							<span class="you-badge">You</span>
						{/if}
					</div>
					<div class="lb-images">{entry.top_images}</div>
					<div class="lb-conf">{(entry.avg_confidence * 100).toFixed(0)}%</div>
				</div>
			{/each}
		</div>

		<div class="lb-legend">
			<span>Top Images</span>
			<span>Avg Confidence</span>
		</div>
	{/if}
</div>

<style>
	.leaderboard-page {
		max-width: 600px;
		margin: 0 auto;
		padding: 1rem;
	}
	.lb-header { text-align: center; margin-bottom: 1.5rem; }
	.lb-header h1 { font-size: 1.3rem; font-weight: 700; margin-bottom: 0.5rem; }
	.lb-subtitle { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4; }

	.stats-bar {
		display: flex; gap: 1rem; justify-content: center;
		margin-bottom: 1.5rem;
	}
	.stat { text-align: center; }
	.stat-value { display: block; font-size: 1.3rem; font-weight: 700; color: var(--accent-gold, #f59e0b); }
	.stat-label { font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }

	.my-stats-card {
		background: var(--bg-elevated);
		border: 1px solid var(--accent-gold, #f59e0b);
		border-radius: 12px;
		padding: 1rem;
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	.my-rank { min-width: 50px; text-align: center; }
	.rank-number { font-size: 1.5rem; font-weight: 800; color: var(--accent-gold); }
	.my-label { font-size: 0.75rem; color: var(--text-secondary); }
	.my-value { font-size: 1.2rem; font-weight: 700; }
	.my-hint { font-size: 0.8rem; color: var(--text-secondary); flex: 1; }

	.lb-table { display: flex; flex-direction: column; gap: 2px; }
	.lb-row {
		display: grid;
		grid-template-columns: 50px 1fr 60px 60px;
		align-items: center;
		padding: 0.75rem 0.5rem;
		border-radius: 8px;
		background: var(--bg-elevated);
		font-size: 0.9rem;
	}
	.lb-row.gold { background: rgba(245, 158, 11, 0.1); }
	.lb-row.silver { background: rgba(148, 163, 184, 0.1); }
	.lb-row.bronze { background: rgba(180, 83, 9, 0.1); }
	.lb-row.highlight { border: 1px solid var(--accent-gold); }
	.lb-rank { font-weight: 700; text-align: center; font-size: 1rem; }
	.lb-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.lb-images { text-align: right; font-weight: 700; color: var(--accent-gold); }
	.lb-conf { text-align: right; font-size: 0.8rem; color: var(--text-secondary); }
	.you-badge {
		display: inline-block; padding: 1px 6px; border-radius: 4px;
		font-size: 0.65rem; font-weight: 700;
		background: var(--accent-gold); color: #000;
		margin-left: 6px; vertical-align: middle;
	}
	.lb-legend {
		display: flex; justify-content: flex-end; gap: 3rem;
		padding: 0.5rem 0.5rem 0; font-size: 0.7rem;
		color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em;
	}

	.lb-description {
		font-size: 0.85rem;
		color: var(--text-secondary);
		line-height: 1.5;
		margin-bottom: 1.25rem;
		text-align: center;
	}
	.empty-state { text-align: center; padding: 3rem 1rem; color: var(--text-secondary); }
	.btn-scan {
		display: inline-block; margin-top: 1rem; padding: 0.75rem 2rem;
		border-radius: 10px; background: var(--accent-primary); color: white;
		font-weight: 600; text-decoration: none;
	}
	.loading { text-align: center; padding: 3rem; color: var(--text-secondary); }
</style>
