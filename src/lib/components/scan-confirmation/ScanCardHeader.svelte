<script lang="ts">
	let {
		name,
		heroName,
		cardNumber,
		isOwned,
		ownedCount
	}: {
		name: string;
		heroName: string | null;
		cardNumber: string | null;
		isOwned: boolean;
		ownedCount: number;
	} = $props();
</script>

<div class="card-header">
	<div class="title-row">
		<h2 class="card-name">{name}</h2>
		{#if isOwned}
			<span class="badge badge-owned">In Collection x{ownedCount}</span>
		{:else}
			<span class="badge badge-new">New!</span>
		{/if}
	</div>
	{#if heroName && heroName !== name}
		<p class="hero-name">{heroName}</p>
	{/if}
	{#if cardNumber}
		<span class="card-number">#{cardNumber}</span>
	{/if}
</div>

<style>
	.card-header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.card-name {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1.375rem;
		font-weight: 700;
		color: var(--text-primary, #e2e8f0);
		margin: 0;
	}

	.hero-name {
		font-size: 0.9rem;
		color: var(--text-secondary, #94a3b8);
		margin: 0;
	}

	.card-number {
		font-size: 0.875rem;
		color: var(--text-muted, #475569);
		font-weight: 500;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 10px;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		animation: badge-pop 0.4s ease-out;
	}

	.badge-owned {
		background: var(--primary-light, rgba(59, 130, 246, 0.12));
		color: var(--primary, #3b82f6);
		border: 1px solid rgba(59, 130, 246, 0.25);
	}

	.badge-new {
		background: var(--success-light, rgba(16, 185, 129, 0.12));
		color: var(--success, #10b981);
		border: 1px solid rgba(16, 185, 129, 0.25);
	}

	@keyframes badge-pop {
		0% { transform: scale(0.7); opacity: 0; }
		60% { transform: scale(1.05); }
		100% { transform: scale(1); opacity: 1; }
	}
</style>
