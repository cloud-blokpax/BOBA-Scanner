<!--
	Phase 8 — Draggable quad refinement overlay for the result screen.

	Renders a 4-corner SVG quad over the scan result image. Each corner is a
	touch/mouse-draggable handle. On commit, the corrected corners are
	submitted to scan_user_corrections as labeled training data.

	Coordinate system: pure UV (0..1) relative to the displayed image. The
	caller is responsible for converting to whatever pixel space the data
	consumer expects.

	UX:
		- The quad starts as the image bounds (the detector's output, since
		  we're rendering on the cropped canonical).
		- User drags any corner; the SVG quad updates live.
		- "Cancel" reverts. "Save" submits + closes via oncomplete.
		- "Reset" snaps back to the image bounds.

	Side-effect free: just captures and submits. Re-running detection with
	user-corrected corners would need raw-frame access; deferred for v2.
-->
<script lang="ts">
	import { triggerHaptic } from '$lib/utils/haptics';

	interface UvPoint {
		x: number;
		y: number;
	}

	let {
		imageUrl,
		oncomplete,
		oncancel
	}: {
		imageUrl: string;
		oncomplete: (correctedCornersUV: UvPoint[]) => void;
		oncancel: () => void;
	} = $props();

	// Quad starts at image bounds, ordered TL/TR/BR/BL.
	let corners = $state<UvPoint[]>([
		{ x: 0.02, y: 0.02 },
		{ x: 0.98, y: 0.02 },
		{ x: 0.98, y: 0.98 },
		{ x: 0.02, y: 0.98 }
	]);

	let svgEl = $state<SVGSVGElement | null>(null);
	let draggingIdx = $state<number | null>(null);

	function resetQuad() {
		corners = [
			{ x: 0.02, y: 0.02 },
			{ x: 0.98, y: 0.02 },
			{ x: 0.98, y: 0.98 },
			{ x: 0.02, y: 0.98 }
		];
	}

	function eventToUV(ev: PointerEvent): UvPoint | null {
		if (!svgEl) return null;
		const rect = svgEl.getBoundingClientRect();
		if (rect.width < 10 || rect.height < 10) return null;
		const x = (ev.clientX - rect.left) / rect.width;
		const y = (ev.clientY - rect.top) / rect.height;
		return {
			x: Math.max(0, Math.min(1, x)),
			y: Math.max(0, Math.min(1, y))
		};
	}

	function onHandlePointerDown(idx: number, ev: PointerEvent) {
		ev.preventDefault();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(ev.currentTarget as any).setPointerCapture(ev.pointerId);
		draggingIdx = idx;
		triggerHaptic('tap');
	}

	function onHandlePointerMove(ev: PointerEvent) {
		if (draggingIdx === null) return;
		const uv = eventToUV(ev);
		if (!uv) return;
		corners = corners.map((c, i) => (i === draggingIdx ? uv : c));
	}

	function onHandlePointerUp(ev: PointerEvent) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		try { (ev.currentTarget as any).releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
		draggingIdx = null;
	}

	function save() {
		oncomplete(corners);
	}

	const pathD = $derived(
		`M ${corners[0].x * 100} ${corners[0].y * 100} ` +
		`L ${corners[1].x * 100} ${corners[1].y * 100} ` +
		`L ${corners[2].x * 100} ${corners[2].y * 100} ` +
		`L ${corners[3].x * 100} ${corners[3].y * 100} Z`
	);
</script>

<div class="quad-adjust-overlay">
	<div class="image-frame">
		<img src={imageUrl} alt="Scan to adjust" class="bg-image" draggable="false" />
		<svg
			bind:this={svgEl}
			class="quad-svg"
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
			role="application"
			aria-label="Card crop adjustment"
			onpointermove={onHandlePointerMove}
			onpointerup={onHandlePointerUp}
			onpointercancel={onHandlePointerUp}
		>
			<path d={pathD} class="quad-path" vector-effect="non-scaling-stroke" />
			{#each corners as c, i (i)}
				<circle
					cx={c.x * 100}
					cy={c.y * 100}
					r="2.6"
					class="handle"
					class:active={draggingIdx === i}
					vector-effect="non-scaling-stroke"
					role="slider"
					aria-label="Corner {i + 1}"
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={Math.round((c.x + c.y) * 50)}
					aria-valuetext="x {Math.round(c.x * 100)}% y {Math.round(c.y * 100)}%"
					tabindex="0"
					onpointerdown={(ev) => onHandlePointerDown(i, ev)}
				/>
			{/each}
		</svg>
	</div>

	<div class="controls">
		<button type="button" class="control-btn cancel" onclick={oncancel}>Cancel</button>
		<button type="button" class="control-btn" onclick={resetQuad}>Reset</button>
		<button type="button" class="control-btn primary" onclick={save}>Save</button>
	</div>
	<div class="hint">
		Drag a corner to nudge it. Saves a hint that helps future detections.
	</div>
</div>

<style>
	.quad-adjust-overlay {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 16px;
	}
	.image-frame {
		position: relative;
		width: min(360px, 80vw);
		aspect-ratio: 750 / 1050;
		border-radius: 12px;
		overflow: hidden;
		background: #111;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}
	.bg-image {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		user-select: none;
		-webkit-user-drag: none;
	}
	.quad-svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		touch-action: none;
	}
	.quad-path {
		fill: rgba(76, 175, 80, 0.15);
		stroke: rgba(76, 175, 80, 0.95);
		stroke-width: 2px;
	}
	.handle {
		fill: rgba(76, 175, 80, 0.95);
		stroke: white;
		stroke-width: 1.5px;
		cursor: grab;
		touch-action: none;
	}
	.handle.active {
		fill: rgba(255, 215, 0, 1);
		cursor: grabbing;
	}
	.controls {
		display: flex;
		gap: 10px;
	}
	.control-btn {
		background: rgba(255, 255, 255, 0.95);
		color: #111;
		border: 1px solid rgba(0, 0, 0, 0.15);
		padding: 9px 16px;
		border-radius: 999px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}
	.control-btn:active {
		transform: scale(0.96);
	}
	.control-btn.primary {
		background: #2e7d32;
		color: white;
		border-color: #2e7d32;
	}
	.control-btn.cancel {
		background: transparent;
		color: white;
		border-color: rgba(255, 255, 255, 0.5);
	}
	.hint {
		max-width: 320px;
		text-align: center;
		font-size: 12px;
		color: rgba(255, 255, 255, 0.75);
	}
</style>
