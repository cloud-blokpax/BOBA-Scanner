<script lang="ts">
	import ScanEffects from '$lib/components/ScanEffects.svelte';
	import type { Card } from '$lib/types';
	import type { AlignmentState } from './use-scanner-analysis.svelte';

	let {
		alignmentState = 'no_card',
		bracketAnimClass,
		scanFailed,
		revealColor,
		scanSuccess,
		cameraReady,
		showFlash,
		blurWarning,
		glareRegions,
		statusType,
		revealedCard,
		scanning,
		foilMode,
		foilStep,
		foilCapturesNeeded,
		foilGuidance,
		cameraError,
		onAlignmentStateChanged
	}: {
		alignmentState?: AlignmentState;
		bracketAnimClass: string;
		scanFailed: boolean;
		revealColor: { color: string; glow: number; pulses: number } | null;
		scanSuccess: boolean;
		cameraReady: boolean;
		showFlash: boolean;
		blurWarning: boolean;
		glareRegions: Array<{ x: number; y: number; w: number; h: number }>;
		statusType: string;
		revealedCard: Card | null;
		scanning: boolean;
		foilMode: boolean;
		foilStep: number;
		foilCapturesNeeded: number;
		foilGuidance: string[];
		cameraError: string | null;
		onAlignmentStateChanged?: (state: AlignmentState) => void;
	} = $props();

	// Forward alignment transitions to the parent so the live-OCR coordinator
	// can start/stop sessions in sync with the viewfinder's readiness.
	$effect(() => {
		onAlignmentStateChanged?.(alignmentState);
	});

	const bracketColor = $derived(
		alignmentState === 'ready'
			? 'rgba(34, 197, 94, 0.95)'
			: alignmentState === 'partial'
				? 'rgba(234, 179, 8, 0.9)'
				: 'rgba(148, 163, 184, 0.6)'
	);
	const bracketGlow = $derived(
		alignmentState === 'ready'
			? '0 0 10px rgba(34, 197, 94, 0.55)'
			: alignmentState === 'partial'
				? '0 0 6px rgba(234, 179, 8, 0.45)'
				: 'none'
	);
	const promptText = $derived(
		alignmentState === 'ready'
			? 'Hold still…'
			: alignmentState === 'partial'
				? 'Align with frame'
				: 'Point at card'
	);
</script>

<!-- Auto-capture flash overlay -->
{#if showFlash}
	<div class="flash-overlay"></div>
{/if}

<!-- Dark overlay outside scanning zone -->
<div class="viewfinder-overlay"></div>

<!-- Invisible guide rect for crop calculations -->
<div class="scanner-guide-rect"></div>

<!-- Alignment prompt near the top of the viewfinder, never covered by the shutter -->
{#if !scanning && !scanSuccess && !scanFailed && !foilMode}
	<div class="alignment-prompt" class:ready={alignmentState === 'ready'}>
		{promptText}
	</div>
{/if}

<!-- Corner brackets -->
{#each ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as corner}
	<div
		class="bracket {corner} {bracketAnimClass}"
		class:bracket-fail={scanFailed}
		class:bracket-align-ready={alignmentState === 'ready'}
		style:--bracket-color={bracketColor}
		style:--bracket-glow={bracketGlow}
		style:--reveal-color={revealColor?.color ?? ''}
		style:--reveal-glow="{revealColor?.glow ?? 0}px"
	></div>
{/each}

<!-- Scan line animation — hide during capture/processing -->
{#if cameraReady && !scanSuccess && !scanFailed && !scanning}
	<div class="scan-line"></div>
{/if}

<!-- Scan effects overlay -->
<ScanEffects
	scanning={statusType === 'scanning'}
	revealed={scanSuccess}
	rarity={revealedCard?.rarity ?? null}
	weaponType={revealedCard?.weapon_type ?? null}
/>

<!-- Blur warning overlay -->
{#if blurWarning}
	<div class="blur-warning">
		<span>Hold steady — image is blurry</span>
	</div>
{/if}

<!-- Glare region overlays -->
{#each glareRegions as region}
	<div
		class="glare-region"
		style="left: {region.x * 100}%; top: {region.y * 100}%; width: {region.w * 100}%; height: {region.h * 100}%"
	></div>
{/each}

<!-- Foil capture guidance -->
{#if foilMode && foilStep < foilCapturesNeeded && !scanning}
	<div class="guidance-text foil-guidance">
		{foilGuidance[foilStep]}
	</div>
{/if}

<!-- Foil capture progress -->
{#if foilMode && foilStep > 0 && foilStep < foilCapturesNeeded}
	<div class="foil-progress">
		{#each Array(foilCapturesNeeded) as _, i}
			<div class="foil-dot" class:foil-dot-filled={i < foilStep}></div>
		{/each}
	</div>
{/if}

<!-- Camera error state -->
{#if cameraError && !cameraReady}
	<div class="camera-error">
		<p class="camera-error-text">{cameraError}</p>
		<button class="camera-error-retry" onclick={() => location.reload()}>
			Retry
		</button>
	</div>
{/if}

<style>
	/* Invisible guide rect — matches the viewfinder cut-out for crop calculations.
	   Uses a centered, card-aspect-ratio rect so the cutout always matches a
	   2.5:3.5 card regardless of device aspect ratio. */
	.scanner-guide-rect {
		--guide-width: min(80%, calc((100% - 200px) * 2.5 / 3.5));
		--guide-aspect: calc(2.5 / 3.5);
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: var(--guide-width);
		aspect-ratio: 2.5 / 3.5;
		z-index: 0;
		pointer-events: none;
	}

	/* Dark overlay outside scanning zone — uses a giant box-shadow on the
	   guide rect to dim everything outside it, replacing the previous fixed-%
	   clip-path which didn't preserve card aspect ratio. */
	.viewfinder-overlay {
		display: none; /* Replaced by .scanner-guide-rect's box-shadow below. */
	}
	.scanner-guide-rect {
		box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
	}

	/* L-shaped corner brackets */
	.bracket {
		position: absolute;
		width: 40px;
		height: 40px;
		border-color: var(--bracket-color, rgba(255, 255, 255, 0.6));
		border-style: solid;
		border-width: 0;
		z-index: 2;
		filter: drop-shadow(var(--bracket-glow, none));
		transition: border-color 150ms ease, filter 150ms ease;
	}

	.bracket.top-left {
		top: 15%; left: 10%;
		border-top-width: 3px; border-left-width: 3px;
		border-top-left-radius: 8px;
	}
	.bracket.top-right {
		top: 15%; right: 10%;
		border-top-width: 3px; border-right-width: 3px;
		border-top-right-radius: 8px;
	}
	.bracket.bottom-left {
		bottom: 15%; left: 10%;
		border-bottom-width: 3px; border-left-width: 3px;
		border-bottom-left-radius: 8px;
	}
	.bracket.bottom-right {
		bottom: 15%; right: 10%;
		border-bottom-width: 3px; border-right-width: 3px;
		border-bottom-right-radius: 8px;
	}

	/* Post-capture reveal animations (rarity-coded). Driven by bracketAnimClass. */
	.bracket-reveal { animation: bracket-flash-reveal 1s ease-out; }
	.bracket-reveal-double { animation: bracket-flash-reveal-double 1.2s ease-out; }
	.bracket-reveal-triple {
		animation: bracket-flash-reveal-triple 1.6s ease-out;
		border-width: 0;
	}
	.bracket-reveal-triple.top-left { border-top-width: 3px; border-left-width: 3px; }
	.bracket-reveal-triple.top-right { border-top-width: 3px; border-right-width: 3px; }
	.bracket-reveal-triple.bottom-left { border-bottom-width: 3px; border-left-width: 3px; }
	.bracket-reveal-triple.bottom-right { border-bottom-width: 3px; border-right-width: 3px; }

	@keyframes bracket-flash-reveal {
		0%   { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
		25%  { border-color: var(--reveal-color); box-shadow: 0 0 var(--reveal-glow) color-mix(in srgb, var(--reveal-color) 50%, transparent); }
		100% { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
	}

	@keyframes bracket-flash-reveal-double {
		0%   { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
		20%  { border-color: var(--reveal-color); box-shadow: 0 0 var(--reveal-glow) color-mix(in srgb, var(--reveal-color) 50%, transparent); }
		40%  { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
		55%  { border-color: var(--reveal-color); box-shadow: 0 0 var(--reveal-glow) color-mix(in srgb, var(--reveal-color) 40%, transparent); }
		100% { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
	}

	@keyframes bracket-flash-reveal-triple {
		0%   { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
		15%  { border-color: var(--reveal-color); box-shadow: 0 0 var(--reveal-glow) color-mix(in srgb, var(--reveal-color) 55%, transparent); }
		30%  { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
		45%  { border-color: var(--reveal-color); box-shadow: 0 0 var(--reveal-glow) color-mix(in srgb, var(--reveal-color) 45%, transparent); }
		60%  { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
		75%  { border-color: var(--reveal-color); box-shadow: 0 0 var(--reveal-glow) color-mix(in srgb, var(--reveal-color) 35%, transparent); }
		100% { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
	}

	/* Subtle pulse when alignment is ready — draws the eye without being loud. */
	.bracket-align-ready {
		animation: bracket-ready-pulse 1.2s ease-in-out infinite;
	}

	@keyframes bracket-ready-pulse {
		0%, 100% {
			filter: drop-shadow(0 0 6px rgba(34, 197, 94, 0.4));
		}
		50% {
			filter: drop-shadow(0 0 12px rgba(34, 197, 94, 0.7));
		}
	}

	.bracket-fail {
		animation: bracket-flash-fail 0.8s ease-out;
	}

	/* Auto-capture flash */
	.flash-overlay {
		position: absolute;
		inset: 0;
		background: white;
		z-index: 20;
		animation: flash-burst 0.15s ease-out forwards;
		pointer-events: none;
	}

	@keyframes flash-burst {
		0% { opacity: 0.8; }
		100% { opacity: 0; }
	}

	@keyframes bracket-flash-fail {
		0%   { border-color: var(--accent-primary, #3b82f6); }
		25%  { border-color: var(--danger, #ef4444); box-shadow: 0 0 12px rgba(239, 68, 68, 0.4); }
		100% { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
	}

	/* Alignment prompt: sits just below the top bracket corners, inside the
	   viewfinder. Never overlaps the shutter at the bottom. */
	.alignment-prompt {
		position: absolute;
		top: calc(15% + 48px);
		left: 50%;
		transform: translateX(-50%);
		padding: 0.375rem 0.875rem;
		background: rgba(0, 0, 0, 0.55);
		border-radius: 16px;
		font-size: 0.85rem;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.9);
		pointer-events: none;
		z-index: 5;
		white-space: nowrap;
		transition: color 150ms ease, background 150ms ease;
	}

	.alignment-prompt.ready {
		color: #bbf7d0;
		background: rgba(5, 46, 22, 0.6);
		animation: prompt-ready-pulse 1.2s ease-in-out infinite;
	}

	@keyframes prompt-ready-pulse {
		0%, 100% { opacity: 0.85; }
		50% { opacity: 1; }
	}

	/* Blur warning overlay */
	.blur-warning {
		position: absolute;
		inset: 0;
		background: rgba(239, 68, 68, 0.15);
		border: 2px solid rgba(239, 68, 68, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
		animation: fade-in 0.2s ease-out;
	}
	.blur-warning span {
		background: rgba(0, 0, 0, 0.8);
		color: #ef4444;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
	}

	/* Glare region highlights */
	.glare-region {
		position: absolute;
		background: rgba(239, 68, 68, 0.2);
		border: 1px solid rgba(239, 68, 68, 0.5);
		border-radius: 4px;
		z-index: 9;
		pointer-events: none;
		animation: fade-in 0.2s ease-out;
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	/* Foil-mode guidance text (kept bottom-anchored so it doesn't clash with
	   the top-anchored alignment prompt). */
	.guidance-text {
		position: absolute;
		bottom: 4.5rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.375rem 0.875rem;
		background: rgba(0, 0, 0, 0.6);
		border-radius: 16px;
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.85);
		pointer-events: none;
		z-index: 5;
		white-space: nowrap;
	}

	/* Scan line animation */
	.scan-line {
		position: absolute;
		left: 10%;
		right: 10%;
		height: 2px;
		background: rgba(34, 211, 238, 0.54);
		box-shadow: 0 0 12px rgba(34, 211, 238, 0.4), 0 0 4px rgba(34, 211, 238, 0.6);
		z-index: 3;
		pointer-events: none;
		animation: scan-sweep 2s ease-in-out infinite;
	}

	@keyframes scan-sweep {
		0%, 100% { top: 15%; }
		50% { top: 85%; }
	}

	@media (prefers-reduced-motion: reduce) {
		.scan-line {
			animation: none;
			top: 50%;
			opacity: 0.3;
		}
		.bracket-align-ready {
			animation: none;
		}
		.alignment-prompt.ready {
			animation: none;
		}
	}

	/* Camera error state */
	.camera-error {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 2rem;
		z-index: 10;
	}
	.camera-error-text {
		color: rgba(255, 255, 255, 0.85);
		font-size: 0.95rem;
		text-align: center;
		max-width: 300px;
		margin: 0;
		line-height: 1.5;
	}
	.camera-error-retry {
		padding: 0.5rem 1.5rem;
		background: var(--primary, #3b82f6);
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}

	/* Foil mode */
	.foil-guidance {
		background: rgba(245, 158, 11, 0.15);
		border: 1px solid rgba(245, 158, 11, 0.3);
		color: #fbbf24;
	}
	.foil-progress {
		position: absolute;
		top: 10%;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 6px;
		z-index: 5;
		pointer-events: none;
	}
	.foil-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.5);
	}
	.foil-dot-filled {
		background: #f59e0b;
		border-color: #f59e0b;
	}
</style>
