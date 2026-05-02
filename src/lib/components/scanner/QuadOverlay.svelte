<script lang="ts">
	import { quadToSvgPath, type Pt } from './quad-coords';

	export type QuadState = 'detected' | 'ready' | 'lost';

	let {
		corners = null,
		quadState = 'lost',
		viewportW,
		viewportH,
		reducedMotion = false
	}: {
		corners: [Pt, Pt, Pt, Pt] | null;
		quadState: QuadState;
		viewportW: number;
		viewportH: number;
		reducedMotion?: boolean;
	} = $props();

	// Hold last-known corners through the fade-out. When upstream sets
	// corners=null (lost detection), we keep rendering the prior corners
	// briefly while opacity transitions to 0, then drop entirely.
	let lastCorners = $state<[Pt, Pt, Pt, Pt] | null>(null);
	let visible = $state(false);
	let fadeTimeout: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		if (corners) {
			lastCorners = corners;
			visible = true;
			if (fadeTimeout) {
				clearTimeout(fadeTimeout);
				fadeTimeout = null;
			}
		} else if (lastCorners) {
			// Fade out, then clear after the transition completes.
			visible = false;
			if (fadeTimeout) clearTimeout(fadeTimeout);
			fadeTimeout = setTimeout(() => {
				lastCorners = null;
				fadeTimeout = null;
			}, reducedMotion ? 0 : 220);
		}
	});

	const stroke = $derived(
		quadState === 'ready' ? '#10B981'      // emerald — locked
		: quadState === 'detected' ? '#FBBF24' // amber — found but not yet ready
		: '#FFFFFF'                             // white — fading out
	);

	const path = $derived(lastCorners ? quadToSvgPath(lastCorners) : '');
</script>

{#if lastCorners && viewportW > 0 && viewportH > 0}
	<svg
		class="quad-overlay"
		class:visible
		class:reduced-motion={reducedMotion}
		class:ready={quadState === 'ready'}
		viewBox="0 0 {viewportW} {viewportH}"
		preserveAspectRatio="none"
		aria-hidden="true"
	>
		<!-- Outer stroke for contrast on bright backgrounds -->
		<path
			d={path}
			fill="none"
			stroke="rgba(0,0,0,0.45)"
			stroke-width="6"
			stroke-linejoin="round"
			stroke-linecap="round"
			vector-effect="non-scaling-stroke"
		/>
		<!-- Coloured stroke -->
		<path
			d={path}
			fill="none"
			stroke={stroke}
			stroke-width="3"
			stroke-linejoin="round"
			stroke-linecap="round"
			vector-effect="non-scaling-stroke"
		/>
	</svg>
{/if}

<style>
	.quad-overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 6;
		opacity: 0;
		transition: opacity 200ms ease-out;
	}
	.quad-overlay.visible {
		opacity: 1;
	}
	.quad-overlay.reduced-motion {
		transition: none;
	}
	/* Subtle pulse when ready — single 600ms cycle at state-change, not
	   a continuous loop. Continuous animation feels noisy on a viewfinder. */
	.quad-overlay.ready path {
		animation: quad-lock-pulse 600ms ease-out 1;
	}
	.quad-overlay.reduced-motion.ready path {
		animation: none;
	}
	@keyframes quad-lock-pulse {
		0% { stroke-opacity: 1; }
		40% { stroke-opacity: 0.55; }
		100% { stroke-opacity: 1; }
	}
</style>
