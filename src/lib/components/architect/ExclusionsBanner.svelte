<script lang="ts">
	let {
		count,
		onmanage
	}: {
		count: number;
		onmanage: () => void;
	} = $props();
</script>

{#if count > 0}
	<button class="banner" onclick={onmanage}>
		<span class="dot-icon">●</span>
		<span class="banner-text">
			{count}
			{count === 1 ? 'play' : 'plays'} excluded from suggestions
		</span>
		<span class="manage-link">Manage →</span>
	</button>
{/if}

<style>
	.banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--gold-light);
		border: 1px solid rgba(245, 158, 11, 0.25);
		border-radius: var(--radius-md);
		cursor: pointer;
		font-family: inherit;
		color: inherit;
		text-align: left;
		margin-bottom: var(--space-3);
		transition: background var(--transition-fast);
	}
	.banner:hover {
		background: var(--gold-glow);
	}
	.dot-icon {
		font-size: 8px;
		color: var(--gold);
	}
	.banner-text {
		flex: 1;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.manage-link {
		font-family: var(--font-display);
		font-size: var(--text-xs);
		font-weight: var(--font-bold);
		color: var(--gold);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
</style>
