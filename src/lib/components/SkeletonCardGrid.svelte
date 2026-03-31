<script lang="ts">
	let { count = 6, columns = 3 }: { count?: number; columns?: number } = $props();
</script>

<div class="skeleton-grid" style="--cols: {columns}">
	{#each Array(count) as _, i}
		<div class="skel-card" style="animation-delay: {60 * i}ms">
			<div class="skel-image skeleton-shimmer"></div>
			<div class="skel-details">
				<div class="skel-line skeleton-shimmer" style="width: 75%"></div>
				<div class="skel-line short skeleton-shimmer" style="width: 50%"></div>
			</div>
		</div>
	{/each}
</div>

<style>
	.skeleton-grid {
		display: grid;
		grid-template-columns: repeat(var(--cols, 3), 1fr);
		gap: 12px;
		padding: 0;
	}

	.skel-card {
		border-radius: var(--radius-lg, 12px);
		overflow: hidden;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		animation: skeletonFadeIn 0.4s ease-out both;
	}

	@keyframes skeletonFadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.skel-image {
		aspect-ratio: 5 / 7;
	}

	.skel-details {
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.skel-line {
		height: 10px;
		border-radius: 4px;
	}

	.skel-line.short {
		height: 8px;
	}

	.skeleton-shimmer {
		background: linear-gradient(90deg,
			var(--bg-surface, #0d1524) 0%,
			var(--bg-elevated, #121d34) 40%,
			var(--bg-surface, #0d1524) 80%
		);
		background-size: 200% 100%;
		animation: skeleton-shimmer 1.5s infinite ease-in-out;
	}

	@keyframes skeleton-shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	@media (max-width: 400px) {
		.skeleton-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
