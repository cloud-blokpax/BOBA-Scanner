<script lang="ts">
	import { VARIANT_CODES, VARIANT_ABBREV, VARIANT_FULL_NAME, VARIANT_COLOR, normalizeVariant, type VariantCode } from '$lib/data/variants';

	let {
		value,
		onSelect,
		helperText = 'Wonders cards come in multiple physical treatments that affect price. Confirm the treatment of the card you scanned.',
		size = 'md',
		showHelper = true,
	}: {
		value: string | null | undefined;
		onSelect: (variant: VariantCode) => void;
		helperText?: string;
		size?: 'sm' | 'md' | 'lg';
		showHelper?: boolean;
	} = $props();

	const current = $derived(normalizeVariant(value));
</script>

<div class="variant-selector variant-selector-{size}" role="radiogroup" aria-label="Card variant">
	<div class="variant-options">
		{#each VARIANT_CODES as code}
			<button
				type="button"
				role="radio"
				aria-checked={current === code}
				class="variant-option"
				class:variant-option-active={current === code}
				data-variant={code}
				style={`--variant-color: ${VARIANT_COLOR[code]}`}
				onclick={() => onSelect(code)}
			>
				<span class="variant-option-abbrev">{VARIANT_ABBREV[code]}</span>
				<span class="variant-option-name">{VARIANT_FULL_NAME[code]}</span>
			</button>
		{/each}
	</div>
	{#if showHelper}
		<p class="variant-helper">{helperText}</p>
	{/if}
</div>

<style>
	.variant-selector { display: flex; flex-direction: column; gap: 8px; }

	.variant-options {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
		gap: 6px;
	}

	.variant-option {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 8px 6px;
		border: 1px solid var(--border, rgba(148,163,184,0.2));
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		color: var(--text-primary, #e2e8f0);
		font-family: var(--font-sans);
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.variant-option:hover { border-color: var(--variant-color); }
	.variant-option:active { transform: scale(0.97); }
	.variant-option-active {
		border-color: var(--variant-color);
		background: color-mix(in srgb, var(--variant-color) 12%, var(--bg-surface, #0d1524));
	}

	.variant-option-abbrev {
		font-size: 0.85rem;
		font-weight: 800;
		color: var(--variant-color);
		letter-spacing: 0.03em;
	}
	.variant-option-name {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--text-secondary, #94a3b8);
		text-align: center;
		line-height: 1.15;
	}
	.variant-option-active .variant-option-name {
		color: var(--text-primary, #e2e8f0);
	}

	.variant-helper {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-secondary, #94a3b8);
		line-height: 1.3;
	}

	/* Size variants */
	.variant-selector-sm .variant-option { padding: 6px 4px; }
	.variant-selector-sm .variant-option-abbrev { font-size: 0.75rem; }
	.variant-selector-sm .variant-option-name { font-size: 0.6rem; }
</style>
