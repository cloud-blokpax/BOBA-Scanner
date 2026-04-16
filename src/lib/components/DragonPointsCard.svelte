<script lang="ts">
	import { calculateDragonPoints } from '$lib/games/wonders/dragon-points';
	import type { Card } from '$lib/types';

	let {
		card,
		variant = 'paper',
	}: {
		card: Card;
		/** The variant being viewed — drives the Dragon Points calculation. */
		variant?: string;
	} = $props();

	const meta = $derived((card.metadata ?? {}) as Record<string, unknown>);
	const cardClass = $derived(typeof meta.card_class === 'string' ? meta.card_class : null);

	const result = $derived(
		calculateDragonPoints({
			rarity: card.rarity ?? null,
			variant,
			year: card.year ?? null,
			card_class: cardClass,
		})
	);

	const isPaper = $derived(variant === 'paper');
	let expanded = $state(false);
</script>

<section class="dragon-points-card" class:dp-paper={isPaper}>
	<button
		type="button"
		class="dp-header"
		onclick={() => (expanded = !expanded)}
		aria-expanded={expanded}
	>
		<span class="dp-icon" aria-hidden="true">🐉</span>
		<span class="dp-label">Dragon Points</span>
		<span class="dp-value" class:dp-value-zero={result.points === 0}>
			{result.points}
		</span>
		<span class="dp-chevron" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
	</button>

	{#if isPaper}
		<p class="dp-disqualified">Paper variant — not eligible for Dragon Points</p>
	{:else if result.disqualification_reason}
		<p class="dp-disqualified">{result.disqualification_reason}</p>
	{:else if expanded}
		<div class="dp-breakdown">
			<dl>
				<dt>Base ({card.rarity} {variant.toUpperCase()})</dt>
				<dd>{result.breakdown.base}</dd>
				{#if result.breakdown.freshness_bonus > 0}
					<dt>Freshness bonus (2026, +35%)</dt>
					<dd>+{result.breakdown.freshness_bonus.toFixed(2)}</dd>
				{/if}
				{#if result.breakdown.class_multiplier > 0}
					<dt>Class multiplier (×3)</dt>
					<dd>+{result.breakdown.class_multiplier.toFixed(2)}</dd>
				{/if}
				<dt class="dp-total-label">Total (rounded down)</dt>
				<dd class="dp-total-value">{result.points}</dd>
			</dl>
		</div>
	{/if}
</section>

<style>
	.dragon-points-card {
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 10px;
		border: 1px solid rgba(212, 175, 55, 0.3);
		background: color-mix(in srgb, #D4AF37 6%, var(--bg-surface, #0d1524));
	}
	.dp-paper {
		border-color: var(--border, rgba(148,163,184,0.2));
		background: var(--bg-surface, #0d1524);
	}

	.dp-header {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 0;
		border: none;
		background: transparent;
		color: var(--text-primary, #e2e8f0);
		font-family: var(--font-sans);
		font-size: 0.85rem;
		cursor: pointer;
	}
	.dp-icon { font-size: 1.1rem; }
	.dp-label { flex: 1; text-align: left; font-weight: 700; }
	.dp-value { font-weight: 800; font-size: 1rem; color: #D4AF37; }
	.dp-value-zero { color: var(--text-muted, #475569); }
	.dp-chevron { font-size: 0.7rem; opacity: 0.7; }

	.dp-disqualified {
		margin: 0.35rem 0 0;
		font-size: 0.75rem;
		color: var(--text-muted, #475569);
		font-style: italic;
	}

	.dp-breakdown {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(212, 175, 55, 0.2);
	}
	.dp-breakdown dl {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 4px 12px;
		margin: 0;
		font-size: 0.78rem;
	}
	.dp-breakdown dt {
		color: var(--text-secondary, #94a3b8);
	}
	.dp-breakdown dd {
		margin: 0;
		font-weight: 600;
		color: var(--text-primary, #e2e8f0);
		text-align: right;
	}
	.dp-total-label {
		color: #D4AF37 !important;
		font-weight: 700;
	}
	.dp-total-value {
		color: #D4AF37;
		font-weight: 800;
	}
</style>
