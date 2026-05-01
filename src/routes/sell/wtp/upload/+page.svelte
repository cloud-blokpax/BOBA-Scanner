<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { recognizeCard, initWorkers } from '$lib/services/recognition';
	import { releaseOcrWorker } from '$lib/services/paddle-ocr';
	import { uploadScanImageForListing } from '$lib/stores/collection.svelte';

	let processing = $state(false);
	let error = $state<string | null>(null);
	let thumbUrl = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	// Pre-warm the OCR workers as soon as the user lands on this page so the
	// model is ready before they pick a photo. initWorkers is idempotent and
	// concurrency-safe — repeat calls share an in-flight promise.
	onMount(() => {
		initWorkers().catch((err) => {
			console.warn('[sell/wtp/upload] OCR pre-warm failed; will retry on first scan', err);
		});
	});

	async function handleFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.value = '';

		error = null;
		processing = true;
		if (thumbUrl) URL.revokeObjectURL(thumbUrl);
		thumbUrl = URL.createObjectURL(file);

		let bitmap: ImageBitmap | null = null;
		try {
			// Two-step decode preserves aspect ratio. createImageBitmap with both
			// resizeWidth and resizeHeight set distorts the image to a square per
			// the WHATWG spec — silently degrades OCR (vertical compression of a
			// portrait card). Probe first, then proportional resize.
			//
			// resizeQuality 'medium' (bilinear) instead of 'high' (Lanczos): for
			// a 12MP-to-2048 downsample the OCR-quality difference is undetectable
			// and 'high' has a transient working buffer ~1.5x output size that
			// matters on iOS WebKit's tighter memory budget.
			//
			// initWorkers runs in parallel with decode — saves the smaller of the
			// two latencies on a cold session (pre-warm not yet complete).
			const decodePromise = (async () => {
				const probe = await createImageBitmap(file);
				const longEdge = Math.max(probe.width, probe.height);
				if (longEdge <= 2048) {
					return probe;
				}
				const scale = 2048 / longEdge;
				const resized = await createImageBitmap(probe, {
					resizeWidth: Math.round(probe.width * scale),
					resizeHeight: Math.round(probe.height * scale),
					resizeQuality: 'medium'
				});
				probe.close();
				return resized;
			})();

			const [, decodedBitmap] = await Promise.all([initWorkers(), decodePromise]);
			bitmap = decodedBitmap;
			const result = await recognizeCard(bitmap, undefined, { isAuthenticated: true, skipBlurCheck: true });

			if (!result.card_id || !result.card || !result.id) {
				error = result.failReason || 'Could not identify card. Try a clearer photo.';
				return;
			}

			if (result.game_id !== 'wonders') {
				goto(`/sell/wtp/wrong-game?card_id=${encodeURIComponent(result.card_id)}&game=${encodeURIComponent(result.game_id ?? 'boba')}&scan_id=${encodeURIComponent(result.id)}`);
				return;
			}

			if (thumbUrl) {
				uploadScanImageForListing(result.card.id, thumbUrl).catch((err) => {
					console.warn('[sell/wtp/upload] image upload failed', err);
				});
			}

			goto(`/sell/wtp/compose/${result.id}`);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Processing failed';
		} finally {
			bitmap?.close();
			// Release the PaddleOCR client between WTP uploads. iOS Safari's
			// per-tab memory ceiling otherwise kills the page on card #2.
			// Cold-start cost (~300–600ms) on the next card is acceptable here.
			await releaseOcrWorker().catch(() => {});
			processing = false;
		}
	}
</script>

<svelte:head><title>Upload for WTP</title></svelte:head>

<div class="wtp-upload">
	<div class="header">
		<button class="back" onclick={() => goto('/sell/wtp')}>← Back</button>
		<h1>Upload a Wonders card photo</h1>
	</div>

	<div class="container">
		{#if processing}
			<div class="processing">
				{#if thumbUrl}
					<img src={thumbUrl} alt="Processing" class="preview" />
				{/if}
				<div class="spinner"></div>
				<p>Identifying card…</p>
			</div>
		{:else}
			<label class="drop-zone">
				<span class="icon" aria-hidden="true">📤</span>
				<span class="text">Select a card photo</span>
				<span class="hint">JPEG, PNG, or WebP</span>
				<input bind:this={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onchange={handleFile} />
			</label>
			{#if error}
				<div class="error">
					<p>{error}</p>
					<button onclick={() => { error = null; fileInput?.click(); }}>Try another photo</button>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.wtp-upload { max-width: 600px; margin: 0 auto; }
	.header { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border, rgba(148,163,184,0.10)); }
	.back { background: none; border: none; color: var(--text-secondary, #94a3b8); font-size: 0.9rem; cursor: pointer; padding: 0.25rem; }
	h1 { font-size: 1.1rem; font-weight: 700; margin: 0; }
	.container { display: flex; flex-direction: column; align-items: center; padding: 2rem 1rem; gap: 1.5rem; min-height: calc(100dvh - 56px - 68px - 52px - 44px); }
	.drop-zone { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; width: 100%; max-width: 320px; padding: 3rem 1.5rem; border: 2px dashed var(--border-strong, rgba(148,163,184,0.3)); border-radius: 16px; cursor: pointer; }
	.drop-zone:hover, .drop-zone:focus-within { border-color: var(--accent-primary, #3b82f6); }
	.drop-zone .icon { font-size: 2.5rem; }
	.drop-zone .text { font-size: 1rem; font-weight: 600; }
	.drop-zone .hint { font-size: 0.8rem; color: var(--text-muted, #475569); }
	.drop-zone input { position: absolute; opacity: 0; width: 0; height: 0; }
	.processing { display: flex; flex-direction: column; align-items: center; gap: 1.25rem; }
	.preview { width: 200px; height: 280px; object-fit: cover; border-radius: 12px; border: 1px solid var(--border, rgba(148,163,184,0.10)); }
	.spinner { width: 32px; height: 32px; border: 3px solid var(--border-strong, rgba(148,163,184,0.2)); border-top-color: var(--accent-primary, #3b82f6); border-radius: 50%; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.error { text-align: center; padding: 1rem; border-radius: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); max-width: 320px; }
	.error p { font-size: 0.85rem; color: var(--danger, #ef4444); margin: 0 0 0.75rem; }
	.error button { padding: 0.5rem 1.25rem; border-radius: 8px; background: var(--accent-primary, #3b82f6); color: white; border: none; font-weight: 600; cursor: pointer; }
</style>
