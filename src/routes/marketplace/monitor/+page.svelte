<script lang="ts">
	import { onMount } from 'svelte';
	import { collectionItems } from '$lib/stores/collection';
	import { fetchSellerListings, scoreListingMatch, type EbayListing } from '$lib/services/ebay';
	import { showToast } from '$lib/stores/toast';
	import { idb } from '$lib/services/idb';

	const SETTINGS_KEY = 'ebayMonitorSettings';
	const LAST_CHECK_KEY = 'ebayMonitorLastCheck';

	interface MonitorSettings {
		enabled: boolean;
		sellerUsername: string;
	}

	interface MatchResult {
		listing: EbayListing;
		cardId: string;
		heroName: string;
		score: number;
	}

	let settings = $state<MonitorSettings>({ enabled: false, sellerUsername: '' });
	let checking = $state(false);
	let matches = $state<MatchResult[]>([]);
	let lastCheck = $state<string | null>(null);

	// Load from IDB on mount
	onMount(async () => {
		try {
			const stored = await idb.getMeta<MonitorSettings>(SETTINGS_KEY);
			if (stored && typeof stored === 'object') {
				settings = stored as MonitorSettings;
			}
			const storedCheck = await idb.getMeta<string>(LAST_CHECK_KEY);
			if (storedCheck) lastCheck = storedCheck;

			// One-time localStorage migration
			const legacySettings = localStorage.getItem('ebayMonitorSettings');
			if (legacySettings) {
				const parsed = JSON.parse(legacySettings);
				settings = parsed;
				await idb.setMeta(SETTINGS_KEY, parsed);
				localStorage.removeItem('ebayMonitorSettings');
			}
			const legacyCheck = localStorage.getItem('ebayMonitorLastCheck');
			if (legacyCheck) {
				lastCheck = legacyCheck;
				await idb.setMeta(LAST_CHECK_KEY, legacyCheck);
				localStorage.removeItem('ebayMonitorLastCheck');
			}
		} catch (err) {
			console.debug('[marketplace-monitor] Settings load failed:', err);
		}
	});

	function saveSettings() {
		idb.setMeta(SETTINGS_KEY, settings).catch(() => {});
	}

	async function checkNow() {
		if (!settings.sellerUsername.trim()) {
			showToast('Enter a seller username', 'x');
			return;
		}
		checking = true;
		matches = [];

		try {
			const listings = await fetchSellerListings(settings.sellerUsername.trim());
			const items = $collectionItems;
			const results: MatchResult[] = [];

			for (const listing of listings) {
				let bestMatch: MatchResult | null = null;
				for (const item of items) {
					const card = item.card;
					if (!card) continue;
					const score = scoreListingMatch(listing.title, card);
					if (score >= 55 && (!bestMatch || score > bestMatch.score)) {
						bestMatch = {
							listing,
							cardId: card.id,
							heroName: card.hero_name || card.name,
							score
						};
					}
				}
				if (bestMatch) results.push(bestMatch);
			}

			matches = results.sort((a, b) => b.score - a.score);
			lastCheck = new Date().toISOString();
			idb.setMeta(LAST_CHECK_KEY, lastCheck).catch(() => {});
			showToast(`Found ${matches.length} matches`, 'check');
		} catch (err) {
			console.debug('[marketplace-monitor] Listing check failed:', err);
			showToast('Failed to check listings', 'x');
		}
		checking = false;
	}

	function formatTime(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Seller Monitor - BOBA Scanner</title>
</svelte:head>

<div class="monitor-page">
	<header class="page-header">
		<h1>Seller Monitor</h1>
		<p class="subtitle">Track an eBay seller's listings and match them to your collection</p>
	</header>

	<div class="settings-card">
		<div class="setting-row">
			<label for="seller-input">eBay Seller Username</label>
			<input
				id="seller-input"
				type="text"
				bind:value={settings.sellerUsername}
				placeholder="seller_username"
				onchange={saveSettings}
			/>
		</div>

		<div class="setting-row">
			<label class="toggle-label">
				<input type="checkbox" bind:checked={settings.enabled} onchange={saveSettings} />
				<span>Enable auto-checking (every 4 hours)</span>
			</label>
		</div>

		<button class="check-btn" onclick={checkNow} disabled={checking}>
			{checking ? 'Checking...' : 'Check Now'}
		</button>

		{#if lastCheck}
			<p class="last-check">Last checked: {formatTime(lastCheck)}</p>
		{/if}
	</div>

	{#if matches.length > 0}
		<div class="matches-section">
			<h2>Matched Listings ({matches.length})</h2>
			<div class="matches-list">
				{#each matches as match}
					<a
						href={match.listing.url}
						target="_blank"
						rel="noopener noreferrer"
						class="match-card"
					>
						<div class="match-header">
							<span class="match-hero">{match.heroName}</span>
							<span class="match-score">Score: {match.score}</span>
						</div>
						<div class="match-title">{match.listing.title}</div>
						<div class="match-price">${match.listing.price.toFixed(2)}</div>
					</a>
				{/each}
			</div>
		</div>
	{:else if lastCheck && !checking}
		<div class="no-matches">
			<p>No matching listings found for this seller.</p>
		</div>
	{/if}
</div>

<style>
	.monitor-page {
		max-width: 600px;
		margin: 0 auto;
		padding: 1rem;
	}
	.page-header { margin-bottom: 1.5rem; }
	h1 { font-size: 1.5rem; font-weight: 700; }
	.subtitle {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}
	.settings-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}
	.setting-row {
		margin-bottom: 1rem;
	}
	.setting-row label {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	.setting-row input[type='text'] {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
	}
	.toggle-label {
		display: flex !important;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}
	.toggle-label span {
		font-size: 0.85rem;
		color: var(--text-primary);
	}
	.check-btn {
		width: 100%;
		padding: 0.75rem;
		border-radius: 10px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}
	.check-btn:disabled { opacity: 0.6; cursor: not-allowed; }
	.last-check {
		text-align: center;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 0.5rem;
	}
	.matches-section h2 {
		font-size: 1.1rem;
		font-weight: 600;
		margin-bottom: 0.75rem;
	}
	.matches-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.match-card {
		display: block;
		padding: 0.75rem;
		background: var(--bg-elevated);
		border-radius: 10px;
		text-decoration: none;
		color: var(--text-primary);
		transition: background 0.15s;
	}
	.match-card:hover { background: var(--bg-hover); }
	.match-header {
		display: flex;
		justify-content: space-between;
		margin-bottom: 4px;
	}
	.match-hero { font-weight: 600; font-size: 0.9rem; }
	.match-score {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}
	.match-title {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-bottom: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.match-price {
		font-size: 1rem;
		font-weight: 700;
		color: var(--accent-primary);
	}
	.no-matches {
		text-align: center;
		padding: 2rem;
		color: var(--text-tertiary);
	}
</style>
