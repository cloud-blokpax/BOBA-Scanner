<!--
  Phase 1.5.a alignment-signal validation spike.
  Admin-gated. Captures one frame every 250ms, computes six alignment
  signals + pHash-256 for the viewfinder region, and batches to
  /api/dev/alignment-telemetry. Tester taps one of three labels to set
  the ground-truth for all subsequent frames until the next tap.

  Delete this route (and /api/dev/alignment-telemetry/+server.ts, plus
  the computeAlignmentSignals worker method if unused elsewhere) after
  Session 1.5.b ships.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { useScannerCamera } from '$lib/components/scanner/use-scanner-camera.svelte';
	import { captureFrame } from '$lib/services/camera';
	import { getImageWorker, initWorkers } from '$lib/services/recognition-workers';
	import { cropToCardRegion } from '$lib/services/card-cropper';

	type Label = 'no_card' | 'partial' | 'aligned';
	const LABELS: Label[] = ['no_card', 'partial', 'aligned'];
	const CAPTURE_INTERVAL_MS = 250;
	const FLUSH_BATCH_SIZE = 100;

	let videoEl = $state<HTMLVideoElement | null>(null);
	let guideEl = $state<HTMLDivElement | null>(null);
	const camera = useScannerCamera(false);

	let phase = $state<'initializing' | 'ready' | 'running' | 'stopped' | 'error'>('initializing');
	let currentLabel = $state<Label>('no_card');
	let labelChangedAt = $state<string>(new Date().toISOString());
	let sessionId = $state<string>('');
	let frameCount = $state(0);
	let bufferedCount = $state(0);
	let flushedTotal = $state(0);
	let lastFlushStatus = $state<string | null>(null);
	let lastErr = $state<string | null>(null);
	let captureBudgetMs = $state<number>(0);

	let intervalHandle: ReturnType<typeof setInterval> | null = null;
	let buffer: Record<string, unknown>[] = [];
	let flushChain: Promise<void> = Promise.resolve();

	function setLabel(label: Label) {
		if (currentLabel === label) return;
		currentLabel = label;
		labelChangedAt = new Date().toISOString();
	}

	function newSessionId(): string {
		const rand = crypto.randomUUID().slice(0, 8);
		return `spike-${rand}-${Date.now()}`;
	}

	function flush(force = false): Promise<void> {
		flushChain = flushChain.then(async () => {
			if (buffer.length === 0) return;
			if (!force && buffer.length < FLUSH_BATCH_SIZE) return;
			const batch = buffer.slice(0, FLUSH_BATCH_SIZE);
			try {
				const res = await fetch('/api/dev/alignment-telemetry', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ session_id: sessionId, rows: batch })
				});
				if (!res.ok) {
					const txt = await res.text().catch(() => '');
					throw new Error(`HTTP ${res.status} ${txt.slice(0, 140)}`);
				}
				const result = (await res.json()) as { inserted?: number };
				const inserted = result.inserted ?? batch.length;
				flushedTotal += inserted;
				buffer.splice(0, batch.length);
				bufferedCount = buffer.length;
				lastFlushStatus = `OK +${inserted} (total ${flushedTotal})`;
			} catch (err) {
				lastFlushStatus = `ERR ${err instanceof Error ? err.message : String(err)}`;
			}
		});
		return flushChain;
	}

	async function captureOnce() {
		if (!videoEl || !guideEl) return;
		const start = performance.now();
		let bitmap: ImageBitmap | null = null;
		try {
			bitmap = await captureFrame(videoEl);
			const guideRect = guideEl.getBoundingClientRect();
			const videoRect = videoEl.getBoundingClientRect();
			if (guideRect.width < 10 || guideRect.height < 10) return;

			const vf = cropToCardRegion(videoEl.videoWidth, videoEl.videoHeight, guideRect, videoRect);

			const signals = await getImageWorker().computeAlignmentSignals(bitmap, {
				x: vf.x,
				y: vf.y,
				w: vf.width,
				h: vf.height
			});

			buffer.push({
				viewfinder_x: Math.round(vf.x),
				viewfinder_y: Math.round(vf.y),
				viewfinder_width: Math.round(vf.width),
				viewfinder_height: Math.round(vf.height),
				frame_width: videoEl.videoWidth,
				frame_height: videoEl.videoHeight,
				user_label: currentLabel,
				label_changed_at: labelChangedAt,
				blur_inside: signals.blurInside,
				luminance_inside: signals.luminanceInside,
				edge_density_inside: signals.edgeDensityInside,
				edge_density_outside: signals.edgeDensityOutside,
				border_gradient_score: signals.borderGradientScore,
				corner_gradient_score: signals.cornerGradientScore,
				interior_variance: signals.interiorVariance,
				viewfinder_phash_256: signals.phash256
			});
			frameCount++;
			bufferedCount = buffer.length;

			const dt = performance.now() - start;
			captureBudgetMs = Math.round((captureBudgetMs * 0.8 + dt * 0.2) * 10) / 10;

			if (buffer.length >= FLUSH_BATCH_SIZE) {
				void flush(false);
			}
		} catch (err) {
			lastErr = err instanceof Error ? err.message : String(err);
		} finally {
			bitmap?.close();
		}
	}

	function startLoop() {
		if (phase !== 'ready' && phase !== 'stopped') return;
		sessionId = newSessionId();
		frameCount = 0;
		flushedTotal = 0;
		bufferedCount = 0;
		buffer = [];
		labelChangedAt = new Date().toISOString();
		lastFlushStatus = null;
		lastErr = null;
		phase = 'running';
		intervalHandle = setInterval(captureOnce, CAPTURE_INTERVAL_MS);
	}

	async function stopLoop() {
		if (intervalHandle) {
			clearInterval(intervalHandle);
			intervalHandle = null;
		}
		phase = 'stopped';
		while (buffer.length > 0) {
			await flush(true);
		}
	}

	onMount(() => {
		if (!videoEl) return;
		camera
			.initCamera(videoEl, async () => {
				try {
					await initWorkers();
					phase = 'ready';
				} catch (err) {
					lastErr = err instanceof Error ? err.message : String(err);
					phase = 'error';
				}
			})
			.catch(() => {
				phase = 'error';
			});

		return () => {
			if (intervalHandle) clearInterval(intervalHandle);
			camera.destroy();
		};
	});
</script>

<div class="spike">
	<div class="viewfinder">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={videoEl} autoplay playsinline muted></video>
		<div class="scanner-guide-rect" bind:this={guideEl}></div>
		<div class="bracket top-left"></div>
		<div class="bracket top-right"></div>
		<div class="bracket bottom-left"></div>
		<div class="bracket bottom-right"></div>

		<div class="label-banner label-{currentLabel}">
			<strong>{currentLabel.replace('_', ' ')}</strong>
			{#if phase === 'running'}
				· {frameCount}f · buf {bufferedCount} · sent {flushedTotal} · {captureBudgetMs}ms
			{/if}
		</div>

		{#if lastErr}
			<div class="err">err: {lastErr}</div>
		{/if}
		{#if camera.cameraError}
			<div class="err">camera: {camera.cameraError}</div>
		{/if}
	</div>

	<div class="labels">
		{#each LABELS as L (L)}
			<button
				class="label-btn label-{L}"
				class:active={currentLabel === L}
				onclick={() => setLabel(L)}
				disabled={phase === 'initializing' || phase === 'error'}
			>
				{L.replace('_', ' ')}
			</button>
		{/each}
	</div>

	<div class="controls">
		{#if phase === 'ready' || phase === 'stopped'}
			<button class="btn primary" onclick={startLoop}>
				{phase === 'stopped' ? 'New session' : 'Start capture'}
			</button>
		{:else if phase === 'running'}
			<button class="btn stop" onclick={stopLoop}>Stop &amp; flush</button>
		{:else}
			<button class="btn primary" disabled>
				{phase === 'initializing' ? 'Initializing…' : 'Error'}
			</button>
		{/if}
		<div class="session">
			<div>session: <code>{sessionId || '—'}</code></div>
			<div>flush: {lastFlushStatus ?? '—'}</div>
		</div>
	</div>
</div>

<style>
	.spike {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		background: #000;
		color: #fff;
	}
	.viewfinder {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	video {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.scanner-guide-rect {
		position: absolute;
		top: 15%;
		left: 10%;
		right: 10%;
		bottom: 15%;
		z-index: 0;
		pointer-events: none;
	}
	.bracket {
		position: absolute;
		width: 40px;
		height: 40px;
		border: 3px solid rgba(255, 255, 255, 0.75);
		z-index: 2;
		pointer-events: none;
	}
	.bracket.top-left {
		top: 15%;
		left: 10%;
		border-right: 0;
		border-bottom: 0;
		border-top-left-radius: 8px;
	}
	.bracket.top-right {
		top: 15%;
		right: 10%;
		border-left: 0;
		border-bottom: 0;
		border-top-right-radius: 8px;
	}
	.bracket.bottom-left {
		bottom: 15%;
		left: 10%;
		border-right: 0;
		border-top: 0;
		border-bottom-left-radius: 8px;
	}
	.bracket.bottom-right {
		bottom: 15%;
		right: 10%;
		border-left: 0;
		border-top: 0;
		border-bottom-right-radius: 8px;
	}

	.label-banner {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		padding: 6px 12px;
		font-size: 0.85rem;
		font-family: monospace;
		background: rgba(0, 0, 0, 0.7);
		border-radius: 6px;
		white-space: nowrap;
		z-index: 3;
	}
	.label-no_card {
		border: 1px solid rgba(255, 255, 255, 0.3);
	}
	.label-partial {
		border: 1px solid #f59e0b;
		color: #fbbf24;
	}
	.label-aligned {
		border: 1px solid #10b981;
		color: #34d399;
	}

	.err {
		position: absolute;
		bottom: 12px;
		left: 12px;
		right: 12px;
		padding: 6px 10px;
		background: rgba(239, 68, 68, 0.15);
		border: 1px solid rgba(239, 68, 68, 0.5);
		border-radius: 6px;
		font-size: 0.75rem;
		color: #fca5a5;
		z-index: 5;
	}

	.labels {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 8px;
		padding: 12px;
		background: #111;
	}
	.label-btn {
		padding: 1rem 0.5rem;
		font-size: 1rem;
		font-weight: 700;
		text-transform: uppercase;
		border-radius: 8px;
		background: #1f2937;
		color: rgba(255, 255, 255, 0.6);
		border: 2px solid transparent;
		cursor: pointer;
	}
	.label-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.label-btn.active.label-no_card {
		background: #374151;
		color: #fff;
		border-color: #6b7280;
	}
	.label-btn.active.label-partial {
		background: #78350f;
		color: #fbbf24;
		border-color: #f59e0b;
	}
	.label-btn.active.label-aligned {
		background: #064e3b;
		color: #34d399;
		border-color: #10b981;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px;
		background: #0a0a0a;
		border-top: 1px solid #222;
	}
	.btn {
		padding: 0.75rem 1.25rem;
		font-size: 0.95rem;
		font-weight: 700;
		border: none;
		border-radius: 8px;
		cursor: pointer;
	}
	.btn.primary {
		background: #3b82f6;
		color: #fff;
	}
	.btn.stop {
		background: #ef4444;
		color: #fff;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.session {
		flex: 1;
		font-family: monospace;
		font-size: 0.7rem;
		color: rgba(255, 255, 255, 0.6);
		line-height: 1.4;
		min-width: 0;
		overflow: hidden;
	}
	.session code {
		color: rgba(255, 255, 255, 0.85);
	}
</style>
