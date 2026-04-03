<script lang="ts">
	import { onMount } from 'svelte';
	import ScatterPlot from '$lib/components/war-room/ScatterPlot.svelte';
	import WIcon from '$lib/components/war-room/WIcon.svelte';
	import AnimatedNum from '$lib/components/war-room/AnimatedNum.svelte';
	import type { HeroCard, PlayCard } from '$lib/components/war-room/war-room-data';
	import { PARALLEL_COLORS, RARITY_COLORS } from '$lib/components/war-room/war-room-data';

	// ── State ────────────────────────────────────────────
	let pFilter = $state<string | null>(null);
	let wFilter = $state<string | null>(null);
	let sortBy = $state<'ppp' | 'price' | 'power' | 'listings'>('ppp');
	let hoverDot = $state<string | null>(null);
	let loaded = $state(false);
	let showPlays = $state(false);
	let playSort = $state<'dpd' | 'price' | 'dbs'>('dpd');

	// Live data from API (replaces hardcoded HEROES/PLAYS)
	let HEROES = $state<HeroCard[]>([]);
	let PLAYS = $state<PlayCard[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	onMount(async () => {
		try {
			const res = await fetch('/api/market/war-room');
			if (!res.ok) throw new Error(`${res.status}`);
			const data = await res.json();
			HEROES = data.heroes;
			PLAYS = data.plays;
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load';
			console.error('[war-room] Load failed:', err);
		} finally {
			loading = false;
			setTimeout(() => (loaded = true), 60);
		}
	});

	// ── Parallel pricing stats (replaces ring chart data) ─────
	const parallelStats = $derived.by(() => {
		const src = wFilter ? HEROES.filter(h => h.w === wFilter) : HEROES;
		const g: Record<string, { n: number; pr: number[]; pw: number[]; ls: number }> = {};
		src.forEach(h => {
			if (!g[h.p]) g[h.p] = { n: 0, pr: [], pw: [], ls: 0 };
			g[h.p].n++;
			g[h.p].pr.push(h.mid);
			g[h.p].pw.push(h.pwr);
			g[h.p].ls += h.ls;
		});
		return Object.entries(g)
			.map(([p, x]) => ({
				parallel: p,
				count: x.n,
				avg: +(x.pr.reduce((a, b) => a + b, 0) / x.n).toFixed(2),
				avgPwr: Math.round(x.pw.reduce((a, b) => a + b, 0) / x.n),
				listings: x.ls,
				min: Math.min(...x.pr),
				max: Math.max(...x.pr),
			}))
			.sort((a, b) => a.avg - b.avg);
	});

	// ── Filtered heroes ─────────────────────────────────
	const filtered = $derived.by(() => {
		let l = [...HEROES];
		if (pFilter) l = l.filter((h) => h.p === pFilter);
		if (wFilter) l = l.filter((h) => h.w === wFilter);
		if (sortBy === 'ppp') l.sort((a, b) => a.ppp - b.ppp);
		else if (sortBy === 'price') l.sort((a, b) => a.mid - b.mid);
		else if (sortBy === 'power') l.sort((a, b) => b.pwr - a.pwr);
		else if (sortBy === 'listings') l.sort((a, b) => b.ls - a.ls);
		return l;
	});

	// ── Weapon stats ────────────────────────────────────
	const weaponStats = $derived.by(() => {
		const src = pFilter ? HEROES.filter((h) => h.p === pFilter) : HEROES;
		const g: Record<string, { n: number; pr: number[]; pw: number[] }> = {};
		src.forEach((h) => {
			if (!g[h.w]) g[h.w] = { n: 0, pr: [], pw: [] };
			g[h.w].n++;
			g[h.w].pr.push(h.mid);
			g[h.w].pw.push(h.pwr);
		});
		return Object.entries(g)
			.map(([w, x]) => ({
				weapon: w,
				count: x.n,
				avg: +(x.pr.reduce((a, b) => a + b, 0) / x.n).toFixed(2),
				avgPwr: Math.round(x.pw.reduce((a, b) => a + b, 0) / x.n),
			}))
			.sort((a, b) => a.avg - b.avg);
	});

	// ── Aggregate stats ─────────────────────────────────
	const agg = $derived.by(() => {
		const t = filtered.length;
		if (!t) return null;
		return {
			count: t,
			listings: filtered.reduce((s, h) => s + h.ls, 0),
			avg: +(filtered.reduce((s, h) => s + h.mid, 0) / t).toFixed(2),
			avgPwr: Math.round(filtered.reduce((s, h) => s + h.pwr, 0) / t),
		};
	});

	// ── Sorted plays ────────────────────────────────────
	const sortedPlays = $derived.by(() => {
		const l = [...PLAYS];
		if (playSort === 'dpd') l.sort((a, b) => (a.dpd ?? 999) - (b.dpd ?? 999));
		else if (playSort === 'price') l.sort((a, b) => a.mid - b.mid);
		else if (playSort === 'dbs') l.sort((a, b) => b.dbs - a.dbs);
		return l;
	});

	// ── Helpers ─────────────────────────────────────────
	function liq(ls: number): { label: string; color: string } {
		if (ls >= 10) return { label: 'Available', color: '#22c55e' };
		if (ls >= 3) return { label: 'Limited', color: '#f59e0b' };
		if (ls >= 1) return { label: 'Scarce', color: '#ef4444' };
		return { label: 'None', color: '#4a6178' };
	}

	function fmtPrice(v: number): string {
		return v < 10 ? v.toFixed(2) : v.toFixed(0);
	}

	const SORT_OPTIONS: { id: typeof sortBy; l: string }[] = [
		{ id: 'ppp', l: 'Best $/pwr' },
		{ id: 'price', l: 'Cheapest' },
		{ id: 'power', l: 'Strongest' },
		{ id: 'listings', l: 'Most listed' },
	];

	const PLAY_SORT_OPTIONS: { id: typeof playSort; l: string }[] = [
		{ id: 'dpd', l: 'Best $/DBS' },
		{ id: 'price', l: 'Cheapest' },
		{ id: 'dbs', l: 'Highest DBS' },
	];
</script>

<svelte:head>
	<title>War Room | BoBA Scanner</title>
</svelte:head>

<div class="war-room">
	{#if loading}
		<div class="loading-state">
			<div class="spinner"></div>
			<p>Loading market data...</p>
		</div>
	{:else if loadError}
		<div class="empty-state">
			<p>Failed to load market data</p>
			<p class="empty-hint">{loadError}</p>
		</div>
	{:else if HEROES.length === 0}
		<div class="empty-state">
			<p>No pricing data available yet</p>
			<p class="empty-hint">The eBay harvester needs to run before market data appears here.</p>
		</div>
	{:else}
		<!-- HERO SECTION -->
		<div class="hero-section" class:loaded>
			<div class="hero-badge">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5">
					<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
				</svg>
				<span class="badge-text">War Room</span>
			</div>
			<h1 class="hero-title">Card economy<br />intelligence</h1>
			<p class="hero-desc">
				Every parallel, weapon, and power level — cross-referenced with live eBay pricing.
				Find the cheapest path to a winning deck.
			</p>
		</div>

		<!-- AGGREGATE STATS -->
		{#if agg}
			<section class="section" class:loaded style="transition-delay: 0.13s">
				<div class="stat-grid">
					{#each [
						{ l: 'Cards', v: agg.count, c: '#e2e8f0' },
						{ l: 'Listed', v: agg.listings, c: '#22c55e' },
						{ l: 'Avg Price', v: agg.avg, c: '#f59e0b', pre: '$' },
						{ l: 'Avg Power', v: agg.avgPwr, c: '#3b82f6' },
					] as s}
						<div class="stat-cell">
							<div class="stat-value" style="color: {s.c}">
								<AnimatedNum value={s.v} pre={s.pre ?? ''} decimals={s.pre ? 2 : 0} />
							</div>
							<div class="stat-label">{s.l}</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- PRICE BY PARALLEL (replaces ring chart) -->
		<section class="section" class:loaded style="transition-delay: 0.21s">
			<div class="section-label">Price by parallel{wFilter ? ` \u00b7 ${wFilter}` : ''}</div>
			<div class="parallel-grid">
				{#each parallelStats as ps}
					<button
						class="parallel-card"
						class:active={pFilter === ps.parallel}
						onclick={() => (pFilter = pFilter === ps.parallel ? null : ps.parallel)}
					>
						<div class="parallel-name">{ps.parallel}</div>
						<div class="parallel-price">${fmtPrice(ps.avg)}</div>
						<div class="parallel-meta">{ps.count} cards · {ps.avgPwr}p</div>
					</button>
				{/each}
			</div>
		</section>

		<!-- PRICE BY WEAPON -->
		<section class="section" class:loaded style="transition-delay: 0.29s">
			<div class="section-label">Price by weapon{pFilter ? ` \u00b7 ${pFilter}` : ''}</div>
			<div class="weapon-grid">
				{#each weaponStats as ws}
					<button
						class="weapon-card"
						class:active={wFilter === ws.weapon}
						onclick={() => (wFilter = wFilter === ws.weapon ? null : ws.weapon)}
					>
						<WIcon type={ws.weapon} size={18} color={wFilter === ws.weapon ? '#f59e0b' : '#6b7d8e'} />
						<div class="weapon-name">{ws.weapon}</div>
						<div class="weapon-price">${fmtPrice(ws.avg)}</div>
						<div class="weapon-meta">{ws.count} cards · {ws.avgPwr}p</div>
					</button>
				{/each}
			</div>
		</section>

		<!-- SCATTER: PRICE vs POWER -->
		<section class="section card-panel" class:loaded style="transition-delay: 0.37s">
			<div class="scatter-header">
				<div class="section-label">Price vs power</div>
				<div class="scatter-hint">Hover for details · {pFilter || 'All parallels'}</div>
			</div>
			<ScatterPlot data={filtered} width={340} height={190} onhover={(n) => (hoverDot = n)} hovered={hoverDot} />
			<div class="scatter-footer">Bottom-left = best value (low price, high power)</div>
		</section>

		<!-- HERO RESULTS -->
		<section class="section" class:loaded style="transition-delay: 0.45s">
			<div class="results-header">
				<div class="section-label">
					Heroes{pFilter ? ` \u00b7 ${pFilter}` : ''}{wFilter ? ` \u00b7 ${wFilter}` : ''}
				</div>
				{#if pFilter || wFilter}
					<button class="clear-btn" onclick={() => { pFilter = null; wFilter = null; }}>Clear</button>
				{/if}
			</div>
			<div class="sort-row">
				{#each SORT_OPTIONS as o}
					<button class="sort-btn" class:active={sortBy === o.id} onclick={() => (sortBy = o.id)}>
						{o.l}
					</button>
				{/each}
			</div>
			<div class="card-list">
				{#each filtered.slice(0, 20) as h, i}
					{@const l = liq(h.ls)}
					<div class="card-row" class:even={i % 2 === 0}>
						<div class="card-icon-col">
							<WIcon type={h.w} size={16} color="#6b7d8e" />
							<span class="card-pwr">{h.pwr}</span>
						</div>
						<div class="card-info">
							<div class="card-hero">{h.hero}</div>
							<div class="card-meta">
								<span class="card-parallel">{h.p}</span>
								<span class="liq-badge" style="color: {l.color}; background: {l.color}12">{l.label}</span>
								<span>{h.ls} listed</span>
							</div>
						</div>
						<div class="card-price-col">
							<div class="card-price">${fmtPrice(h.mid)}</div>
							<div class="card-ppp">${h.ppp}/pwr</div>
						</div>
					</div>
				{/each}
			</div>
		</section>

		<!-- PLAYS -->
		<section class="section" class:loaded style="transition-delay: 0.53s">
			<button class="plays-toggle" onclick={() => (showPlays = !showPlays)}>
				<div class="plays-toggle-left">
					<div class="plays-icon">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2">
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
							<polyline points="14 2 14 8 20 8" />
						</svg>
					</div>
					<div class="plays-toggle-text">
						<div class="plays-toggle-title">Play card market</div>
						<div class="plays-toggle-desc">{PLAYS.length} plays · DBS efficiency · rarity pricing</div>
					</div>
				</div>
				<svg
					width="16" height="16" viewBox="0 0 24 24"
					fill="none" stroke="#6b7d8e" stroke-width="2"
					class="chevron" class:open={showPlays}
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>

			{#if showPlays}
				<div class="plays-content">
					<div class="sort-row">
						{#each PLAY_SORT_OPTIONS as o}
							<button
								class="sort-btn blue"
								class:active={playSort === o.id}
								onclick={() => (playSort = o.id)}
							>
								{o.l}
							</button>
						{/each}
					</div>
					<div class="card-list">
						{#each sortedPlays as p, i}
							<div class="card-row" class:even={i % 2 === 0}>
								<div class="play-dbs-col">
									<div class="play-dbs-val">{p.dbs}</div>
									<div class="play-dbs-label">DBS</div>
								</div>
								<div class="card-info">
									<div class="card-hero">{p.name}</div>
									<div class="card-meta">
										<span class="rarity-badge" style="color: {RARITY_COLORS[p.r] || '#6b7d8e'}">{p.r}</span>
										<span>{p.num}</span>
										<span>{p.hd > 0 ? `${p.hd} HD` : 'Free'}</span>
										<span>{p.ls} listed</span>
									</div>
								</div>
								<div class="card-price-col">
									<div class="card-price">${fmtPrice(p.mid)}</div>
									{#if p.dpd !== null}
										<div class="card-dpd">${p.dpd}/dbs</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.war-room {
		font-family: 'DM Sans', -apple-system, sans-serif;
		background: #060d19;
		color: #e2e8f0;
		min-height: 100vh;
		max-width: 480px;
		margin: 0 auto;
		padding-bottom: 60px;
	}

	/* ── Entrance animation ── */
	.hero-section,
	.section {
		opacity: 0;
		transform: translateY(20px);
		transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.hero-section.loaded,
	.section.loaded {
		opacity: 1;
		transform: translateY(0);
	}

	/* ── Hero section ── */
	.hero-section {
		padding: 28px 20px 0;
		background: linear-gradient(180deg, #0e1a2e, #060d19);
		transition-delay: 0.08s;
	}
	.hero-badge {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 6px;
	}
	.badge-text {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.18em;
		color: #f59e0b;
		text-transform: uppercase;
	}
	.hero-title {
		font-size: 24px;
		font-weight: 900;
		color: #fff;
		line-height: 1.15;
		margin-bottom: 6px;
	}
	.hero-desc {
		font-size: 11px;
		color: #4a6178;
		line-height: 1.6;
		margin-bottom: 20px;
	}

	/* ── Sections ── */
	.section {
		padding: 0 20px 16px;
	}
	.card-panel {
		background: rgba(255, 255, 255, 0.02);
		border-radius: 16px;
		padding: 20px 16px;
		border: 1px solid rgba(255, 255, 255, 0.05);
		margin: 0 20px 16px;
	}
	.section-label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #6b7d8e;
		text-transform: uppercase;
		margin-bottom: 8px;
	}

	/* ── Stats grid ── */
	.stat-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
	}
	.stat-cell {
		text-align: center;
		padding: 8px 4px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.04);
	}
	.stat-value {
		font-size: 15px;
		font-weight: 800;
		font-family: 'JetBrains Mono', monospace;
	}
	.stat-label {
		font-size: 8px;
		color: #4a6178;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		margin-top: 1px;
	}

	/* ── Parallel Grid (matches weapon grid) ────────── */
	.parallel-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
		margin-top: 4px;
	}
	.parallel-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 10px 6px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
		color: #e2e8f0;
	}
	.parallel-card:hover {
		border-color: rgba(255, 255, 255, 0.1);
	}
	.parallel-card.active {
		border-color: rgba(245, 158, 11, 0.25);
		background: rgba(245, 158, 11, 0.06);
	}
	.parallel-name {
		font-size: 10px;
		font-weight: 600;
		color: #6b7d8e;
		text-align: center;
		line-height: 1.2;
	}
	.parallel-price {
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: 800;
		color: #f59e0b;
	}
	.parallel-meta {
		font-size: 9px;
		color: #4a6178;
	}

	@media (max-width: 380px) {
		.parallel-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	/* ── Scatter ── */
	.scatter-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
		padding: 0 4px;
	}
	.scatter-hint {
		font-size: 9px;
		color: #4a6178;
	}
	.scatter-footer {
		text-align: center;
		font-size: 9px;
		color: #4a6178;
		margin-top: 4px;
	}

	/* ── Weapon grid ── */
	.weapon-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
		gap: 6px;
	}
	.weapon-card {
		padding: 10px 6px;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.04);
		cursor: pointer;
		text-align: center;
		font-family: inherit;
		color: #e2e8f0;
		transition: all 0.2s;
	}
	.weapon-card.active {
		background: rgba(245, 158, 11, 0.06);
		border-color: rgba(245, 158, 11, 0.25);
	}
	.weapon-name {
		font-size: 11px;
		font-weight: 700;
		margin-top: 4px;
	}
	.weapon-price {
		font-size: 14px;
		font-weight: 800;
		font-family: 'JetBrains Mono', monospace;
		color: #f59e0b;
		margin-top: 2px;
	}
	.weapon-meta {
		font-size: 9px;
		color: #4a6178;
	}

	/* ── Results header ── */
	.results-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}
	.clear-btn {
		font-size: 9px;
		color: #ef4444;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: 6px;
		padding: 2px 8px;
		cursor: pointer;
		font-family: inherit;
		font-weight: 600;
	}

	/* ── Sort row ── */
	.sort-row {
		display: flex;
		gap: 4px;
		margin-bottom: 8px;
	}
	.sort-btn {
		padding: 4px 8px;
		border-radius: 8px;
		font-size: 9px;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid rgba(255, 255, 255, 0.05);
		background: transparent;
		color: #4a6178;
		font-family: inherit;
		transition: all 0.15s;
	}
	.sort-btn.active {
		border-color: rgba(245, 158, 11, 0.25);
		background: rgba(245, 158, 11, 0.06);
		color: #f59e0b;
	}
	.sort-btn.blue.active {
		border-color: rgba(59, 130, 246, 0.25);
		background: rgba(59, 130, 246, 0.06);
		color: #3b82f6;
	}

	/* ── Card list ── */
	.card-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.card-row {
		display: flex;
		align-items: center;
		padding: 8px 10px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.03);
		gap: 8px;
		transition: background 0.15s;
	}
	.card-row.even {
		background: rgba(255, 255, 255, 0.015);
	}
	.card-icon-col {
		width: 28px;
		display: flex;
		flex-direction: column;
		align-items: center;
		flex-shrink: 0;
	}
	.card-pwr {
		font-size: 8px;
		color: #4a6178;
		margin-top: 1px;
	}
	.card-info {
		flex: 1;
		min-width: 0;
	}
	.card-hero {
		font-size: 12px;
		font-weight: 700;
		color: #fff;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.card-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 9px;
		color: #4a6178;
		margin-top: 1px;
	}
	.card-parallel {
		color: #6b7d8e;
		font-weight: 500;
	}
	.liq-badge {
		font-weight: 700;
		font-size: 8px;
		padding: 0 4px;
		border-radius: 3px;
	}
	.rarity-badge {
		font-weight: 700;
	}
	.card-price-col {
		text-align: right;
		flex-shrink: 0;
	}
	.card-price {
		font-size: 15px;
		font-weight: 800;
		font-family: 'JetBrains Mono', monospace;
		color: #fff;
	}
	.card-ppp {
		font-size: 9px;
		font-weight: 700;
		font-family: 'JetBrains Mono', monospace;
		color: #22c55e;
	}
	.card-dpd {
		font-size: 9px;
		font-weight: 700;
		font-family: 'JetBrains Mono', monospace;
		color: #3b82f6;
	}

	/* ── Play DBS column ── */
	.play-dbs-col {
		width: 32px;
		text-align: center;
		flex-shrink: 0;
	}
	.play-dbs-val {
		font-size: 16px;
		font-weight: 800;
		font-family: 'JetBrains Mono', monospace;
		color: #3b82f6;
		line-height: 1;
	}
	.play-dbs-label {
		font-size: 7px;
		color: #4a6178;
		font-weight: 600;
	}

	/* ── Plays toggle ── */
	.plays-toggle {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 14px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.05);
		cursor: pointer;
		font-family: inherit;
		color: #e2e8f0;
	}
	.plays-toggle-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.plays-icon {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		background: rgba(59, 130, 246, 0.08);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.plays-toggle-text {
		text-align: left;
	}
	.plays-toggle-title {
		font-size: 12px;
		font-weight: 700;
	}
	.plays-toggle-desc {
		font-size: 10px;
		color: #4a6178;
	}
	.chevron {
		transition: transform 0.3s;
	}
	.chevron.open {
		transform: rotate(180deg);
	}
	.plays-content {
		margin-top: 8px;
		animation: fadeIn 0.3s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* ── Loading / Empty states ── */
	.loading-state,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 48px 20px;
		gap: 12px;
		color: #6b7d8e;
		font-size: 13px;
		text-align: center;
	}
	.empty-hint {
		font-size: 11px;
		color: #4a6178;
		margin-top: 4px;
	}
	.spinner {
		width: 28px;
		height: 28px;
		border: 3px solid rgba(245, 158, 11, 0.2);
		border-top-color: #f59e0b;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
