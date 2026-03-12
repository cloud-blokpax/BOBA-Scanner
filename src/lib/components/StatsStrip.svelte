<script lang="ts">
	import { collectionCount, uniqueCardCount } from '$lib/stores/collection';
</script>

<div class="stats-strip">
	<div class="stat">
		<span class="stat-value">{$uniqueCardCount}</span>
		<span class="stat-label">Unique</span>
	</div>
	<div class="stat-divider"></div>
	<div class="stat">
		<span class="stat-value">{$collectionCount}</span>
		<span class="stat-label">Total</span>
	</div>
</div>

<style>
	.stats-strip {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
		padding: 0.5rem 1rem;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-color);
	}
	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.stat-value {
		font-family: 'Syne', sans-serif;
		font-weight: 700;
		font-size: 1.25rem;
	}
	.stat-label {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.stat-divider {
		width: 1px;
		height: 24px;
		background: var(--border-color);
	}
</style>
