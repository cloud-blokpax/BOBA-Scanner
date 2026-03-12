<script lang="ts">
	import { addToCollection } from '$lib/stores/collection';
	import type { ScanResult } from '$lib/types';

	let {
		result,
		onClose,
		onScanAnother
	}: {
		result: ScanResult | null;
		onClose: () => void;
		onScanAnother: () => void;
	} = $props();

	let adding = $state(false);
	let addError = $state<string | null>(null);
	let addSuccess = $state(false);

	async function handleAdd() {
		if (!result?.card) return;
		adding = true;
		addError = null;
		addSuccess = false;
		try {
			await addToCollection(result.card.id);
			addSuccess = true;
		} catch (err) {
			addError = err instanceof Error ? err.message : 'Failed to add card';
		} finally {
			adding = false;
		}
	}

	function methodLabel(method: string): string {
		switch (method) {
			case 'hash_cache':
				return 'Instant (cached)';
			case 'tesseract':
				return 'OCR Match';
			case 'claude':
				return 'AI Identified';
			default:
				return method;
		}
	}
</script>

{#if result}
	<div class="bottom-sheet" role="dialog" aria-modal="true">
		<div class="sheet-handle"></div>

		{#if result.card}
			<div class="result-success">
				<div class="result-header">
					<h2>{result.card.name}</h2>
					{#if result.card.card_number}
						<span class="result-number">#{result.card.card_number}</span>
					{/if}
				</div>

				<div class="result-meta">
					{#if result.card.set_code}
						<span class="meta-pill">{result.card.set_code}</span>
					{/if}
					{#if result.card.weapon_type}
						<span class="meta-pill">{result.card.weapon_type}</span>
					{/if}
					{#if result.card.power}
						<span class="meta-pill power">PWR {result.card.power}</span>
					{/if}
				</div>

				<div class="result-stats">
					<span class="stat-item">
						<span class="stat-label">Method</span>
						<span class="stat-value">{methodLabel(result.scan_method)}</span>
					</span>
					<span class="stat-item">
						<span class="stat-label">Confidence</span>
						<span class="stat-value">{Math.round(result.confidence * 100)}%</span>
					</span>
					<span class="stat-item">
						<span class="stat-label">Time</span>
						<span class="stat-value">{result.processing_ms}ms</span>
					</span>
				</div>

				{#if addError}
					<p class="add-error">{addError}</p>
				{/if}

				<div class="result-actions">
					<button class="btn-primary" onclick={handleAdd} disabled={adding || addSuccess}>
						{adding ? 'Adding...' : addSuccess ? 'Added!' : 'Add to Collection'}
					</button>
					<button class="btn-secondary" onclick={onScanAnother}>
						Scan Another
					</button>
				</div>
			</div>
		{:else}
			<div class="result-fail">
				<h2>Card Not Identified</h2>
				<p>Try adjusting the angle or lighting and scan again.</p>
				<div class="result-actions">
					<button class="btn-primary" onclick={onScanAnother}>Try Again</button>
					<button class="btn-secondary" onclick={onClose}>Close</button>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.bottom-sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: var(--surface-secondary, #0d1524);
		border-radius: 16px 16px 0 0;
		padding: 1rem 1.5rem 2rem;
		z-index: 500;
		box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
		max-height: 60vh;
		overflow-y: auto;
	}

	.sheet-handle {
		width: 40px;
		height: 4px;
		border-radius: 2px;
		background: var(--border-color, #1e293b);
		margin: 0 auto 1rem;
	}

	.result-header h2 {
		font-family: 'Syne', sans-serif;
		font-size: 1.25rem;
		font-weight: 700;
	}

	.result-number {
		font-size: 0.9rem;
		color: var(--text-secondary, #94a3b8);
	}

	.result-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0.75rem 0;
	}

	.meta-pill {
		padding: 0.25rem 0.625rem;
		border-radius: 12px;
		background: var(--surface-primary, #070b14);
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
	}

	.meta-pill.power {
		color: var(--accent-gold, #f59e0b);
		font-weight: 600;
	}

	.result-stats {
		display: flex;
		gap: 1.5rem;
		margin: 1rem 0;
		padding: 0.75rem 0;
		border-top: 1px solid var(--border-color, #1e293b);
		border-bottom: 1px solid var(--border-color, #1e293b);
	}

	.stat-item {
		display: flex;
		flex-direction: column;
	}

	.stat-label {
		font-size: 0.7rem;
		color: var(--text-tertiary, #64748b);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.stat-value {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.result-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.result-actions button {
		flex: 1;
		padding: 0.875rem;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.btn-primary {
		background: var(--accent-primary, #3b82f6);
		color: white;
		border: none;
	}

	.btn-primary:disabled {
		opacity: 0.5;
	}

	.btn-secondary {
		background: transparent;
		border: 1px solid var(--border-color, #1e293b);
		color: var(--text-primary, #f1f5f9);
	}

	.add-error {
		color: #ef4444;
		font-size: 0.85rem;
		margin-bottom: 0.5rem;
	}

	.result-fail {
		text-align: center;
	}

	.result-fail h2 {
		font-family: 'Syne', sans-serif;
		margin-bottom: 0.5rem;
	}

	.result-fail p {
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 1rem;
	}
</style>
