<script lang="ts">
	import { CONDITION_TO_WTP } from '$lib/services/wtp/listing-vocab';
	import { parallelToWtpTreatment } from '$lib/services/wtp/parallel-mapping';

	interface ComposeCard {
		id: string;
		name: string;
		card_number: string | null;
		parallel: string;
		set_name: string | null;
		rarity: string | null;
		orbital: string | null;
		special_attribute: string | null;
		image_url: string | null;
	}

	interface SuggestedPrice {
		value: number;
		source: string;
		sample_size: number | null;
	}

	export interface WtpFormValues {
		condition: string;
		price: number;
		quantity: number;
		accepting_offers: boolean;
		open_to_trade: boolean;
		shipping_mode: 'free' | 'flat' | 'per_item';
		shipping_fee: number;
		description: string | null;
	}

	interface Props {
		card: ComposeCard;
		images: string[];
		suggestedPrice: SuggestedPrice | null;
		onSubmit: (values: WtpFormValues) => void;
		busy: boolean;
		error: string | null;
	}

	let { card, images, suggestedPrice, onSubmit, busy, error }: Props = $props();

	const treatment = $derived(parallelToWtpTreatment(card.parallel));

	let condition = $state<string>('Near Mint');
	// svelte-ignore state_referenced_locally
	let price = $state<number>(suggestedPrice?.value ? Math.round(suggestedPrice.value) : 0);
	let quantity = $state<number>(1);
	let acceptingOffers = $state(true);
	let openToTrade = $state(false);
	let shippingMode = $state<'free' | 'flat' | 'per_item'>('free');
	let shippingFee = $state(0);
	let description = $state('');

	function useSuggested() {
		if (suggestedPrice) price = Math.round(suggestedPrice.value);
	}

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (!treatment || busy) return;
		onSubmit({
			condition,
			price,
			quantity,
			accepting_offers: acceptingOffers,
			open_to_trade: openToTrade,
			shipping_mode: shippingMode,
			shipping_fee: shippingMode === 'free' ? 0 : shippingFee,
			description: description.trim() || null
		});
	}

	const primaryImage = $derived(images[0] ?? card.image_url ?? null);
	const conditionKeys = Object.keys(CONDITION_TO_WTP);
</script>

<form onsubmit={handleSubmit} class="wtp-form">
	<section class="card-identity">
		{#if primaryImage}
			<img src={primaryImage} alt={card.name} />
		{:else}
			<div class="image-placeholder" aria-hidden="true">No image</div>
		{/if}
		<div class="card-meta">
			<h2>{card.name}</h2>
			<dl>
				{#if card.set_name}<dt>Set</dt><dd>{card.set_name}</dd>{/if}
				{#if card.card_number}<dt>Number</dt><dd>{card.card_number}</dd>{/if}
				<dt>Treatment</dt><dd class:warn={!treatment}>{treatment ?? '⚠ unmapped'}</dd>
				{#if card.orbital}<dt>Orbital</dt><dd>{card.orbital}</dd>{/if}
				{#if card.rarity}<dt>Rarity</dt><dd>{card.rarity}</dd>{/if}
				<dt>Special</dt><dd>{card.special_attribute || 'None'}</dd>
			</dl>
		</div>
	</section>

	{#if !treatment}
		<p class="error-block">
			This card's parallel ({card.parallel}) doesn't have a WTP treatment mapping.
			Please report this so we can fix it.
		</p>
	{/if}

	<fieldset>
		<legend>Condition</legend>
		<div class="radio-grid">
			{#each conditionKeys as c (c)}
				<label class="radio-pill">
					<input type="radio" bind:group={condition} value={c} />
					<span>{c}</span>
				</label>
			{/each}
		</div>
	</fieldset>

	<fieldset>
		<legend>Price (USD)</legend>
		<input class="number-input" type="number" bind:value={price} min="0.01" step="0.01" required />
		{#if suggestedPrice}
			<p class="hint">
				Median {suggestedPrice.source} price: ${suggestedPrice.value.toFixed(2)}
				{#if suggestedPrice.sample_size}({suggestedPrice.sample_size} listings){/if}
				<button type="button" class="link-btn" onclick={useSuggested}>Use this</button>
			</p>
		{/if}
	</fieldset>

	<fieldset>
		<legend>Quantity</legend>
		<input class="number-input" type="number" bind:value={quantity} min="1" max="999" required />
	</fieldset>

	<fieldset>
		<legend>Options</legend>
		<label class="checkbox-row"><input type="checkbox" bind:checked={acceptingOffers} /> Accept offers</label>
		<label class="checkbox-row"><input type="checkbox" bind:checked={openToTrade} /> Open to trade</label>
	</fieldset>

	<fieldset>
		<legend>Shipping</legend>
		<label class="radio-row"><input type="radio" bind:group={shippingMode} value="free" /> Free shipping</label>
		<label class="radio-row">
			<input type="radio" bind:group={shippingMode} value="flat" /> Flat fee:
			<input class="inline-number" type="number" bind:value={shippingFee} min="0" step="0.01" disabled={shippingMode !== 'flat'} />
		</label>
		<label class="radio-row">
			<input type="radio" bind:group={shippingMode} value="per_item" /> Per item:
			<input class="inline-number" type="number" bind:value={shippingFee} min="0" step="0.01" disabled={shippingMode !== 'per_item'} />
		</label>
	</fieldset>

	<fieldset>
		<legend>Notes (optional)</legend>
		<textarea
			bind:value={description}
			maxlength="500"
			rows="3"
			placeholder="Anything buyers should know? Card number is included automatically."
		></textarea>
	</fieldset>

	{#if error}<p class="error-block">{error}</p>{/if}

	<button type="submit" class="submit-btn" disabled={busy || !treatment || price < 0.01}>
		{busy ? 'Posting…' : 'Post to Wonders Trading Post'}
	</button>
</form>

<style>
	.wtp-form { display: flex; flex-direction: column; gap: 1rem; max-width: 540px; margin: 0 auto; padding: 1rem; }

	.card-identity { display: grid; grid-template-columns: 120px 1fr; gap: 1rem; padding: 1rem; border-radius: 12px; background: var(--surface, #0f172a); border: 1px solid var(--border, rgba(148,163,184,0.15)); }
	.card-identity img { width: 120px; height: 168px; object-fit: cover; border-radius: 8px; }
	.image-placeholder { width: 120px; height: 168px; display: grid; place-items: center; border-radius: 8px; background: rgba(148,163,184,0.1); color: var(--text-muted, #475569); font-size: 0.8rem; }
	.card-meta h2 { font-size: 1.05rem; font-weight: 700; margin: 0 0 0.5rem; }
	.card-meta dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 0.75rem; margin: 0; font-size: 0.85rem; }
	.card-meta dt { color: var(--text-secondary, #94a3b8); }
	.card-meta dd { margin: 0; }
	.card-meta dd.warn { color: var(--danger, #ef4444); font-weight: 600; }

	fieldset { border: 1px solid var(--border, rgba(148,163,184,0.15)); border-radius: 10px; padding: 0.75rem 1rem; margin: 0; }
	legend { padding: 0 0.5rem; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary, #94a3b8); }

	.radio-grid { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.radio-pill { display: flex; align-items: center; gap: 0.35rem; padding: 0.4rem 0.75rem; border-radius: 999px; border: 1px solid var(--border, rgba(148,163,184,0.2)); cursor: pointer; font-size: 0.85rem; }
	.radio-pill input { accent-color: var(--accent-primary, #3b82f6); }

	.checkbox-row, .radio-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; font-size: 0.9rem; }

	.number-input { width: 100%; padding: 0.625rem 0.75rem; border-radius: 8px; border: 1px solid var(--border-strong, rgba(148,163,184,0.3)); background: var(--surface, #0f172a); color: inherit; font-size: 1rem; }
	.inline-number { width: 90px; padding: 0.35rem 0.5rem; border-radius: 6px; border: 1px solid var(--border-strong, rgba(148,163,184,0.3)); background: var(--surface, #0f172a); color: inherit; }
	.inline-number:disabled { opacity: 0.4; }

	textarea { width: 100%; padding: 0.625rem 0.75rem; border-radius: 8px; border: 1px solid var(--border-strong, rgba(148,163,184,0.3)); background: var(--surface, #0f172a); color: inherit; resize: vertical; font: inherit; }

	.hint { font-size: 0.8rem; color: var(--text-secondary, #94a3b8); margin: 0.5rem 0 0; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
	.link-btn { background: none; border: none; color: var(--accent-primary, #3b82f6); cursor: pointer; padding: 0; font: inherit; text-decoration: underline; }

	.error-block { padding: 0.75rem 1rem; border-radius: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: var(--danger, #ef4444); font-size: 0.875rem; margin: 0; }

	.submit-btn { padding: 0.875rem 1rem; border-radius: 10px; border: none; background: var(--accent-primary, #3b82f6); color: #fff; font-size: 1rem; font-weight: 700; cursor: pointer; }
	.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
