<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		loadCollection,
		dragonPointsTotal,
		dragonPointsEntries,
		collectionLoading,
	} from '$lib/stores/collection.svelte';
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';
	import ParallelBadge from '$lib/components/ParallelBadge.svelte';
	import { DRAGON_POINTS_CONFIG } from '$lib/games/wonders/dragon-points';
	import { loadDragonPointsConfig } from '$lib/games/wonders/dragon-points-config';
	import { FOIL_PARALLELS, PARALLEL_ABBREV, PARALLEL_COLOR, normalizeParallel, type ParallelCode } from '$lib/data/parallels';

	const multiGameEnabled = featureEnabled('multi_game_ui');

	onMount(async () => {
		// Load admin overrides before the collection so derived totals reflect them.
		await loadDragonPointsConfig();
		await loadCollection();
	});

	const total = $derived(dragonPointsTotal());
	const entries = $derived(dragonPointsEntries());
	const threshold = DRAGON_POINTS_CONFIG.dragonGoldThreshold;
	const progressPct = $derived(Math.min(100, (total / threshold) * 100));
	const remaining = $derived(Math.max(0, threshold - total));
	const hasQualified = $derived(total >= threshold);

	// Per-parallel breakdown (quantity-weighted points per foil parallel)
	const perParallelPoints = $derived.by<Record<ParallelCode, number>>(() => {
		const tally = { paper: 0, cf: 0, ff: 0, ocm: 0, sf: 0 } as Record<ParallelCode, number>;
		for (const e of entries) {
			const code = normalizeParallel(e.item.parallel);
			tally[code] = (tally[code] || 0) + e.totalForItem;
		}
		return tally;
	});
	const maxParallelPoints = $derived(
		Math.max(1, ...FOIL_PARALLELS.map((p) => perParallelPoints[p] || 0))
	);

	// Top-earning foils list (quantity-weighted)
	let showAll = $state(false);
	let searchQuery = $state('');
	const TOP_CAP = 20;
	const sortedEntries = $derived(
		[...entries]
			.filter((e) => e.totalForItem > 0)
			.sort((a, b) => b.totalForItem - a.totalForItem)
	);
	const filteredEntries = $derived(
		searchQuery.trim()
			? sortedEntries.filter((e) => {
					const q = searchQuery.toLowerCase();
					return (
						(e.item.card?.name || '').toLowerCase().includes(q) ||
						(e.item.card?.card_number || '').toLowerCase().includes(q)
					);
				})
			: sortedEntries
	);
	const visibleEntries = $derived(
		showAll ? filteredEntries : filteredEntries.slice(0, TOP_CAP)
	);

	// Animated progress ring
	let animatedPct = $state(0);
	$effect(() => {
		const target = progressPct;
		let frame: number;
		const start = performance.now();
		const duration = 1200;
		function step(now: number) {
			const t = Math.min(1, (now - start) / duration);
			// Ease-out cubic
			const eased = 1 - Math.pow(1 - t, 3);
			animatedPct = target * eased;
			if (t < 1) frame = requestAnimationFrame(step);
		}
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	});

	// SVG progress ring geometry
	const ringRadius = 72;
	const ringCircumference = 2 * Math.PI * ringRadius;
	const ringOffset = $derived(ringCircumference * (1 - animatedPct / 100));
</script>

<svelte:head>
	<title>Dragon Points | Card Scanner</title>
</svelte:head>

{#if !multiGameEnabled()}
	<div class="feature-gate">
		<h1>Dragon Points</h1>
		<p>Multi-game features aren't enabled on your account yet.</p>
		<button type="button" onclick={() => goto('/')}>Back to home</button>
	</div>
{:else}
	<div class="dp-page">
		<header class="dp-hero">
			<h1 class="dp-hero-title">
				<span class="dp-hero-icon" aria-hidden="true">🐉</span> Dragon Points
			</h1>
			<p class="dp-hero-sub">Your progress toward Dragon Gold ({threshold.toLocaleString()} points)</p>

			<div class="dp-ring-wrap">
				<svg class="dp-ring" viewBox="0 0 160 160" aria-hidden="true">
					<circle
						class="dp-ring-track"
						cx="80" cy="80" r={ringRadius}
						fill="none" stroke-width="12"
					/>
					<circle
						class="dp-ring-fill"
						cx="80" cy="80" r={ringRadius}
						fill="none" stroke-width="12"
						stroke-dasharray={ringCircumference}
						stroke-dashoffset={ringOffset}
						stroke-linecap="round"
						transform="rotate(-90 80 80)"
					/>
				</svg>
				<div class="dp-ring-label">
					<span class="dp-ring-number">{total.toLocaleString()}</span>
					<span class="dp-ring-sub">{progressPct.toFixed(1)}%</span>
				</div>
			</div>

			{#if collectionLoading()}
				<p class="dp-status dp-status-loading">Loading collection…</p>
			{:else if hasQualified}
				<p class="dp-status dp-status-qualified">You have qualified for Dragon Gold! Keep building your Dragon.</p>
			{:else}
				<p class="dp-status">You are {remaining.toLocaleString()} points away from Dragon Gold eligibility.</p>
			{/if}
		</header>

		<section class="dp-section">
			<h2 class="dp-section-title">By Parallel</h2>
			<div class="dp-parallel-bars">
				{#each FOIL_PARALLELS as code}
					{@const points = perParallelPoints[code] || 0}
					{@const barWidth = (points / maxParallelPoints) * 100}
					<div class="dp-parallel-row" data-parallel={code}>
						<span class="dp-parallel-abbrev" style={`color: ${PARALLEL_COLOR[code]}`}>
							{PARALLEL_ABBREV[code]}
						</span>
						<div class="dp-parallel-bar-track">
							<div
								class="dp-parallel-bar-fill"
								style={`width: ${barWidth}%; background: ${PARALLEL_COLOR[code]}`}
							></div>
						</div>
						<span class="dp-parallel-points">{points.toLocaleString()}</span>
					</div>
				{/each}
			</div>
		</section>

		<section class="dp-section">
			<div class="dp-list-header">
				<h2 class="dp-section-title">Top Earning Foils</h2>
				<input
					type="search"
					class="dp-search"
					placeholder="Filter by name or number…"
					bind:value={searchQuery}
					aria-label="Filter top earning foils"
				/>
			</div>

			{#if visibleEntries.length === 0}
				<p class="dp-empty">
					{#if entries.length === 0}
						No Wonders cards in your collection yet. Scan a foil card to start earning Dragon Points.
					{:else if searchQuery.trim()}
						No matches for "{searchQuery}".
					{:else}
						No foil cards yet — only Paper Wonders cards in your collection, which earn no Dragon Points.
					{/if}
				</p>
			{:else}
				<ol class="dp-entries">
					{#each visibleEntries as e}
						<li class="dp-entry" data-card-id={e.item.card?.id}>
							<a href={`/collection?focus=${e.item.card?.id}`} class="dp-entry-link">
								<span class="dp-entry-name">{e.item.card?.name || 'Unknown'}</span>
								<ParallelBadge parallel={e.item.parallel} size="sm" />
								<span class="dp-entry-rarity">{e.item.card?.rarity || ''}</span>
								<span class="dp-entry-points">{e.totalForItem.toLocaleString()}</span>
							</a>
						</li>
					{/each}
				</ol>
				{#if !showAll && filteredEntries.length > TOP_CAP}
					<button
						type="button"
						class="dp-show-all"
						onclick={() => (showAll = true)}
					>
						Show all {filteredEntries.length} cards
					</button>
				{/if}
			{/if}
		</section>
	</div>
{/if}

<style>
	.feature-gate {
		max-width: 420px;
		margin: 3rem auto;
		padding: 2rem;
		text-align: center;
	}
	.feature-gate h1 {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1.5rem;
		margin-bottom: 0.5rem;
	}
	.feature-gate p { color: var(--text-secondary, #94a3b8); margin-bottom: 1.5rem; }
	.feature-gate button {
		padding: 0.6rem 1.2rem;
		border: none;
		border-radius: 8px;
		background: var(--gold, #f59e0b);
		color: #0d1524;
		font-weight: 700;
		cursor: pointer;
	}

	.dp-page {
		max-width: 680px;
		margin: 0 auto;
		padding: 1rem 1rem 3rem;
	}

	/* ── Hero ──────────────────────────────────────── */
	.dp-hero {
		text-align: center;
		padding: 1.5rem 0 1rem;
	}
	.dp-hero-title {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1.75rem;
		font-weight: 800;
		margin: 0 0 0.25rem;
	}
	.dp-hero-icon { margin-right: 6px; }
	.dp-hero-sub {
		color: var(--text-secondary, #94a3b8);
		font-size: 0.9rem;
		margin: 0 0 1.5rem;
	}

	.dp-ring-wrap {
		position: relative;
		width: 160px;
		height: 160px;
		margin: 0 auto 1rem;
	}
	.dp-ring { width: 100%; height: 100%; display: block; }
	.dp-ring-track { stroke: rgba(212, 175, 55, 0.15); }
	.dp-ring-fill {
		stroke: #D4AF37;
		transition: stroke-dashoffset 0s;
		filter: drop-shadow(0 0 6px rgba(212, 175, 55, 0.3));
	}
	.dp-ring-label {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
	}
	.dp-ring-number {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1.7rem;
		font-weight: 800;
		color: #D4AF37;
	}
	.dp-ring-sub {
		font-size: 0.75rem;
		color: var(--text-secondary, #94a3b8);
	}

	.dp-status {
		margin: 0.5rem auto 0;
		max-width: 420px;
		font-size: 0.9rem;
		color: var(--text-primary, #e2e8f0);
	}
	.dp-status-loading { color: var(--text-muted, #475569); }
	.dp-status-qualified {
		color: #D4AF37;
		font-weight: 700;
	}

	/* ── Section ───────────────────────────────────── */
	.dp-section { margin-top: 1.75rem; }
	.dp-section-title {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1rem;
		font-weight: 700;
		margin: 0 0 0.75rem;
	}

	/* ── Variant bars ─────────────────────────────── */
	.dp-parallel-bars { display: flex; flex-direction: column; gap: 8px; }
	.dp-parallel-row {
		display: grid;
		grid-template-columns: 46px 1fr auto;
		align-items: center;
		gap: 8px;
	}
	.dp-parallel-abbrev {
		font-weight: 800;
		font-size: 0.85rem;
		text-align: center;
	}
	.dp-parallel-bar-track {
		height: 14px;
		border-radius: 7px;
		background: var(--bg-elevated, #121d34);
		overflow: hidden;
	}
	.dp-parallel-bar-fill {
		height: 100%;
		border-radius: 7px;
		transition: width 0.6s ease-out;
		min-width: 2px;
	}
	.dp-parallel-points {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-primary, #e2e8f0);
		text-align: right;
		min-width: 50px;
	}

	/* ── Top entries list ─────────────────────────── */
	.dp-list-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 0.75rem;
	}
	.dp-search {
		flex: 0 0 auto;
		max-width: 240px;
		padding: 6px 10px;
		border-radius: 6px;
		border: 1px solid var(--border, rgba(148,163,184,0.2));
		background: var(--bg-input, #0a1020);
		color: var(--text-primary, #e2e8f0);
		font-size: 0.8rem;
	}
	.dp-empty {
		padding: 1rem;
		text-align: center;
		color: var(--text-secondary, #94a3b8);
		border: 1px dashed var(--border, rgba(148,163,184,0.2));
		border-radius: 10px;
		font-size: 0.85rem;
	}

	.dp-entries {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.dp-entry-link {
		display: grid;
		grid-template-columns: 1fr auto auto auto;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border, rgba(148,163,184,0.1));
		color: var(--text-primary, #e2e8f0);
		text-decoration: none;
		font-size: 0.85rem;
	}
	.dp-entry-link:hover {
		border-color: rgba(212, 175, 55, 0.3);
	}
	.dp-entry-name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dp-entry-rarity {
		font-size: 0.7rem;
		color: var(--text-secondary, #94a3b8);
		text-transform: capitalize;
	}
	.dp-entry-points {
		font-weight: 800;
		color: #D4AF37;
		font-size: 0.85rem;
		min-width: 50px;
		text-align: right;
	}

	.dp-show-all {
		margin-top: 0.75rem;
		width: 100%;
		padding: 0.6rem;
		border: 1px dashed var(--border-strong, rgba(148,163,184,0.3));
		border-radius: 8px;
		background: transparent;
		color: var(--text-secondary, #94a3b8);
		font-size: 0.85rem;
		cursor: pointer;
	}
	.dp-show-all:hover {
		background: var(--bg-elevated, #121d34);
		color: var(--text-primary, #e2e8f0);
	}
</style>
