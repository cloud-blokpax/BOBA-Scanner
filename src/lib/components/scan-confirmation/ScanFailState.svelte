<script lang="ts">
	import CardCorrection from '$lib/components/CardCorrection.svelte';
	import type { Card } from '$lib/types';

	let {
		capturedImageUrl,
		failReason,
		onScanAnother,
		onClose,
		onManualCorrection
	}: {
		capturedImageUrl: string | null;
		failReason: string | null;
		onScanAnother: () => void;
		onClose: () => void;
		onManualCorrection: (card: Partial<Card>) => void;
	} = $props();

	let showManualSearch = $state(false);
</script>

<div class="fail-state">
	{#if capturedImageUrl}
		<div class="fail-image-wrapper">
			<img src={capturedImageUrl} alt="Scanned card" class="card-image" />
			<div class="fail-image-overlay">?</div>
		</div>
	{/if}
	<h2>Card Not Identified</h2>
	{#if failReason}
		<p class="fail-reason">{failReason}</p>
	{:else}
		<p class="fail-reason">Try adjusting the angle or lighting and scan again.</p>
	{/if}
	{#if showManualSearch}
		<div class="manual-search-container">
			<CardCorrection
				card={{ card_number: '' }}
				onCorrect={onManualCorrection}
				onClose={() => { showManualSearch = false; }}
			/>
		</div>
	{:else}
		<div class="actions">
			<button class="btn btn-add" onclick={() => { showManualSearch = true; }}>Search Manually</button>
			<button class="btn btn-secondary" onclick={onScanAnother}>Try Again</button>
			<button class="btn btn-secondary" onclick={onClose}>Close</button>
		</div>
	{/if}
</div>

<style>
	.fail-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2rem 1.5rem;
		text-align: center;
		gap: 0.75rem;
		flex: 1;
	}

	.fail-state h2 {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1.25rem;
		color: var(--text-primary, #e2e8f0);
		margin: 0;
	}

	.fail-image-wrapper {
		position: relative;
		width: 200px;
		border-radius: 12px;
		overflow: hidden;
		border: 2px solid var(--danger, #ef4444);
		opacity: 0.7;
		margin-bottom: 0.5rem;
	}

	.card-image {
		width: 100%;
		display: block;
		aspect-ratio: 2.5/3.5;
		object-fit: cover;
	}

	.fail-image-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.5);
		font-size: 3rem;
		font-weight: 800;
		color: var(--danger, #ef4444);
	}

	.fail-reason {
		color: var(--text-secondary, #94a3b8);
		margin: 0;
		font-size: 0.9rem;
		max-width: 300px;
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		width: 100%;
		max-width: 360px;
		margin-top: 1rem;
	}

	.btn {
		flex: 1;
		padding: 0.875rem;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		border: none;
		transition: opacity 0.15s, background 0.15s;
	}

	.btn:active { opacity: 0.85; }

	.btn-add {
		background: var(--primary, #3b82f6);
		color: white;
	}

	.btn-secondary {
		background: transparent;
		border: 1px solid var(--border-strong, rgba(148,163,184,0.2));
		color: var(--text-primary, #e2e8f0);
	}

	.manual-search-container {
		width: 100%;
		max-width: 400px;
		margin-top: 0.5rem;
		text-align: left;
	}
</style>
