<script lang="ts">
	import { onMount } from 'svelte';
	import Sparkline from '$lib/components/market/Sparkline.svelte';

	// ── Types ────────────────────────────────────────────
	interface MoverCard {
		id: string;
		hero: string;
		num: string;
		set: string;
		rarity: string;
		mid: number;
		low: number;
		high: number;
		bnMid: number | null;
		bnLow: number | null;
		bnCount: number;
		aucCount: number;
		listings: number;
		filtered: number;
		conf: number;
		prevMid: number | null;
		delta: number | null;
		deltaPct: number | null;
		bnPremium: number;
		history: number[];
	}

	interface Summary {
		totalMkt: number;
		prevMkt: number;
		mktDeltaPct: number;
		totalCards: number;
		gainers: number;
		losers: number;
		totalListings: number;
	}

	interface Insights {
		confBuckets: number[];
		avgConf: number;
		totalListings: number;
		totalFiltered: number;
		outliersRemoved: number;
		bnPremiumCards: { hero: string; num: string; bnPremium: number }[];
	}

	// ── State ────────────────────────────────────────────
	let loading = $state(true);
	let summary = $state<Summary | null>(null);
	let insights = $state<Insights | null>(null);
	let movers = $state<MoverCard[]>([]);
	let topGainer = $state<MoverCard | null>(null);
	let topLoser = $state<MoverCard | null>(null);
	let expanded = $state<string | null>(null);

	const RARITY_COLORS: Record<string, string> = {
		Common: '#64748b',
		Rare: '#3b82f6',
		'Super Rare': '#a855f7',
		'Ultra Rare': '#f59e0b',
		Legendary: '#ef4444',
	};

	onMount(async () => {
		try {
			const res = await fetch('/api/market/pulse');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			summary = data.summary;
			insights = data.insights;
			movers = data.movers || [];
			topGainer = data.topGainer;
			topLoser = data.topLoser;
		} catch (err) {
			console.error('[market] Failed to load pulse data:', err);
		}
		loading = false;
	});

	function toggleExpand(id: string) {
		expanded = expanded === id ? null : id;
	}
</script>

<svelte:head>
	<title>Market Pulse | BoBA Scanner</title>
</svelte:head>

<div class="pulse-page">
	{#if loading}
		<div class="loading-state">
			<div class="loading-dot"></div>
			<span>Loading market data...</span>
		</div>
	{:else if !summary}
		<div class="empty-state">
			<p>No market data available yet. Run the price harvester to populate pricing.</p>
		</div>
	{:else}
		<!-- HERO -->
		<div class="hero-section">
			<div class="hero-badge">
				<span class="live-dot"></span>
				<span class="badge-text">Market Pulse</span>
			</div>
			<div class="hero-label">Total tracked market value</div>
			<div class="hero-value-row">
				<span class="hero-value">${summary.totalMkt.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
				<span class="hero-delta" class:up={summary.mktDeltaPct >= 0} class:down={summary.mktDeltaPct < 0}>
					{summary.mktDeltaPct >= 0 ? '+' : ''}{summary.mktDeltaPct.toFixed(2)}%
				</span>
			</div>

			<!-- Sentiment bar -->
			<div class="sentiment">
				<div class="sentiment-labels">
					<span class="sentiment-up">{summary.gainers} Rising</span>
					<span class="sentiment-label">Market Sentiment</span>
					<span class="sentiment-down">{summary.losers} Falling</span>
				</div>
				<div class="sentiment-bar">
					<div class="sentiment-green" style:width="{(summary.gainers / summary.totalCards) * 100}%"></div>
					<div class="sentiment-neutral"></div>
					<div class="sentiment-red" style:width="{(summary.losers / summary.totalCards) * 100}%"></div>
				</div>
			</div>
		</div>

		<!-- INSIGHTS -->
		{#if insights}
			<div class="section">
				<h2 class="section-heading">Market Insights</h2>

				<!-- Confidence Distribution -->
				<div class="insight-card">
					<div class="ic-title">Price Confidence</div>
					<div class="ic-desc">How trustworthy is each price? More listings + tighter spread = higher confidence.</div>
					<div class="conf-chart">
						{#each ['0\u201320', '20\u201340', '40\u201360', '60\u201380', '80\u2013100'] as range, i}
							{@const maxBucket = Math.max(...insights.confBuckets, 1)}
							{@const count = insights.confBuckets[i]}
							{@const color = i < 2 ? 'var(--danger)' : i < 4 ? 'var(--warning)' : 'var(--success)'}
							<div class="conf-col">
								<span class="conf-count" class:zero={count === 0}>{count}</span>
								<div class="conf-bar" style:height="{Math.max(3, (count / maxBucket) * 48)}px" style:background="{color}25" style:border-color="{color}35"></div>
								<span class="conf-label">{range}%</span>
							</div>
						{/each}
					</div>
					<div class="conf-callout">
						<span class="conf-highlight">{insights.confBuckets[4]} of {summary.totalCards}</span> cards have high-confidence pricing. Cards below 45% are based on thin data — consider manual verification before buying or selling.
					</div>
				</div>

				<!-- BIN Premium -->
				{#if insights.bnPremiumCards.length > 0}
					<div class="insight-card">
						<div class="ic-title">Buy-It-Now Premium</div>
						<div class="ic-desc">How much extra are BIN sellers asking over the overall median? Bigger gap = more negotiation room in auctions.</div>
						{#each insights.bnPremiumCards as card}
							<div class="bn-row">
								<span class="bn-hero">{card.hero}</span>
								<div class="bn-bar-track">
									<div class="bn-bar-fill" style:width="{Math.min(100, card.bnPremium * 4)}%"></div>
								</div>
								<span class="bn-pct">+{card.bnPremium}%</span>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Harvest Quality -->
				<div class="insight-card">
					<div class="ic-title">Harvest Quality</div>
					{#each [
						{ label: 'eBay listings scanned', val: insights.totalListings.toLocaleString(), accent: 'var(--text-primary)' },
						{ label: 'After IQR outlier filtering', val: insights.totalFiltered.toLocaleString(), accent: 'var(--success)' },
						{ label: 'Outliers removed', val: insights.outliersRemoved.toLocaleString(), accent: 'var(--warning)' },
						{ label: 'Average confidence', val: `${insights.avgConf}%`, accent: insights.avgConf >= 75 ? 'var(--success)' : 'var(--warning)' },
					] as row, i}
						<div class="hq-row" class:last={i === 3}>
							<span class="hq-label">{row.label}</span>
							<span class="hq-val" style:color={row.accent}>{row.val}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- HEADLINE MOVERS -->
		{#if topGainer && topLoser}
			<div class="section">
				<h2 class="section-heading">Biggest Movers</h2>
				<div class="headline-movers">
					{#each [topGainer, topLoser] as card}
						{@const isUp = (card.deltaPct ?? 0) > 0}
						{@const accent = isUp ? 'var(--success)' : 'var(--danger)'}
						<div class="headline-card" style:border-color="{accent}33" style:background="{accent}08">
							<div class="hc-watermark" style:color="{accent}0a">{isUp ? '\u25B2' : '\u25BC'}</div>
							<div class="hc-tag" style:color={accent}>{isUp ? 'Top Gainer' : 'Top Loser'}</div>
							<div class="hc-hero">{card.hero}</div>
							<div class="hc-num">{card.num}</div>
							<div class="hc-delta" style:color={accent}>{isUp ? '+' : ''}{(card.deltaPct ?? 0).toFixed(1)}%</div>
							<div class="hc-price">${card.prevMid?.toFixed(0) ?? '?'} &rarr; <strong>${card.mid.toFixed(0)}</strong></div>
							<div class="hc-spark">
								<Sparkline data={card.history} width={100} height={20} color={accent} />
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- ALL MOVERS LIST -->
		{#if movers.length > 0}
			<div class="section">
				<h2 class="section-heading">All Price Changes</h2>
				<div class="movers-list">
					{#each movers as card (card.id)}
						{@const isUp = (card.deltaPct ?? 0) > 0}
						{@const accent = isUp ? 'var(--success)' : 'var(--danger)'}
						{@const isOpen = expanded === card.id}
						<div class="mover-item">
							<!-- Collapsed row -->
							<button class="mover-row" class:open={isOpen} style:border-left-color={accent} onclick={() => toggleExpand(card.id)}>
								<div class="mr-info">
									<span class="mr-hero">{card.hero}</span>
									<span class="mr-meta">{card.num} · <span style:color={RARITY_COLORS[card.rarity] ?? '#64748b'} style:font-weight="600">{card.rarity}</span></span>
								</div>
								<div class="mr-right">
									<Sparkline data={card.history} width={56} height={18} color={accent} />
									<div class="mr-prices">
										<span class="mr-mid">${card.mid < 10 ? card.mid.toFixed(2) : card.mid.toFixed(0)}</span>
										<span class="mr-pct" style:color={accent}>{isUp ? '+' : ''}{(card.deltaPct ?? 0).toFixed(1)}%</span>
									</div>
								</div>
							</button>

							<!-- Expanded detail -->
							{#if isOpen}
								<div class="mover-detail" style:border-left-color={accent}>
									<!-- Price range -->
									<div class="md-range">
										<div class="md-range-labels">
											<span>Ask Range</span><span>BIN floor</span>
										</div>
										<div class="md-range-track">
											<div class="md-range-median" style:left="{((card.mid - card.low) / (card.high - card.low || 1)) * 100}%"></div>
											{#if card.bnLow}
												<div class="md-range-bn" style:left="{((card.bnLow - card.low) / (card.high - card.low || 1)) * 100}%"></div>
											{/if}
										</div>
										<div class="md-range-labels">
											<span>${card.low}</span>
											<span class="gold">Median ${card.mid}</span>
											<span>${card.high}</span>
										</div>
									</div>

									<!-- Stats row -->
									<div class="md-stats">
										<div class="md-stat">
											<span class="md-stat-val blue">${card.bnMid ?? '\u2014'}</span>
											<span class="md-stat-label">BIN Median</span>
										</div>
										<div class="md-stat">
											<span class="md-stat-val">{card.listings}</span>
											<span class="md-stat-label">Listings</span>
										</div>
										<div class="md-stat">
											<span class="md-stat-val" class:green={Math.round(card.conf * 100) >= 75} class:amber={Math.round(card.conf * 100) >= 45 && Math.round(card.conf * 100) < 75} class:red={Math.round(card.conf * 100) < 45}>{Math.round(card.conf * 100)}%</span>
											<span class="md-stat-label">Confidence</span>
										</div>
									</div>

									<!-- Auction/BIN split -->
									<div class="md-split">
										<div class="md-split-bar">
											<div class="md-split-bin" style:width="{card.listings > 0 ? (card.bnCount / card.listings) * 100 : 0}%"></div>
											<div class="md-split-auc"></div>
										</div>
										<span class="md-split-label blue">{card.bnCount} BIN</span>
										<span class="md-split-dot">&middot;</span>
										<span class="md-split-label purple">{card.aucCount} Auc</span>
										<span class="md-split-dot">&middot;</span>
										<span class="md-split-label muted">+{Math.round(card.bnPremium)}% premium</span>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.pulse-page {
		max-width: 480px;
		margin: 0 auto;
		padding-bottom: 6rem;
	}

	/* ── Loading / Empty ────────────────────────── */
	.loading-state, .empty-state {
		text-align: center;
		padding: 4rem 1rem;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.loading-dot {
		width: 8px; height: 8px; border-radius: 50%;
		background: var(--gold);
		margin: 0 auto 0.75rem;
		animation: pulse 1.5s infinite;
	}

	/* ── Hero ────────────────────────────────────── */
	.hero-section { padding: 1.75rem 1.25rem 1.25rem; }
	.hero-badge { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
	.live-dot {
		width: 8px; height: 8px; border-radius: 50%;
		background: var(--success);
		box-shadow: 0 0 8px color-mix(in srgb, var(--success) 50%, transparent);
		animation: pulse 2s infinite;
	}
	.badge-text {
		font-size: 0.625rem; font-weight: 700;
		letter-spacing: 0.2em; color: var(--gold);
		text-transform: uppercase;
	}
	.hero-label { font-size: 0.6875rem; color: var(--text-muted); margin-bottom: 0.25rem; }
	.hero-value-row { display: flex; align-items: baseline; gap: 0.625rem; }
	.hero-value {
		font-size: 2.25rem; font-weight: 900;
		font-family: var(--font-mono); color: var(--text-primary);
		letter-spacing: -0.02em;
	}
	.hero-delta {
		font-size: var(--text-sm); font-weight: 700;
		font-family: var(--font-mono);
	}
	.hero-delta.up { color: var(--success); }
	.hero-delta.down { color: var(--danger); }

	/* ── Sentiment ───────────────────────────────── */
	.sentiment { margin-top: 1rem; }
	.sentiment-labels {
		display: flex; justify-content: space-between;
		font-size: 0.625rem; margin-bottom: 0.375rem;
	}
	.sentiment-up { color: var(--success); font-weight: 700; }
	.sentiment-label { color: var(--text-muted); }
	.sentiment-down { color: var(--danger); font-weight: 700; }
	.sentiment-bar {
		height: 6px; border-radius: 3px;
		display: flex; overflow: hidden; gap: 1px;
	}
	.sentiment-green {
		background: linear-gradient(90deg, #15803d, var(--success));
		border-radius: 3px 0 0 3px;
		transition: width 1s ease;
	}
	.sentiment-neutral { flex: 1; background: var(--bg-hover); }
	.sentiment-red {
		background: linear-gradient(90deg, var(--danger), #991b1b);
		border-radius: 0 3px 3px 0;
		transition: width 1s ease;
	}

	/* ── Sections ────────────────────────────────── */
	.section { padding: 1.5rem 1.25rem 0; }
	.section-heading {
		font-size: 0.625rem; font-weight: 700;
		letter-spacing: 0.15em; color: var(--text-muted);
		text-transform: uppercase; margin-bottom: 0.875rem;
	}

	/* ── Insight Cards ───────────────────────────── */
	.insight-card {
		background: var(--bg-surface);
		border-radius: var(--radius-xl);
		padding: 1rem;
		border: 1px solid var(--border);
		margin-bottom: 0.875rem;
	}
	.ic-title { font-size: 0.75rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.125rem; }
	.ic-desc { font-size: 0.625rem; color: var(--text-muted); margin-bottom: 0.875rem; }

	/* Confidence chart */
	.conf-chart { display: flex; align-items: flex-end; gap: 4px; height: 70px; }
	.conf-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
	.conf-count { font-size: 0.6875rem; font-weight: 800; font-family: var(--font-mono); color: var(--text-primary); }
	.conf-count.zero { color: var(--bg-hover); }
	.conf-bar { width: 100%; border-radius: 4px; border: 1px solid; transition: height 1s cubic-bezier(0.16,1,0.3,1); }
	.conf-label { font-size: 0.5rem; color: var(--text-muted); }
	.conf-callout {
		margin-top: 0.625rem; padding: 0.5rem 0.625rem;
		border-radius: var(--radius-md);
		background: var(--gold-light); border: 1px solid var(--gold-glow);
		font-size: 0.6875rem; color: #b8a07a; line-height: 1.5;
	}
	.conf-highlight { font-weight: 700; color: var(--gold); }

	/* BIN Premium */
	.bn-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.375rem; }
	.bn-hero {
		width: 80px; font-size: 0.6875rem; font-weight: 600;
		color: var(--text-secondary); overflow: hidden;
		text-overflow: ellipsis; white-space: nowrap;
	}
	.bn-bar-track { flex: 1; height: 8px; border-radius: 4px; background: rgba(255,255,255,0.03); overflow: hidden; }
	.bn-bar-fill {
		height: 100%; border-radius: 4px;
		background: linear-gradient(90deg, color-mix(in srgb, var(--primary) 25%, transparent), var(--primary));
		transition: width 1s cubic-bezier(0.16,1,0.3,1);
	}
	.bn-pct {
		font-size: 0.6875rem; font-weight: 700;
		font-family: var(--font-mono); color: var(--primary);
		min-width: 42px; text-align: right;
	}

	/* Harvest Quality */
	.hq-row {
		display: flex; justify-content: space-between;
		align-items: center; padding: 0.4375rem 0;
		border-bottom: 1px solid var(--border);
	}
	.hq-row.last { border-bottom: none; }
	.hq-label { font-size: 0.6875rem; color: var(--text-muted); }
	.hq-val { font-size: var(--text-sm); font-weight: 800; font-family: var(--font-mono); }

	/* ── Headline Movers ─────────────────────────── */
	.headline-movers { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
	.headline-card {
		border-radius: var(--radius-xl); padding: 0.875rem;
		border: 1px solid; position: relative; overflow: hidden;
	}
	.hc-watermark {
		position: absolute; top: -10px; right: -10px;
		font-size: 3.5rem; font-weight: 900;
		font-family: var(--font-mono); line-height: 1;
	}
	.hc-tag { font-size: 0.5625rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 0.375rem; }
	.hc-hero { font-size: 0.9375rem; font-weight: 800; color: var(--text-primary); margin-bottom: 0.125rem; }
	.hc-num { font-size: 0.625rem; color: var(--text-muted); margin-bottom: 0.5rem; }
	.hc-delta { font-size: 1.25rem; font-weight: 800; font-family: var(--font-mono); }
	.hc-price { font-size: 0.625rem; color: var(--text-muted); margin-top: 0.25rem; }
	.hc-price :global(strong) { color: var(--text-primary); }
	.hc-spark { margin-top: 0.5rem; }

	/* ── Movers List ──────────────────────────────── */
	.movers-list { display: flex; flex-direction: column; gap: 3px; }
	.mover-row {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.625rem 0.75rem; border-radius: var(--radius-lg);
		background: var(--bg-surface); cursor: pointer;
		border: none; border-left: 3px solid;
		width: 100%; text-align: left;
		font-family: var(--font-sans); color: var(--text-primary);
		transition: background 0.2s;
	}
	.mover-row.open { border-radius: var(--radius-lg) var(--radius-lg) 0 0; background: var(--bg-elevated); }
	.mover-row:hover { background: var(--bg-elevated); }
	.mr-info { min-width: 0; flex: 1; }
	.mr-hero { display: block; font-size: 0.8125rem; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.mr-meta { display: block; font-size: 0.625rem; color: var(--text-muted); }
	.mr-right { display: flex; align-items: center; gap: 0.625rem; flex-shrink: 0; }
	.mr-prices { text-align: right; min-width: 70px; }
	.mr-mid { display: block; font-size: var(--text-sm); font-weight: 800; font-family: var(--font-mono); }
	.mr-pct { display: block; font-size: 0.6875rem; font-weight: 700; font-family: var(--font-mono); }

	/* ── Mover Detail ─────────────────────────────── */
	.mover-detail {
		padding: 0.75rem; background: var(--bg-elevated);
		border-radius: 0 0 var(--radius-lg) var(--radius-lg);
		border-left: 3px solid; border-top: 1px solid var(--border);
	}

	/* Range bar */
	.md-range { margin-bottom: 0.625rem; }
	.md-range-labels { display: flex; justify-content: space-between; font-size: 0.5625rem; color: var(--text-muted); margin: 0.1875rem 0; }
	.md-range-labels .gold { color: var(--gold); font-weight: 600; }
	.md-range-track { position: relative; height: 8px; border-radius: 4px; background: rgba(255,255,255,0.04); }
	.md-range-median {
		position: absolute; top: -2px; width: 4px; height: 12px;
		border-radius: 2px; background: var(--gold);
		transform: translateX(-50%);
		box-shadow: 0 0 8px color-mix(in srgb, var(--gold) 25%, transparent);
	}
	.md-range-bn {
		position: absolute; top: -3px; transform: translateX(-50%);
		border-left: 5px solid transparent; border-right: 5px solid transparent;
		border-bottom: 6px solid var(--primary);
	}

	/* Stats */
	.md-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.375rem; margin-bottom: 0.625rem; }
	.md-stat { text-align: center; padding: 0.375rem; border-radius: var(--radius-md); background: var(--bg-surface); }
	.md-stat-val { display: block; font-size: var(--text-sm); font-weight: 800; font-family: var(--font-mono); color: var(--text-primary); }
	.md-stat-val.blue { color: var(--primary); }
	.md-stat-val.green { color: var(--success); }
	.md-stat-val.amber { color: var(--warning); }
	.md-stat-val.red { color: var(--danger); }
	.md-stat-label { display: block; font-size: 0.5rem; color: var(--text-muted); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }

	/* Split bar */
	.md-split { display: flex; align-items: center; gap: 0.5rem; font-size: 0.625rem; }
	.md-split-bar { flex: 1; height: 6px; border-radius: 3px; display: flex; overflow: hidden; gap: 1px; }
	.md-split-bin { background: var(--primary); border-radius: 3px 0 0 3px; }
	.md-split-auc { flex: 1; background: #a855f7; border-radius: 0 3px 3px 0; }
	.md-split-label.blue { color: var(--primary); font-weight: 600; }
	.md-split-label.purple { color: #a855f7; font-weight: 600; }
	.md-split-label.muted { color: var(--text-muted); }
	.md-split-dot { color: var(--text-muted); }

	@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
