<!--
	Pack Card Reveal

	Renders a single card in the pack grid with flip animation,
	glow effects, and particle burst.
-->
<script lang="ts">
	import { getWeapon } from '$lib/data/boba-weapons';
	import type { SimulatedCard } from '$lib/types/pack-simulator';

	const PARALLEL_COLORS: Record<string, string> = {
		silver: '#c0c0c0', blue_battlefoil: '#60a5fa', orange_battlefoil: '#f97316',
		green_battlefoil: '#22c55e', pink_battlefoil: '#f472b6', red_battlefoil: '#ef4444',
		blizzard: '#67e8f9', '80s_rad': '#f472b6', headliner: '#fbbf24',
		power_glove: '#a855f7', mixtape: '#34d399', slime: '#22c55e',
		inspired_ink: '#ffd700', super_parallel: '#ffd700', bubblegum: '#ff69b4',
		miami_ice: '#06b6d4', fire_tracks: '#ef4444', icon: '#c084fc',
		colosseum: '#d97706', logo: '#60a5fa', grillin: '#f97316', chillin: '#3b82f6',
		alpha: '#a78bfa', battlefoil: '#60a5fa', cj_maddox: '#34d399',
		blue_headliner: '#60a5fa', orange_headliner: '#f97316', red_headliner: '#ef4444',
		metallic_inspired_ink: '#ffd700', alt: '#a78bfa',
	};

	let {
		card,
		revealed,
		failedImage = false,
		onReveal,
		onSelect,
		onImageError,
	}: {
		card: SimulatedCard;
		revealed: boolean;
		failedImage?: boolean;
		onReveal: () => void;
		onSelect: () => void;
		onImageError: () => void;
	} = $props();

	function isHotDog(c: SimulatedCard): boolean {
		return c.outcomeValue === 'hotdog' || c.slotLabel.toLowerCase().includes('hot dog');
	}

	function isPlay(c: SimulatedCard): boolean {
		return c.outcomeType === 'card_type' && c.outcomeValue === 'play';
	}

	function isBonusPlay(c: SimulatedCard): boolean {
		return c.outcomeType === 'card_type' && c.outcomeValue === 'bonus_play';
	}

	function isSpecialParallel(c: SimulatedCard): boolean {
		const basic = ['base', 'paper', 'battlefoil', ''];
		return !basic.includes(c.parallel.toLowerCase());
	}

	function weaponColor(c: SimulatedCard): string {
		return getWeapon(c.weaponType)?.color || '#9CA3AF';
	}

	function weaponRarity(c: SimulatedCard): string {
		return getWeapon(c.weaponType)?.rarity || 'common';
	}

	function parallelColor(c: SimulatedCard): string {
		return PARALLEL_COLORS[c.parallel.toLowerCase()] || '#a78bfa';
	}

	function cardBorderColor(c: SimulatedCard): string {
		if (isHotDog(c)) return '#f59e0b';
		if (isPlay(c) || isBonusPlay(c)) return '#3b82f6';
		const rarity = weaponRarity(c);
		if (isSpecialParallel(c) && rarity !== 'legendary' && rarity !== 'ultra_rare') {
			return parallelColor(c);
		}
		return weaponColor(c);
	}

	function cardGlow(c: SimulatedCard): string {
		const color = weaponColor(c);
		const rarity = weaponRarity(c);
		if (rarity === 'legendary') return `0 0 30px ${color}, 0 0 60px ${color}, 0 0 90px ${color}`;
		if (rarity === 'ultra_rare') return `0 0 20px ${color}, 0 0 40px ${color}`;
		if (isSpecialParallel(c)) return `0 0 12px ${parallelColor(c)}`;
		return 'none';
	}

	function showParticles(c: SimulatedCard): boolean {
		const rarity = weaponRarity(c);
		return rarity === 'legendary' || rarity === 'ultra_rare' || isSpecialParallel(c);
	}

	function particleColor(c: SimulatedCard): string {
		const rarity = weaponRarity(c);
		if (rarity === 'legendary' || rarity === 'ultra_rare') return weaponColor(c);
		if (isSpecialParallel(c)) return parallelColor(c);
		return weaponColor(c);
	}

	function particleCount(c: SimulatedCard): number {
		return weaponRarity(c) === 'legendary' ? 20 : 12;
	}

	function makeParticle(index: number): { dx: number; dy: number; size: number; round: boolean; delay: number } {
		const angle = (Math.PI * 2 * index) / 16 + (Math.random() - 0.5);
		const dist = 40 + Math.random() * 80;
		return {
			dx: Math.cos(angle) * dist,
			dy: Math.sin(angle) * dist,
			size: 3 + Math.random() * 5,
			round: Math.random() > 0.5,
			delay: index * 0.03,
		};
	}

	const isHero = $derived(!isHotDog(card) && !isPlay(card) && !isBonusPlay(card));
	const borderColor = $derived(cardBorderColor(card));
	const rarity = $derived(weaponRarity(card));
	const wColor = $derived(weaponColor(card));
	const wGlow = $derived(`0 0 8px ${wColor}`);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="card-wrapper"
	class:is-revealed={revealed}
	onclick={() => revealed ? onSelect() : onReveal()}
>
	<div class="card-inner">
		<!-- Back -->
		<div class="card-back">
			<div class="card-back-inner">
				<span class="back-emoji">🎴</span>
				<span class="back-label">BoBA</span>
			</div>
		</div>

		<!-- Front -->
		<div
			class="card-front"
			class:is-legendary={revealed && rarity === 'legendary'}
			class:has-image={card.imageUrl && !failedImage && !isHotDog(card) && !isPlay(card) && !isBonusPlay(card)}
			style="
				border-color: {borderColor};
				background: {isHotDog(card)
					? 'linear-gradient(135deg, #7c2d12, #431407)'
					: isPlay(card) || isBonusPlay(card)
					? 'linear-gradient(135deg, #1e3a5f, #0c1929)'
					: `linear-gradient(135deg, ${borderColor}22, #0f172a 40%, ${borderColor}11)`};
				box-shadow: {revealed ? cardGlow(card) : 'none'};
				--weapon-glow: {wGlow};
			"
		>
			<div class="slot-label">{card.slotLabel}</div>
			<div class="card-number">{card.cardNumber}</div>

			<div class="card-center">
				{#if isHotDog(card)}
					<span class="type-emoji">🌭</span>
					<span class="card-name" style="color: #fbbf24">{card.heroName}</span>
				{:else if isBonusPlay(card)}
					<span class="play-emoji">⚡</span>
					<span class="card-name" style="color: #a78bfa">{card.heroName}</span>
					<span class="bonus-badge">BONUS PLAY</span>
				{:else if isPlay(card)}
					<span class="play-emoji">📜</span>
					<span class="card-name" style="color: #93c5fd">{card.heroName}</span>
				{:else if card.imageUrl && !failedImage}
					<img
						src={card.imageUrl}
						alt={card.heroName}
						class="card-face-image"
						loading="lazy"
						onerror={onImageError}
					/>
				{:else}
					<span
						class="hero-name"
						class:has-glow={rarity === 'legendary'}
						style={rarity === 'legendary' ? `--weapon-glow: 0 0 10px ${wColor}` : ''}
					>
						{card.heroName}
					</span>
					{#if card.power}
						<span
							class="power-value"
							class:has-glow={rarity === 'legendary' || rarity === 'ultra_rare'}
							style="color: {wColor}; --weapon-glow: {wGlow}"
						>
							{card.power}
						</span>
					{/if}
				{/if}
			</div>

			<div class="card-bottom">
				{#if card.weaponType && isHero}
					{@const w = getWeapon(card.weaponType)}
					<span class="weapon-label" style="color: {wColor}">
						{w?.name?.toUpperCase() ?? card.weaponType.toUpperCase()}
					</span>
				{:else}
					<span></span>
				{/if}
				{#if isSpecialParallel(card)}
					<span class="parallel-label" style="color: {parallelColor(card)}">
						{card.parallel.replace(/_/g, ' ')}
					</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- Particles -->
	{#if revealed && showParticles(card)}
		<div class="particles">
			{#each Array.from({ length: particleCount(card) }) as _, pi}
				{@const p = makeParticle(pi)}
				<span
					class="particle"
					style="
						width: {p.size}px; height: {p.size}px;
						border-radius: {p.round ? '50%' : '2px'};
						background: {particleColor(card)};
						animation-delay: {p.delay}s;
						--dx: {p.dx}px; --dy: {p.dy}px;
					"
				></span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.card-wrapper {
		position: relative; width: 100%; aspect-ratio: 2.5 / 3.5;
		perspective: 600px; cursor: pointer;
	}
	.card-wrapper.is-revealed { cursor: pointer; }
	.card-inner {
		width: 100%; height: 100%; position: relative;
		transform-style: preserve-3d;
		transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.card-wrapper.is-revealed .card-inner { transform: rotateY(180deg); }

	.card-back, .card-front {
		position: absolute; inset: 0; border-radius: 10px; overflow: hidden;
		-webkit-backface-visibility: hidden; backface-visibility: hidden;
	}

	.card-back {
		background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
		border: 2px solid #334155; display: flex; align-items: center; justify-content: center;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	}
	.card-back-inner {
		width: 70%; height: 70%; border-radius: 8px;
		background: linear-gradient(135deg, #1e3a5f, #0f172a, #1e3a5f);
		border: 1px solid #334155;
		display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 4px;
	}
	.card-back-inner .back-emoji { font-size: 1.75rem; filter: grayscale(0.3); }
	.card-back-inner .back-label { font-size: 0.6875rem; color: #475569; font-weight: 700; letter-spacing: 2px; }

	.card-front {
		transform: rotateY(180deg);
		display: flex; flex-direction: column; padding: 8%;
		border-width: 2px; border-style: solid;
	}
	.card-front.is-legendary { animation: legendaryPulse 2s ease-in-out infinite; }
	.card-front .slot-label {
		font-size: 0.5rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1px;
	}
	.card-front .card-number {
		font-size: 0.5625rem; color: #94a3b8; font-family: monospace;
	}

	.card-center {
		flex: 1; display: flex; flex-direction: column;
		align-items: center; justify-content: center; gap: 4px;
	}
	.card-center .type-emoji { font-size: 1.75rem; }
	.card-center .play-emoji { font-size: 1.375rem; }
	.card-center .hero-name {
		font-size: 0.6875rem; font-weight: 800; color: #e2e8f0;
		text-align: center; line-height: 1.2;
	}
	.card-center .hero-name.has-glow { text-shadow: var(--weapon-glow); }
	.card-center .card-name {
		font-size: 0.6875rem; font-weight: 700; text-align: center; line-height: 1.2;
	}
	.card-center .power-value {
		font-size: 1.25rem; font-weight: 900;
	}
	.card-center .power-value.has-glow { text-shadow: var(--weapon-glow); }
	.bonus-badge {
		font-size: 0.5rem; color: #c084fc; font-weight: 600;
		background: rgba(124, 58, 237, 0.13); padding: 1px 6px; border-radius: 4px; margin-top: 2px;
	}

	.card-bottom {
		display: flex; justify-content: space-between; align-items: flex-end;
	}
	.card-bottom .weapon-label {
		font-size: 0.5625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
	}
	.card-bottom .parallel-label {
		font-size: 0.5rem; font-weight: 700; font-style: italic;
	}

	.particles {
		position: absolute; inset: 0; pointer-events: none; overflow: visible; z-index: 2;
	}
	.particle {
		position: absolute; left: 50%; top: 50%; opacity: 0; pointer-events: none;
		animation: particleFly 0.8s ease-out forwards;
	}

	.card-face-image {
		width: 100%; height: 100%; object-fit: cover; border-radius: 6px;
		position: absolute; top: 0; left: 0;
	}
	.card-front.has-image .card-center {
		position: absolute; top: 0; left: 0; right: 0; bottom: 0; padding: 0; display: flex;
	}
	.card-front.has-image .slot-label,
	.card-front.has-image .card-number {
		position: relative; z-index: 2;
	}
	.card-front.has-image .card-bottom {
		position: relative; z-index: 2;
		background: linear-gradient(transparent, rgba(0,0,0,0.7));
		padding: 4px 8px; border-radius: 0 0 6px 6px;
	}

	@keyframes legendaryPulse {
		0%, 100% { filter: brightness(1); }
		50% { filter: brightness(1.3); }
	}
	@keyframes particleFly {
		0% { opacity: 1; transform: translate(0, 0) scale(0); }
		50% { opacity: 1; transform: translate(calc(var(--dx) * 0.7), calc(var(--dy) * 0.7)) scale(1.2); }
		100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0); }
	}
</style>
