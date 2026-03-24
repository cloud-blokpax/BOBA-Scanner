<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import {
		getAllParallelConfig,
		updateParallelRarity,
		seedMissingParallels,
		reloadParallelConfig,
		type ParallelConfigEntry
	} from '$lib/services/parallel-config';
	import type { CardRarity } from '$lib/types';

	let parallelEntries = $state<ParallelConfigEntry[]>([]);
	let parallelsLoading = $state(false);
	let seeding = $state(false);
	let editingParallel = $state<string | null>(null);

	const RARITY_TIERS: { key: CardRarity; label: string; color: string }[] = [
		{ key: 'common', label: 'Common', color: '#9CA3AF' },
		{ key: 'uncommon', label: 'Uncommon', color: '#22C55E' },
		{ key: 'rare', label: 'Rare', color: '#3B82F6' },
		{ key: 'ultra_rare', label: 'Ultra Rare', color: '#A855F7' },
		{ key: 'legendary', label: 'Legendary', color: '#F59E0B' }
	];

	const parallelsByRarity = $derived.by(() => {
		const grouped: Record<CardRarity, ParallelConfigEntry[]> = {
			common: [], uncommon: [], rare: [], ultra_rare: [], legendary: []
		};
		for (const entry of parallelEntries) {
			const r = entry.rarity as CardRarity;
			if (grouped[r]) grouped[r].push(entry);
		}
		return grouped;
	});

	$effect(() => {
		loadParallels();
	});

	async function loadParallels() {
		parallelsLoading = true;
		try {
			parallelEntries = await getAllParallelConfig();
		} catch (err) {
			console.debug('[admin] Parallel config load failed:', err);
			showToast('Failed to load parallel config', 'x');
		}
		parallelsLoading = false;
	}

	async function handleSeedParallels() {
		seeding = true;
		try {
			const count = await seedMissingParallels();
			if (count > 0) {
				showToast(`Discovered ${count} new parallel(s)`, 'check');
				await loadParallels();
			} else {
				showToast('No new parallels found', 'check');
			}
		} catch (err) {
			console.debug('[admin] Parallel seeding failed:', err);
			showToast('Failed to seed parallels', 'x');
		}
		seeding = false;
	}

	async function handleRarityChange(parallelName: string, newRarity: CardRarity) {
		parallelEntries = parallelEntries.map((e) =>
			e.parallel_name === parallelName ? { ...e, rarity: newRarity } : e
		);
		editingParallel = null;

		const success = await updateParallelRarity(parallelName, newRarity);
		if (!success) {
			showToast('Failed to update — reloading', 'x');
			await loadParallels();
		}
	}
</script>

<div class="tab-content">
	<div class="parallels-header">
		<p class="parallels-desc">Assign each card parallel to a rarity tier. Tap a parallel to change its rarity.</p>
		<button class="btn-discover" onclick={handleSeedParallels} disabled={seeding}>
			{seeding ? 'Discovering...' : 'Auto-Discover'}
		</button>
	</div>

	{#if parallelsLoading}
		<div class="loading">Loading parallels...</div>
	{:else if parallelEntries.length === 0}
		<div class="empty">
			<p>No parallels configured yet.</p>
			<p>Click "Auto-Discover" to pull parallel names from your card database.</p>
		</div>
	{:else}
		<div class="rarity-columns">
			{#each RARITY_TIERS as tier}
				{@const entries = parallelsByRarity[tier.key]}
				<div class="rarity-column">
					<div class="rarity-header" style:--rarity-color={tier.color}>
						<span class="rarity-dot" style:background={tier.color}></span>
						<span class="rarity-name">{tier.label}</span>
						<span class="rarity-count">{entries.length}</span>
					</div>
					<div class="rarity-list">
						{#each entries as entry}
							<div class="parallel-pill-wrapper">
								<button
									class="parallel-pill"
									style:--pill-color={tier.color}
									onclick={() => editingParallel = editingParallel === entry.parallel_name ? null : entry.parallel_name}
								>
									{entry.parallel_name}
								</button>
								{#if editingParallel === entry.parallel_name}
									<div class="rarity-selector">
										{#each RARITY_TIERS as target}
											<button
												class="rarity-option"
												class:current={target.key === entry.rarity}
												style:--option-color={target.color}
												onclick={() => handleRarityChange(entry.parallel_name, target.key)}
												disabled={target.key === entry.rarity}
											>
												<span class="option-dot" style:background={target.color}></span>
												{target.label}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
						{#if entries.length === 0}
							<span class="empty-tier">No parallels</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.loading, .empty {
		text-align: center;
		padding: 2rem;
		color: var(--text-tertiary);
	}
	.parallels-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.parallels-desc {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin: 0;
	}
	.btn-discover {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--accent-primary);
		background: transparent;
		color: var(--accent-primary);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-discover:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.rarity-columns {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.rarity-column {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 0.75rem;
	}
	.rarity-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.625rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-color);
	}
	.rarity-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.rarity-name {
		font-weight: 700;
		font-size: 0.9rem;
		color: var(--rarity-color);
	}
	.rarity-count {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-left: auto;
	}
	.rarity-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.parallel-pill-wrapper {
		position: relative;
	}
	.parallel-pill {
		padding: 0.3rem 0.75rem;
		border-radius: 16px;
		border: 1px solid color-mix(in srgb, var(--pill-color) 30%, transparent);
		background: color-mix(in srgb, var(--pill-color) 10%, transparent);
		color: var(--pill-color);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.parallel-pill:hover {
		background: color-mix(in srgb, var(--pill-color) 20%, transparent);
		border-color: color-mix(in srgb, var(--pill-color) 50%, transparent);
	}
	.rarity-selector {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 100;
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 0.25rem;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 140px;
	}
	.rarity-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.625rem;
		border: none;
		background: transparent;
		border-radius: 6px;
		font-size: 0.8rem;
		color: var(--text-primary);
		cursor: pointer;
		text-align: left;
	}
	.rarity-option:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.rarity-option.current {
		opacity: 0.4;
		cursor: default;
	}
	.option-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.empty-tier {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		font-style: italic;
	}
</style>
