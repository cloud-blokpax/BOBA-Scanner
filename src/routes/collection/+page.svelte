<script lang="ts">
	import { onMount } from 'svelte';
	import CardDetail from '$lib/components/CardDetail.svelte';
	import SkeletonCardGrid from '$lib/components/SkeletonCardGrid.svelte';
	import {
		collectionItems,
		collectionLoading,
		collectionCount,
		uniqueCardCount,
		loadCollection
	} from '$lib/stores/collection.svelte';
	import { priceCache, getPrice } from '$lib/stores/prices.svelte';
	import { getWeapon, WEAPON_HIERARCHY } from '$lib/data/boba-weapons';
	import type { CollectionItem } from '$lib/types';

	/** Weapon icons for display */
	const WEAPON_ICONS: Record<string, string> = {
		super: '👑', gum: '🫧', hex: '💀', glow: '☢️',
		fire: '🔥', ice: '❄️', steel: '🛡️', brawl: '👊',
		alt: '🎭', cyber: '🔮',
	};

	/** Set display metadata */
	const SET_META: Record<string, { label: string; color: string; icon: string; totalCards: number }> = {
		G: { label: 'Griffey', color: '#60a5fa', icon: '🏆', totalCards: 60 },
		A: { label: 'Alpha', color: '#f59e0b', icon: '⚔️', totalCards: 60 },
		U: { label: 'Update', color: '#a78bfa', icon: '🔄', totalCards: 60 },
	};

	const RARITY_TIERS = [
		{ tier: 'Legendary', keys: ['super', 'gum'], color: '#ffd700', bg: '#ffd70012' },
		{ tier: 'Ultra Rare', keys: ['hex', 'glow'], color: '#a78bfa', bg: '#a78bfa12' },
		{ tier: 'Rare', keys: ['fire', 'ice'], color: '#ef4444', bg: '#ef444412' },
		{ tier: 'Common', keys: ['steel', 'brawl'], color: '#9CA3AF', bg: '#9CA3AF12' },
	];

	let selectedItem = $state<CollectionItem | null>(null);
	let activeTab = $state<'overview' | 'cards' | 'weapons'>('overview');
	let filterWeapon = $state<string | null>(null);

	onMount(() => {
		loadCollection();
	});

	// Batch-fetch prices for collection items with concurrency limit
	let pricesFetchStarted = $state(false);
	$effect(() => {
		if (items.length === 0 || pricesFetchStarted) return;
		pricesFetchStarted = true;
		const ids = items.map(i => i.card_id);
		let active = 0;
		let idx = 0;
		function next() {
			while (active < 3 && idx < ids.length) {
				const cardId = ids[idx++];
				active++;
				getPrice(cardId).finally(() => { active--; next(); });
			}
		}
		next();
	});

	// ── Computed stats ─────────────────────────────────────

	const items = $derived(collectionItems());
	const prices = $derived(priceCache());

	/** Get estimated value for a collection item */
	function cardValue(item: CollectionItem): number {
		const p = prices.get(item.card_id);
		return p?.price_mid ?? 0;
	}

	const totalValue = $derived(items.reduce((s, i) => s + cardValue(i) * (i.quantity || 1), 0));

	const avgPower = $derived(
		items.length > 0
			? Math.round(items.reduce((s, i) => s + (i.card?.power ?? 0), 0) / items.length)
			: 0
	);

	const parallelCount = $derived(
		items.filter(i => {
			const p = (i.card?.parallel ?? '').toLowerCase();
			return p !== '' && p !== 'base' && p !== 'paper';
		}).length
	);

	const highPowerCount = $derived(items.filter(i => (i.card?.power ?? 0) >= 160).length);

	const weaponCounts = $derived(() => {
		const counts: Record<string, number> = {};
		for (const w of WEAPON_HIERARCHY) counts[w.key] = 0;
		for (const item of items) {
			const wt = item.card?.weapon_type?.toLowerCase();
			if (wt && counts[wt] !== undefined) counts[wt]++;
		}
		return counts;
	});

	const maxWeaponCount = $derived(Math.max(...Object.values(weaponCounts()), 1));

	const setCounts = $derived(() => {
		const counts: Record<string, number> = {};
		for (const key of Object.keys(SET_META)) counts[key] = 0;
		for (const item of items) {
			const sc = item.card?.set_code;
			if (sc && counts[sc] !== undefined) counts[sc]++;
		}
		return counts;
	});

	const topCards = $derived(
		[...items]
			.sort((a, b) => cardValue(b) - cardValue(a))
			.slice(0, 5)
	);

	/** Power distribution buckets (80-200 in steps of 10) */
	const powerBuckets = $derived(() => {
		const b: Record<number, number> = {};
		for (let p = 80; p <= 200; p += 10) b[p] = 0;
		for (const item of items) {
			const power = item.card?.power;
			if (power == null) continue;
			const bucket = Math.max(80, Math.min(200, Math.floor(power / 10) * 10));
			b[bucket] = (b[bucket] || 0) + 1;
		}
		return Object.entries(b).map(([p, c]) => ({ power: +p, count: c }));
	});

	/** Recent activity — cards added in last 7 days */
	const recentDays = $derived(() => {
		const now = Date.now();
		const days = Array.from({ length: 7 }, (_, i) => ({ day: i, count: 0 }));
		for (const item of items) {
			if (!item.added_at) continue;
			const daysAgo = Math.floor((now - new Date(item.added_at).getTime()) / 86_400_000);
			if (daysAgo >= 0 && daysAgo < 7) days[daysAgo].count++;
		}
		return days;
	});

	/** Filtered + sorted cards for cards tab */
	const filteredCards = $derived(() => {
		let result = [...items];
		if (filterWeapon) result = result.filter(i => i.card?.weapon_type?.toLowerCase() === filterWeapon);
		return result.sort((a, b) => (b.card?.power ?? 0) - (a.card?.power ?? 0));
	});

	// ── Helpers ─────────────────────────────────────────────

	function wColor(weaponKey: string): string {
		return getWeapon(weaponKey)?.color ?? '#9CA3AF';
	}

	function wIcon(weaponKey: string): string {
		return WEAPON_ICONS[weaponKey.toLowerCase()] ?? '⚔️';
	}

	/** SVG completion ring math */
	function ringOffset(percent: number, radius: number): number {
		const circ = 2 * Math.PI * radius;
		return circ - (percent / 100) * circ;
	}

	function ringCirc(radius: number): number {
		return 2 * Math.PI * radius;
	}
</script>

<svelte:head>
	<title>My Collection | BOBA Scanner</title>
</svelte:head>

<div class="collection-page">
	{#if collectionLoading()}
		<div class="dash-header">
			<div>
				<div class="label">My Collection</div>
				<h1>Loading...</h1>
			</div>
		</div>
		<SkeletonCardGrid count={9} columns={3} />
	{:else}
		<!-- Header -->
		<div class="dash-header">
			<div>
				<div class="label">My Collection</div>
				<h1>{collectionCount()} Cards</h1>
			</div>
			<div class="value-block">
				<div class="total-value">${Math.round(totalValue).toLocaleString()}</div>
				<div class="value-label">Est. Value</div>
			</div>
		</div>

		<!-- Tabs -->
		<div class="tabs">
			{#each [{ id: 'overview', label: 'Overview', icon: '📊' }, { id: 'cards', label: 'Cards', icon: '🎴' }, { id: 'weapons', label: 'Weapons', icon: '⚔️' }] as tab}
				<button
					class="tab-btn" class:active={activeTab === tab.id}
					onclick={() => activeTab = tab.id as typeof activeTab}
				>
					{tab.icon} {tab.label}
				</button>
			{/each}
		</div>

		<!-- Quick actions -->
		<div class="collection-actions">
			<a href="/set-completion" class="action-chip">
				<span class="action-icon">📊</span>
				<span>Set Progress</span>
			</a>
			<a href="/organize" class="action-chip">
				<span class="action-icon">📁</span>
				<span>Organize</span>
			</a>
			<a href="/sell" class="action-chip">
				<span class="action-icon">💰</span>
				<span>Sell</span>
			</a>
			<a href="/export" class="action-chip">
				<span class="action-icon">📤</span>
				<span>Export</span>
			</a>
			<a href="/leaderboard" class="action-chip">
				<span class="action-icon">🏆</span>
				<span>Leaderboard</span>
			</a>
			<a href="/marketplace/monitor" class="action-chip">
				<span class="action-icon">🔍</span>
				<span>Market</span>
			</a>
		</div>

		<div class="tab-content">
			<!-- ════════ Overview Tab ════════ -->
			{#if activeTab === 'overview'}
				<div class="sections" style="animation: countUp 0.4s ease-out">
					<!-- Quick stats -->
					<div class="stat-grid">
						<div class="stat-card">
							<div class="stat-value" style="color: #60a5fa">{avgPower}</div>
							<div class="stat-label">Avg Power</div>
						</div>
						<div class="stat-card">
							<div class="stat-value" style="color: #fbbf24">{parallelCount}</div>
							<div class="stat-label">Parallels</div>
						</div>
						<div class="stat-card">
							<div class="stat-value" style="color: #ef4444">{highPowerCount}</div>
							<div class="stat-label">160+ Power</div>
						</div>
					</div>

					<!-- Set Completion -->
					<div class="panel">
						<div class="panel-title">Set Completion</div>
						<div class="ring-row">
							{#each Object.entries(SET_META) as [key, meta]}
								{@const count = setCounts()[key] ?? 0}
								{@const pct = Math.min(99, Math.round((count / meta.totalCards) * 100))}
								{@const r = 36}
								<div class="ring-cell">
									<svg width="80" height="80" style="transform: rotate(-90deg)">
										<circle cx="40" cy="40" r={r} fill="none" stroke="#1e293b" stroke-width="6" />
										<circle cx="40" cy="40" r={r} fill="none" stroke={meta.color} stroke-width="6"
											stroke-dasharray={ringCirc(r)} stroke-dashoffset={ringOffset(pct, r)}
											stroke-linecap="round"
											style="transition: stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1)"
										/>
									</svg>
									<div style="margin-top: -48px; height: 80px; display: flex; flex-direction: column; align-items: center; justify-content: center">
										<span class="ring-pct" style="color: {meta.color}">{pct}%</span>
									</div>
									<div class="ring-label">{meta.label}</div>
									<div class="ring-count">{count}/{meta.totalCards}</div>
								</div>
							{/each}
						</div>
					</div>

					<!-- Recent Activity -->
					{#if true}
						{@const days = recentDays()}
						{@const maxD = Math.max(...days.map(d => d.count), 1)}
						{@const dayLabels = ['Today', '1d', '2d', '3d', '4d', '5d', '6d']}
						<div class="panel">
							<div class="panel-title">Recent Scans</div>
							<div class="activity-bars">
								{#each days as d, i}
									<div class="activity-col">
										<div
											class="activity-bar"
											style="
												height: {Math.max(4, (d.count / maxD) * 40)}px;
												background: {d.day === 0
													? 'linear-gradient(180deg, #3b82f6, #6366f1)'
													: `rgba(59, 130, 246, ${0.2 + (1 - d.day / 7) * 0.4})`};
											"
										></div>
										<span class="activity-day">{dayLabels[i]}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Power Distribution -->
					{#if true}
						{@const buckets = powerBuckets()}
						{@const maxC = Math.max(...buckets.map(b => b.count), 1)}
						{@const svgW = 280}
						{@const svgH = 100}
						{@const barW = svgW / buckets.length - 2}
						<div class="panel">
							<div class="panel-title">Power Distribution</div>
							<svg class="power-svg" viewBox="0 0 {svgW} {svgH + 20}">
								{#each buckets as b, i}
									{@const barH = (b.count / maxC) * svgH}
									{@const x = i * (barW + 2)}
									{@const hue = ((b.power - 80) / 120) * 240}
									<rect {x} y={svgH - barH} width={barW} height={barH} rx="3"
										fill="hsl({hue}, 70%, 55%)" opacity="0.85" />
									{#if b.count > 0}
										<text x={x + barW / 2} y={svgH - barH - 4} text-anchor="middle"
											fill="#94a3b8" font-size="8" font-weight="600">{b.count}</text>
									{/if}
									<text x={x + barW / 2} y={svgH + 12} text-anchor="middle"
										fill="#475569" font-size="7">{b.power}</text>
								{/each}
							</svg>
						</div>
					{/if}

					<!-- Top 5 Most Valuable -->
					<div class="panel">
						<div class="panel-title">💎 Most Valuable</div>
						<div class="top-list">
							{#each topCards as card, i}
								{@const wt = card.card?.weapon_type ?? 'steel'}
								<div class="top-row" style="animation-delay: {i * 0.1}s">
									<div class="top-rank" class:gold={i === 0} class:default={i > 0}>{i + 1}</div>
									<div class="top-info">
										<div class="top-name">{card.card?.hero_name ?? card.card?.name ?? 'Unknown'}</div>
										<div class="top-meta" style="color: {wColor(wt)}">
											{getWeapon(wt)?.name ?? wt} &middot; {card.card?.power ?? '?'}
										</div>
									</div>
									<div class="top-value">${cardValue(card).toFixed(2)}</div>
								</div>
							{/each}
							{#if topCards.length === 0}
								<div style="text-align: center; color: #475569; font-size: 0.75rem; padding: 1rem">
									No cards in collection yet
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}

			<!-- ════════ Cards Tab ════════ -->
			{#if activeTab === 'cards'}
				<div style="animation: countUp 0.3s ease-out">
					<!-- Weapon filter chips -->
					<div class="filter-chips">
						<button
							class="chip"
							style="background: {!filterWeapon ? '#3b82f6' : '#1e293b'}; color: {!filterWeapon ? '#fff' : '#64748b'}"
							onclick={() => filterWeapon = null}
						>All</button>
						{#each WEAPON_HIERARCHY.slice(0, 8) as w}
							<button
								class="chip"
								style="background: {filterWeapon === w.key ? `${w.color}33` : '#1e293b'}; color: {filterWeapon === w.key ? w.color : '#64748b'}"
								onclick={() => filterWeapon = filterWeapon === w.key ? null : w.key}
							>
								{wIcon(w.key)} {w.name}
							</button>
						{/each}
					</div>

					{#if true}
					{@const filtered = filteredCards()}
					<div class="cards-count">{filtered.length} cards &middot; sorted by power</div>

					<div class="card-list">
						{#each filtered.slice(0, 30) as item, i}
							{@const card = item.card}
							{@const wt = card?.weapon_type ?? 'steel'}
							{@const color = wColor(wt)}
							{@const w = getWeapon(wt)}
							{@const isSpecial = card?.parallel && !['base', 'paper', ''].includes(card.parallel.toLowerCase())}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="card-preview"
								style="
									background: linear-gradient(135deg, {color}15, #0f172a 60%);
									border-color: {color}44;
									box-shadow: {(w?.rank ?? 8) <= 2 ? `0 0 12px ${color}33` : '0 2px 8px rgba(0,0,0,0.3)'};
									animation: slideIn 0.2s ease-out {Math.min(i * 0.03, 0.5)}s both;
								"
								onclick={() => selectedItem = item}
							>
								<div class="cp-top">
									<div>
										<div class="cp-name">{card?.hero_name ?? card?.name ?? 'Unknown'}</div>
										<div class="cp-sub">{card?.card_number ?? ''} &middot; {card?.set_code ?? ''}</div>
									</div>
									<div
										class="cp-power"
										style="color: {color}; text-shadow: {(w?.rank ?? 8) <= 4 ? `0 0 8px ${color}` : 'none'}"
									>
										{card?.power ?? '?'}
									</div>
								</div>
								<div class="cp-badges">
									<span class="cp-badge" style="color: {color}; background: {color}15">
										{wIcon(wt)} {w?.name ?? wt}
									</span>
									{#if isSpecial}
										<span class="cp-parallel" style="color: #fbbf24; background: #fbbf2415">
											{card?.parallel}
										</span>
									{/if}
									{#if cardValue(item) > 0}
										<span class="cp-price">${cardValue(item).toFixed(2)}</span>
									{/if}
								</div>
							</div>
						{/each}
						{#if filtered.length > 30}
							<div class="more-cards">+ {filtered.length - 30} more cards</div>
						{/if}
						{#if filtered.length === 0}
							<div class="more-cards">No cards found</div>
						{/if}
					</div>
					{/if}
				</div>
			{/if}

			<!-- ════════ Weapons Tab ════════ -->
			{#if activeTab === 'weapons'}
				<div style="animation: countUp 0.3s ease-out">
					<!-- Weapon distribution bars -->
					<div class="panel">
						<div class="panel-title">Weapon Distribution</div>
						{#each WEAPON_HIERARCHY.slice(0, 8) as w}
							{@const count = weaponCounts()[w.key] ?? 0}
							{@const pct = items.length > 0 ? (count / items.length * 100) : 0}
							<div class="weapon-row">
								<span class="weapon-icon">{wIcon(w.key)}</span>
								<span class="weapon-name" style="color: {w.color}">{w.name}</span>
								<div class="weapon-track">
									<div
										class="weapon-fill"
										style="
											width: {maxWeaponCount > 0 ? (count / maxWeaponCount * 100) : 0}%;
											background: linear-gradient(90deg, {w.color}88, {w.color});
											box-shadow: {w.rank <= 4 ? `0 0 8px ${w.color}66` : 'none'};
										"
									></div>
									<span class="weapon-count">{count}</span>
								</div>
								<span class="weapon-pct">{pct.toFixed(1)}%</span>
							</div>
						{/each}
					</div>

					<!-- Rarity breakdown -->
					<div class="panel" style="margin-top: 1rem">
						<div class="panel-title">Rarity Breakdown</div>
						{#each RARITY_TIERS as t}
							{@const count = t.keys.reduce((s, k) => s + (weaponCounts()[k] ?? 0), 0)}
							{@const pct = items.length > 0 ? ((count / items.length) * 100).toFixed(1) : '0.0'}
							<div class="rarity-row" style="background: {t.bg}">
								<div>
									<div class="rarity-name" style="color: {t.color}">{t.tier}</div>
									<div class="rarity-sub">
										{t.keys.map(k => wIcon(k)).join(' ')}
										{t.keys.map(k => getWeapon(k)?.name ?? k).join(' · ')}
									</div>
								</div>
								<div style="text-align: right">
									<div class="rarity-count" style="color: {t.color}">{count}</div>
									<div class="rarity-pct">{pct}%</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<CardDetail item={selectedItem} ebayConnected={false} onClose={() => { selectedItem = null; }} />

	<div class="footer">boba.cards &mdash; Collection Dashboard</div>
</div>

<style>
	/* ── Layout ───────────────────────────────────── */
	.collection-page { max-width: 480px; margin: 0 auto; padding: 0; }

	/* ── Header ───────────────────────────────────── */
	.dash-header {
		padding: 1rem 1rem 0; display: flex; justify-content: space-between; align-items: center;
	}
	.dash-header .label {
		font-size: 0.75rem; color: #64748b; letter-spacing: 2px; text-transform: uppercase;
	}
	.dash-header h1 {
		font-size: 1.5rem; font-weight: 900; margin: 2px 0 0;
		background: linear-gradient(135deg, #60a5fa, #a78bfa);
		-webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
	}
	.dash-header .value-block { text-align: right; }
	.dash-header .total-value { font-size: 1.375rem; font-weight: 900; color: #10b981; }
	.dash-header .value-label { font-size: 0.625rem; color: #64748b; }

	/* ── Tabs ─────────────────────────────────────── */
	.tabs { display: flex; gap: 4px; padding: 0.75rem 1rem; overflow-x: auto; }
	.tab-btn {
		padding: 0.5rem 1rem; border-radius: 10px; border: none; cursor: pointer;
		font-size: 0.8125rem; font-weight: 600; white-space: nowrap; transition: all 0.2s;
	}
	.tab-btn.active { background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff; }
	.tab-btn:not(.active) { background: #1e293b; color: #64748b; }

	/* ── Tab content ──────────────────────────────── */
	.tab-content { padding: 0 1rem 1.5rem; }

	.collection-actions {
		display: flex;
		gap: 0.5rem;
		padding: 0 1rem 0.75rem;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
	}
	.collection-actions::-webkit-scrollbar { display: none; }

	.action-chip {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.75rem;
		border-radius: 20px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-secondary);
		font-size: 0.75rem;
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
		flex-shrink: 0;
		transition: border-color var(--transition-fast), background var(--transition-fast);
	}
	.action-chip:hover {
		border-color: var(--border-strong);
		background: var(--bg-elevated);
	}
	.action-icon { font-size: 0.85rem; }

	/* ── Stat cards ───────────────────────────────── */
	.stat-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
	.stat-card {
		background: #0f172a; border-radius: 12px; padding: 0.75rem 0.625rem;
		text-align: center; border: 1px solid #1e293b;
	}
	.stat-card .stat-value { font-size: 1.375rem; font-weight: 900; }
	.stat-card .stat-label { font-size: 0.625rem; color: #64748b; margin-top: 2px; }

	/* ── Panels (shared card style) ───────────────── */
	.panel {
		background: #0f172a; border-radius: 14px; padding: 1rem; border: 1px solid #1e293b;
	}
	.panel-title { font-size: 0.8125rem; font-weight: 700; color: #94a3b8; margin-bottom: 0.75rem; }
	.sections { display: flex; flex-direction: column; gap: 1rem; }

	/* ── Completion rings ─────────────────────────── */
	.ring-row { display: flex; justify-content: space-around; }
	.ring-cell { text-align: center; }
	.ring-pct { font-size: 1.125rem; font-weight: 800; }
	.ring-label { font-size: 0.6875rem; color: #94a3b8; margin-top: 0.25rem; font-weight: 600; }
	.ring-count { font-size: 0.625rem; color: #475569; }

	/* ── Activity bars ────────────────────────────── */
	.activity-bars { display: flex; gap: 4px; align-items: flex-end; height: 50px; margin-bottom: 0.5rem; }
	.activity-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; }
	.activity-bar { width: 100%; border-radius: 4px; transition: height 0.5s ease; }
	.activity-day { font-size: 0.5rem; color: #475569; }

	/* ── Power curve SVG ──────────────────────────── */
	.power-svg { width: 100%; overflow: visible; }

	/* ── Top cards list ───────────────────────────── */
	.top-list { display: flex; flex-direction: column; gap: 0.5rem; }
	.top-row {
		display: flex; align-items: center; gap: 0.625rem;
		animation: slideIn 0.3s ease-out both;
	}
	.top-rank {
		width: 24px; height: 24px; border-radius: 6px; display: flex;
		align-items: center; justify-content: center;
		font-size: 0.75rem; font-weight: 800;
	}
	.top-rank.gold { background: linear-gradient(135deg, #ffd700, #f59e0b); color: #000; }
	.top-rank.default { background: #1e293b; color: #64748b; }
	.top-info { flex: 1; }
	.top-name { font-size: 0.75rem; font-weight: 600; }
	.top-meta { font-size: 0.625rem; }
	.top-value { font-size: 0.875rem; font-weight: 800; color: #10b981; }

	/* ── Weapon bar chart ─────────────────────────── */
	.weapon-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
	.weapon-icon { width: 24px; text-align: center; font-size: 0.875rem; }
	.weapon-name { width: 45px; font-size: 0.6875rem; font-weight: 600; }
	.weapon-track { flex: 1; height: 16px; background: #0f172a; border-radius: 8px; overflow: hidden; position: relative; }
	.weapon-fill { height: 100%; border-radius: 8px; transition: width 1s cubic-bezier(0.4, 0, 0.2, 1); }
	.weapon-count {
		position: absolute; right: 6px; top: 0; height: 100%;
		display: flex; align-items: center;
		font-size: 0.625rem; font-weight: 700; color: #e2e8f0;
	}
	.weapon-pct { width: 35px; font-size: 0.625rem; color: #64748b; text-align: right; }

	/* ── Rarity breakdown ─────────────────────────── */
	.rarity-row {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.625rem 0.75rem; margin-bottom: 6px; border-radius: 10px;
	}
	.rarity-name { font-size: 0.8125rem; font-weight: 700; }
	.rarity-sub { font-size: 0.625rem; color: #64748b; }
	.rarity-count { font-size: 1.125rem; font-weight: 900; }
	.rarity-pct { font-size: 0.625rem; color: #64748b; }

	/* ── Card filter chips ────────────────────────── */
	.filter-chips { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 0.75rem; }
	.chip {
		padding: 5px 10px; border-radius: 8px; border: none; cursor: pointer;
		font-size: 0.6875rem; font-weight: 600; transition: all 0.15s;
	}
	.cards-count { font-size: 0.75rem; color: #475569; margin-bottom: 0.5rem; }

	/* ── Card preview items ───────────────────────── */
	.card-list { display: flex; flex-direction: column; gap: 0.5rem; max-height: 500px; overflow-y: auto; }
	.card-preview {
		border-radius: 10px; padding: 0.625rem 0.75rem; cursor: pointer;
		transition: transform 0.15s, box-shadow 0.2s;
		border-width: 1px; border-style: solid;
	}
	.card-preview:active { transform: translateY(-2px); }
	.card-preview .cp-top { display: flex; justify-content: space-between; align-items: flex-start; }
	.card-preview .cp-name { font-size: 0.8125rem; font-weight: 700; color: #e2e8f0; line-height: 1.2; }
	.card-preview .cp-sub { font-size: 0.625rem; color: #64748b; margin-top: 2px; }
	.card-preview .cp-power { font-size: 1.125rem; font-weight: 900; }
	.card-preview .cp-badges { display: flex; gap: 6px; margin-top: 6px; align-items: center; }
	.cp-badge {
		font-size: 0.5625rem; font-weight: 700; text-transform: uppercase;
		padding: 2px 6px; border-radius: 4px; letter-spacing: 0.5px;
	}
	.cp-parallel {
		font-size: 0.5625rem; font-weight: 600; font-style: italic;
		padding: 2px 6px; border-radius: 4px;
	}
	.cp-price { margin-left: auto; font-size: 0.6875rem; font-weight: 700; color: #10b981; }
	.more-cards { text-align: center; padding: 0.75rem; color: #475569; font-size: 0.75rem; }

	/* ── Footer ───────────────────────────────────── */
	.footer { text-align: center; padding: 0 1rem 1rem; font-size: 0.6875rem; color: #1e293b; }

	/* ── Keyframes ────────────────────────────────── */
	@keyframes countUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
	@keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
</style>
