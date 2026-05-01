<script lang="ts">
	import type { PlayCard } from '$lib/services/playbook-engine';
	import { buildEbaySearchUrl } from '$lib/services/ebay';
	import { getPrice } from '$lib/stores/prices.svelte';
	import type { PriceData } from '$lib/types';

	let {
		play,
		isBonus = false,
		onexclude,
		onremove
	}: {
		play: PlayCard;
		isBonus?: boolean;
		onexclude: (name: string) => void;
		onremove: (name: string) => void;
	} = $props();

	const ebayUrl = $derived(
		buildEbaySearchUrl({
			card_number: play.card_number,
			name: play.name
		})
	);

	let price = $state<PriceData | null>(null);
	let priceLoading = $state(true);
	let menuOpen = $state(false);

	$effect(() => {
		const id = play.id;
		let cancelled = false;
		priceLoading = true;
		price = null;
		getPrice(id)
			.then((data) => {
				if (!cancelled) {
					price = data;
					priceLoading = false;
				}
			})
			.catch(() => {
				if (!cancelled) {
					price = null;
					priceLoading = false;
				}
			});
		return () => {
			cancelled = true;
		};
	});

	function formatPrice(val: number | null | undefined): string {
		if (val === null || val === undefined) return '';
		if (val >= 100) return `$${Math.round(val)}`;
		return `$${val.toFixed(2)}`;
	}

	function handleExclude() {
		menuOpen = false;
		onexclude(play.name);
	}

	function handleRemove() {
		menuOpen = false;
		onremove(play.name);
	}

	function handleMenuClick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		menuOpen = !menuOpen;
	}

	function handleClickOutside() {
		menuOpen = false;
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="play-row" class:bonus={isBonus}>
	<a
		class="play-link"
		href={ebayUrl}
		target="_blank"
		rel="sponsored noopener"
	>
		<div class="play-info">
			<div class="play-title-row">
				<span class="play-name">{play.name}</span>
				{#if isBonus}<span class="badge-bpl">BPL</span>{/if}
			</div>
			<div class="play-meta">
				<span class="card-number">{play.card_number}</span>
				<span class="dot">·</span>
				<span class="stat">{play.dbs} DBS</span>
				<span class="dot">·</span>
				<span class="stat">{play.hot_dog_cost} HD</span>
			</div>
		</div>

		<div class="play-cta">
			{#if !priceLoading && price && price.price_mid}
				<span class="price">{formatPrice(price.price_mid)}</span>
			{/if}
			<span class="ebay-pill">eBay →</span>
		</div>
	</a>

	<button
		class="menu-btn"
		title="More actions"
		onclick={handleMenuClick}
		aria-label="More actions for {play.name}"
	>
		<span class="menu-dots">⋯</span>
	</button>

	{#if menuOpen}
		<div
			class="menu-popup"
			role="menu"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<button class="menu-item" onclick={handleRemove} role="menuitem">
				<span class="menu-item-text">Swap out of this playbook</span>
				<span class="menu-item-hint">Removes from the current 30 only</span>
			</button>
			<button class="menu-item" onclick={handleExclude} role="menuitem">
				<span class="menu-item-text">Don't suggest this play again</span>
				<span class="menu-item-hint">Strategy will rebuild around it</span>
			</button>
		</div>
	{/if}
</div>

<style>
	.play-row {
		position: relative;
		display: flex;
		align-items: stretch;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		transition: border-color var(--transition-fast);
	}
	.play-row:hover {
		border-color: var(--border-strong);
	}
	.play-row.bonus {
		border-left: 3px solid var(--gold);
	}

	/* Tappable area — fills most of the row */
	.play-link {
		flex: 1;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}

	/* Left: name + meta */
	.play-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		flex: 1;
	}
	.play-title-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.play-name {
		font-family: var(--font-display);
		font-size: var(--text-base);
		font-weight: var(--font-bold);
		color: var(--text-primary);
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge-bpl {
		font-size: 9px;
		font-weight: var(--font-bold);
		color: var(--gold);
		background: var(--gold-light);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		letter-spacing: 0.05em;
		flex-shrink: 0;
	}
	.play-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.card-number {
		color: var(--text-secondary);
		font-weight: var(--font-medium);
	}
	.dot {
		opacity: 0.5;
	}
	.stat {
		color: var(--text-muted);
	}

	/* Right: price + gold eBay pill */
	.play-cta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-1);
		flex-shrink: 0;
	}
	.price {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: var(--font-bold);
		color: var(--text-primary);
		line-height: 1;
	}
	.ebay-pill {
		font-family: var(--font-display);
		font-size: var(--text-xs);
		font-weight: var(--font-bold);
		color: var(--gold);
		background: var(--gold-light);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		letter-spacing: 0.02em;
		transition: background var(--transition-fast);
	}
	.play-link:hover .ebay-pill {
		background: var(--gold-glow);
	}

	/* Overflow menu button */
	.menu-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		background: transparent;
		border: none;
		border-left: 1px solid var(--border);
		cursor: pointer;
		color: var(--text-muted);
		transition: color var(--transition-fast), background var(--transition-fast);
		font-family: inherit;
	}
	.menu-btn:hover {
		color: var(--text-primary);
		background: var(--bg-elevated);
	}
	.menu-dots {
		font-size: var(--text-lg);
		font-weight: var(--font-bold);
		line-height: 1;
	}

	/* Popup menu */
	.menu-popup {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: var(--space-1);
		min-width: 240px;
		background: var(--bg-elevated);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		z-index: 10;
		overflow: hidden;
		animation: menu-in 100ms ease-out;
	}
	@keyframes menu-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.menu-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		text-align: left;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		cursor: pointer;
		font-family: inherit;
		color: var(--text-primary);
		transition: background var(--transition-fast);
	}
	.menu-item:hover {
		background: var(--bg-surface);
	}
	.menu-item + .menu-item {
		border-top: 1px solid var(--border);
	}
	.menu-item-text {
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
	}
	.menu-item-hint {
		font-size: var(--text-xs);
		color: var(--text-muted);
		font-weight: var(--font-regular);
	}
</style>
