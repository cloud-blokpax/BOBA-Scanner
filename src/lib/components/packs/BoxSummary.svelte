<!--
	Box Summary

	Shows aggregate pull summary after opening a full box.
-->
<script lang="ts">
	import { getWeapon } from '$lib/data/boba-weapons';
	import type { PackResult, SimulatedCard } from '$lib/types/pack-simulator';

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

	let {
		boxResults,
		onOpenSingle,
		onOpenBox,
		onBack,
		onSelectCard,
	}: {
		boxResults: PackResult[];
		onOpenSingle: () => void;
		onOpenBox: () => void;
		onBack: () => void;
		onSelectCard: (card: SimulatedCard) => void;
	} = $props();

	function rarityColor(weapon: string): string {
		return getWeapon(weapon)?.color || '#9CA3AF';
	}

	function parallelColor(card: SimulatedCard): string {
		return PARALLEL_COLORS[card.parallel.toLowerCase()] || '#a78bfa';
	}
</script>

<div class="box-summary">
	<h2>Box Results &mdash; {boxResults.length} Packs</h2>
	{#each boxResults as pack, packIdx}
		<details class="pack-detail">
			<summary>Pack {packIdx + 1}{pack.bestCard ? ` — Best: ${pack.bestCard.heroName} (${pack.bestCard.weaponType})` : ''}</summary>
			<div class="pack-cards-list">
				{#each pack.cards as card}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="list-card" style="--list-color: {rarityColor(card.weaponType)}; cursor: pointer;" onclick={() => onSelectCard(card)}>
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
		<button class="btn-primary" onclick={onOpenSingle}>Open Single Pack</button>
		<button class="btn-secondary" onclick={onOpenBox}>Open Another Box</button>
		<button class="btn-text" onclick={onBack}>Back</button>
	</div>
</div>

<style>
	.box-summary { padding: 0.5rem 0; animation: floatIn 0.4s ease-out; }
	h2 { font-size: 1.15rem; font-weight: 700; margin-bottom: 0.75rem; }
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
	.post-actions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
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
	.btn-text {
		background: transparent; border: none; color: var(--text-secondary);
		font-size: 0.875rem; cursor: pointer; padding: 0.5rem;
	}

	@keyframes floatIn {
		from { opacity: 0; transform: translateY(20px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
