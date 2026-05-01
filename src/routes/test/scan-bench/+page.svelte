<script lang="ts">
	import { onMount } from 'svelte';
	import { runCanonicalTier1 } from '$lib/services/tier1-canonical';
	import { detectCardRect } from '$lib/services/upload-card-detector';
	import { cropToCanonical } from '$lib/services/constrained-crop';
	import { initPaddleOCR } from '$lib/services/paddle-ocr';

	// Mirror the upload-side path that recognition.ts runs for File inputs.
	// We expose a single helper that loads a data URL, builds an ImageBitmap,
	// detects the card rect, crops to canonical, runs Tier 1 OCR, and reports
	// the result. This is the SAME path production runs on a user upload —
	// we're just driving it from a test harness instead of from the Scanner UI.

	async function runBenchScan(dataUrl: string, game: 'boba' | 'wonders') {
		const t0 = performance.now();
		await initPaddleOCR();
		const blob = await (await fetch(dataUrl)).blob();
		const bitmap = await createImageBitmap(blob);

		const rect = await detectCardRect(bitmap);
		const viewfinder = {
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height
		};
		const canonical = await cropToCanonical(bitmap, viewfinder);

		const tier1 = await runCanonicalTier1(canonical, game);

		bitmap.close?.();
		canonical.close?.();

		return {
			cardNumber: tier1.cardNumber,
			name: tier1.name,
			parallel: tier1.parallel,
			cardId: tier1.card?.id ?? null,
			confidence: tier1.confidence,
			winningTier: tier1.card ? 'tier1' : null,
			fallbackUsed: null, // bench harness doesn't run Haiku — gates on Tier 1 only
			ocrStrategy: tier1.ocrStrategy,
			latencyMs: Math.round(performance.now() - t0)
		};
	}

	onMount(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(window as any).__runBenchScan = runBenchScan;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(window as any).__SCAN_BENCH_READY = true;
		console.log('[scan-bench] ready');
	});
</script>

<main style="padding: 2rem; font-family: system-ui;">
	<h1>Scan Bench Harness</h1>
	<p>This page exposes <code>window.__runBenchScan(dataUrl, game)</code> for the Playwright runner.</p>
	<p>Status: <code id="status">ready</code></p>
</main>
