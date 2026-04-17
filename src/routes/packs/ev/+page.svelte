<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { DEFAULT_CONFIGS } from '$lib/data/pack-defaults';
	import { showToast } from '$lib/stores/toast.svelte';

	interface TopHit {
		heroName: string;
		cardNumber: string;
		parallel: string;
		price: number;
	}

	interface EvResponse {
		iterations: number;
		msrp: number;
		ev: number;
		median: number;
		p10: number;
		p90: number;
		p99: number;
		max: number;
		breakEvenPct: number;
		jackpotPct: number;
		avgParallelsByType: Record<string, number>;
		topHits: TopHit[];
		priceCoverage: number;
		configLabel: string;
		setLabel: string;
	}

	const SET_OPTIONS = [
		{ key: 'G', label: '2026 Griffey' },
		{ key: 'A', label: 'Alpha Edition' },
		{ key: 'U', label: 'Alpha Update' },
		{ key: 'T', label: 'Tecmo Bowl' },
	];

	let selectedSet = $state<string>('G');
	let selectedBox = $state<string>('hobby');
	let loading = $state(false);
	let result = $state<EvResponse | null>(null);
	let errorMessage = $state<string | null>(null);

	const availableBoxTypes = $derived(
		Object.entries(DEFAULT_CONFIGS)
			.filter(([, config]) => config.availableForSets.includes(selectedSet))
			.map(([key, config]) => ({ key, label: config.displayName }))
	);

	const delta = $derived(result ? result.ev - result.msrp : 0);
	const isProfit = $derived(delta > 0);
	const setDisplay = $derived(
		SET_OPTIONS.find((s) => s.key === (result?.setLabel ?? selectedSet))?.label ??
			result?.setLabel ??
			selectedSet
	);

	function syncUrl() {
		const url = new URL($page.url);
		url.searchParams.set('set', selectedSet);
		url.searchParams.set('box', selectedBox);
		goto(`?${url.searchParams.toString()}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function handleSetChange(newSet: string) {
		selectedSet = newSet;
		const available = Object.entries(DEFAULT_CONFIGS)
			.filter(([, config]) => config.availableForSets.includes(newSet))
			.map(([key]) => key);
		if (!available.includes(selectedBox)) selectedBox = available[0] ?? 'hobby';
		syncUrl();
	}

	function handleBoxChange(newBox: string) {
		selectedBox = newBox;
		syncUrl();
	}

	async function calculate() {
		loading = true;
		errorMessage = null;
		try {
			const resp = await fetch('/api/pack/ev', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ setCode: selectedSet, boxType: selectedBox, iterations: 500 }),
			});
			if (!resp.ok) {
				if (resp.status === 429) {
					errorMessage = 'Rate limited. Try again in a minute.';
				} else {
					const body = await resp.json().catch(() => ({}));
					errorMessage = body.error || `Simulation failed (${resp.status})`;
				}
				return;
			}
			result = (await resp.json()) as EvResponse;
			syncUrl();
		} catch (err) {
			console.error('[packs/ev] fetch failed:', err);
			errorMessage = 'Network error — try again.';
		} finally {
			loading = false;
		}
	}

	function formatParallelLabel(key: string): string {
		return key
			.split('_')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ');
	}

	function formatFrequency(avgPerBox: number): string {
		if (avgPerBox >= 1) return `~${avgPerBox.toFixed(1)} per box`;
		if (avgPerBox >= 0.1) return `~${(avgPerBox * 10).toFixed(1)} per 10 boxes`;
		return `~${(avgPerBox * 100).toFixed(1)} per 100 boxes`;
	}

	function share() {
		if (!result) return;
		const url = $page.url.toString();
		const text = `${result.configLabel} expected value: $${result.ev.toFixed(2)} vs $${result.msrp.toFixed(2)} MSRP. ${result.breakEvenPct}% chance to break even.`;
		const shareData = {
			title: `${result.configLabel} — ${setDisplay} EV`,
			text,
			url,
		};
		if (typeof navigator !== 'undefined' && 'share' in navigator && typeof navigator.share === 'function') {
			navigator.share(shareData).catch(() => {});
		} else if (typeof navigator !== 'undefined' && navigator.clipboard) {
			navigator.clipboard.writeText(`${text} ${url}`).then(
				() => showToast('Link copied to clipboard', '✓'),
				() => showToast('Copy failed', 'x')
			);
		}
	}

	onMount(() => {
		const qSet = $page.url.searchParams.get('set');
		const qBox = $page.url.searchParams.get('box');
		if (qSet) selectedSet = qSet;
		if (qBox) selectedBox = qBox;
		// If both are provided in URL, auto-run
		if (qSet && qBox) void calculate();
	});

	const sortedParallels = $derived(
		result
			? Object.entries(result.avgParallelsByType).sort((a, b) => b[1] - a[1]).slice(0, 8)
			: []
	);
</script>

<svelte:head>
	<title>Box EV Calculator — Card Scanner</title>
	<meta property="og:title" content="Is your BoBA box worth buying?" />
	<meta
		property="og:description"
		content="Calculate expected value of any BoBA box from current eBay prices. See break-even odds, best-case hits, and profit/loss per box."
	/>
	<meta property="og:image" content="/og-box-ev.png" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="description" content="Calculate BoBA box expected value from real eBay prices. Break-even odds, top possible hits, profit per box." />
</svelte:head>

<div class="ev-page">
	<header class="page-header">
		<div class="header-label">BoBA Scanner</div>
		<h1>Box EV Calculator</h1>
		<p class="subtitle">Expected value of a sealed box at current eBay prices.</p>
	</header>

	<div class="picker-card">
		<div class="selector">
			<span class="selector-label">Set</span>
			<div class="pill-row">
				{#each SET_OPTIONS as setOpt}
					<button
						class="pill"
						class:active={selectedSet === setOpt.key}
						onclick={() => handleSetChange(setOpt.key)}
					>
						{setOpt.label}
					</button>
				{/each}
			</div>
		</div>

		<div class="selector">
			<span class="selector-label">Box</span>
			<div class="pill-row">
				{#each availableBoxTypes as box}
					<button
						class="pill"
						class:active={selectedBox === box.key}
						onclick={() => handleBoxChange(box.key)}
					>
						{box.label}
					</button>
				{/each}
			</div>
		</div>

		<button class="btn-calc" onclick={calculate} disabled={loading}>
			{loading ? 'Running…' : 'Calculate EV'}
		</button>
	</div>

	{#if loading}
		<div class="loading-card">
			<div class="spinner"></div>
			<div class="loading-title">Running 500 simulated box opens…</div>
			<div class="loading-sub">Crunching eBay prices against the pull rates. First run may take a few seconds.</div>
		</div>
	{/if}

	{#if errorMessage && !loading}
		<div class="error-card">{errorMessage}</div>
	{/if}

	{#if result && !loading}
		<div class="hero-card" class:profit={isProfit} class:loss={!isProfit}>
			<div class="hero-label">{result.configLabel} · {setDisplay}</div>
			<div class="hero-ev">${result.ev.toFixed(2)}</div>
			<div class="hero-msrp">vs ${result.msrp.toFixed(2)} MSRP</div>
			<div class="delta-pill" class:profit={isProfit} class:loss={!isProfit}>
				{isProfit ? '+' : '−'}${Math.abs(delta).toFixed(2)} per box
			</div>
			<div class="hero-sub">Based on {result.iterations} simulated box opens at current eBay prices.</div>
		</div>

		<div class="stats-grid">
			<div class="stat">
				<div class="stat-label">Median</div>
				<div class="stat-value">${result.median.toFixed(2)}</div>
				<div class="stat-note">Most likely box value</div>
			</div>
			<div class="stat">
				<div class="stat-label">Worst case (p10)</div>
				<div class="stat-value">${result.p10.toFixed(2)}</div>
				<div class="stat-note">1 in 10 boxes or worse</div>
			</div>
			<div class="stat">
				<div class="stat-label">Best case (p90)</div>
				<div class="stat-value">${result.p90.toFixed(2)}</div>
				<div class="stat-note">1 in 10 boxes or better</div>
			</div>
			<div class="stat">
				<div class="stat-label">Break-even odds</div>
				<div class="stat-value">{result.breakEvenPct}%</div>
				<div class="stat-note">chance to beat MSRP</div>
			</div>
		</div>

		{#if result.topHits.length > 0}
			<section class="section">
				<h2>What a great box looks like</h2>
				<p class="section-sub">Top 5 single-card hits across {result.iterations} simulated boxes.</p>
				<div class="hits-list">
					{#each result.topHits.slice(0, 5) as hit}
						<div class="hit-row">
							<div class="hit-name">
								<div class="hit-hero">{hit.heroName}</div>
								<div class="hit-meta">
									<span class="hit-number">{hit.cardNumber}</span>
									{#if hit.parallel && hit.parallel !== 'paper' && hit.parallel !== 'base'}
										<span class="hit-parallel">{formatParallelLabel(hit.parallel)}</span>
									{/if}
								</div>
							</div>
							<div class="hit-price">${hit.price.toFixed(2)}</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		{#if sortedParallels.length > 0}
			<section class="section">
				<h2>What you'll average per box</h2>
				<p class="section-sub">Expected parallel/insert pulls averaged across all boxes.</p>
				<div class="parallels-list">
					{#each sortedParallels as [parallel, avg]}
						<div class="parallel-row">
							<div class="parallel-name">{formatParallelLabel(parallel)}</div>
							<div class="parallel-freq">{formatFrequency(avg)}</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<div class="coverage-note">
			Price data covers {result.priceCoverage}% of cards in this pool. Unpriced cards contribute $0 to EV,
			so real EV is slightly higher than shown.
		</div>

		<div class="cta-card">
			<div class="cta-title">Got a box in hand?</div>
			<div class="cta-sub">Scan your hits with Card Scanner to lock in real prices.</div>
			<a class="cta-btn" href="/scan">Start Scanning →</a>
		</div>

		<div class="share-row">
			<button class="btn-share" onclick={share}>Share these results</button>
		</div>
	{/if}

	<footer class="disclaimer">
		Based on current eBay mid-prices. These are asking prices — realized sale prices are usually
		lower. Treat this as a ceiling, not a floor.
	</footer>
</div>

<style>
	.ev-page {
		max-width: 520px;
		margin: 0 auto;
		padding: 1rem;
		min-height: 100vh;
	}
	.page-header {
		text-align: center;
		margin-bottom: 1.5rem;
	}
	.header-label {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		letter-spacing: 3px;
		text-transform: uppercase;
		font-weight: 600;
	}
	h1 {
		font-size: 1.75rem;
		font-weight: 900;
		margin: 0.25rem 0 0.5rem;
		background: linear-gradient(135deg, #60a5fa, #a78bfa, #f472b6);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}
	.subtitle {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin: 0;
	}

	.picker-card {
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 14px;
		padding: 1rem;
		margin-bottom: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}
	.selector-label {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		display: block;
		margin-bottom: 0.375rem;
	}
	.pill-row {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}
	.pill {
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-primary, rgba(15, 23, 42, 0.5));
		color: var(--text-secondary);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}
	.pill.active {
		border-color: var(--accent-primary, #3b82f6);
		color: var(--accent-primary, #60a5fa);
		background: rgba(59, 130, 246, 0.1);
	}
	.btn-calc {
		padding: 0.875rem;
		border-radius: 12px;
		border: none;
		cursor: pointer;
		background: linear-gradient(135deg, #3b82f6, #8b5cf6);
		color: #fff;
		font-size: 1rem;
		font-weight: 700;
		box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
	}
	.btn-calc:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.loading-card {
		text-align: center;
		padding: 2.5rem 1rem;
		background: var(--bg-elevated);
		border-radius: 14px;
		margin-bottom: 1rem;
		border: 1px solid var(--border-color);
	}
	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid rgba(96, 165, 250, 0.15);
		border-top-color: #60a5fa;
		border-radius: 50%;
		margin: 0 auto 1rem;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	.loading-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.25rem;
	}
	.loading-sub {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.error-card {
		padding: 1rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: #fca5a5;
		border-radius: 12px;
		margin-bottom: 1rem;
		font-size: 0.875rem;
	}

	.hero-card {
		position: relative;
		padding: 1.5rem 1.25rem;
		border-radius: 16px;
		background: linear-gradient(135deg, #1e293b, #0f172a);
		border: 2px solid;
		text-align: center;
		margin-bottom: 1rem;
		animation: floatIn 0.4s ease-out;
	}
	.hero-card.profit { border-color: rgba(34, 197, 94, 0.5); }
	.hero-card.loss { border-color: rgba(239, 68, 68, 0.4); }
	.hero-label {
		font-size: 0.75rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		margin-bottom: 0.5rem;
	}
	.hero-ev {
		font-size: 3rem;
		font-weight: 900;
		color: var(--text-primary);
		line-height: 1;
		margin-bottom: 0.25rem;
	}
	.hero-msrp {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}
	.delta-pill {
		display: inline-block;
		padding: 0.375rem 1rem;
		border-radius: 999px;
		font-size: 0.95rem;
		font-weight: 700;
		margin-bottom: 0.75rem;
	}
	.delta-pill.profit {
		background: rgba(34, 197, 94, 0.15);
		color: #86efac;
	}
	.delta-pill.loss {
		background: rgba(239, 68, 68, 0.12);
		color: #fca5a5;
	}
	.hero-sub {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.stat {
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 0.75rem;
	}
	.stat-label {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
	}
	.stat-value {
		font-size: 1.375rem;
		font-weight: 800;
		color: var(--text-primary);
		margin: 0.25rem 0;
	}
	.stat-note {
		font-size: 0.7rem;
		color: var(--text-secondary);
	}

	.section {
		margin-bottom: 1.25rem;
	}
	.section h2 {
		font-size: 1rem;
		font-weight: 700;
		margin: 0 0 0.25rem;
		color: var(--text-primary);
	}
	.section-sub {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin: 0 0 0.625rem;
	}

	.hits-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.hit-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.625rem 0.875rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 10px;
	}
	.hit-hero {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.hit-meta {
		display: flex;
		gap: 0.5rem;
		font-size: 0.7rem;
		color: var(--text-tertiary);
		margin-top: 0.125rem;
	}
	.hit-number {
		font-family: monospace;
	}
	.hit-parallel {
		color: #a78bfa;
		text-transform: capitalize;
	}
	.hit-price {
		font-size: 1rem;
		font-weight: 800;
		color: #86efac;
	}

	.parallels-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.parallel-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.75rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		font-size: 0.85rem;
	}
	.parallel-name {
		color: var(--text-primary);
		font-weight: 600;
	}
	.parallel-freq {
		color: var(--text-secondary);
		font-size: 0.8rem;
	}

	.coverage-note {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-style: italic;
		text-align: center;
		margin: 0.75rem 0 1rem;
		line-height: 1.4;
	}

	.cta-card {
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(139, 92, 246, 0.12));
		border: 1px solid rgba(96, 165, 250, 0.3);
		border-radius: 14px;
		padding: 1.25rem;
		text-align: center;
		margin-bottom: 1rem;
	}
	.cta-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.25rem;
	}
	.cta-sub {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}
	.cta-btn {
		display: inline-block;
		padding: 0.625rem 1.25rem;
		border-radius: 10px;
		background: linear-gradient(135deg, #3b82f6, #8b5cf6);
		color: #fff;
		text-decoration: none;
		font-weight: 700;
		font-size: 0.9rem;
	}

	.share-row {
		display: flex;
		justify-content: center;
		margin-bottom: 1rem;
	}
	.btn-share {
		padding: 0.75rem 1.5rem;
		border-radius: 10px;
		border: 1px solid var(--border-color);
		background: var(--bg-elevated);
		color: var(--text-primary);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}

	.disclaimer {
		text-align: center;
		font-size: 0.7rem;
		color: var(--text-tertiary);
		line-height: 1.5;
		margin-top: 2rem;
		padding: 0 0.5rem;
	}

	@keyframes floatIn {
		from { opacity: 0; transform: translateY(12px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
