<!--
	Phase 8 — Corner-tap fallback overlay.

	Surfaces when the detector has missed for too many consecutive frames.
	User taps the four corners of the card on screen. Coordinates are
	captured in viewport space and converted to video-source space, then
	submitted to scan_user_corrections as labeled training data.

	UX:
		- A subtle "Tap each corner" coaching banner.
		- After every tap, a numbered dot appears at the touch point.
		- After 4 taps, fires `oncomplete` with corners in source-video coords.
		- `oncancel` lets the user abort and return to normal capture.

	The overlay overlays the camera viewfinder. The video element MUST cover
	the same area as this component for the coord conversion to be valid;
	`viewportRect` is sampled from the parent's getBoundingClientRect().

	This component is intentionally side-effect free — re-detection or
	re-scan with manual corners is the caller's job.
-->
<script lang="ts">
	import { triggerHaptic } from '$lib/utils/haptics';

	interface Point {
		x: number;
		y: number;
	}

	let {
		videoEl,
		oncomplete,
		oncancel
	}: {
		videoEl: HTMLVideoElement | null;
		oncomplete: (cornersInVideoCoords: Point[]) => void;
		oncancel: () => void;
	} = $props();

	// Taps so far. Stored in viewport coords for SVG rendering; the
	// translation to video-source coords happens at submit time.
	let taps = $state<Point[]>([]);

	const labels = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];

	function pointFromEvent(ev: PointerEvent): Point | null {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const target = ev.currentTarget as any as HTMLElement;
		const rect = target.getBoundingClientRect();
		const x = ev.clientX - rect.left;
		const y = ev.clientY - rect.top;
		if (rect.width < 10 || rect.height < 10) return null;
		return { x, y };
	}

	function viewportToVideoCoords(p: Point, viewportW: number, viewportH: number): Point | null {
		if (!videoEl || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) return null;
		// Mirror the object-fit: cover math from Scanner.svelte's
		// `computeViewfinderInVideoCoords`. The video covers the viewport,
		// possibly with letterboxing in one dimension.
		const videoAspect = videoEl.videoWidth / videoEl.videoHeight;
		const elemAspect = viewportW / viewportH;
		let displayedWidth: number;
		let displayedHeight: number;
		let offsetX: number;
		let offsetY: number;
		if (videoAspect > elemAspect) {
			displayedHeight = viewportH;
			displayedWidth = viewportH * videoAspect;
			offsetX = (displayedWidth - viewportW) / 2;
			offsetY = 0;
		} else {
			displayedWidth = viewportW;
			displayedHeight = viewportW / videoAspect;
			offsetX = 0;
			offsetY = (displayedHeight - viewportH) / 2;
		}
		const scaleX = videoEl.videoWidth / displayedWidth;
		const scaleY = videoEl.videoHeight / displayedHeight;
		return {
			x: Math.round((p.x + offsetX) * scaleX),
			y: Math.round((p.y + offsetY) * scaleY)
		};
	}

	function onPointerDown(ev: PointerEvent) {
		if (taps.length >= 4) return;
		const p = pointFromEvent(ev);
		if (!p) return;
		triggerHaptic('tap');
		taps = [...taps, p];
		if (taps.length === 4) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const target = ev.currentTarget as any as HTMLElement;
			const rect = target.getBoundingClientRect();
			const videoCorners: Point[] = [];
			for (const t of taps) {
				const v = viewportToVideoCoords(t, rect.width, rect.height);
				if (!v) {
					// Bail and reset — caller can show a "video not ready" message.
					taps = [];
					return;
				}
				videoCorners.push(v);
			}
			oncomplete(videoCorners);
		}
	}

	function reset() {
		taps = [];
	}
</script>

<div
	class="corner-tap-overlay"
	onpointerdown={onPointerDown}
	role="button"
	tabindex="0"
	aria-label="Tap each corner of the card"
>
	<div class="banner">
		{#if taps.length < 4}
			<div class="banner-title">Tap each corner</div>
			<div class="banner-subtitle">
				{labels[taps.length]} ({taps.length + 1}/4)
			</div>
		{:else}
			<div class="banner-title">Captured — submitting…</div>
		{/if}
	</div>

	{#each taps as t, i (i)}
		<div class="tap-marker" style="left: {t.x}px; top: {t.y}px;">
			<span class="tap-marker-num">{i + 1}</span>
		</div>
	{/each}

	<div class="controls">
		<button type="button" class="control-btn" onclick={(e) => { e.stopPropagation(); reset(); }}>
			Reset
		</button>
		<button type="button" class="control-btn cancel" onclick={(e) => { e.stopPropagation(); oncancel(); }}>
			Cancel
		</button>
	</div>
</div>

<style>
	.corner-tap-overlay {
		position: absolute;
		inset: 0;
		z-index: 30;
		cursor: crosshair;
		touch-action: none;
		/* Slight tint so the user can see the overlay is active without
		   obscuring the card preview behind. */
		background: rgba(0, 0, 0, 0.15);
	}

	.banner {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.75);
		color: white;
		padding: 10px 20px;
		border-radius: 12px;
		text-align: center;
		pointer-events: none;
		max-width: 80%;
	}
	.banner-title {
		font-weight: 600;
		font-size: 15px;
	}
	.banner-subtitle {
		font-size: 13px;
		opacity: 0.85;
		margin-top: 2px;
	}

	.tap-marker {
		position: absolute;
		width: 28px;
		height: 28px;
		margin-left: -14px;
		margin-top: -14px;
		border-radius: 50%;
		background: rgba(76, 175, 80, 0.95);
		border: 2px solid white;
		box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.3);
		pointer-events: none;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.tap-marker-num {
		color: white;
		font-weight: 700;
		font-size: 13px;
	}

	.controls {
		position: absolute;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 12px;
	}
	.control-btn {
		background: rgba(0, 0, 0, 0.7);
		color: white;
		border: 1px solid rgba(255, 255, 255, 0.3);
		padding: 8px 18px;
		border-radius: 999px;
		font-size: 14px;
		cursor: pointer;
	}
	.control-btn:active {
		transform: scale(0.96);
	}
	.control-btn.cancel {
		background: rgba(180, 50, 50, 0.7);
	}
</style>
