<script lang="ts">
	import type { ScrapingTestData } from '$lib/types';

	interface Props {
		stData: ScrapingTestData | null;
		stLoading: boolean;
	}

	let { stData, stLoading }: Props = $props();

	let stExpanded = $state(false);
</script>

<details class="stl-st-details" bind:open={stExpanded}>
	<summary class="stl-st-summary">Scraping Test</summary>
	<div class="stl-st-grid">
		{#if stLoading}
			<div class="stl-st-row">
				<span class="stl-st-key">Status</span>
				<span class="stl-st-val stl-st-loading">Loading...</span>
			</div>
		{:else if !stData}
			<div class="stl-st-row">
				<span class="stl-st-key">Status</span>
				<span class="stl-st-val stl-st-na">No scrape data for this card</span>
			</div>
		{/if}
		{#if stData}
			<div class="stl-st-row">
				<span class="stl-st-key">ST Price</span>
				<span class="stl-st-val">{stData.st_price != null ? `$${stData.st_price.toFixed(2)}` : '—'}</span>
			</div>
			<div class="stl-st-row">
				<span class="stl-st-key">ST Low</span>
				<span class="stl-st-val">{stData.st_low != null ? `$${stData.st_low.toFixed(2)}` : '—'}</span>
			</div>
			<div class="stl-st-row">
				<span class="stl-st-key">ST High</span>
				<span class="stl-st-val">{stData.st_high != null ? `$${stData.st_high.toFixed(2)}` : '—'}</span>
			</div>
			<div class="stl-st-row">
				<span class="stl-st-key">Source Card Name</span>
				<span class="stl-st-val">{stData.st_card_name || '—'}</span>
			</div>
			<div class="stl-st-row">
				<span class="stl-st-key">Source Set</span>
				<span class="stl-st-val">{stData.st_set_name || '—'}</span>
			</div>
			<div class="stl-st-row">
				<span class="stl-st-key">Source Variant</span>
				<span class="stl-st-val">{stData.st_variant || '—'}</span>
			</div>
			<div class="stl-st-row">
				<span class="stl-st-key">Source Rarity</span>
				<span class="stl-st-val">{stData.st_rarity || '—'}</span>
			</div>
			<div class="stl-st-row">
				<span class="stl-st-key">Last Updated</span>
				<span class="stl-st-val">{stData.st_updated ? new Date(stData.st_updated).toLocaleDateString() : '—'}</span>
			</div>
			{#if stData.st_image_url}
				<div class="stl-st-row stl-st-image-row">
					<span class="stl-st-key">Source Image</span>
					<img src={stData.st_image_url} alt="Source card" class="stl-st-image" />
				</div>
			{/if}
			{#if stData.st_raw_data}
				<details class="stl-st-raw">
					<summary class="stl-st-raw-summary">Raw Data</summary>
					<pre class="stl-st-raw-pre">{JSON.stringify(stData.st_raw_data, null, 2)}</pre>
				</details>
			{/if}
		{/if}
	</div>
</details>

<style>
	.stl-st-details {
		margin-bottom: 1.25rem;
		border: 1px solid rgba(168, 85, 247, 0.15);
		border-radius: 10px;
		padding: 0.75rem;
		background: rgba(168, 85, 247, 0.04);
	}

	.stl-st-summary {
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted, #475569);
		cursor: pointer;
	}

	.stl-st-grid {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.stl-st-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.3rem 0;
		border-bottom: 1px solid rgba(168, 85, 247, 0.06);
		font-size: 0.8rem;
	}

	.stl-st-key {
		color: var(--text-muted, #475569);
	}

	.stl-st-val {
		color: #a855f7;
		font-weight: 600;
		text-align: right;
		max-width: 60%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stl-st-loading { opacity: 0.5; font-weight: 400; font-style: italic; }
	.stl-st-na { opacity: 0.4; }

	.stl-st-image-row {
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.stl-st-image {
		width: 100px;
		height: 140px;
		object-fit: cover;
		border-radius: 6px;
		border: 1px solid rgba(168, 85, 247, 0.2);
	}

	.stl-st-raw {
		margin-top: 0.5rem;
	}

	.stl-st-raw-summary {
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
		cursor: pointer;
	}

	.stl-st-raw-pre {
		font-size: 0.65rem;
		color: var(--text-muted, #475569);
		background: var(--bg-surface, #0d1524);
		border-radius: 6px;
		padding: 0.5rem;
		overflow-x: auto;
		max-height: 200px;
		overflow-y: auto;
		margin-top: 0.375rem;
	}
</style>
