<script lang="ts">
	import { onMount } from 'svelte';
	import { runCanonicalTier1 } from '$lib/services/tier1-canonical';
	import { detectCard } from '$lib/services/upload-card-detector';
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

		const detection = await detectCard(bitmap, { mode: 'upload' });
		const viewfinder = {
			x: detection.boundingRect.x,
			y: detection.boundingRect.y,
			width: detection.boundingRect.width,
			height: detection.boundingRect.height
		};
		const canonical = await cropToCanonical(bitmap, viewfinder, detection.homography);

		const tier1 = await runCanonicalTier1(canonical, game);

		// Doc 1.1 — when DEBUG_DUMP is set, also return the canonical PNG so
		// the harness can write it to disk for visual inspection. Lets us see
		// whether the rectified image actually contains the card text where
		// REGIONS expects it.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let canonicalPng: number[] | null = null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		if ((window as any).__BENCH_DUMP_CANONICAL === true) {
			const cnv = new OffscreenCanvas(canonical.width, canonical.height);
			const ctx2 = cnv.getContext('2d');
			if (ctx2) {
				ctx2.drawImage(canonical, 0, 0);
				const blob = await cnv.convertToBlob({ type: 'image/png' });
				const buf = new Uint8Array(await blob.arrayBuffer());
				canonicalPng = Array.from(buf);
			}
		}

		bitmap.close?.();
		canonical.close?.();

		return {
			// Existing fields — required by run-bench.ts comparison logic
			cardNumber: tier1.cardNumber,
			name: tier1.name,
			parallel: tier1.parallel,
			cardId: tier1.card?.id ?? null,
			confidence: tier1.confidence,
			winningTier: tier1.card ? 'tier1' : null,
			fallbackUsed: null, // bench harness doesn't run Haiku — gates on Tier 1 only
			ocrStrategy: tier1.ocrStrategy,
			latencyMs: Math.round(performance.now() - t0),

			// Diagnostic fields — for baseline interpretation, not for matching
			_raw: {
				// Exact OCR text the consensus produced, before catalog resolution.
				// Tells us whether failures are OCR misreads vs. resolver misses.
				ocrCardNumber: tier1.cardNumber ?? null,
				ocrName: tier1.name ?? null,

				// Catalog row that was resolved (if any). Null = resolver miss.
				resolvedRow: tier1.card
					? {
							id: tier1.card.id,
							card_number: tier1.card.card_number,
							name: tier1.card.name,
							parallel: tier1.card.parallel,
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							game_id: (tier1.card as any).game_id ?? null,
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							set_code: (tier1.card as any).set_code ?? null
						}
					: null,

				// Which catalog lookup path ran. Null until tier1 exposes it.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				resolverPath: (tier1 as any).resolverPath ?? null,

				// Doc 1, Phase 6: geometry trace for bench delta
				geometry: {
					detection_method: detection.method,
					detection_layer: detection.detection_layer ?? null,
					px_per_mm: detection.pxPerMm,
					aspect_ratio: detection.aspectRatio,
					rectification_applied: !!detection.homography,
					canonical_size: '750x1050',
					corners: detection.corners
				},

				canonicalPng
			}
		};
	}

	onMount(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(window as any).__runBenchScan = runBenchScan;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(window as any).__SCAN_BENCH_READY = true;
		console.log('[scan-bench] ready');
	});

	// Pin the page against any navigation that would destroy the
	// __runBenchScan function reference. Bench saw:
	//   "Execution context was destroyed, most likely because of a navigation"
	// on 9 of 20 runs. Vite HMR, link prefetches, and unhandled promise
	// rejections that bubble to a redirect can all do this.
	if (typeof window !== 'undefined') {
		// Block beforeunload during a bench run.
		window.addEventListener('beforeunload', (e) => {
			e.preventDefault();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(e as any).returnValue = '';
		});
		// Catch and log unhandled rejections rather than letting them
		// trigger SvelteKit error navigation.
		window.addEventListener('unhandledrejection', (ev) => {
			console.error('[scan-bench] unhandled rejection (suppressed):', ev.reason);
			ev.preventDefault();
		});
	}
</script>

<main style="padding: 2rem; font-family: system-ui;">
	<h1>Scan Bench Harness</h1>
	<p>This page exposes <code>window.__runBenchScan(dataUrl, game)</code> for the Playwright runner.</p>
	<p>Status: <code id="status">ready</code></p>
</main>
