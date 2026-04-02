<script lang="ts">
	import { onMount } from 'svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { getSupabase } from '$lib/services/supabase';
	import { DEFAULT_CONFIGS, getBoxConfig } from '$lib/data/pack-defaults';
	import { loadCardDatabase } from '$lib/services/card-db';
	import { getWeapon } from '$lib/data/boba-weapons';
	import type { SlotConfig, SimulatedCard, PackResult, BoxGuarantee } from '$lib/types/pack-simulator';

	const SET_OPTIONS = [
		{ key: 'G', label: '2026 Griffey Set' },
		{ key: 'A', label: 'Alpha Edition' },
		{ key: 'U', label: 'Alpha Update' }
		// { key: 'T', label: 'Tecmo Bowl' },  // Uncomment when Tecmo launches
	];

	/** Parallel key → display color mapping for special parallels */
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

	// Pack opening state
	let currentPack = $state<PackResult | null>(null);
	let revealedSet = $state<Set<number>>(new Set());
	let autoRevealing = $state(false);
	let boxResults = $state<PackResult[]>([]);
	let showBoxSummary = $state(false);
	let shaking = $state(false);
	let packCount = $state(0);

	// Card detail modal
	let selectedCard = $state<SimulatedCard | null>(null);

	// Derived state
	const availableBoxTypes = $derived(
		Object.entries(DEFAULT_CONFIGS)
			.filter(([, config]) => config.availableForSets.includes(selectedSet))
			.map(([key, config]) => ({ key, label: config.displayName }))
	);
	const allRevealed = $derived(currentPack != null && revealedSet.size === currentPack.cards.length);
	const unrevealedCount = $derived(currentPack ? currentPack.cards.length - revealedSet.size : 0);

	// ── Card type helpers ──────────────────────────────────

	function isHotDog(card: SimulatedCard): boolean {
		return card.outcomeValue === 'hotdog' || card.slotLabel.toLowerCase().includes('hot dog');
	}

	function isPlay(card: SimulatedCard): boolean {
		return card.outcomeType === 'card_type' && card.outcomeValue === 'play';
	}

	function isBonusPlay(card: SimulatedCard): boolean {
		return card.outcomeType === 'card_type' && card.outcomeValue === 'bonus_play';
	}

	function isSpecialParallel(card: SimulatedCard): boolean {
		const basic = ['base', 'paper', 'battlefoil', ''];
		return !basic.includes(card.parallel.toLowerCase());
	}

	// ── Color helpers ──────────────────────────────────────

	function weaponColor(card: SimulatedCard): string {
		const w = getWeapon(card.weaponType);
		return w?.color || '#9CA3AF';
	}

	function weaponRarity(card: SimulatedCard): string {
		const w = getWeapon(card.weaponType);
		return w?.rarity || 'common';
	}

	function parallelColor(card: SimulatedCard): string {
		return PARALLEL_COLORS[card.parallel.toLowerCase()] || '#a78bfa';
	}

	function cardBorderColor(card: SimulatedCard): string {
		if (isHotDog(card)) return '#f59e0b';
		if (isPlay(card) || isBonusPlay(card)) return '#3b82f6';
		const rarity = weaponRarity(card);
		if (isSpecialParallel(card) && rarity !== 'legendary' && rarity !== 'ultra_rare') {
			return parallelColor(card);
		}
		return weaponColor(card);
	}

	function cardGlow(card: SimulatedCard): string {
		const color = weaponColor(card);
		const rarity = weaponRarity(card);
		if (rarity === 'legendary') return `0 0 30px ${color}, 0 0 60px ${color}, 0 0 90px ${color}`;
		if (rarity === 'ultra_rare') return `0 0 20px ${color}, 0 0 40px ${color}`;
		if (isSpecialParallel(card)) return `0 0 12px ${parallelColor(card)}`;
		return 'none';
	}

	function showParticles(card: SimulatedCard): boolean {
		const rarity = weaponRarity(card);
		return rarity === 'legendary' || rarity === 'ultra_rare' || isSpecialParallel(card);
	}

	function particleColor(card: SimulatedCard): string {
		const rarity = weaponRarity(card);
		if (rarity === 'legendary' || rarity === 'ultra_rare') return weaponColor(card);
		if (isSpecialParallel(card)) return parallelColor(card);
		return weaponColor(card);
	}

	function particleCount(card: SimulatedCard): number {
		return weaponRarity(card) === 'legendary' ? 20 : 12;
	}

	/** Generate random particle offsets (pre-computed per card on reveal) */
	function makeParticle(index: number): { dx: number; dy: number; size: number; round: boolean; delay: number } {
		const angle = (Math.PI * 2 * index) / 16 + (Math.random() - 0.5);
		const dist = 40 + Math.random() * 80;
		return {
			dx: Math.cos(angle) * dist,
			dy: Math.sin(angle) * dist,
			size: 3 + Math.random() * 5,
			round: Math.random() > 0.5,
			delay: index * 0.03,
		};
	}

	function rarityColor(weapon: string): string {
		const w = getWeapon(weapon);
		return w?.color || '#9CA3AF';
	}

	function boxIcon(boxType: string): string {
		switch (boxType) {
			case 'blaster': return 'B';
			case 'double_mega': return 'DM';
			case 'hobby': return 'H';
			case 'jumbo': return 'J';
			default: return '?';
		}
	}

	// ── Lifecycle ──────────────────────────────────────────

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
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const { data } = await (client as any)
					.from('pack_configurations')
					.select('*')
					.eq('box_type', selectedBox)
					.eq('is_active', true)
					.limit(1)
					.maybeSingle();

				if (data?.slots) {
					const defaultConfig = getBoxConfig(selectedBox, selectedSet);
					// Merge cardFormat from defaults for configs saved before the field existed
					slots = (data.slots as SlotConfig[]).map((slot: SlotConfig, i: number) => ({
						...slot,
						cardFormat: slot.cardFormat || defaultConfig?.slots[i]?.cardFormat || 'any'
					}));
					packsPerBox = data.packs_per_box || defaultConfig?.packsPerBox || 10;
					guarantees = data.box_guarantees || defaultConfig?.guarantees || [];
					return;
				}
			} catch {
				// Fall through to defaults
			}
		}

		const config = getBoxConfig(selectedBox, selectedSet);
		if (config) {
			slots = config.slots;
			packsPerBox = config.packsPerBox;
			guarantees = config.guarantees;
		}
	}

	function handleSetChange() {
		const available = Object.entries(DEFAULT_CONFIGS)
			.filter(([, config]) => config.availableForSets.includes(selectedSet))
			.map(([key]) => key);
		if (!available.includes(selectedBox)) {
			selectedBox = 'blaster';
		}
		handleBoxChange();
	}

	async function handleBoxChange() {
		loading = true;
		currentPack = null;
		boxResults = [];
		showBoxSummary = false;
		await loadConfig();
		loading = false;
	}

	// ── Pack actions ───────────────────────────────────────

	async function openSinglePack() {
		if (!dbLoaded) {
			showToast('Card database still loading...', 'x');
			return;
		}
		shaking = true;
		setTimeout(async () => {
			const { openPack } = await import('$lib/services/pack-simulator');
			currentPack = openPack(slots, selectedSet);
			revealedSet = new Set();
			autoRevealing = false;
			showBoxSummary = false;
			packCount++;
			shaking = false;
		}, 500);
	}

	async function openFullBox() {
		if (!dbLoaded) {
			showToast('Card database still loading...', 'x');
			return;
		}
		const { openBox } = await import('$lib/services/pack-simulator');
		boxResults = openBox(slots, packsPerBox, selectedSet, guarantees);
		showBoxSummary = true;
		currentPack = null;
		packCount += packsPerBox;
	}

	function revealCard(index: number) {
		if (revealedSet.has(index)) return;
		revealedSet = new Set([...revealedSet, index]);
	}

	function revealNext() {
		if (!currentPack) return;
		const next = currentPack.cards.findIndex((_, i) => !revealedSet.has(i));
		if (next >= 0) revealCard(next);
	}

	function revealAll() {
		if (!currentPack || autoRevealing) return;
		autoRevealing = true;
		const unrevealed = currentPack.cards.map((_, i) => i).filter(i => !revealedSet.has(i));
		unrevealed.forEach((idx, i) => {
			setTimeout(() => {
				revealCard(idx);
				if (i === unrevealed.length - 1) autoRevealing = false;
			}, (i + 1) * 250);
		});
	}
</script>

<svelte:head>
	<title>Pack Simulator - BOBA Scanner</title>
</svelte:head>

<div class="packs-page">
	<!-- Header -->
	<header class="page-header">
		<div class="header-label">BoBA Scanner</div>
		<h1>Pack Simulator</h1>
		{#if packCount > 0}
			<div class="pack-counter">Packs opened: {packCount}</div>
		{/if}
	</header>

	<!-- Set Selector -->
	<div class="set-selector">
		<span class="selector-label">Set</span>
		<div class="set-buttons">
			{#each SET_OPTIONS as setOpt}
				<button
					class="set-btn"
					class:active={selectedSet === setOpt.key}
					onclick={() => { selectedSet = setOpt.key; handleSetChange(); }}
				>
					{setOpt.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Box Type Selector -->
	<div class="box-selector">
		{#each availableBoxTypes as box}
			<button
				class="box-btn"
				class:active={selectedBox === box.key}
				onclick={() => { selectedBox = box.key; handleBoxChange(); }}
			>
				{box.label}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="loading">Loading pack configuration...</div>
	{:else}
		<!-- Pre-Open Pack Display -->
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
						{#each guarantees as g}
							<span class="guarantee-badge">{g.minCount}x {g.value.replace(/_/g, ' ')} guaranteed</span>
						{/each}
					</div>
				{/if}

				<div class="open-actions">
					<button class="btn-primary" onclick={openSinglePack}>Rip a Pack 🔥</button>
					<button class="btn-secondary" onclick={openFullBox}>Open Full Box ({packsPerBox} packs)</button>
				</div>
			</div>
		{/if}

		<!-- Single Pack Opening -->
		{#if currentPack}
			<div class="pack-opening">
				<div class="cards-grid">
					{#each currentPack.cards as card, i}
						{@const revealed = revealedSet.has(i)}
						{@const isHero = !isHotDog(card) && !isPlay(card) && !isBonusPlay(card)}
						{@const borderColor = cardBorderColor(card)}
						{@const rarity = weaponRarity(card)}
						{@const wColor = weaponColor(card)}
						{@const wGlow = `0 0 8px ${wColor}`}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="card-wrapper"
							class:is-revealed={revealed}
							onclick={() => revealed ? (selectedCard = card) : revealCard(i)}
						>
							<div class="card-inner">
								<!-- Back -->
								<div class="card-back">
									<div class="card-back-inner">
										<span class="back-emoji">🎴</span>
										<span class="back-label">BoBA</span>
									</div>
								</div>

								<!-- Front -->
								<div
									class="card-front"
									class:is-legendary={revealed && rarity === 'legendary'}
									style="
										border-color: {borderColor};
										background: {isHotDog(card)
											? 'linear-gradient(135deg, #7c2d12, #431407)'
											: isPlay(card) || isBonusPlay(card)
											? 'linear-gradient(135deg, #1e3a5f, #0c1929)'
											: `linear-gradient(135deg, ${borderColor}22, #0f172a 40%, ${borderColor}11)`};
										box-shadow: {revealed ? cardGlow(card) : 'none'};
										--weapon-glow: {wGlow};
									"
								>
									<div class="slot-label">{card.slotLabel}</div>
									<div class="card-number">{card.cardNumber}</div>

									<div class="card-center">
										{#if isHotDog(card)}
											<span class="type-emoji">🌭</span>
											<span class="card-name" style="color: #fbbf24">{card.heroName}</span>
										{:else if isBonusPlay(card)}
											<span class="play-emoji">⚡</span>
											<span class="card-name" style="color: #a78bfa">{card.heroName}</span>
											<span class="bonus-badge">BONUS PLAY</span>
										{:else if isPlay(card)}
											<span class="play-emoji">📜</span>
											<span class="card-name" style="color: #93c5fd">{card.heroName}</span>
										{:else}
											<span
												class="hero-name"
												class:has-glow={rarity === 'legendary'}
												style={rarity === 'legendary' ? `--weapon-glow: 0 0 10px ${wColor}` : ''}
											>
												{card.heroName}
											</span>
											{#if card.power}
												<span
													class="power-value"
													class:has-glow={rarity === 'legendary' || rarity === 'ultra_rare'}
													style="color: {wColor}; --weapon-glow: {wGlow}"
												>
													{card.power}
												</span>
											{/if}
										{/if}
									</div>

									<div class="card-bottom">
										{#if card.weaponType && isHero}
											{@const w = getWeapon(card.weaponType)}
											<span class="weapon-label" style="color: {wColor}">
												{w?.name?.toUpperCase() ?? card.weaponType.toUpperCase()}
											</span>
										{:else}
											<span></span>
										{/if}
										{#if isSpecialParallel(card)}
											<span class="parallel-label" style="color: {parallelColor(card)}">
												{card.parallel.replace(/_/g, ' ')}
											</span>
										{/if}
									</div>
								</div>
							</div>

							<!-- Particles -->
							{#if revealed && showParticles(card)}
								<div class="particles">
									{#each Array.from({ length: particleCount(card) }) as _, pi}
										{@const p = makeParticle(pi)}
										<span
											class="particle"
											style="
												width: {p.size}px; height: {p.size}px;
												border-radius: {p.round ? '50%' : '2px'};
												background: {particleColor(card)};
												animation-delay: {p.delay}s;
												--dx: {p.dx}px; --dy: {p.dy}px;
											"
										></span>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Reveal Controls -->
				<div class="reveal-controls">
					{#if !allRevealed}
						<button class="btn-reveal" onclick={revealNext}>
							Tap to Reveal ({unrevealedCount} left)
						</button>
						{#if !autoRevealing && unrevealedCount > 1}
							<button class="btn-text" onclick={revealAll}>Reveal All</button>
						{/if}
					{:else}
						<!-- Best Pull -->
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

						<div class="post-actions">
							<button class="btn-primary" onclick={openSinglePack}>Open Another Pack 🔥</button>
							<button class="btn-secondary" onclick={openFullBox}>Open Full Box</button>
							<button class="btn-text" onclick={() => { currentPack = null; }}>Back</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Box Summary -->
		{#if showBoxSummary && boxResults.length > 0}
			<div class="box-summary">
				<h2>Box Results &mdash; {boxResults.length} Packs</h2>
				{#each boxResults as pack, packIdx}
					<details class="pack-detail">
						<summary>Pack {packIdx + 1}{pack.bestCard ? ` — Best: ${pack.bestCard.heroName} (${pack.bestCard.weaponType})` : ''}</summary>
						<div class="pack-cards-list">
							{#each pack.cards as card}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="list-card" style="--list-color: {rarityColor(card.weaponType)}; cursor: pointer;" onclick={() => (selectedCard = card)}>
									<span class="list-hero">{card.heroName}</span>
									<span class="list-num">{card.cardNumber}</span>
									<span class="list-weapon" style="color: {rarityColor(card.weaponType)}">{card.weaponType}</span>
									{#if card.parallel !== 'base' && card.parallel !== 'paper'}
										<span class="list-parallel" style="color: {parallelColor(card)}">{card.parallel.replace(/_/g, ' ')}</span>
									{/if}
								</div>
							{/each}
						</div>
					</details>
				{/each}
				<div class="post-actions">
					<button class="btn-primary" onclick={openSinglePack}>Open Single Pack</button>
					<button class="btn-secondary" onclick={openFullBox}>Open Another Box</button>
					<button class="btn-text" onclick={() => { showBoxSummary = false; boxResults = []; }}>Back</button>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Card Detail Modal -->
	{#if selectedCard}
		{@const card = selectedCard}
		{@const isHero = !isHotDog(card) && !isPlay(card) && !isBonusPlay(card)}
		{@const borderColor = cardBorderColor(card)}
		{@const rarity = weaponRarity(card)}
		{@const wColor = weaponColor(card)}
		{@const w = isHero ? getWeapon(card.weaponType) : null}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-overlay" onclick={() => (selectedCard = null)}>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="modal-card" onclick={(e) => e.stopPropagation()} style="border-color: {borderColor}; --modal-accent: {borderColor};">
				<!-- Close button -->
				<button class="modal-close" onclick={() => (selectedCard = null)}>&times;</button>

				<!-- Card type badge -->
				<div class="modal-type-badge" style="background: {borderColor}22; color: {borderColor}">
					{#if isHotDog(card)}
						Hot Dog
					{:else if isBonusPlay(card)}
						Bonus Play
					{:else if isPlay(card)}
						Play Card
					{:else}
						Hero Card
					{/if}
				</div>

				<!-- Card icon / emoji -->
				<div class="modal-icon">
					{#if isHotDog(card)}
						<span style="font-size: 3rem">🌭</span>
					{:else if isPlay(card) || isBonusPlay(card)}
						<span style="font-size: 3rem">{isBonusPlay(card) ? '⚡' : '📜'}</span>
					{:else}
						<div class="modal-power-circle" style="border-color: {wColor}; box-shadow: 0 0 20px {wColor}44">
							{#if card.power}
								<span class="modal-power" style="color: {wColor}">{card.power}</span>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Card name -->
				<h2 class="modal-name" style="color: {isHotDog(card) ? '#fbbf24' : isPlay(card) || isBonusPlay(card) ? '#93c5fd' : '#e2e8f0'}">
					{card.heroName}
				</h2>

				<!-- Card number -->
				<div class="modal-card-number">{card.cardNumber}</div>

				<!-- Details grid -->
				<div class="modal-details">
					{#if isHero && w}
						<div class="modal-detail-row">
							<span class="modal-detail-label">Weapon</span>
							<span class="modal-detail-value" style="color: {wColor}">{w.name}</span>
						</div>
					{/if}
					{#if isHero && rarity}
						<div class="modal-detail-row">
							<span class="modal-detail-label">Rarity</span>
							<span class="modal-detail-value" style="color: {wColor}; text-transform: capitalize">{rarity.replace(/_/g, ' ')}</span>
						</div>
					{/if}
					{#if card.parallel && card.parallel !== 'base' && card.parallel !== 'paper'}
						<div class="modal-detail-row">
							<span class="modal-detail-label">Parallel</span>
							<span class="modal-detail-value" style="color: {parallelColor(card)}; text-transform: capitalize">
								{card.parallel.replace(/_/g, ' ')}
							</span>
						</div>
					{/if}
					<div class="modal-detail-row">
						<span class="modal-detail-label">Set</span>
						<span class="modal-detail-value">{card.setCode}</span>
					</div>
					<div class="modal-detail-row">
						<span class="modal-detail-label">Slot</span>
						<span class="modal-detail-value">{card.slotLabel}</span>
					</div>
				</div>

				<!-- Glow effect for special cards -->
				{#if rarity === 'legendary' || rarity === 'ultra_rare' || isSpecialParallel(card)}
					<div class="modal-glow" style="background: radial-gradient(ellipse at center, {borderColor}22 0%, transparent 70%)"></div>
				{/if}
			</div>
		</div>
	{/if}

	<div class="footer">boba.cards &mdash; AI Card Detection</div>
</div>

<style>
	/* ── Layout ───────────────────────────────────── */
	.packs-page {
		max-width: 440px; margin: 0 auto; padding: 1rem;
		min-height: 100vh;
	}
	.loading { text-align: center; padding: 3rem; color: var(--text-tertiary); }

	/* ── Header ───────────────────────────────────── */
	.page-header {
		text-align: center; margin-bottom: 1.25rem;
		animation: floatIn 0.5s ease-out;
	}
	.header-label {
		font-size: 0.75rem; color: var(--text-tertiary); letter-spacing: 3px;
		text-transform: uppercase; font-weight: 600;
	}
	h1 {
		font-size: 1.75rem; font-weight: 900; margin: 0.25rem 0;
		background: linear-gradient(135deg, #60a5fa, #a78bfa, #f472b6);
		-webkit-background-clip: text; -webkit-text-fill-color: transparent;
		background-clip: text;
	}
	h2 { font-size: 1.15rem; font-weight: 700; margin-bottom: 0.75rem; }
	.pack-counter { font-size: 0.75rem; color: var(--text-tertiary); }

	/* ── Set / Box Selectors ──────────────────────── */
	.set-selector { margin-bottom: 1rem; }
	.selector-label {
		font-size: 0.75rem; font-weight: 600; color: var(--text-tertiary);
		text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.375rem;
	}
	.set-buttons { display: flex; gap: 0.375rem; }
	.set-btn {
		flex: 1; padding: 0.5rem 0.25rem; border-radius: 8px; border: 1px solid var(--border-color);
		background: var(--bg-elevated); color: var(--text-secondary); font-size: 0.8rem;
		font-weight: 600; cursor: pointer; transition: all 0.15s;
	}
	.set-btn.active {
		border-color: var(--accent-primary); color: var(--accent-primary);
		background: rgba(59, 130, 246, 0.1);
	}
	.box-selector { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
	.box-btn {
		flex: 1; min-width: calc(50% - 0.25rem); padding: 0.75rem; border-radius: 10px;
		border: 1px solid var(--border-color); background: var(--bg-elevated);
		color: var(--text-secondary); font-size: 0.9rem; font-weight: 600;
		cursor: pointer; transition: all 0.15s;
	}
	.box-btn.active {
		border-color: var(--accent-primary); color: var(--accent-primary);
		background: rgba(59, 130, 246, 0.1);
	}

	/* ── Pack Display (pre-open) ──────────────────── */
	.pack-display { text-align: center; padding: 2rem 0; animation: floatIn 0.6s ease-out; }
	.pack-visual-box {
		width: 140px; height: 200px; margin: 0 auto 1.5rem;
		background: linear-gradient(135deg, #1e3a5f, #0f172a);
		border-radius: 16px; border: 2px solid #334155;
		display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 0.5rem;
		box-shadow: 0 8px 32px rgba(59, 130, 246, 0.15), 0 0 60px rgba(59, 130, 246, 0.05);
	}
	.pack-visual-box.shaking { animation: shake 0.5s ease-in-out; }
	.pack-visual-box .pack-emoji { font-size: 3rem; }
	.pack-visual-box .pack-brand { font-size: 1rem; font-weight: 800; color: #60a5fa; letter-spacing: 2px; }
	.pack-visual-box .pack-type-label { font-size: 0.625rem; color: #475569; }
	.pack-info { font-size: 0.8rem; color: var(--text-tertiary); margin-bottom: 1rem; }
	.pack-guarantees {
		margin-bottom: 1rem; display: flex; justify-content: center; gap: 0.375rem; flex-wrap: wrap;
	}
	.guarantee-badge {
		font-size: 0.7rem; padding: 0.2rem 0.5rem; border-radius: 999px;
		background: rgba(234, 179, 8, 0.15); color: #eab308; font-weight: 600;
		text-transform: capitalize;
	}

	/* ── Buttons ──────────────────────────────────── */
	.open-actions { display: flex; flex-direction: column; gap: 0.5rem; max-width: 300px; margin: 0 auto; }
	.btn-primary {
		width: 100%; padding: 1rem; border-radius: 14px; border: none; cursor: pointer;
		background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: #fff;
		font-size: 1.125rem; font-weight: 700;
		box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
		transition: transform 0.15s, box-shadow 0.15s;
	}
	.btn-primary:active { transform: scale(0.97); }
	.btn-secondary {
		width: 100%; padding: 0.75rem; border-radius: 12px;
		border: 1px solid var(--border-color); background: var(--bg-elevated);
		color: var(--text-primary); font-size: 0.9rem; font-weight: 600; cursor: pointer;
	}
	.btn-reveal {
		width: 100%; padding: 0.875rem; border-radius: 12px; border: none; cursor: pointer;
		background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff;
		font-size: 1rem; font-weight: 700;
		box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3); margin-bottom: 0.5rem;
	}
	.btn-text {
		background: transparent; border: none; color: var(--text-secondary);
		font-size: 0.875rem; cursor: pointer; padding: 0.5rem;
	}
	.post-actions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }

	/* ── Cards Grid ───────────────────────────────── */
	.pack-opening { padding: 0.5rem 0; animation: floatIn 0.4s ease-out; }
	.cards-grid {
		display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px;
		margin-bottom: 1rem;
	}

	/* ── Individual Card ──────────────────────────── */
	.card-wrapper {
		position: relative; width: 100%; aspect-ratio: 2.5 / 3.5;
		perspective: 600px; cursor: pointer;
	}
	.card-wrapper.is-revealed { cursor: pointer; }
	.card-inner {
		width: 100%; height: 100%; position: relative;
		transform-style: preserve-3d;
		transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.card-wrapper.is-revealed .card-inner { transform: rotateY(180deg); }

	.card-back, .card-front {
		position: absolute; inset: 0; border-radius: 10px; overflow: hidden;
		-webkit-backface-visibility: hidden; backface-visibility: hidden;
	}

	/* Card back */
	.card-back {
		background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
		border: 2px solid #334155; display: flex; align-items: center; justify-content: center;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	}
	.card-back-inner {
		width: 70%; height: 70%; border-radius: 8px;
		background: linear-gradient(135deg, #1e3a5f, #0f172a, #1e3a5f);
		border: 1px solid #334155;
		display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 4px;
	}
	.card-back-inner .back-emoji { font-size: 1.75rem; filter: grayscale(0.3); }
	.card-back-inner .back-label { font-size: 0.6875rem; color: #475569; font-weight: 700; letter-spacing: 2px; }

	/* Card front */
	.card-front {
		transform: rotateY(180deg);
		display: flex; flex-direction: column; padding: 8%;
		border-width: 2px; border-style: solid;
	}
	.card-front.is-legendary { animation: legendaryPulse 2s ease-in-out infinite; }
	.card-front .slot-label {
		font-size: 0.5rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1px;
	}
	.card-front .card-number {
		font-size: 0.5625rem; color: #94a3b8; font-family: monospace;
	}

	/* Card center content */
	.card-center {
		flex: 1; display: flex; flex-direction: column;
		align-items: center; justify-content: center; gap: 4px;
	}
	.card-center .type-emoji { font-size: 1.75rem; }
	.card-center .play-emoji { font-size: 1.375rem; }
	.card-center .hero-name {
		font-size: 0.6875rem; font-weight: 800; color: #e2e8f0;
		text-align: center; line-height: 1.2;
	}
	.card-center .hero-name.has-glow { text-shadow: var(--weapon-glow); }
	.card-center .card-name {
		font-size: 0.6875rem; font-weight: 700; text-align: center; line-height: 1.2;
	}
	.card-center .power-value {
		font-size: 1.25rem; font-weight: 900;
	}
	.card-center .power-value.has-glow { text-shadow: var(--weapon-glow); }
	.bonus-badge {
		font-size: 0.5rem; color: #c084fc; font-weight: 600;
		background: rgba(124, 58, 237, 0.13); padding: 1px 6px; border-radius: 4px; margin-top: 2px;
	}

	/* Card bottom */
	.card-bottom {
		display: flex; justify-content: space-between; align-items: flex-end;
	}
	.card-bottom .weapon-label {
		font-size: 0.5625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
	}
	.card-bottom .parallel-label {
		font-size: 0.5rem; font-weight: 700; font-style: italic;
	}

	/* ── Particles ────────────────────────────────── */
	.particles {
		position: absolute; inset: 0; pointer-events: none; overflow: visible; z-index: 2;
	}
	.particle {
		position: absolute; left: 50%; top: 50%; opacity: 0; pointer-events: none;
		animation: particleFly 0.8s ease-out forwards;
	}

	/* ── Best Pull ────────────────────────────────── */
	.best-pull-card {
		border-radius: 12px; padding: 0.75rem 1rem; margin-bottom: 0.75rem;
		border-width: 1px; border-style: solid;
	}
	.best-pull-card .label { font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem; }
	.best-pull-card .value { font-size: 1rem; font-weight: 700; }
	.best-pull-card .parallel-note { font-size: 0.75rem; color: #a78bfa; font-style: italic; margin-top: 0.125rem; }

	/* ── Reveal Controls ──────────────────────────── */
	.reveal-controls { text-align: center; }

	/* ── Box Summary ──────────────────────────────── */
	.box-summary { padding: 0.5rem 0; animation: floatIn 0.4s ease-out; }
	.pack-detail {
		background: var(--bg-elevated); border-radius: 10px; padding: 0.75rem;
		margin-bottom: 0.5rem;
	}
	.pack-detail summary { cursor: pointer; font-size: 0.85rem; font-weight: 600; }
	.pack-cards-list { margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.25rem; }
	.list-card {
		display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.5rem;
		background: var(--bg-base); border-radius: 6px; font-size: 0.8rem;
		border-left: 3px solid var(--list-color, var(--border-color));
	}
	.list-hero { font-weight: 600; flex: 1; }
	.list-num { color: var(--text-secondary); font-size: 0.7rem; }
	.list-weapon { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
	.list-parallel { font-size: 0.65rem; font-style: italic; }

	/* ── Footer ───────────────────────────────────── */
	.footer { text-align: center; margin-top: 2rem; font-size: 0.6875rem; color: #334155; }

	/* ── Card Detail Modal ────────────────────────── */
	.modal-overlay {
		position: fixed; inset: 0; z-index: 100;
		background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(8px);
		display: flex; align-items: center; justify-content: center;
		padding: 1rem;
		animation: fadeIn 0.2s ease-out;
	}
	.modal-card {
		position: relative; width: 100%; max-width: 320px;
		background: linear-gradient(135deg, #1e293b, #0f172a);
		border-radius: 20px; border: 2px solid; padding: 2rem 1.5rem;
		text-align: center; overflow: hidden;
		animation: modalSlideUp 0.3s ease-out;
	}
	.modal-close {
		position: absolute; top: 0.75rem; right: 0.75rem; z-index: 2;
		width: 32px; height: 32px; border-radius: 50%; border: none;
		background: rgba(255, 255, 255, 0.1); color: #94a3b8;
		font-size: 1.25rem; cursor: pointer; display: flex; align-items: center; justify-content: center;
		line-height: 1;
	}
	.modal-close:hover { background: rgba(255, 255, 255, 0.2); color: #e2e8f0; }
	.modal-type-badge {
		display: inline-block; font-size: 0.7rem; font-weight: 700;
		text-transform: uppercase; letter-spacing: 1.5px; padding: 0.25rem 0.75rem;
		border-radius: 999px; margin-bottom: 1.25rem;
	}
	.modal-icon { margin-bottom: 1rem; }
	.modal-power-circle {
		width: 80px; height: 80px; border-radius: 50%; margin: 0 auto;
		border: 3px solid; display: flex; align-items: center; justify-content: center;
		background: rgba(0, 0, 0, 0.3);
	}
	.modal-power { font-size: 2rem; font-weight: 900; }
	.modal-name {
		font-size: 1.5rem; font-weight: 800; margin: 0 0 0.25rem; line-height: 1.2;
	}
	.modal-card-number {
		font-size: 0.8rem; color: #64748b; font-family: monospace; margin-bottom: 1.25rem;
	}
	.modal-details {
		background: rgba(0, 0, 0, 0.2); border-radius: 12px; padding: 0.75rem;
		display: flex; flex-direction: column; gap: 0.5rem;
	}
	.modal-detail-row {
		display: flex; justify-content: space-between; align-items: center;
		font-size: 0.85rem;
	}
	.modal-detail-label { color: #64748b; font-weight: 500; }
	.modal-detail-value { font-weight: 600; color: #e2e8f0; }
	.modal-glow {
		position: absolute; inset: 0; pointer-events: none; z-index: 0;
	}

	/* ── Keyframes ────────────────────────────────── */
	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	@keyframes modalSlideUp {
		from { opacity: 0; transform: translateY(40px) scale(0.95); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}
	@keyframes floatIn {
		from { opacity: 0; transform: translateY(20px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@keyframes shake {
		0%, 100% { transform: translateX(0) rotate(0deg); }
		20% { transform: translateX(-8px) rotate(-2deg); }
		40% { transform: translateX(8px) rotate(2deg); }
		60% { transform: translateX(-5px) rotate(-1deg); }
		80% { transform: translateX(5px) rotate(1deg); }
	}
	@keyframes legendaryPulse {
		0%, 100% { filter: brightness(1); }
		50% { filter: brightness(1.3); }
	}
	@keyframes particleFly {
		0% { opacity: 1; transform: translate(0, 0) scale(0); }
		50% { opacity: 1; transform: translate(calc(var(--dx) * 0.7), calc(var(--dy) * 0.7)) scale(1.2); }
		100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0); }
	}
</style>
