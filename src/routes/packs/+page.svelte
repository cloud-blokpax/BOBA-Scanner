<script lang="ts">
	import { onMount } from 'svelte';
	import { showToast } from '$lib/stores/toast.svelte';
	import { getSupabase } from '$lib/services/supabase';
	import { DEFAULT_CONFIGS } from '$lib/data/pack-defaults';
	import { loadCardDatabase } from '$lib/services/card-db';
	import { getWeapon } from '$lib/data/boba-weapons';
	import type { SlotConfig, SimulatedCard, PackResult } from '$lib/types/pack-simulator';

	const BOX_TYPES = [
		{ key: 'blaster', label: 'Blaster Box' },
		{ key: 'hobby', label: 'Hobby Box' }
	];

	let selectedBox = $state('blaster');
	let slots = $state<SlotConfig[]>([]);
	let packsPerBox = $state(6);
	let loading = $state(true);
	let dbLoaded = $state(false);

	// Pack opening state
	let currentPack = $state<PackResult | null>(null);
	let revealedCount = $state(0);
	let autoRevealing = $state(false);
	let boxResults = $state<PackResult[]>([]);
	let showBoxSummary = $state(false);

	onMount(async () => {
		// Load card database first
		await loadCardDatabase();
		dbLoaded = true;

		// Try to load admin-configured pack config from Supabase
		await loadConfig();
		loading = false;
	});

	async function loadConfig() {
		const client = getSupabase();
		if (client) {
			try {
				// pack_configurations is not in generated Supabase types yet
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const { data } = await (client as any)
					.from('pack_configurations')
					.select('*')
					.eq('box_type', selectedBox)
					.eq('is_active', true)
					.limit(1)
					.single();

				if (data?.slots) {
					slots = data.slots as SlotConfig[];
					packsPerBox = data.packs_per_box || DEFAULT_CONFIGS[selectedBox]?.packsPerBox || 10;
					return;
				}
			} catch {
				// Fall through to defaults
			}
		}

		// Use defaults
		const config = DEFAULT_CONFIGS[selectedBox];
		if (config) {
			slots = config.slots;
			packsPerBox = config.packsPerBox;
		}
	}

	async function handleBoxChange() {
		loading = true;
		currentPack = null;
		boxResults = [];
		showBoxSummary = false;
		await loadConfig();
		loading = false;
	}

	async function openSinglePack() {
		if (!dbLoaded) {
			showToast('Card database still loading...', 'x');
			return;
		}
		const { openPack } = await import('$lib/services/pack-simulator');
		currentPack = openPack(slots);
		revealedCount = 0;
		autoRevealing = false;
		showBoxSummary = false;
	}

	async function openFullBox() {
		if (!dbLoaded) {
			showToast('Card database still loading...', 'x');
			return;
		}
		const { openBox } = await import('$lib/services/pack-simulator');
		boxResults = openBox(slots, packsPerBox);
		showBoxSummary = true;
		currentPack = null;
	}

	function revealNext() {
		if (currentPack && revealedCount < currentPack.cards.length) {
			revealedCount++;
		}
	}

	function revealAll() {
		if (currentPack) {
			autoRevealing = true;
			const interval = setInterval(() => {
				revealedCount++;
				if (!currentPack || revealedCount >= currentPack.cards.length) {
					clearInterval(interval);
					autoRevealing = false;
				}
			}, 400);
		}
	}

	function rarityColor(weapon: string): string {
		const w = getWeapon(weapon);
		return w?.color || '#9CA3AF';
	}

	function rarityGlow(weapon: string): string {
		const w = getWeapon(weapon);
		if (!w) return 'none';
		if (w.rarity === 'legendary') return `0 0 20px ${w.color}, 0 0 40px ${w.color}`;
		if (w.rarity === 'ultra_rare') return `0 0 12px ${w.color}`;
		return 'none';
	}
</script>

<svelte:head>
	<title>Pack Simulator - BOBA Scanner</title>
</svelte:head>

<div class="packs-page">
	<header class="page-header">
		<h1>Pack Simulator</h1>
		<p class="subtitle">Open virtual BoBA packs and see what you pull</p>
	</header>

	<!-- Box Type Selector -->
	<div class="box-selector">
		{#each BOX_TYPES as box}
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
		<!-- Open Pack Controls -->
		{#if !currentPack && !showBoxSummary}
			<div class="pack-display">
				<div class="pack-visual">
					<div class="pack-icon">{selectedBox === 'hobby' ? 'H' : 'B'}</div>
					<div class="pack-name">{BOX_TYPES.find(b => b.key === selectedBox)?.label}</div>
					<div class="pack-info">{packsPerBox} packs per box | 10 cards per pack</div>
				</div>
				<div class="open-actions">
					<button class="btn-open" onclick={openSinglePack}>Open a Pack</button>
					<button class="btn-open-box" onclick={openFullBox}>Open Full Box ({packsPerBox} packs)</button>
				</div>
			</div>
		{/if}

		<!-- Single Pack Opening -->
		{#if currentPack}
			<div class="pack-opening">
				<div class="cards-grid">
					{#each currentPack.cards as card, i}
						<button
							class="pack-card"
							class:revealed={i < revealedCount}
							class:legendary={card.rarity === 'legendary' && i < revealedCount}
							class:ultra-rare={card.rarity === 'ultra_rare' && i < revealedCount}
							style={i < revealedCount ? `border-color: ${rarityColor(card.weaponType)}; box-shadow: ${rarityGlow(card.weaponType)}` : ''}
							onclick={revealNext}
						>
							{#if i < revealedCount}
								<div class="card-face">
									<div class="card-slot-label">{card.slotLabel}</div>
									<div class="card-hero">{card.heroName}</div>
									<div class="card-number">{card.cardNumber}</div>
									<div class="card-meta">
										<span class="weapon-badge" style="color: {rarityColor(card.weaponType)}">{card.weaponType}</span>
										{#if card.power}
											<span class="power-badge">PWR {card.power}</span>
										{/if}
									</div>
									{#if card.parallel !== 'base' && card.parallel !== 'paper'}
										<div class="parallel-tag">{card.parallel}</div>
									{/if}
								</div>
							{:else}
								<div class="card-back">
									<span class="card-back-num">{i + 1}</span>
								</div>
							{/if}
						</button>
					{/each}
				</div>

				<div class="reveal-controls">
					{#if revealedCount < currentPack.cards.length}
						<button class="btn-reveal" onclick={revealNext}>Tap to Reveal ({currentPack.cards.length - revealedCount} left)</button>
						{#if !autoRevealing}
							<button class="btn-reveal-all" onclick={revealAll}>Reveal All</button>
						{/if}
					{:else}
						<div class="pack-summary">
							{#if currentPack.bestCard}
								<div class="best-pull">Best Pull: <strong style="color: {rarityColor(currentPack.bestCard.weaponType)}">{currentPack.bestCard.heroName} ({currentPack.bestCard.weaponType})</strong></div>
							{/if}
						</div>
						<div class="post-actions">
							<button class="btn-open" onclick={openSinglePack}>Open Another Pack</button>
							<button class="btn-open-box" onclick={openFullBox}>Open Full Box</button>
							<button class="btn-back" onclick={() => { currentPack = null; }}>Back</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Box Summary -->
		{#if showBoxSummary && boxResults.length > 0}
			<div class="box-summary">
				<h2>Box Results — {boxResults.length} Packs</h2>
				{#each boxResults as pack, packIdx}
					<details class="pack-detail">
						<summary>Pack {packIdx + 1}{pack.bestCard ? ` — Best: ${pack.bestCard.heroName} (${pack.bestCard.weaponType})` : ''}</summary>
						<div class="pack-cards-list">
							{#each pack.cards as card}
								<div class="list-card" style="border-left: 3px solid {rarityColor(card.weaponType)}">
									<span class="list-hero">{card.heroName}</span>
									<span class="list-num">{card.cardNumber}</span>
									<span class="list-weapon" style="color: {rarityColor(card.weaponType)}">{card.weaponType}</span>
									{#if card.parallel !== 'base' && card.parallel !== 'paper'}
										<span class="list-parallel">{card.parallel}</span>
									{/if}
								</div>
							{/each}
						</div>
					</details>
				{/each}
				<div class="post-actions">
					<button class="btn-open" onclick={openSinglePack}>Open Single Pack</button>
					<button class="btn-open-box" onclick={openFullBox}>Open Another Box</button>
					<button class="btn-back" onclick={() => { showBoxSummary = false; boxResults = []; }}>Back</button>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.packs-page { max-width: 600px; margin: 0 auto; padding: 1rem; }
	.page-header { margin-bottom: 1.25rem; }
	h1 { font-size: 1.5rem; font-weight: 700; }
	h2 { font-size: 1.15rem; font-weight: 700; margin-bottom: 0.75rem; }
	.subtitle { font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem; }
	.loading { text-align: center; padding: 3rem; color: var(--text-tertiary); }

	.box-selector { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
	.box-btn {
		flex: 1; padding: 0.75rem; border-radius: 10px; border: 1px solid var(--border-color);
		background: var(--bg-elevated); color: var(--text-secondary); font-size: 0.9rem;
		font-weight: 600; cursor: pointer; transition: all 0.15s;
	}
	.box-btn.active {
		border-color: var(--accent-primary); color: var(--accent-primary);
		background: rgba(59, 130, 246, 0.1);
	}

	.pack-display { text-align: center; padding: 2rem 0; }
	.pack-visual { margin-bottom: 1.5rem; }
	.pack-icon {
		width: 80px; height: 80px; border-radius: 16px; background: var(--bg-elevated);
		display: flex; align-items: center; justify-content: center;
		font-size: 2rem; font-weight: 800; color: var(--accent-primary);
		margin: 0 auto 0.75rem; border: 2px solid var(--border-color);
	}
	.pack-name { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem; }
	.pack-info { font-size: 0.8rem; color: var(--text-tertiary); }

	.open-actions { display: flex; flex-direction: column; gap: 0.5rem; }
	.btn-open {
		width: 100%; padding: 0.875rem; border-radius: 12px; border: none;
		background: var(--accent-primary); color: #fff; font-size: 1rem;
		font-weight: 600; cursor: pointer;
	}
	.btn-open-box {
		width: 100%; padding: 0.75rem; border-radius: 12px; border: 1px solid var(--border-color);
		background: var(--bg-elevated); color: var(--text-primary); font-size: 0.9rem;
		font-weight: 600; cursor: pointer;
	}

	.pack-opening { padding: 0.5rem 0; }
	.cards-grid {
		display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.pack-card {
		aspect-ratio: 2.5/3.5; border-radius: 8px; border: 2px solid var(--border-color);
		background: var(--bg-elevated); cursor: pointer; transition: all 0.3s;
		padding: 0; overflow: hidden;
	}
	.pack-card.revealed {
		animation: card-flip 0.4s ease-out;
	}
	.pack-card.legendary { animation: card-flip 0.4s ease-out, legendary-pulse 1.5s ease-in-out infinite; }
	.pack-card.ultra-rare { animation: card-flip 0.4s ease-out; }

	@keyframes card-flip {
		0% { transform: rotateY(90deg) scale(0.8); }
		50% { transform: rotateY(0deg) scale(1.05); }
		100% { transform: rotateY(0deg) scale(1); }
	}
	@keyframes legendary-pulse {
		0%, 100% { filter: brightness(1); }
		50% { filter: brightness(1.15); }
	}

	.card-back {
		width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
		background: linear-gradient(135deg, var(--bg-elevated), var(--bg-base));
	}
	.card-back-num { font-size: 1.25rem; font-weight: 700; color: var(--text-tertiary); }

	.card-face {
		width: 100%; height: 100%; display: flex; flex-direction: column;
		align-items: center; justify-content: center; padding: 0.25rem;
		gap: 0.15rem; text-align: center;
	}
	.card-slot-label { font-size: 0.5rem; color: var(--text-tertiary); }
	.card-hero { font-size: 0.6rem; font-weight: 700; line-height: 1.1; }
	.card-number { font-size: 0.5rem; color: var(--text-secondary); }
	.card-meta { display: flex; gap: 0.2rem; align-items: center; }
	.weapon-badge { font-size: 0.5rem; font-weight: 600; text-transform: uppercase; }
	.power-badge { font-size: 0.45rem; color: var(--text-tertiary); }
	.parallel-tag { font-size: 0.45rem; color: var(--accent-primary); font-style: italic; }

	.reveal-controls { text-align: center; }
	.btn-reveal {
		width: 100%; padding: 0.875rem; border-radius: 12px; border: none;
		background: var(--accent-primary); color: #fff; font-size: 1rem;
		font-weight: 600; cursor: pointer;
	}
	.btn-reveal-all {
		width: 100%; padding: 0.625rem; border-radius: 10px; border: none;
		background: transparent; color: var(--text-secondary); font-size: 0.85rem;
		cursor: pointer; margin-top: 0.5rem;
	}
	.pack-summary { margin-bottom: 1rem; }
	.best-pull { font-size: 0.9rem; color: var(--text-primary); }

	.post-actions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
	.btn-back {
		width: 100%; padding: 0.625rem; border-radius: 10px; border: none;
		background: transparent; color: var(--text-secondary); font-size: 0.85rem; cursor: pointer;
	}

	.box-summary { padding: 0.5rem 0; }
	.pack-detail {
		background: var(--bg-elevated); border-radius: 10px; padding: 0.75rem;
		margin-bottom: 0.5rem;
	}
	.pack-detail summary {
		cursor: pointer; font-size: 0.85rem; font-weight: 600;
	}
	.pack-cards-list { margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.25rem; }
	.list-card {
		display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.5rem;
		background: var(--bg-base); border-radius: 6px; font-size: 0.8rem;
	}
	.list-hero { font-weight: 600; flex: 1; }
	.list-num { color: var(--text-secondary); font-size: 0.7rem; }
	.list-weapon { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
	.list-parallel { font-size: 0.65rem; color: var(--accent-primary); font-style: italic; }
</style>
