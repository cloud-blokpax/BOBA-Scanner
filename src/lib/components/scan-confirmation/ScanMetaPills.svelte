<script lang="ts">
	let {
		setCode,
		parallel,
		weaponType,
		power,
		battleZone,
		rarity
	}: {
		setCode: string | null;
		parallel: string | null;
		weaponType: string | null;
		power: number | null;
		battleZone: string | null;
		rarity: string | null;
	} = $props();
</script>

<div class="meta-pills">
	{#if setCode}
		<span class="pill">{setCode}</span>
	{/if}
	{#if parallel}
		<span class="pill pill-parallel">{parallel}</span>
	{/if}
	{#if weaponType}
		<span class="pill">{weaponType}</span>
	{/if}
	{#if power}
		<span class="pill pill-power">PWR {power}</span>
	{/if}
	{#if battleZone}
		<span class="pill">{battleZone}</span>
	{/if}
	{#if rarity}
		<span class="pill pill-rarity rarity-{rarity}">{rarity.replace('_', ' ')}</span>
	{/if}
</div>

<style>
	.meta-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.pill {
		padding: 0.25rem 0.625rem;
		border-radius: 12px;
		background: var(--bg-surface, #0d1524);
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
	}

	.pill-power {
		color: var(--gold, #f59e0b);
		font-weight: 600;
	}

	.pill-parallel {
		color: var(--primary, #3b82f6);
		border: 1px solid rgba(59, 130, 246, 0.2);
		font-weight: 500;
	}

	.pill-rarity { text-transform: capitalize; font-weight: 600; }
	.pill-rarity.rarity-common { color: #9CA3AF; }
	.pill-rarity.rarity-uncommon { color: #22C55E; }
	.pill-rarity.rarity-rare { color: #3B82F6; }
	.pill-rarity.rarity-ultra_rare { color: #A855F7; }
	.pill-rarity.rarity-legendary { color: #F59E0B; }
</style>
