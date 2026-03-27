<script lang="ts">
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast.svelte';

	interface ScanFlag {
		id: string;
		card_identified: string | null;
		card_suggested: string | null;
		image_url: string | null;
		status: string;
		created_at: string;
	}

	let loading = $state(true);
	let cardMetrics = $state({
		totalCards: 0,
		withPrices: 0,
		stalePrices: 0,
		pendingFlags: 0
	});
	let scanFlags = $state<ScanFlag[]>([]);
	let resolvingFlag = $state<string | null>(null);
	let activeSection = $state<'overview' | 'misid'>('overview');

	$effect(() => {
		loadCards();
	});

	async function loadCards() {
		loading = true;
		const client = getSupabase();
		if (!client) { loading = false; return; }

		const sevenDaysAgo = new Date();
		sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

		try {
			const [cardsRes, pricesRes, stalePricesRes, flagsCountRes, flagsRes] = await Promise.all([
				client.from('system_settings').select('value').eq('key', 'total_cards').maybeSingle(),
				client.from('price_cache').select('id', { count: 'exact', head: true }),
				client.from('price_cache').select('id', { count: 'exact', head: true })
					.lt('fetched_at', sevenDaysAgo.toISOString()),
				client.from('scan_flags').select('id', { count: 'exact', head: true })
					.eq('status', 'pending'),
				client.from('scan_flags').select('*')
					.eq('status', 'pending')
					.order('created_at', { ascending: false })
					.limit(50)
			]);

			cardMetrics.totalCards = Number(cardsRes.data?.value) || 0;
			cardMetrics.withPrices = pricesRes.count || 0;
			cardMetrics.stalePrices = stalePricesRes.count || 0;
			cardMetrics.pendingFlags = flagsCountRes.count || 0;

			if (flagsRes.data) {
				scanFlags = flagsRes.data as ScanFlag[];
			}
		} catch {
			showToast('Failed to load card data', 'x');
		}
		loading = false;
	}

	async function resolveFlag(flagId: string, status: 'confirmed_user' | 'confirmed_ai' | 'resolved') {
		resolvingFlag = flagId;
		try {
			const res = await fetch('/api/admin/scan-flags', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: flagId, status })
			});
			if (!res.ok) throw new Error('Failed to resolve');
			scanFlags = scanFlags.filter((f) => f.id !== flagId);
			cardMetrics.pendingFlags = Math.max(0, cardMetrics.pendingFlags - 1);
			showToast('Flag resolved', 'check');
		} catch {
			showToast('Failed to resolve flag', 'x');
		}
		resolvingFlag = null;
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
		});
	}
</script>

<div class="cards-tab">
	{#if loading}
		<div class="loading">Loading card data...</div>
	{:else}
		<!-- Section Switcher -->
		<div class="sub-tabs">
			<button class:active={activeSection === 'overview'} onclick={() => activeSection = 'overview'}>
				Overview
			</button>
			<button class:active={activeSection === 'misid'} onclick={() => activeSection = 'misid'}>
				MisID Queue {#if cardMetrics.pendingFlags > 0}<span class="badge-count">{cardMetrics.pendingFlags}</span>{/if}
			</button>
		</div>

		{#if activeSection === 'overview'}
			<!-- Metrics -->
			<div class="metrics-row">
				<div class="mini-card">
					<div class="mc-value">{cardMetrics.totalCards.toLocaleString()}</div>
					<div class="mc-label">Total Cards</div>
				</div>
				<div class="mini-card">
					<div class="mc-value">{cardMetrics.withPrices.toLocaleString()}</div>
					<div class="mc-label">With Prices</div>
				</div>
				<div class="mini-card">
					<div class="mc-value warn">{cardMetrics.stalePrices}</div>
					<div class="mc-label">Stale Prices (&gt;7d)</div>
				</div>
				<div class="mini-card">
					<div class="mc-value" class:warn={cardMetrics.pendingFlags > 0}>{cardMetrics.pendingFlags}</div>
					<div class="mc-label">Pending Flags</div>
				</div>
			</div>

			<!-- Price Health Info -->
			<div class="info-card">
				<h3 class="section-title">Pricing Health</h3>
				{#if cardMetrics.totalCards > 0}
					{@const pricedPct = Math.round((cardMetrics.withPrices / cardMetrics.totalCards) * 100)}
					<div class="health-bar-row">
						<span class="health-label">Cards with pricing data</span>
						<div class="health-bar">
							<div class="health-fill" style:width="{pricedPct}%"></div>
						</div>
						<span class="health-pct">{pricedPct}%</span>
					</div>
				{/if}
				{#if cardMetrics.withPrices > 0}
					{@const freshPct = Math.round(((cardMetrics.withPrices - cardMetrics.stalePrices) / cardMetrics.withPrices) * 100)}
					<div class="health-bar-row">
						<span class="health-label">Prices fresh (&lt;7d)</span>
						<div class="health-bar">
							<div class="health-fill fresh" style:width="{freshPct}%"></div>
						</div>
						<span class="health-pct">{freshPct}%</span>
					</div>
				{/if}
			</div>
		{:else}
			<!-- Misidentification Review Queue -->
			{#if scanFlags.length === 0}
				<div class="empty-state">
					<div class="empty-icon">&#10003;</div>
					<p>No pending misidentification reports</p>
				</div>
			{:else}
				<div class="flags-list">
					{#each scanFlags as flag}
						<div class="flag-card">
							<div class="flag-header">
								<span class="flag-date">{formatDate(flag.created_at)}</span>
							</div>
							<div class="flag-body">
								<div class="flag-detail">
									<span class="flag-label">AI identified:</span>
									<span class="flag-value">{flag.card_identified || 'Unknown'}</span>
								</div>
								<div class="flag-detail">
									<span class="flag-label">User says:</span>
									<span class="flag-value">{flag.card_suggested || 'Not specified'}</span>
								</div>
							</div>
							<div class="flag-actions">
								<button
									class="flag-btn confirm-user"
									onclick={() => resolveFlag(flag.id, 'confirmed_user')}
									disabled={resolvingFlag === flag.id}
								>Confirm User</button>
								<button
									class="flag-btn confirm-ai"
									onclick={() => resolveFlag(flag.id, 'confirmed_ai')}
									disabled={resolvingFlag === flag.id}
								>Confirm AI</button>
								<button
									class="flag-btn resolve"
									onclick={() => resolveFlag(flag.id, 'resolved')}
									disabled={resolvingFlag === flag.id}
								>Dismiss</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.cards-tab {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.loading {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}

	.sub-tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 0.5rem;
	}

	.sub-tabs button {
		background: none;
		border: none;
		padding: 0.5rem 0.75rem;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.85rem;
		border-bottom: 2px solid transparent;
	}

	.sub-tabs button.active {
		color: var(--gold);
		border-bottom-color: var(--gold);
		font-weight: 600;
	}

	.badge-count {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 10px;
		background: var(--warning);
		color: #000;
		font-size: 0.65rem;
		font-weight: 700;
		margin-left: 4px;
	}

	.metrics-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
		gap: 0.5rem;
	}

	.mini-card {
		background: var(--bg-elevated);
		border-radius: 10px;
		padding: 0.75rem;
		text-align: center;
	}

	.mc-value {
		font-size: 1.2rem;
		font-weight: 700;
		color: var(--gold);
	}

	.mc-value.warn { color: var(--warning); }

	.mc-label {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		margin-top: 2px;
	}

	.info-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
	}

	.section-title {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}

	.health-bar-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.health-label {
		font-size: 0.8rem;
		color: var(--text-secondary);
		min-width: 160px;
	}

	.health-bar {
		flex: 1;
		height: 8px;
		border-radius: 4px;
		background: var(--bg-hover);
		overflow: hidden;
	}

	.health-fill {
		height: 100%;
		border-radius: 4px;
		background: var(--gold);
		transition: width 0.3s;
	}

	.health-fill.fresh { background: var(--success); }

	.health-pct {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-primary);
		min-width: 36px;
		text-align: right;
	}

	/* Flags */
	.empty-state {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}

	.empty-icon {
		font-size: 2rem;
		color: var(--success);
		margin-bottom: 0.5rem;
	}

	.flags-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.flag-card {
		background: var(--bg-elevated);
		border-radius: 10px;
		padding: 0.875rem;
		border-left: 3px solid var(--warning);
	}

	.flag-header {
		margin-bottom: 0.5rem;
	}

	.flag-date {
		font-size: 0.7rem;
		color: var(--text-tertiary);
	}

	.flag-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
	}

	.flag-detail {
		display: flex;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.flag-label {
		color: var(--text-tertiary);
		min-width: 100px;
	}

	.flag-value {
		color: var(--text-primary);
		font-weight: 500;
	}

	.flag-actions {
		display: flex;
		gap: 0.375rem;
	}

	.flag-btn {
		padding: 0.35rem 0.625rem;
		border-radius: 6px;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid;
	}

	.flag-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.confirm-user {
		background: rgba(16, 185, 129, 0.1);
		border-color: rgba(16, 185, 129, 0.3);
		color: var(--success);
	}

	.confirm-ai {
		background: rgba(59, 130, 246, 0.1);
		border-color: rgba(59, 130, 246, 0.3);
		color: var(--info);
	}

	.resolve {
		background: transparent;
		border-color: var(--border);
		color: var(--text-tertiary);
	}
</style>
