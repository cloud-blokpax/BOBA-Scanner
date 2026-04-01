<script lang="ts">
	import { page } from '$app/stores';

	export interface CategoryTab {
		label: string;
		path: string;
		badge?: string;
	}

	let {
		tabs,
		category
	}: {
		tabs: CategoryTab[];
		category: string;
	} = $props();

	const currentPath = $derived($page.url.pathname);
	const currentSearch = $derived($page.url.search);

	function isActive(tab: CategoryTab): boolean {
		const [tabPath, tabQuery] = tab.path.split('?');
		if (currentPath === tabPath) {
			// If tab has a query param requirement, check it
			if (tabQuery) return currentSearch.includes(tabQuery);
			return true;
		}
		return false;
	}
</script>

<nav class="category-tabs" aria-label="{category} navigation">
	<div class="tabs-scroll">
		{#each tabs as tab (tab.path)}
			<a
				href={tab.path}
				class="cat-tab"
				class:active={isActive(tab)}
			>
				{tab.label}
				{#if tab.badge}
					<span class="tab-badge">{tab.badge}</span>
				{/if}
			</a>
		{/each}
	</div>
</nav>

<style>
	.category-tabs {
		position: sticky;
		top: 0;
		z-index: 10;
		background: var(--bg-base, #070b14);
		border-bottom: 1px solid var(--border, rgba(148,163,184,0.08));
		padding: 0 0.75rem;
	}

	.tabs-scroll {
		display: flex;
		gap: 0;
		overflow-x: auto;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}

	.tabs-scroll::-webkit-scrollbar {
		display: none;
	}

	.cat-tab {
		flex-shrink: 0;
		padding: 0.6rem 0.75rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-muted, #475569);
		text-decoration: none;
		white-space: nowrap;
		border-bottom: 2px solid transparent;
		transition: color 0.15s, border-color 0.15s;
	}

	.cat-tab:hover {
		color: var(--text-secondary, #94a3b8);
	}

	.cat-tab.active {
		color: var(--accent-primary, #3b82f6);
		border-bottom-color: var(--accent-primary, #3b82f6);
	}

	.tab-badge {
		font-size: 0.55rem;
		font-weight: 700;
		padding: 1px 4px;
		border-radius: 3px;
		background: var(--gold, #f59e0b);
		color: #000;
		margin-left: 3px;
		vertical-align: super;
		letter-spacing: 0.02em;
	}
</style>
