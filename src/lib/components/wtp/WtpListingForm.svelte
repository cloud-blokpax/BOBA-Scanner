<script lang="ts">
	import {
		CONDITION_TO_WTP,
		buildWtpPayload,
		parallelToWtpTreatmentReal
	} from '$lib/services/wtp/listing-vocab';

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
		// Card identity (now editable)
		card_name: string;
		set_name: string;
		treatment: string;
		orbital: string;
		rarity: string;
		special_attribute: string;
		card_number: string | null;
		// Listing details
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

	const SETS = ['Existence', 'Call of the Stones'];
	const TREATMENTS = ['Paper', 'Classic Foil', 'Formless Foil', 'OCM', 'Stone Foil'];
	const ORBITALS = [
		'Boundless',
		'Heliosynth',
		'Petraia',
		'Solfera',
		'Thalwind',
		'Umbrathene',
		'All Orbital Link'
	];
	const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Mythic', 'Token', 'Promo'];
	const ATTRIBUTES = ['None', 'Echo', 'Alt-Art', 'Promo', 'Pre-Release Slabs', 'Autographs'];
	const CONDITIONS = Object.keys(CONDITION_TO_WTP);

	let { card, images, suggestedPrice, onSubmit, busy, error }: Props = $props();

	// Card identity — editable, prefilled from scan (initial values from props are intentional)
	/* svelte-ignore state_referenced_locally */
	let cardName = $state(card.name);
	/* svelte-ignore state_referenced_locally */
	let setName = $state(card.set_name ?? 'Existence');
	/* svelte-ignore state_referenced_locally */
	let treatment = $state(parallelToWtpTreatmentReal(card.parallel) ?? 'Paper');
	/* svelte-ignore state_referenced_locally */
	let orbital = $state(card.orbital ?? 'Boundless');
	/* svelte-ignore state_referenced_locally */
	let rarity = $state(card.rarity ?? 'Common');
	/* svelte-ignore state_referenced_locally */
	let specialAttribute = $state(card.special_attribute ?? 'None');
	/* svelte-ignore state_referenced_locally */
	let cardNumber = $state(card.card_number ?? '');

	// Listing details — user choices
	let condition = $state<string>('Near Mint');
	// svelte-ignore state_referenced_locally
	let price = $state<number>(suggestedPrice?.value ? Math.round(suggestedPrice.value) : 0);
	let quantity = $state<number>(1);
	let acceptingOffers = $state(true);
	let openToTrade = $state(false);
	let shippingMode = $state<'free' | 'flat' | 'per_item'>('free');
	let shippingFee = $state(0);
	let description = $state('');

	let showPreview = $state(false);

	const formValues = $derived<WtpFormValues>({
		card_name: cardName,
		set_name: setName,
		treatment,
		orbital,
		rarity,
		special_attribute: specialAttribute,
		card_number: cardNumber.trim() || null,
		condition,
		price,
		quantity,
		accepting_offers: acceptingOffers,
		open_to_trade: openToTrade,
		shipping_mode: shippingMode,
		shipping_fee: shippingMode === 'free' ? 0 : shippingFee,
		description: description.trim() || null
	});

	const payloadPreview = $derived.by(() => {
		try {
			return buildWtpPayload({
				card_name: formValues.card_name,
				set_name: formValues.set_name,
				treatment: formValues.treatment,
				orbital: formValues.orbital,
				rarity: formValues.rarity,
				special_attribute: formValues.special_attribute,
				card_number: formValues.card_number,
				condition: formValues.condition,
				quantity: formValues.quantity,
				price: formValues.price,
				description: formValues.description,
				accepting_offers: formValues.accepting_offers,
				open_to_trade: formValues.open_to_trade,
				shipping_mode: formValues.shipping_mode,
				shipping_fee: formValues.shipping_fee
			});
		} catch (e) {
			return { error: e instanceof Error ? e.message : 'invalid' };
		}
	});

	function useSuggested() {
		if (suggestedPrice) price = Math.round(suggestedPrice.value);
	}

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (busy) return;
		if (price <= 0 || quantity < 1) return;
		onSubmit(formValues);
	}

	const primaryImage = $derived(images[0] ?? card.image_url ?? null);
</script>

<form onsubmit={handleSubmit} class="wtp-form">
	<section class="card-identity">
		{#if primaryImage}
			<img src={primaryImage} alt={cardName} />
		{:else}
			<div class="image-placeholder" aria-hidden="true">No image</div>
		{/if}
		<div class="card-meta">
			<h2>Card identity</h2>
			<p class="hint">Auto-detected from scan — edit any field if it looks wrong.</p>

			<label class="field">
				Card name
				<input type="text" bind:value={cardName} required />
			</label>

			<div class="field-row">
				<label class="field">
					Set
					<select bind:value={setName} required>
						{#each SETS as s}<option value={s}>{s}</option>{/each}
					</select>
				</label>
				<label class="field">
					Card number
					<input type="text" bind:value={cardNumber} placeholder="e.g. 042/250" />
				</label>
			</div>

			<div class="field-row">
				<label class="field">
					Treatment
					<select bind:value={treatment} required>
						{#each TREATMENTS as t}<option value={t}>{t}</option>{/each}
					</select>
				</label>
				<label class="field">
					Orbital
					<select bind:value={orbital} required>
						{#each ORBITALS as o}<option value={o}>{o}</option>{/each}
					</select>
				</label>
			</div>

			<div class="field-row">
				<label class="field">
					Rarity
					<select bind:value={rarity} required>
						{#each RARITIES as r}<option value={r}>{r}</option>{/each}
					</select>
				</label>
				<label class="field">
					Special attribute
					<select bind:value={specialAttribute} required>
						{#each ATTRIBUTES as a}<option value={a}>{a}</option>{/each}
					</select>
				</label>
			</div>
		</div>
	</section>

	<section class="listing-details">
		<h2>Listing details</h2>

		<fieldset>
			<legend>Condition</legend>
			<div class="condition-grid">
				{#each CONDITIONS as c (c)}
					<label class="radio-pill">
						<input type="radio" bind:group={condition} value={c} />
						<span>{c}</span>
					</label>
				{/each}
			</div>
		</fieldset>

		<div class="field-row">
			<label class="field">
				Price ($)
				<input type="number" bind:value={price} min="0.01" step="0.01" required />
				{#if suggestedPrice}
					<small class="hint">
						Suggested: ${suggestedPrice.value.toFixed(2)}
						{#if suggestedPrice.sample_size}({suggestedPrice.sample_size} listings){/if}
						<button type="button" class="link-btn" onclick={useSuggested}>Use this</button>
					</small>
				{/if}
			</label>
			<label class="field">
				Quantity
				<input type="number" bind:value={quantity} min="1" max="999" step="1" required />
			</label>
		</div>

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

		<label class="field">
			Notes (optional)
			<textarea
				bind:value={description}
				maxlength="500"
				rows="3"
				placeholder="Anything buyers should know? Card number is appended automatically."
			></textarea>
		</label>
	</section>

	<section class="payload-preview">
		<button type="button" class="preview-toggle" onclick={() => (showPreview = !showPreview)}>
			{showPreview ? '▼' : '▶'} Preview the exact JSON sent to WTP
		</button>
		{#if showPreview}
			<pre class="payload-json">{JSON.stringify(payloadPreview, null, 2)}</pre>
			<p class="hint">
				This is the exact payload our server POSTs to WTP's <code>/rest/v1/listings</code>
				endpoint on submit. Image URLs are added separately after the listing is created.
			</p>
		{/if}
	</section>

	{#if error}<p class="error-block">{error}</p>{/if}

	<button type="submit" class="submit-btn" disabled={busy || price <= 0 || quantity < 1}>
		{busy ? 'Posting…' : 'Post to Wonders Trading Post'}
	</button>
</form>

<style>
	.wtp-form { display: flex; flex-direction: column; gap: 1rem; max-width: 540px; margin: 0 auto; padding: 1rem; }

	.card-identity { display: grid; grid-template-columns: 120px 1fr; gap: 1rem; padding: 1rem; border-radius: 12px; background: var(--surface, #0f172a); border: 1px solid var(--border, rgba(148,163,184,0.15)); }
	.card-identity img { width: 120px; height: 168px; object-fit: cover; border-radius: 8px; }
	.image-placeholder { width: 120px; height: 168px; display: grid; place-items: center; border-radius: 8px; background: rgba(148,163,184,0.1); color: var(--text-muted, #475569); font-size: 0.8rem; }
	.card-meta h2 { font-size: 1.05rem; font-weight: 700; margin: 0 0 0.25rem; }

	.listing-details h2 { font-size: 1.05rem; font-weight: 700; margin: 0.5rem 0 0.5rem; }

	fieldset { border: 1px solid var(--border, rgba(148,163,184,0.15)); border-radius: 10px; padding: 0.75rem 1rem; margin: 0; }
	legend { padding: 0 0.5rem; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary, #94a3b8); }

	.field { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; font-weight: 600; }
	.field input, .field select, .field textarea {
		padding: 0.5rem 0.65rem;
		border-radius: 8px;
		border: 1px solid var(--border-strong, rgba(148,163,184,0.3));
		background: var(--surface, #0f172a);
		color: inherit;
		font: inherit;
		font-weight: 400;
		font-size: 0.9rem;
	}
	.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 0.5rem; }

	.condition-grid { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.radio-pill { display: flex; align-items: center; gap: 0.35rem; padding: 0.4rem 0.75rem; border-radius: 999px; border: 1px solid var(--border, rgba(148,163,184,0.2)); cursor: pointer; font-size: 0.85rem; }
	.radio-pill input { accent-color: var(--accent-primary, #3b82f6); }

	.checkbox-row, .radio-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; font-size: 0.9rem; }

	.inline-number { width: 90px; padding: 0.35rem 0.5rem; border-radius: 6px; border: 1px solid var(--border-strong, rgba(148,163,184,0.3)); background: var(--surface, #0f172a); color: inherit; }
	.inline-number:disabled { opacity: 0.4; }

	textarea { width: 100%; resize: vertical; }

	.hint { font-size: 0.8rem; color: var(--text-secondary, #94a3b8); margin: 0.4rem 0 0; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; font-weight: 400; }
	.link-btn { background: none; border: none; color: var(--accent-primary, #3b82f6); cursor: pointer; padding: 0; font: inherit; text-decoration: underline; }

	.payload-preview { display: flex; flex-direction: column; gap: 0.5rem; }
	.preview-toggle {
		text-align: left;
		background: none;
		border: 1px dashed var(--border-strong, rgba(148,163,184,0.3));
		color: inherit;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.payload-json {
		background: rgba(0,0,0,0.35);
		padding: 0.75rem 1rem;
		border-radius: 8px;
		overflow-x: auto;
		font-family: ui-monospace, monospace;
		font-size: 0.78rem;
		line-height: 1.45;
		margin: 0;
	}
	code { font-family: ui-monospace, monospace; font-size: 0.78rem; background: rgba(148,163,184,0.15); padding: 0.05rem 0.3rem; border-radius: 4px; }

	.error-block { padding: 0.75rem 1rem; border-radius: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: var(--danger, #ef4444); font-size: 0.875rem; margin: 0; }

	.submit-btn { padding: 0.875rem 1rem; border-radius: 10px; border: none; background: var(--accent-primary, #3b82f6); color: #fff; font-size: 1rem; font-weight: 700; cursor: pointer; }
	.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
