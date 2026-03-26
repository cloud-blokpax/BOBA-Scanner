<script lang="ts">
	import ScanEffects from '$lib/components/ScanEffects.svelte';
	import type { Card } from '$lib/types';

	let {
		bracketState,
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
		guidanceText,
		scanning,
		foilMode,
		foilStep,
		foilCapturesNeeded,
		foilGuidance,
		cameraError
	}: {
		bracketState: 'idle' | 'detected' | 'locked';
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
		guidanceText: string | null;
		scanning: boolean;
		foilMode: boolean;
		foilStep: number;
		foilCapturesNeeded: number;
		foilGuidance: string[];
		cameraError: string | null;
	} = $props();
</script>

<!-- Auto-capture flash overlay -->
{#if showFlash}
	<div class="flash-overlay"></div>
{/if}

<!-- Dark overlay outside scanning zone -->
<div class="viewfinder-overlay"></div>

<!-- Invisible guide rect for crop calculations -->
<div class="scanner-guide-rect"></div>

<!-- Corner brackets -->
{#each ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as corner}
	<div
		class="bracket {corner} {bracketAnimClass}"
		class:bracket-fail={scanFailed}
		class:bracket-detected={bracketState === 'detected'}
		class:bracket-locked={bracketState === 'locked'}
		style:--reveal-color={revealColor?.color ?? ''}
		style:--reveal-glow="{revealColor?.glow ?? 0}px"
	></div>
{/each}

<!-- Scan line animation -->
{#if cameraReady && !scanSuccess && !scanFailed}
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

<!-- Guidance text -->
{#if foilMode && foilStep < foilCapturesNeeded && !scanning}
	<div class="guidance-text foil-guidance">
		{foilGuidance[foilStep]}
	</div>
{:else if guidanceText && !scanning && !foilMode}
	<div class="guidance-text">
		{guidanceText}
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
	/* Invisible guide rect — matches the viewfinder cut-out for crop calculations */
	.scanner-guide-rect {
		position: absolute;
		top: 15%;
		left: 10%;
		right: 10%;
		bottom: 15%;
		z-index: 0;
		pointer-events: none;
	}

	/* Dark overlay outside scanning zone */
	.viewfinder-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		clip-path: polygon(evenodd,
			0% 0%, 100% 0%, 100% 100%, 0% 100%,
			10% 15%, 90% 15%, 90% 85%, 10% 85%
		);
		z-index: 1;
		pointer-events: none;
	}

	/* L-shaped corner brackets */
	.bracket {
		position: absolute;
		width: 40px;
		height: 40px;
		border-color: rgba(255,255,255,0.6);
		border-style: solid;
		border-width: 0;
		z-index: 2;
		transition: border-color 200ms ease-out, filter 200ms ease-out;
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

	/* Bracket animations */
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

	.bracket-detected {
		border-color: #F59E0B !important;
		filter: drop-shadow(0 0 4px rgba(245,158,11,0.4));
	}
	.bracket-locked {
		border-color: #10B981 !important;
		filter: drop-shadow(0 0 8px rgba(16,185,129,0.5));
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

	@keyframes bracket-flash-fail {
		0%   { border-color: var(--accent-primary, #3b82f6); }
		25%  { border-color: var(--danger, #ef4444); box-shadow: 0 0 12px rgba(239, 68, 68, 0.4); }
		100% { border-color: var(--accent-primary, #3b82f6); box-shadow: none; }
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

	/* Guidance text */
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
