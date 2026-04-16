<script lang="ts">
	import { onMount } from 'svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { getSupabase } from '$lib/services/supabase';
	import { DEFAULT_CONFIGS, getBoxConfig } from '$lib/data/pack-defaults';
	import { loadCardDatabase } from '$lib/services/card-db';
	import { getWeapon } from '$lib/data/boba-weapons';
	import type { SlotConfig, SimulatedCard, PackResult, BoxGuarantee } from '$lib/types/pack-simulator';
	import PackCardReveal from '$lib/components/packs/PackCardReveal.svelte';
	import BoxSummary from '$lib/components/packs/BoxSummary.svelte';

	const SET_OPTIONS = [
		{ key: 'G', label: '2026 Griffey Set' },
		{ key: 'A', label: 'Alpha Edition' },
		{ key: 'U', label: 'Alpha Update' },
	];

	const PARALLEL_COLORS: Record<string, string> = {
		silver: '#c0c0c0', blue_battlefoil: '#60a5fa', orange_battlefoil: '#f97316',
		green_battlefoil: '#22c55e', pink_battlefoil: '#f472b6', red_battlefoil: '#ef4444',
		blizzard: '#67e8f9', '80s_rad': '#f472b6', headliner: '#fbbf24',
		power_glove: '#a855f7', mixtape: '#34d399', slime: '#22c55e',
		inspired_ink: '#ffd700', super_parallel: '#ffd700', bubblegum: '#ff69b4',
		miami_ice: '#06b6d4', fire_tracks: '#ef4444', icon: '#c084fc',
		colosseum: '#d97706', logo: '#60a5fa', grillin: '#f97316', chillin: '#3b82f6',
		alpha: '#a78bfa', battlefoil: '#60a5fa', cj_maddox: '#34d399',
		blue_headliner: '#60a5fa', orange_headliner: '#f97316', red_headliner: '#ef4444',
		metallic_inspired_ink: '#ffd700', alt: '#a78bfa',
	};

	let selectedSet = $state('G');
	let selectedBox = $state('blaster');
	let slots = $state<SlotConfig[]>([]);
	let packsPerBox = $state(6);
	let guarantees = $state<BoxGuarantee[]>([]);
	let loading = $state(true);
	let dbLoaded = $state(false);

	let currentPack = $state<PackResult | null>(null);
	let revealedSet = $state<Set<number>>(new Set());
	let autoRevealing = $state(false);
	let boxResults = $state<PackResult[]>([]);
	let showBoxSummary = $state(false);
	let shaking = $state(false);
	let packCount = $state(0);
	let selectedCard = $state<SimulatedCard | null>(null);
	let failedImages = $state<Set<string>>(new Set());

	function onImageError(cardId: string) {
		failedImages = new Set([...failedImages, cardId]);
	}

	const availableBoxTypes = $derived(
		Object.entries(DEFAULT_CONFIGS)
			.filter(([, config]) => config.availableForSets.includes(selectedSet))
			.map(([key, config]) => ({ key, label: config.displayName }))
	);
	const allRevealed = $derived(currentPack != null && revealedSet.size === currentPack.cards.length);
	const unrevealedCount = $derived(currentPack ? currentPack.cards.length - revealedSet.size : 0);

	function rarityColor(weapon: string): string {
		return getWeapon(weapon)?.color || '#9CA3AF';
	}

	function parallelColor(card: SimulatedCard): string {
		return PARALLEL_COLORS[card.parallel.toLowerCase()] || '#a78bfa';
	}

	onMount(async () => {
		await loadCardDatabase();
		dbLoaded = true;
		await loadConfig();
		loading = false;
	});

	async function loadConfig() {
		const client = getSupabase();
		if (client) {
			try {
				const { data } = await client.from('pack_configurations').select('*').eq('box_type', selectedBox).eq('is_active', true).limit(1).maybeSingle();
				if (data?.slots) {
					const defaultConfig = getBoxConfig(selectedBox, selectedSet);
					slots = (data.slots as unknown as SlotConfig[]).map((slot: SlotConfig, i: number) => ({
						...slot,
						cardFormat: slot.cardFormat || defaultConfig?.slots[i]?.cardFormat || 'any'
					}));
					packsPerBox = data.packs_per_box || defaultConfig?.packsPerBox || 10;
					guarantees = (data.box_guarantees as unknown as BoxGuarantee[]) || defaultConfig?.guarantees || [];
					return;
				}
			} catch { /* Fall through to defaults */ }
		}
		const config = getBoxConfig(selectedBox, selectedSet);
		if (config) { slots = config.slots; packsPerBox = config.packsPerBox; guarantees = config.guarantees; }
	}

	function handleSetChange() {
		const available = Object.entries(DEFAULT_CONFIGS).filter(([, config]) => config.availableForSets.includes(selectedSet)).map(([key]) => key);
		if (!available.includes(selectedBox)) selectedBox = 'blaster';
		handleBoxChange();
	}

	async function handleBoxChange() {
		loading = true; currentPack = null; boxResults = []; showBoxSummary = false;
		await loadConfig(); loading = false;
	}

	async function openSinglePack() {
		if (!dbLoaded) { showToast('Card database still loading...', 'x'); return; }
		shaking = true;
		setTimeout(async () => {
			const { openPack } = await import('$lib/services/pack-simulator');
			currentPack = openPack(slots, selectedSet);
			revealedSet = new Set(); autoRevealing = false; showBoxSummary = false; packCount++; shaking = false;
		}, 500);
	}

	async function openFullBox() {
		if (!dbLoaded) { showToast('Card database still loading...', 'x'); return; }
		const { openBox } = await import('$lib/services/pack-simulator');
		boxResults = openBox(slots, packsPerBox, selectedSet, guarantees);
		showBoxSummary = true; currentPack = null; packCount += packsPerBox;
	}

	function revealCard(index: number) { if (!revealedSet.has(index)) revealedSet = new Set([...revealedSet, index]); }
	function revealNext() { if (!currentPack) return; const next = currentPack.cards.findIndex((_, i) => !revealedSet.has(i)); if (next >= 0) revealCard(next); }
	function revealAll() {
		if (!currentPack || autoRevealing) return;
		autoRevealing = true;
		const unrevealed = currentPack.cards.map((_, i) => i).filter(i => !revealedSet.has(i));
		unrevealed.forEach((idx, i) => { setTimeout(() => { revealCard(idx); if (i === unrevealed.length - 1) autoRevealing = false; }, (i + 1) * 250); });
	}
</script>

<svelte:head>
	<title>Pack Simulator - Card Scanner</title>
</svelte:head>

<div class="packs-page">
	<header class="page-header">
		<div class="header-label">BoBA Scanner</div>
		<h1>Pack Simulator</h1>
		{#if packCount > 0}<div class="pack-counter">Packs opened: {packCount}</div>{/if}
	</header>

	<div class="set-selector">
		<span class="selector-label">Set</span>
		<div class="set-buttons">
			{#each SET_OPTIONS as setOpt}
				<button class="set-btn" class:active={selectedSet === setOpt.key} onclick={() => { selectedSet = setOpt.key; handleSetChange(); }}>{setOpt.label}</button>
			{/each}
		</div>
	</div>

	<div class="box-selector">
		{#each availableBoxTypes as box}
			<button class="box-btn" class:active={selectedBox === box.key} onclick={() => { selectedBox = box.key; handleBoxChange(); }}>{box.label}</button>
		{/each}
	</div>

	{#if loading}
		<div class="loading">Loading pack configuration...</div>
	{:else}
		{#if !currentPack && !showBoxSummary}
			<div class="pack-display">
				<div class="pack-visual-box" class:shaking>
					<span class="pack-emoji">🎴</span>
					<span class="pack-brand">BoBA</span>
					<span class="pack-type-label">{(availableBoxTypes.find(b => b.key === selectedBox)?.label ?? '').toUpperCase()}</span>
				</div>
				<div class="pack-info">{packsPerBox} packs per box &mdash; 10 cards per pack</div>
				{#if guarantees.length > 0}
					<div class="pack-guarantees">
						{#each guarantees as g}<span class="guarantee-badge">{g.minCount}x {g.value.replace(/_/g, ' ')} guaranteed</span>{/each}
					</div>
				{/if}
				<div class="open-actions">
					<button class="btn-primary" onclick={openSinglePack}>Rip a Pack 🔥</button>
					<button class="btn-secondary" onclick={openFullBox}>Open Full Box ({packsPerBox} packs)</button>
				</div>
			</div>
		{/if}

		{#if currentPack}
			<div class="pack-opening">
				<div class="cards-grid">
					{#each currentPack.cards as card, i}
						<PackCardReveal
							{card}
							revealed={revealedSet.has(i)}
							failedImage={failedImages.has(card.cardId)}
							onReveal={() => revealCard(i)}
							onSelect={() => (selectedCard = card)}
							onImageError={() => onImageError(card.cardId)}
						/>
					{/each}
				</div>

				<div class="reveal-controls">
					{#if !allRevealed}
						<button class="btn-reveal" onclick={revealNext}>Tap to Reveal ({unrevealedCount} left)</button>
						{#if !autoRevealing && unrevealedCount > 1}
							<button class="btn-text" onclick={revealAll}>Reveal All</button>
						{/if}
					{:else}
						{#if currentPack.bestCard}
							{@const best = currentPack.bestCard}
							{@const bestColor = rarityColor(best.weaponType)}
							{@const bestW = getWeapon(best.weaponType)}
							<div class="best-pull-card" style="background: {bestColor}11; border-color: {bestColor}44">
								<div class="label">Best Pull</div>
								<div class="value" style="color: {bestColor}">
									{best.heroName} &mdash; {bestW?.name?.toUpperCase() ?? best.weaponType.toUpperCase()}
									{#if best.power} {best.power}{/if}
								</div>
								{#if best.parallel && best.parallel !== 'base' && best.parallel !== 'paper'}
									<div class="parallel-note">{best.parallel.replace(/_/g, ' ')}</div>
								{/if}
							</div>
						{/if}
						{#if currentPack.totalValue > 0}
							<div class="pack-ev-card">
								<div class="pack-ev-label">Simulated Pack Value</div>
								<div class="pack-ev-value">${currentPack.totalValue.toFixed(2)}</div>
								<div class="pack-ev-disclaimer">
									Hypothetical simulation only — not a prediction of real pack value.
									Based on current eBay market prices for the specific cards pulled in this simulation.
								</div>
							</div>
						{/if}
						<div class="post-actions">
							<button class="btn-primary" onclick={openSinglePack}>Open Another Pack 🔥</button>
							<button class="btn-secondary" onclick={openFullBox}>Open Full Box</button>
							<button class="btn-text" onclick={() => { currentPack = null; }}>Back</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if showBoxSummary && boxResults.length > 0}
			<BoxSummary
				{boxResults}
				onOpenSingle={openSinglePack}
				onOpenBox={openFullBox}
				onBack={() => { showBoxSummary = false; boxResults = []; }}
				onSelectCard={(card) => (selectedCard = card)}
			/>
		{/if}
	{/if}

	<!-- Card Detail Modal -->
	{#if selectedCard}
		{@const card = selectedCard}
		{@const isHotDog = card.outcomeValue === 'hotdog' || card.slotLabel.toLowerCase().includes('hot dog')}
		{@const isPlay = card.outcomeType === 'card_type' && card.outcomeValue === 'play'}
		{@const isBonusPlay = card.outcomeType === 'card_type' && card.outcomeValue === 'bonus_play'}
		{@const isHero = !isHotDog && !isPlay && !isBonusPlay}
		{@const borderColor = isHotDog ? '#f59e0b' : isPlay || isBonusPlay ? '#3b82f6' : rarityColor(card.weaponType)}
		{@const rarity = getWeapon(card.weaponType)?.rarity || 'common'}
		{@const wColor = rarityColor(card.weaponType)}
		{@const w = isHero ? getWeapon(card.weaponType) : null}
		{@const isSpecialParallel = !['base', 'paper', 'battlefoil', ''].includes(card.parallel.toLowerCase())}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-overlay" onclick={() => (selectedCard = null)}>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="modal-card" onclick={(e) => e.stopPropagation()} style="border-color: {borderColor}; --modal-accent: {borderColor};">
				<button class="modal-close" onclick={() => (selectedCard = null)}>&times;</button>
				<div class="modal-type-badge" style="background: {borderColor}22; color: {borderColor}">
					{#if isHotDog}Hot Dog{:else if isBonusPlay}Bonus Play{:else if isPlay}Play Card{:else}Hero Card{/if}
				</div>
				<div class="modal-icon">
					{#if isHotDog}<span style="font-size: 3rem">🌭</span>
					{:else if isPlay || isBonusPlay}<span style="font-size: 3rem">{isBonusPlay ? '⚡' : '📜'}</span>
					{:else if card.imageUrl && !failedImages.has(card.cardId)}
						<img src={card.imageUrl} alt={card.heroName} class="modal-card-image" onerror={() => onImageError(card.cardId)} />
					{:else}
						<div class="modal-power-circle" style="border-color: {wColor}; box-shadow: 0 0 20px {wColor}44">
							{#if card.power}<span class="modal-power" style="color: {wColor}">{card.power}</span>{/if}
						</div>
					{/if}
				</div>
				<h2 class="modal-name" style="color: {isHotDog ? '#fbbf24' : isPlay || isBonusPlay ? '#93c5fd' : '#e2e8f0'}">{card.heroName}</h2>
				<div class="modal-card-number">{card.cardNumber}</div>
				<div class="modal-details">
					{#if isHero && w}<div class="modal-detail-row"><span class="modal-detail-label">Weapon</span><span class="modal-detail-value" style="color: {wColor}">{w.name}</span></div>{/if}
					{#if isHero && rarity}<div class="modal-detail-row"><span class="modal-detail-label">Rarity</span><span class="modal-detail-value" style="color: {wColor}; text-transform: capitalize">{rarity.replace(/_/g, ' ')}</span></div>{/if}
					{#if isSpecialParallel}<div class="modal-detail-row"><span class="modal-detail-label">Parallel</span><span class="modal-detail-value" style="color: {parallelColor(card)}; text-transform: capitalize">{card.parallel.replace(/_/g, ' ')}</span></div>{/if}
					<div class="modal-detail-row"><span class="modal-detail-label">Set</span><span class="modal-detail-value">{card.setCode}</span></div>
					<div class="modal-detail-row"><span class="modal-detail-label">Slot</span><span class="modal-detail-value">{card.slotLabel}</span></div>
				</div>
				{#if rarity === 'legendary' || rarity === 'ultra_rare' || isSpecialParallel}
					<div class="modal-glow" style="background: radial-gradient(ellipse at center, {borderColor}22 0%, transparent 70%)"></div>
				{/if}
			</div>
		</div>
	{/if}

	<div class="footer">boba.cards &mdash; AI Card Detection</div>
</div>

<style>
	.packs-page { max-width: 440px; margin: 0 auto; padding: 1rem; min-height: 100vh; }
	.loading { text-align: center; padding: 3rem; color: var(--text-tertiary); }
	.page-header { text-align: center; margin-bottom: 1.25rem; animation: floatIn 0.5s ease-out; }
	.header-label { font-size: 0.75rem; color: var(--text-tertiary); letter-spacing: 3px; text-transform: uppercase; font-weight: 600; }
	h1 { font-size: 1.75rem; font-weight: 900; margin: 0.25rem 0; background: linear-gradient(135deg, #60a5fa, #a78bfa, #f472b6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
	h2 { font-size: 1.15rem; font-weight: 700; margin-bottom: 0.75rem; }
	.pack-counter { font-size: 0.75rem; color: var(--text-tertiary); }
	.set-selector { margin-bottom: 1rem; }
	.selector-label { font-size: 0.75rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.375rem; }
	.set-buttons { display: flex; gap: 0.375rem; }
	.set-btn { flex: 1; padding: 0.5rem 0.25rem; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-elevated); color: var(--text-secondary); font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.15s; }
	.set-btn.active { border-color: var(--accent-primary); color: var(--accent-primary); background: rgba(59, 130, 246, 0.1); }
	.box-selector { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
	.box-btn { flex: 1; min-width: calc(50% - 0.25rem); padding: 0.75rem; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-elevated); color: var(--text-secondary); font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: all 0.15s; }
	.box-btn.active { border-color: var(--accent-primary); color: var(--accent-primary); background: rgba(59, 130, 246, 0.1); }
	.pack-display { text-align: center; padding: 2rem 0; animation: floatIn 0.6s ease-out; }
	.pack-visual-box { width: 140px; height: 200px; margin: 0 auto 1.5rem; background: linear-gradient(135deg, #1e3a5f, #0f172a); border-radius: 16px; border: 2px solid #334155; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 0.5rem; box-shadow: 0 8px 32px rgba(59, 130, 246, 0.15), 0 0 60px rgba(59, 130, 246, 0.05); }
	.pack-visual-box.shaking { animation: shake 0.5s ease-in-out; }
	.pack-visual-box .pack-emoji { font-size: 3rem; }
	.pack-visual-box .pack-brand { font-size: 1rem; font-weight: 800; color: #60a5fa; letter-spacing: 2px; }
	.pack-visual-box .pack-type-label { font-size: 0.625rem; color: #475569; }
	.pack-info { font-size: 0.8rem; color: var(--text-tertiary); margin-bottom: 1rem; }
	.pack-guarantees { margin-bottom: 1rem; display: flex; justify-content: center; gap: 0.375rem; flex-wrap: wrap; }
	.guarantee-badge { font-size: 0.7rem; padding: 0.2rem 0.5rem; border-radius: 999px; background: rgba(234, 179, 8, 0.15); color: #eab308; font-weight: 600; text-transform: capitalize; }
	.open-actions { display: flex; flex-direction: column; gap: 0.5rem; max-width: 300px; margin: 0 auto; }
	.btn-primary { width: 100%; padding: 1rem; border-radius: 14px; border: none; cursor: pointer; background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: #fff; font-size: 1.125rem; font-weight: 700; box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4); transition: transform 0.15s, box-shadow 0.15s; }
	.btn-primary:active { transform: scale(0.97); }
	.btn-secondary { width: 100%; padding: 0.75rem; border-radius: 12px; border: 1px solid var(--border-color); background: var(--bg-elevated); color: var(--text-primary); font-size: 0.9rem; font-weight: 600; cursor: pointer; }
	.btn-reveal { width: 100%; padding: 0.875rem; border-radius: 12px; border: none; cursor: pointer; background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff; font-size: 1rem; font-weight: 700; box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3); margin-bottom: 0.5rem; }
	.btn-text { background: transparent; border: none; color: var(--text-secondary); font-size: 0.875rem; cursor: pointer; padding: 0.5rem; }
	.post-actions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
	.pack-opening { padding: 0.5rem 0; animation: floatIn 0.4s ease-out; }
	.cards-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 1rem; }
	.best-pull-card { border-radius: 12px; padding: 0.75rem 1rem; margin-bottom: 0.75rem; border-width: 1px; border-style: solid; }
	.best-pull-card .label { font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem; }
	.best-pull-card .value { font-size: 1rem; font-weight: 700; }
	.best-pull-card .parallel-note { font-size: 0.75rem; color: #a78bfa; font-style: italic; margin-top: 0.125rem; }
	.reveal-controls { text-align: center; }
	.footer { text-align: center; margin-top: 2rem; font-size: 0.6875rem; color: #334155; }
	.modal-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 1rem; animation: fadeIn 0.2s ease-out; }
	.modal-card { position: relative; width: 100%; max-width: 320px; background: linear-gradient(135deg, #1e293b, #0f172a); border-radius: 20px; border: 2px solid; padding: 2rem 1.5rem; text-align: center; overflow: hidden; animation: modalSlideUp 0.3s ease-out; }
	.modal-close { position: absolute; top: 0.75rem; right: 0.75rem; z-index: 2; width: 32px; height: 32px; border-radius: 50%; border: none; background: rgba(255, 255, 255, 0.1); color: #94a3b8; font-size: 1.25rem; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; }
	.modal-close:hover { background: rgba(255, 255, 255, 0.2); color: #e2e8f0; }
	.modal-type-badge { display: inline-block; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; padding: 0.25rem 0.75rem; border-radius: 999px; margin-bottom: 1.25rem; }
	.modal-icon { margin-bottom: 1rem; }
	.modal-power-circle { width: 80px; height: 80px; border-radius: 50%; margin: 0 auto; border: 3px solid; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.3); }
	.modal-power { font-size: 2rem; font-weight: 900; }
	.modal-name { font-size: 1.5rem; font-weight: 800; margin: 0 0 0.25rem; line-height: 1.2; }
	.modal-card-number { font-size: 0.8rem; color: #64748b; font-family: monospace; margin-bottom: 1.25rem; }
	.modal-details { background: rgba(0, 0, 0, 0.2); border-radius: 12px; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
	.modal-detail-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; }
	.modal-detail-label { color: #64748b; font-weight: 500; }
	.modal-detail-value { font-weight: 600; color: #e2e8f0; }
	.modal-glow { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
	.modal-card-image { width: 160px; max-height: 224px; object-fit: cover; border-radius: 12px; aspect-ratio: 5 / 7; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3); }
	@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
	@keyframes modalSlideUp { from { opacity: 0; transform: translateY(40px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
	@keyframes floatIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
	@keyframes shake { 0%, 100% { transform: translateX(0) rotate(0deg); } 20% { transform: translateX(-8px) rotate(-2deg); } 40% { transform: translateX(8px) rotate(2deg); } 60% { transform: translateX(-5px) rotate(-1deg); } 80% { transform: translateX(5px) rotate(1deg); } }

	.pack-ev-card {
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 0.875rem 1rem;
		margin: 0.75rem 0;
		text-align: center;
	}
	.pack-ev-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.pack-ev-value {
		font-size: 1.5rem;
		font-weight: 800;
		color: var(--text-primary);
		margin: 0.25rem 0 0.5rem;
	}
	.pack-ev-disclaimer {
		font-size: 0.7rem;
		color: var(--text-secondary);
		font-style: italic;
		line-height: 1.4;
		opacity: 0.85;
	}
</style>
