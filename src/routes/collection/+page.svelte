<script lang="ts">
	import { onMount } from 'svelte';
	import CardDetail from '$lib/components/CardDetail.svelte';
	import SkeletonCardGrid from '$lib/components/SkeletonCardGrid.svelte';
	import OverviewTab from '$lib/components/collection/OverviewTab.svelte';
	import WeaponsTab from '$lib/components/collection/WeaponsTab.svelte';
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

	const WEAPON_ICONS: Record<string, string> = {
		super: '👑', gum: '🫧', hex: '💀', glow: '☢️',
		fire: '🔥', ice: '❄️', steel: '🛡️', brawl: '👊',
		alt: '🎭', cyber: '🔮',
	};

	let selectedItem = $state<CollectionItem | null>(null);
	let activeTab = $state<'overview' | 'cards' | 'weapons'>('overview');
	let filterWeapon = $state<string | null>(null);

	onMount(() => { loadCollection(); });

	// Batch-fetch prices
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

	const items = $derived(collectionItems());
	const prices = $derived(priceCache());

	function cardValue(item: CollectionItem): number {
		const p = prices.get(item.card_id);
		return p?.price_mid ?? 0;
	}

	const totalValue = $derived(items.reduce((s, i) => s + cardValue(i) * (i.quantity || 1), 0));
	const avgPower = $derived(items.length > 0 ? Math.round(items.reduce((s, i) => s + (i.card?.power ?? 0), 0) / items.length) : 0);
	const parallelCount = $derived(items.filter(i => { const p = (i.card?.parallel ?? '').toLowerCase(); return p !== '' && p !== 'base' && p !== 'paper'; }).length);
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
		const SET_KEYS = ['G', 'A', 'U'];
		const counts: Record<string, number> = {};
		for (const key of SET_KEYS) counts[key] = 0;
		for (const item of items) {
			const sc = item.card?.set_code;
			if (sc && counts[sc] !== undefined) counts[sc]++;
		}
		return counts;
	});

	const topCards = $derived([...items].sort((a, b) => cardValue(b) - cardValue(a)).slice(0, 5));

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

	const filteredCards = $derived(() => {
		let result = [...items];
		if (filterWeapon) result = result.filter(i => i.card?.weapon_type?.toLowerCase() === filterWeapon);
		return result.sort((a, b) => (b.card?.power ?? 0) - (a.card?.power ?? 0));
	});

	function wColor(weaponKey: string): string {
		return getWeapon(weaponKey)?.color ?? '#9CA3AF';
	}
	function wIcon(weaponKey: string): string {
		return WEAPON_ICONS[weaponKey.toLowerCase()] ?? '⚔️';
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
			<a href="/set-completion" class="action-chip"><span class="action-icon">📊</span><span>Set Progress</span></a>
			<a href="/organize" class="action-chip"><span class="action-icon">📁</span><span>Organize</span></a>
			<a href="/sell" class="action-chip"><span class="action-icon">💰</span><span>Sell</span></a>
			<a href="/export" class="action-chip"><span class="action-icon">📤</span><span>Export</span></a>
			<a href="/leaderboard" class="action-chip"><span class="action-icon">🏆</span><span>Leaderboard</span></a>
			<a href="/marketplace/monitor" class="action-chip"><span class="action-icon">🔍</span><span>Market</span></a>
		</div>

		<div class="tab-content">
			{#if activeTab === 'overview'}
				<OverviewTab
					{items}
					{avgPower}
					{parallelCount}
					{highPowerCount}
					setCounts={setCounts()}
					recentDays={recentDays()}
					powerBuckets={powerBuckets()}
					{topCards}
					{cardValue}
				/>
			{/if}

			<!-- ════════ Cards Tab ════════ -->
			{#if activeTab === 'cards'}
				<div style="animation: countUp 0.3s ease-out">
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
									<div class="cp-power" style="color: {color}; text-shadow: {(w?.rank ?? 8) <= 4 ? `0 0 8px ${color}` : 'none'}">{card?.power ?? '?'}</div>
								</div>
								<div class="cp-badges">
									<span class="cp-badge" style="color: {color}; background: {color}15">{wIcon(wt)} {w?.name ?? wt}</span>
									{#if isSpecial}
										<span class="cp-parallel" style="color: #fbbf24; background: #fbbf2415">{card?.parallel}</span>
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

			{#if activeTab === 'weapons'}
				<WeaponsTab
					{items}
					weaponCounts={weaponCounts()}
					{maxWeaponCount}
				/>
			{/if}
		</div>
	{/if}

	<CardDetail item={selectedItem} ebayConnected={false} onClose={() => { selectedItem = null; }} />

	<div class="footer">boba.cards &mdash; Collection Dashboard</div>
</div>

<style>
	.collection-page { max-width: 480px; margin: 0 auto; padding: 0; }
	.dash-header { padding: 1rem 1rem 0; display: flex; justify-content: space-between; align-items: center; }
	.dash-header .label { font-size: 0.75rem; color: #64748b; letter-spacing: 2px; text-transform: uppercase; }
	.dash-header h1 {
		font-size: 1.5rem; font-weight: 900; margin: 2px 0 0;
		background: linear-gradient(135deg, #60a5fa, #a78bfa);
		-webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
	}
	.dash-header .value-block { text-align: right; }
	.dash-header .total-value { font-size: 1.375rem; font-weight: 900; color: #10b981; }
	.dash-header .value-label { font-size: 0.625rem; color: #64748b; }
	.tabs { display: flex; gap: 4px; padding: 0.75rem 1rem; overflow-x: auto; }
	.tab-btn { padding: 0.5rem 1rem; border-radius: 10px; border: none; cursor: pointer; font-size: 0.8125rem; font-weight: 600; white-space: nowrap; transition: all 0.2s; }
	.tab-btn.active { background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff; }
	.tab-btn:not(.active) { background: #1e293b; color: #64748b; }
	.tab-content { padding: 0 1rem 1.5rem; }
	.collection-actions {
		display: flex; gap: 0.5rem; padding: 0 1rem 0.75rem; overflow-x: auto;
		-webkit-overflow-scrolling: touch; scrollbar-width: none;
	}
	.collection-actions::-webkit-scrollbar { display: none; }
	.action-chip {
		display: flex; align-items: center; gap: 0.35rem; padding: 0.4rem 0.75rem; border-radius: 20px;
		border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-secondary);
		font-size: 0.75rem; font-weight: 500; text-decoration: none; white-space: nowrap; flex-shrink: 0;
		transition: border-color var(--transition-fast), background var(--transition-fast);
	}
	.action-chip:hover { border-color: var(--border-strong); background: var(--bg-elevated); }
	.action-icon { font-size: 0.85rem; }
	.filter-chips { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 0.75rem; }
	.chip { padding: 5px 10px; border-radius: 8px; border: none; cursor: pointer; font-size: 0.6875rem; font-weight: 600; transition: all 0.15s; }
	.cards-count { font-size: 0.75rem; color: #475569; margin-bottom: 0.5rem; }
	.card-list { display: flex; flex-direction: column; gap: 0.5rem; max-height: 500px; overflow-y: auto; }
	.card-preview { border-radius: 10px; padding: 0.625rem 0.75rem; cursor: pointer; transition: transform 0.15s, box-shadow 0.2s; border-width: 1px; border-style: solid; }
	.card-preview:active { transform: translateY(-2px); }
	.card-preview .cp-top { display: flex; justify-content: space-between; align-items: flex-start; }
	.card-preview .cp-name { font-size: 0.8125rem; font-weight: 700; color: #e2e8f0; line-height: 1.2; }
	.card-preview .cp-sub { font-size: 0.625rem; color: #64748b; margin-top: 2px; }
	.card-preview .cp-power { font-size: 1.125rem; font-weight: 900; }
	.card-preview .cp-badges { display: flex; gap: 6px; margin-top: 6px; align-items: center; }
	.cp-badge { font-size: 0.5625rem; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.5px; }
	.cp-parallel { font-size: 0.5625rem; font-weight: 600; font-style: italic; padding: 2px 6px; border-radius: 4px; }
	.cp-price { margin-left: auto; font-size: 0.6875rem; font-weight: 700; color: #10b981; }
	.more-cards { text-align: center; padding: 0.75rem; color: #475569; font-size: 0.75rem; }
	.footer { text-align: center; padding: 0 1rem 1rem; font-size: 0.6875rem; color: #1e293b; }
	@keyframes countUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
	@keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
</style>
