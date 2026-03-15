<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	let {
		imageUrl,
		cardName,
		rarity = 'common'
	}: {
		imageUrl: string | null;
		cardName: string;
		rarity?: string;
	} = $props();

	let flipped = $state(false);
	const shouldFlip = $derived(['uncommon', 'rare', 'ultra_rare', 'legendary'].includes(rarity));

	const rarityColor: Record<string, string> = {
		uncommon: '#22C55E',
		rare: '#3B82F6',
		ultra_rare: '#A855F7',
		legendary: '#F59E0B'
	};

	const glowColor = $derived(rarityColor[rarity] ?? '#9CA3AF');

	const flipDelay: Record<string, number> = {
		legendary: 600,
		ultra_rare: 450,
		rare: 350,
		uncommon: 300
	};

	let flipTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		if (shouldFlip) {
			const delay = flipDelay[rarity] ?? 300;
			flipTimer = setTimeout(() => { flipped = true; }, delay);
		} else {
			flipped = true;
		}
	});

	onDestroy(() => {
		if (flipTimer) clearTimeout(flipTimer);
	});
</script>

<div class="flip-container" class:no-flip={!shouldFlip}>
	<div class="flip-card" class:flipped>
		<!-- Card back (shown initially for uncommon+) -->
		<div class="flip-face flip-front" style:--glow-color={glowColor}>
			<div class="card-back">
				<div class="card-back-logo">🎴</div>
				<div class="card-back-text">BOBA</div>
			</div>
		</div>
		<!-- Card front (revealed) -->
		<div class="flip-face flip-back">
			{#if imageUrl}
				<img src={imageUrl} alt={cardName} class="flip-card-image" />
			{/if}
		</div>
	</div>
</div>

<style>
	.flip-container {
		perspective: 1000px;
		width: 100%;
		max-width: 280px;
		margin: 0 auto;
	}

	.flip-card {
		position: relative;
		width: 100%;
		aspect-ratio: 2.5 / 3.5;
		transform-style: preserve-3d;
		transition: transform 450ms ease-in-out;
	}

	.flip-card.flipped {
		transform: rotateY(180deg);
	}

	/* Skip animation for common cards */
	.no-flip .flip-card {
		transition: none;
		transform: rotateY(180deg);
	}

	.flip-face {
		position: absolute;
		inset: 0;
		backface-visibility: hidden;
		border-radius: 12px;
		overflow: hidden;
	}

	.flip-front {
		background: var(--bg-elevated, #121d34);
		border: 2px solid var(--glow-color);
		box-shadow: 0 0 20px color-mix(in srgb, var(--glow-color) 30%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.flip-back {
		transform: rotateY(180deg);
		border: 2px solid transparent;
		transition: border-color 0.3s ease-out 0.45s, box-shadow 0.3s ease-out 0.45s;
	}

	.flipped .flip-back {
		border-color: var(--glow-color);
		box-shadow: 0 8px 32px color-mix(in srgb, var(--glow-color) 25%, transparent);
	}

	/* Common cards: simple scale-up, no flip */
	.no-flip .flip-back {
		border-color: transparent;
		box-shadow: none;
		animation: common-reveal 0.3s ease-out;
	}

	@keyframes common-reveal {
		from { transform: rotateY(180deg) scale(0.95); opacity: 0.8; }
		to { transform: rotateY(180deg) scale(1); opacity: 1; }
	}

	.card-back {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}

	.card-back-logo {
		font-size: 3rem;
		animation: card-back-pulse 1.5s ease-in-out infinite;
	}

	.card-back-text {
		font-family: 'Syne', sans-serif;
		font-weight: 800;
		font-size: 1.5rem;
		color: var(--glow-color);
		letter-spacing: 0.15em;
		text-shadow: 0 0 12px color-mix(in srgb, var(--glow-color) 50%, transparent);
	}

	.flip-card-image {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 12px;
	}

	@keyframes card-back-pulse {
		0%, 100% { transform: scale(1); opacity: 0.8; }
		50% { transform: scale(1.05); opacity: 1; }
	}

	@media (prefers-reduced-motion: reduce) {
		.flip-card {
			transition: none;
		}
		.card-back-logo {
			animation: none;
		}
	}
</style>
