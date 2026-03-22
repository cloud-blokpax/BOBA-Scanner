<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { ScanResult } from '$lib/types';
	import { recognizeCard } from '$lib/services/recognition';
	import { addToCollection } from '$lib/stores/collection';

	let { onClose }: { onClose?: () => void } = $props();

	interface BatchEntry {
		id: string;
		file: File;
		status: 'pending' | 'processing' | 'done' | 'error';
		result: ScanResult | null;
		error: string | null;
		previewUrl: string;
	}

	const MAX_BATCH = 10;

	let entries = $state<BatchEntry[]>([]);
	let processing = $state(false);
	let committed = $state(false);
	let fileInput = $state<HTMLInputElement>(undefined!);

	onDestroy(() => {
		for (const entry of entries) {
			if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
		}
	});

	const pendingCount = $derived(entries.filter((e) => e.status === 'pending').length);
	const doneCount = $derived(entries.filter((e) => e.status === 'done').length);
	const errorCount = $derived(entries.filter((e) => e.status === 'error').length);

	function handleFiles(event: Event) {
		const target = event.target as HTMLInputElement;
		const files = target.files;
		if (!files) return;

		const remaining = MAX_BATCH - entries.length;
		const newFiles = Array.from(files).slice(0, remaining);

		for (const file of newFiles) {
			if (!file.type.startsWith('image/')) continue;
			entries.push({
				id: Math.random().toString(36).slice(2, 8),
				file,
				status: 'pending',
				result: null,
				error: null,
				previewUrl: URL.createObjectURL(file)
			});
		}
		entries = entries;
	}

	function removeEntry(id: string) {
		const entry = entries.find((e) => e.id === id);
		if (entry) URL.revokeObjectURL(entry.previewUrl);
		entries = entries.filter((e) => e.id !== id);
	}

	async function processAll() {
		processing = true;
		for (const entry of entries) {
			if (entry.status !== 'pending') continue;
			entry.status = 'processing';
			entries = entries;

			try {
				const bitmap = await createImageBitmap(entry.file);
				let result;
				try {
					result = await recognizeCard(bitmap);
				} finally {
					bitmap.close();
				}
				entry.result = result;
				entry.status = 'done';
			} catch (err) {
				entry.error = err instanceof Error ? err.message : 'Scan failed';
				entry.status = 'error';
			}
			entries = entries;
		}
		processing = false;
	}

	async function commitBatch() {
		const successful = entries.filter((e) => e.status === 'done' && e.result?.card_id);
		for (const entry of successful) {
			if (entry.result?.card_id) {
				await addToCollection(entry.result.card_id, 'near_mint');
			}
		}
		committed = true;
	}

	onMount(() => {
		return () => {
			for (const entry of entries) {
				URL.revokeObjectURL(entry.previewUrl);
			}
		};
	});
</script>

<div class="batch-scanner">
	<div class="batch-header">
		<h2>Batch Scanner</h2>
		<button class="close-btn" onclick={() => onClose?.()}>Close</button>
	</div>

	{#if !committed}
		<div class="batch-controls">
			<input
				bind:this={fileInput}
				type="file"
				accept="image/*"
				multiple
				onchange={handleFiles}
				style="display:none"
			/>
			<button
				class="btn-primary"
				onclick={() => fileInput?.click()}
				disabled={entries.length >= MAX_BATCH || processing}
			>
				Add Images ({entries.length}/{MAX_BATCH})
			</button>

			{#if entries.length > 0 && !processing}
				<button class="btn-primary" onclick={processAll}>
					Scan All ({pendingCount} pending)
				</button>
			{/if}

			{#if doneCount > 0 && !processing}
				<button class="btn-primary commit-btn" onclick={commitBatch}>
					Add {doneCount} to Collection
				</button>
			{/if}
		</div>

		<div class="batch-grid">
			{#each entries as entry (entry.id)}
				<div class="batch-tile" class:processing={entry.status === 'processing'}
					class:done={entry.status === 'done'} class:error={entry.status === 'error'}>
					<img src={entry.previewUrl} alt="Card scan" />
					<div class="tile-status">
						{#if entry.status === 'pending'}
							<span class="badge pending">Pending</span>
						{:else if entry.status === 'processing'}
							<span class="badge processing">Scanning...</span>
						{:else if entry.status === 'done'}
							<span class="badge done">{entry.result?.card?.hero_name || 'Found'}</span>
						{:else}
							<span class="badge error">{entry.error || 'Failed'}</span>
						{/if}
					</div>
					{#if !processing}
						<button class="remove-btn" onclick={() => removeEntry(entry.id)}>x</button>
					{/if}
				</div>
			{/each}
		</div>

		{#if entries.length === 0}
			<p class="empty-state">Add up to {MAX_BATCH} card images to scan in batch.</p>
		{/if}
	{:else}
		<div class="commit-success">
			<p>Added {doneCount} cards to your collection!</p>
			{#if errorCount > 0}
				<p class="error-note">{errorCount} cards could not be identified.</p>
			{/if}
			<button class="btn-primary" onclick={() => onClose?.()}>Done</button>
		</div>
	{/if}
</div>

<style>
	.batch-scanner {
		padding: 1rem;
	}
	.batch-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	.batch-header h2 {
		font-family: 'Syne', sans-serif;
		font-weight: 700;
		font-size: 1.25rem;
	}
	.close-btn {
		background: none;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		padding: 0.5rem 1rem;
		border-radius: 8px;
		cursor: pointer;
	}
	.batch-controls {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.commit-btn {
		background: var(--success) !important;
	}
	.batch-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 0.75rem;
	}
	.batch-tile {
		position: relative;
		border-radius: 10px;
		overflow: hidden;
		border: 2px solid var(--border-color);
		aspect-ratio: 5/7;
	}
	.batch-tile.done { border-color: var(--success); }
	.batch-tile.error { border-color: var(--danger); }
	.batch-tile img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.tile-status {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 4px 6px;
		background: rgba(0, 0, 0, 0.7);
	}
	.badge {
		font-size: 0.7rem;
		font-weight: 600;
		color: white;
	}
	.badge.done { color: var(--success); }
	.badge.error { color: var(--danger); }
	.badge.processing { color: var(--accent-primary); }
	.remove-btn {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: none;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		cursor: pointer;
		font-size: 0.75rem;
	}
	.empty-state {
		text-align: center;
		color: var(--text-tertiary);
		padding: 2rem;
	}
	.commit-success {
		text-align: center;
		padding: 2rem;
	}
	.error-note {
		color: var(--text-secondary);
		font-size: 0.85rem;
		margin-top: 0.5rem;
	}
</style>
