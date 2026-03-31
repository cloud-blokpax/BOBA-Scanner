<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import CardFlipReveal from '$lib/components/CardFlipReveal.svelte';
	import type { ActionReturn } from 'svelte/action';

	let tiltAction: ((node: HTMLElement, params?: any) => ActionReturn) | null = null;
	import('$lib/actions/tilt').then(m => { tiltAction = m.tilt; });

	function tilt(node: HTMLElement, params?: any): ActionReturn {
		if (tiltAction) return tiltAction(node, params);
		let cleanup: ActionReturn | void;
		import('$lib/actions/tilt').then(m => {
			cleanup = m.tilt(node, params);
		});
		return {
			destroy() {
				if (cleanup && typeof cleanup === 'object' && cleanup.destroy) {
					cleanup.destroy();
				}
			}
		};
	}

	let {
		imageUrl,
		cardName,
		rarity,
		weaponType,
		parallel = null
	}: {
		imageUrl: string | null;
		cardName: string;
		rarity: string;
		weaponType: string | null;
		parallel?: string | null;
	} = $props();

	const isParallel = $derived(
		parallel !== null && parallel !== 'Base'
	);

	let showGyroHint = $state(false);
	const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

	onMount(() => {
		if (isIOS && rarity && rarity !== 'common') {
			showGyroHint = true;
			setTimeout(() => { showGyroHint = false; }, 3000);
		}
	});
</script>

<div class="card-image-section">
	<div
		class="card-tilt-wrapper"
		use:tilt={{
			gyro: rarity !== 'common',
			weaponType,
			shimmer: true,
			specular: rarity !== 'common',
			holographic: isParallel
		}}
	>
		<CardFlipReveal
			imageUrl={imageUrl}
			cardName={cardName}
			rarity={rarity ?? 'common'}
		/>
		{#if showGyroHint}
			<div class="gyro-hint" transition:fade={{ duration: 300 }}>
				Tap card for holographic effect
			</div>
		{/if}
	</div>
</div>

<style>
	.card-image-section {
		display: flex;
		justify-content: center;
		padding: 1.5rem 1.5rem 0;
		background: linear-gradient(180deg, var(--bg-elevated, #121d34) 0%, var(--bg-base, #070b14) 100%);
	}

	.card-tilt-wrapper {
		position: relative;
		max-width: 280px;
		width: 100%;
		border-radius: 12px;
	}

	.gyro-hint {
		position: absolute;
		bottom: 0.75rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.3rem 0.75rem;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.7);
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.75rem;
		white-space: nowrap;
		pointer-events: none;
		z-index: 3;
	}
</style>
