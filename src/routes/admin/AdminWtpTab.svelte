<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';

	interface ScrapeSummary {
		fetched_at: string;
		duration_ms: number;
		total_listings: number;
		active_count: number;
		sold_count: number;
		card_listings_count: number;
		matched_card_count: number;
		unmatched_listing_count: number;
		ambiguous_listing_count: number;
		upserted_rows: number;
		history_rows: number;
		unmapped_treatments: string[];
		unmapped_sets: string[];
		per_set_coverage: Record<string, { listings: number; matched: number }>;
		unmatched_samples: Array<{
			card_name: string;
			treatment: string;
			set: string;
			condition: string;
			price: number;
			status: string;
		}>;
	}

	interface RunRow {
		date: string;
		cards_with_data: number;
		total_sold_lifetime: number;
		sales_30d: number;
	}

	let busy = $state(false);
	let summary = $state<ScrapeSummary | null>(null);
	let runs = $state<RunRow[]>([]);

	$effect(() => {
		loadRuns();
	});

	async function loadRuns() {
		try {
			const r = await fetch('/api/admin/wtp/runs');
			if (r.ok) runs = (await r.json()).runs;
		} catch {
			// non-critical
		}
	}

	async function runScrape() {
		busy = true;
		try {
			const r = await fetch('/api/admin/wtp/scrape', { method: 'POST' });
			const data = await r.json();
			if (!r.ok || !data.ok) {
				showToast(data.error || 'Scrape failed', 'x');
				return;
			}
			summary = data.summary;
			await loadRuns();
			showToast(
				`Scrape complete — ${data.summary.matched_card_count} cards updated`,
				'check'
			);
		} catch (e) {
			showToast(e instanceof Error ? e.message : 'Scrape failed', 'x');
		} finally {
			busy = false;
		}
	}

	const matchRate = $derived(
		summary && summary.card_listings_count > 0
			? ((summary.card_listings_count - summary.unmatched_listing_count) /
					summary.card_listings_count) *
					100
			: 0
	);

	const matchRateClass = $derived(
		matchRate >= 95 ? 'good' : matchRate >= 80 ? 'okay' : 'bad'
	);
</script>

<div class="wtp-tab">
	<header>
		<h2>Wonders Trading Post — Scrape Test</h2>
		<p class="muted">
			Pulls all listings from
			<a href="https://wonderstradingpost.com" target="_blank" rel="noopener">wonderstradingpost.com</a>,
			matches them to our Wonders catalog, and writes pricing rows to <code>scraping_test</code>
			with <code>game_id='wonders'</code>. Read-only against WTP. Same pattern as the BoBA scraping
			test.
		</p>
	</header>

	<button class="btn-primary" onclick={runScrape} disabled={busy}>
		{busy ? 'Scraping…' : 'Run WTP Scrape'}
	</button>

	{#if summary}
		<section class="summary-grid">
			<div class="stat">
				<span class="label">Listings fetched</span>
				<span class="val">{summary.total_listings}</span>
			</div>
			<div class="stat">
				<span class="label">Active</span>
				<span class="val">{summary.active_count}</span>
			</div>
			<div class="stat">
				<span class="label">Sold</span>
				<span class="val">{summary.sold_count}</span>
			</div>
			<div class="stat">
				<span class="label">Card listings</span>
				<span class="val">{summary.card_listings_count}</span>
			</div>
			<div class="stat">
				<span class="label">Cards updated</span>
				<span class="val good">{summary.upserted_rows}</span>
			</div>
			<div class="stat">
				<span class="label">Unmatched</span>
				<span class="val" class:bad={summary.unmatched_listing_count > 0}>
					{summary.unmatched_listing_count}
				</span>
			</div>
			<div class="stat">
				<span class="label">Match rate</span>
				<span class="val {matchRateClass}">{matchRate.toFixed(1)}%</span>
			</div>
			<div class="stat">
				<span class="label">Duration</span>
				<span class="val">{summary.duration_ms}ms</span>
			</div>
		</section>

		{#if summary.unmapped_treatments.length || summary.unmapped_sets.length}
			<section class="alert">
				<h3>⚠ Vocabulary drift detected</h3>
				{#if summary.unmapped_treatments.length}
					<p>
						<strong>New WTP treatments seen:</strong>
						<code>{summary.unmapped_treatments.join(', ')}</code><br />
						Add these to <code>WTP_TREATMENT_TO_PARALLEL</code> in
						<code>src/lib/server/wtp/inbound-mapping.ts</code>.
					</p>
				{/if}
				{#if summary.unmapped_sets.length}
					<p>
						<strong>WTP sets not in our catalog:</strong>
						<code>{summary.unmapped_sets.join(', ')}</code><br />
						Likely a new Wonders set release — import the new cards before re-running.
					</p>
				{/if}
			</section>
		{/if}

		<section>
			<h3>Coverage by set</h3>
			<table>
				<thead>
					<tr>
						<th>Set</th>
						<th>WTP listings</th>
						<th>Matched</th>
						<th>%</th>
					</tr>
				</thead>
				<tbody>
					{#each Object.entries(summary.per_set_coverage) as [setName, cov]}
						<tr>
							<td>{setName}</td>
							<td>{cov.listings}</td>
							<td>{cov.matched}</td>
							<td>
								{cov.listings > 0 ? ((cov.matched / cov.listings) * 100).toFixed(1) : '0'}%
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		{#if summary.unmatched_samples.length}
			<section>
				<h3>Unmatched listings ({summary.unmatched_listing_count} total — first 50)</h3>
				<details>
					<summary>Show unmatched</summary>
					<table>
						<thead>
							<tr>
								<th>Card name</th>
								<th>Treatment</th>
								<th>Set</th>
								<th>Cond.</th>
								<th>Price</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{#each summary.unmatched_samples as l}
								<tr>
									<td>{l.card_name}</td>
									<td>{l.treatment}</td>
									<td>{l.set}</td>
									<td>{l.condition}</td>
									<td>${l.price}</td>
									<td>{l.status}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</details>
			</section>
		{/if}
	{/if}

	{#if runs.length}
		<section>
			<h3>Recent runs</h3>
			<p class="muted">
				Daily activity from <code>scraping_test_history</code> (game_id='wonders').
			</p>
			<table>
				<thead>
					<tr>
						<th>Date</th>
						<th>Cards w/ data</th>
						<th>Total sold (lifetime)</th>
						<th>Sales (30d)</th>
					</tr>
				</thead>
				<tbody>
					{#each runs as r}
						<tr>
							<td>{r.date}</td>
							<td>{r.cards_with_data}</td>
							<td>{r.total_sold_lifetime}</td>
							<td>{r.sales_30d}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}
</div>

<style>
	.wtp-tab {
		padding: 1rem;
	}
	.muted {
		color: var(--text-tertiary, #888);
		font-size: 0.9rem;
	}
	.summary-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.75rem;
		margin: 1.5rem 0;
	}
	.stat {
		display: flex;
		flex-direction: column;
		padding: 0.75rem;
		border: 1px solid var(--border, #2a2a2a);
		border-radius: 6px;
	}
	.stat .label {
		font-size: 0.75rem;
		color: var(--text-tertiary, #888);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.stat .val {
		font-size: 1.4rem;
		font-weight: 600;
	}
	.good {
		color: #22c55e;
	}
	.okay {
		color: #eab308;
	}
	.bad {
		color: #ef4444;
	}
	.alert {
		padding: 1rem;
		border: 1px solid #eab308;
		border-radius: 6px;
		background: rgba(234, 179, 8, 0.05);
		margin: 1rem 0;
	}
	.alert h3 {
		margin-top: 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		margin: 0.5rem 0;
	}
	th,
	td {
		padding: 0.4rem 0.6rem;
		text-align: left;
		border-bottom: 1px solid var(--border, #2a2a2a);
	}
	.btn-primary {
		padding: 0.6rem 1.2rem;
		border-radius: 6px;
		border: 0;
		background: var(--gold, #8b5cf6);
		color: white;
		cursor: pointer;
		font-weight: 600;
	}
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
