<script lang="ts">
	import { onMount } from 'svelte';

	let { children }: { children: any } = $props();

	let hasError = $state(false);
	let errorMessage = $state<string | null>(null);

	onMount(() => {
		const handleError = (event: ErrorEvent) => {
			const file = event.filename || '';
			if (
				file.includes('Scanner') ||
				file.includes('recognition') ||
				file.includes('image-processor') ||
				file.includes('camera')
			) {
				hasError = true;
				errorMessage = event.message || 'Scanner encountered an error';
				event.preventDefault();
			}
		};

		window.addEventListener('error', handleError);
		return () => window.removeEventListener('error', handleError);
	});

	function retry() {
		hasError = false;
		errorMessage = null;
	}
</script>

{#if hasError}
	<div class="scanner-error">
		<div class="error-content">
			<h2>Scanner Error</h2>
			<p>{errorMessage || 'Something went wrong with the scanner.'}</p>
			<div class="error-actions">
				<button class="btn-retry" onclick={retry}>Try Again</button>
				<a href="/" class="btn-home">Go Home</a>
			</div>
		</div>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	.scanner-error {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
		padding: 2rem;
	}
	.error-content {
		text-align: center;
		max-width: 320px;
	}
	h2 {
		font-family: var(--font-display);
		font-size: 1.25rem;
		margin: 0.75rem 0 0.5rem;
	}
	p {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin-bottom: 1.5rem;
	}
	.error-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
	}
	.btn-retry {
		padding: 0.75rem 1.5rem;
		border-radius: 8px;
		border: none;
		background: var(--accent-primary);
		color: white;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-home {
		padding: 0.75rem 1.5rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-primary);
		text-decoration: none;
		font-weight: 600;
	}
</style>
