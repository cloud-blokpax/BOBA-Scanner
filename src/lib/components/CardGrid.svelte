<script lang="ts">
	import { onMount } from 'svelte';
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import type { CollectionItem, CardRarity } from '$lib/types';
	import { collectionSets,collectionRarities,collectionWeaponTypes } from '$lib/stores/collection.svelte';
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';
	import { getCardImageUrl } from '$lib/utils/image-url';
	import OptimizedCardImage from '$lib/components/OptimizedCardImage.svelte';
	import VariantBadge from '$lib/components/VariantBadge.svelte';

	const multiGameEnabled = featureEnabled('multi_game_ui');

	/** Show a variant badge on the thumbnail for Wonders cards when the
	 *  multi-game flag is on and the variant is something other than paper. */
	function showVariantBadge(item: CollectionItem): boolean {
		if (!multiGameEnabled()) return false;
		if (item.card?.game_id !== 'wonders') return false;
		const v = (item.variant || 'paper').toLowerCase();
		return v !== 'paper'; // Paper thumbnails stay clean; only foils get a badge.
	}

	let {
		items = [],
		onCardClick
	}: {
		items: CollectionItem[];
		onCardClick?: (item: CollectionItem) => void;
	} = $props();

	let gridContainerEl = $state<HTMLDivElement | null>(null);
	let scrollContainerEl = $state<HTMLDivElement | null>(null);
	let columnCount = $state(3);

	const VIRTUAL_THRESHOLD = 100;
	const ROW_HEIGHT = 248; // card (5:7 at ~140px) + info + gap

	// Calculate columns based on container width
	onMount(() => {
		if (!gridContainerEl) return;
		const observer = new ResizeObserver((entries) => {
			const width = entries[0].contentRect.width;
			const minWidth = width <= 480 ? 100 : 140;
			columnCount = Math.max(1, Math.floor((width + 12) / (minWidth + 12)));
		});
		observer.observe(gridContainerEl);
		return () => observer.disconnect();
	});

	let searchQuery = $state('');
	let sortBy = $state<'name' | 'added' | 'power'>('added');
	let filterSet = $state<string | null>(null);
	let filterRarity = $state<string | null>(null);
	let filterWeapon = $state<string | null>(null);
	let duplicatesOnly = $state(false);
	let showFilters = $state(false);

	const activeFilterCount = $derived(
		[filterSet, filterRarity, filterWeapon, duplicatesOnly || null].filter(Boolean).length
	);

	const filteredItems = $derived.by(() => {
		let result = items;

		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			result = result.filter(
				(item) =>
					item.card?.name?.toLowerCase().includes(q) ||
					item.card?.card_number?.toLowerCase().includes(q) ||
					item.card?.set_code?.toLowerCase().includes(q)
			);
		}

		if (filterSet) {
			result = result.filter((item) => item.card?.set_code === filterSet);
		}

		if (filterRarity) {
			result = result.filter((item) => item.card?.rarity === filterRarity);
		}

		if (filterWeapon) {
			result = result.filter((item) => item.card?.weapon_type === filterWeapon);
		}

		if (duplicatesOnly) {
			result = result.filter((item) => item.quantity > 1);
		}

		return [...result].sort((a, b) => {
			switch (sortBy) {
				case 'name':
					return (a.card?.name || '').localeCompare(b.card?.name || '');
				case 'power':
					return (b.card?.power || 0) - (a.card?.power || 0);
				case 'added':
				default:
					return new Date(b.added_at).getTime() - new Date(a.added_at).getTime();
			}
		});
	});

	const useVirtual = $derived(filteredItems.length > VIRTUAL_THRESHOLD);

	const virtualRows = $derived.by(() => {
		const rows: CollectionItem[][] = [];
		for (let i = 0; i < filteredItems.length; i += columnCount) {
			rows.push(filteredItems.slice(i, i + columnCount));
		}
		return rows;
	});

	const virtualizer = $derived(
		useVirtual && scrollContainerEl
			? createVirtualizer({
				count: virtualRows.length,
				getScrollElement: () => scrollContainerEl,
				estimateSize: () => ROW_HEIGHT,
				overscan: 3
			})
			: null
	);

	function clearFilters() {
		filterSet = null;
		filterRarity = null;
		filterWeapon = null;
		duplicatesOnly = false;
	}

	function rarityLabel(r: string): string {
		return r.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	}
</script>

<div class="card-grid-container" bind:this={gridContainerEl}>
	<div class="grid-controls">
		<input
			type="search"
			placeholder="Search cards..."
			bind:value={searchQuery}
			class="search-input"
		/>
		<button
			class="filter-toggle-btn"
			class:has-filters={activeFilterCount > 0}
			onclick={() => showFilters = !showFilters}
			aria-label="Toggle filters"
		>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path d="M1 3h14M4 8h8M6 13h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
			</svg>
			{#if activeFilterCount > 0}
				<span class="filter-badge">{activeFilterCount}</span>
			{/if}
		</button>
		<select bind:value={sortBy} class="sort-select">
			<option value="added">Recently Added</option>
			<option value="name">Name</option>
			<option value="power">Power</option>
		</select>
	</div>

	{#if showFilters}
		<div class="filter-panel">
			<!-- Set filter chips -->
			{#if collectionSets().length > 0}
				<div class="filter-group">
					<span class="filter-group-label">Set</span>
					<div class="filter-chips">
						{#each collectionSets() as setCode}
							<button
								class="filter-chip"
								class:active={filterSet === setCode}
								onclick={() => filterSet = filterSet === setCode ? null : setCode}
							>{setCode}</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Rarity filter chips -->
			{#if collectionRarities().length > 0}
				<div class="filter-group">
					<span class="filter-group-label">Rarity</span>
					<div class="filter-chips">
						{#each collectionRarities() as rarity}
							<button
								class="filter-chip rarity-chip-{rarity}"
								class:active={filterRarity === rarity}
								onclick={() => filterRarity = filterRarity === rarity ? null : rarity}
							>{rarityLabel(rarity)}</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Weapon type filter chips -->
			{#if collectionWeaponTypes().length > 0}
				<div class="filter-group">
					<span class="filter-group-label">Weapon</span>
					<div class="filter-chips">
						{#each collectionWeaponTypes() as weapon}
							<button
								class="filter-chip"
								class:active={filterWeapon === weapon}
								onclick={() => filterWeapon = filterWeapon === weapon ? null : weapon}
							>{weapon}</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Special toggles -->
			<div class="filter-group">
				<div class="filter-chips">
					<button
						class="filter-chip toggle-chip"
						class:active={duplicatesOnly}
						onclick={() => duplicatesOnly = !duplicatesOnly}
					>Duplicates Only</button>
				</div>
			</div>

			{#if activeFilterCount > 0}
				<button class="clear-filters-btn" onclick={clearFilters}>Clear all filters</button>
			{/if}
		</div>
	{/if}

	<!-- Result count -->
	<div class="result-count">
		Showing {filteredItems.length} of {items.length} card{items.length !== 1 ? 's' : ''}
		{#if activeFilterCount > 0}
			<span class="filter-note">({activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active)</span>
		{/if}
	</div>

	{#if filteredItems.length === 0}
		<div class="empty-state">
			{#if searchQuery || activeFilterCount > 0}
				<p>No cards match your search</p>
				<button class="clear-search-btn" onclick={() => { searchQuery = ''; clearFilters(); }}>
					Clear search & filters
				</button>
			{:else}
				<p>Your collection is empty</p>
				<a href="/scan" class="scan-cta-btn">Scan your first card</a>
			{/if}
		</div>
	{:else if useVirtual && virtualizer}
		<!-- Virtual scrolling for large collections -->
		{@const virt = $virtualizer!}
		<div class="virtual-scroll-container" bind:this={scrollContainerEl}>
			<div style="height: {virt.getTotalSize()}px; width: 100%; position: relative;">
				{#each virt.getVirtualItems() as virtualRow (virtualRow.index)}
					<div
						class="virtual-row"
						style="position: absolute; top: 0; left: 0; width: 100%; height: {virtualRow.size}px; transform: translateY({virtualRow.start}px);"
					>
						<div class="card-grid">
							{#each virtualRows[virtualRow.index] as item (item.id)}
								{@const imgUrl = item.card ? getCardImageUrl(item.card) : null}
								<button class="card-tile" onclick={() => onCardClick?.(item)}>
									{#if imgUrl}
										<OptimizedCardImage src={imgUrl} alt={item.card?.name ?? 'Card'} className="card-image" size="thumb" />
									{:else}
										<div class="card-placeholder"><span class="card-emoji">🎴</span></div>
									{/if}
									{#if showVariantBadge(item)}
										<div class="card-variant-overlay">
											<VariantBadge variant={item.variant} size="sm" />
										</div>
									{/if}
									<div class="card-info">
										<span class="card-name">{item.card?.name || 'Unknown'}</span>
										<span class="card-number">{item.card?.card_number || ''}</span>
										{#if item.quantity > 1}
											<span class="card-qty">x{item.quantity}</span>
										{/if}
									</div>
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<!-- Standard grid for small collections -->
		<div class="card-grid">
			{#each filteredItems as item (item.id)}
				{@const imgUrl = item.card ? getCardImageUrl(item.card) : null}
				<button class="card-tile" onclick={() => onCardClick?.(item)}>
					{#if imgUrl}
						<img src={imgUrl} alt={item.card?.name ?? 'Card'} class="card-image" loading="lazy" />
					{:else}
						<div class="card-placeholder"><span class="card-emoji">🎴</span></div>
					{/if}
					{#if showVariantBadge(item)}
						<div class="card-variant-overlay">
							<VariantBadge variant={item.variant} size="sm" />
						</div>
					{/if}
					<div class="card-info">
						<span class="card-name">{item.card?.name || 'Unknown'}</span>
						<span class="card-number">{item.card?.card_number || ''}</span>
						{#if item.quantity > 1}
							<span class="card-qty">x{item.quantity}</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.card-grid-container {
		width: 100%;
	}

	.grid-controls {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.search-input {
		flex: 1;
		padding: 0.625rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-secondary, #0d1524);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.9rem;
	}

	.sort-select {
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-secondary, #0d1524);
		color: var(--text-primary, #f1f5f9);
		font-size: 0.9rem;
	}

	/* ── Filter toggle button ── */
	.filter-toggle-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-secondary, #0d1524);
		color: var(--text-secondary, #94a3b8);
		cursor: pointer;
		position: relative;
		transition: border-color 0.15s, color 0.15s;
	}

	.filter-toggle-btn.has-filters {
		border-color: var(--accent-primary, #3b82f6);
		color: var(--accent-primary, #3b82f6);
	}

	.filter-badge {
		position: absolute;
		top: -5px;
		right: -5px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--accent-primary, #3b82f6);
		color: white;
		font-size: 0.6rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: badge-appear 0.3s ease-out;
	}

	/* ── Filter panel ── */
	.filter-panel {
		padding: 0.75rem;
		margin-bottom: 0.75rem;
		background: var(--surface-primary, #070b14);
		border: 1px solid var(--border-color, #1e293b);
		border-radius: 10px;
		animation: slide-up-fade 0.2s ease-out;
	}

	.filter-group {
		margin-bottom: 0.625rem;
	}

	.filter-group:last-of-type {
		margin-bottom: 0.5rem;
	}

	.filter-group-label {
		display: block;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-tertiary, #64748b);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.375rem;
	}

	.filter-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.filter-chip {
		padding: 0.3rem 0.65rem;
		border-radius: 14px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-secondary, #0d1524);
		color: var(--text-secondary, #94a3b8);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.filter-chip:hover {
		border-color: var(--border-strong, rgba(148, 163, 184, 0.2));
	}

	.filter-chip.active {
		background: var(--accent-primary-dim, rgba(59, 130, 246, 0.1));
		border-color: var(--accent-primary, #3b82f6);
		color: var(--accent-primary, #3b82f6);
		font-weight: 600;
	}

	/* Rarity-specific active colors */
	.filter-chip.rarity-chip-common.active { color: var(--rarity-common, #9CA3AF); border-color: var(--rarity-common, #9CA3AF); }
	.filter-chip.rarity-chip-uncommon.active { color: var(--rarity-uncommon, #22C55E); border-color: var(--rarity-uncommon, #22C55E); }
	.filter-chip.rarity-chip-rare.active { color: var(--rarity-rare, #3B82F6); border-color: var(--rarity-rare, #3B82F6); }
	.filter-chip.rarity-chip-ultra_rare.active { color: var(--rarity-epic, #A855F7); border-color: var(--rarity-epic, #A855F7); }
	.filter-chip.rarity-chip-legendary.active { color: var(--rarity-legendary, #F59E0B); border-color: var(--rarity-legendary, #F59E0B); }

	.toggle-chip.active {
		background: var(--accent-gold, #f59e0b);
		border-color: var(--accent-gold, #f59e0b);
		color: #000;
	}

	.clear-filters-btn {
		display: block;
		width: 100%;
		padding: 0.4rem;
		border: none;
		background: none;
		color: var(--text-tertiary, #64748b);
		font-size: 0.75rem;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.clear-filters-btn:hover {
		color: var(--text-secondary, #94a3b8);
	}

	/* ── Result count ── */
	.result-count {
		font-size: 0.75rem;
		color: var(--text-tertiary, #64748b);
		margin-bottom: 0.75rem;
	}

	.filter-note {
		color: var(--accent-primary, #3b82f6);
	}

	.virtual-scroll-container {
		height: 70vh;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}

	.card-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.75rem;
	}

	.card-tile {
		display: flex;
		flex-direction: column;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-secondary, #0d1524);
		cursor: pointer;
		transition: transform 0.15s, border-color 0.15s;
		padding: 0;
		text-align: left;
		color: inherit;
	}

	.card-tile:hover {
		transform: translateY(-2px);
		border-color: var(--accent-primary, #3b82f6);
	}

	.card-image {
		width: 100%;
		aspect-ratio: 5 / 7;
		object-fit: cover;
	}

	.card-placeholder {
		width: 100%;
		aspect-ratio: 5 / 7;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-primary, #070b14);
	}

	.card-emoji {
		font-size: 2rem;
	}

	.card-info {
		padding: 0.5rem;
	}

	.card-name {
		font-size: 0.8rem;
		font-weight: 600;
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-number {
		font-size: 0.7rem;
		color: var(--text-secondary, #94a3b8);
	}

	.card-qty {
		font-size: 0.7rem;
		color: var(--accent-gold, #f59e0b);
		font-weight: 600;
	}

	.empty-state {
		grid-column: 1 / -1;
		text-align: center;
		padding: 3rem;
		color: var(--text-secondary, #94a3b8);
	}

	.empty-state p {
		margin-bottom: 1rem;
		font-size: 1rem;
	}

	.clear-search-btn {
		padding: 0.625rem 1.25rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: transparent;
		color: var(--text-primary, #f1f5f9);
		font-weight: 500;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.scan-cta-btn {
		display: inline-block;
		padding: 0.75rem 1.5rem;
		border-radius: 8px;
		background: var(--accent-primary, #3b82f6);
		color: white;
		font-weight: 600;
		font-size: 0.9rem;
		text-decoration: none;
		transition: opacity 0.15s;
	}

	.scan-cta-btn:hover {
		opacity: 0.9;
	}

	@media (max-width: 480px) {
		.card-grid {
			grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		}
	}

	/* ── Variant badge overlay (Phase 2.5, Wonders + multi-game flag) ── */
	.card-variant-overlay {
		position: absolute;
		top: 4px;
		left: 4px;
		z-index: 2;
		pointer-events: none;
	}
	.card-tile { position: relative; }
</style>
