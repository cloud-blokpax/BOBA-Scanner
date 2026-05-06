<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';

	interface FilterHealthRow {
		card_id: string;
		game_id: string;
		hero_name: string | null;
		name: string;
		card_number: string | null;
		parallel: string | null;
		weapon_type: string | null;
		total_obs: number;
		accepted: number;
		rejected: number;
		accept_pct: number;
		identity_rejects: number;
		weapon_rejects: number;
		parallel_rejects: number;
		hard_rejects: number;
		top_rejection: string | null;
		last_observed: string;
	}

	interface SampleRow {
		bucket: 'rejected' | 'accepted';
		observed_at: string;
		ebay_item_id: string;
		title: string;
		price_value: number | null;
		condition_label: string | null;
		rejection_reason: string | null;
		weapon_conflict: boolean;
		item_web_url: string | null;
	}

	type SortKey = 'accept_pct_asc' | 'total_obs_desc' | 'last_observed_desc';
	type GameFilter = '' | 'boba' | 'wonders';

	let rows = $state<FilterHealthRow[]>([]);
	let loading = $state(false);
	let refreshedAt = $state<string | null>(null);

	let minObs = $state(10);
	let maxAcceptPct = $state(50);
	let game = $state<GameFilter>('');
	let sort = $state<SortKey>('accept_pct_asc');

	let drawerCard = $state<FilterHealthRow | null>(null);
	let drawerRejected = $state<SampleRow[]>([]);
	let drawerAccepted = $state<SampleRow[]>([]);
	let drawerLoading = $state(false);

	$effect(() => {
		void load();
	});

	async function load() {
		loading = true;
		try {
			const params = new URLSearchParams({
				min_obs: String(minObs),
				max_accept_pct: String(maxAcceptPct),
				sort
			});
			if (game) params.set('game', game);
			const res = await fetch(`/api/admin/filter-health?${params}`);
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			rows = data.rows ?? [];
			refreshedAt = data.refreshedAt ?? null;
		} catch (err) {
			showToast(
				'Failed to load filter health: ' + (err instanceof Error ? err.message : 'unknown'),
				'x'
			);
		} finally {
			loading = false;
		}
	}

	async function openDrawer(row: FilterHealthRow) {
		drawerCard = row;
		drawerRejected = [];
		drawerAccepted = [];
		drawerLoading = true;
		try {
			const res = await fetch(`/api/admin/filter-health?card_id=${encodeURIComponent(row.card_id)}`);
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			drawerRejected = data.rejected ?? [];
			drawerAccepted = data.accepted ?? [];
		} catch (err) {
			showToast(
				'Failed to load samples: ' + (err instanceof Error ? err.message : 'unknown'),
				'x'
			);
		} finally {
			drawerLoading = false;
		}
	}

	function closeDrawer() {
		drawerCard = null;
		drawerRejected = [];
		drawerAccepted = [];
	}

	function fmtDate(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		return (
			d.toLocaleDateString() +
			' ' +
			d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		);
	}

	function fmtRelative(iso: string | null): string {
		if (!iso) return '—';
		const ms = Date.now() - new Date(iso).getTime();
		const hours = Math.floor(ms / 3_600_000);
		if (hours < 1) return 'just now';
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	function fmtPrice(v: number | null): string {
		return v == null ? '—' : `$${Number(v).toFixed(2)}`;
	}

	function pctColor(pct: number): string {
		if (pct === 0) return 'var(--danger, #ef4444)';
		if (pct < 20) return 'var(--danger, #ef4444)';
		if (pct < 50) return 'var(--warning, #f59e0b)';
		return 'var(--success, #10b981)';
	}

	function topRejectionLabel(row: FilterHealthRow): string {
		const reason = row.top_rejection;
		if (!reason) return '—';
		const map: Record<string, string> = {
			identity_gate: 'Identity gate',
			weapon_conflict: 'Weapon conflict',
			parallel_gate: 'Parallel gate',
			set_anchor: 'Set anchor',
			wonders_anchor: 'Wonders anchor',
			boba_contamination: 'BoBA contamination',
			bulk_lot: 'Bulk lot',
			missing_title: 'Missing title'
		};
		if (map[reason]) return map[reason];
		if (reason.startsWith('hard_reject:'))
			return `Hard reject (${reason.slice('hard_reject:'.length)})`;
		return reason;
	}
</script>

<div class="filter-health-tab">
	<div class="header">
		<div>
			<h3>Filter Health</h3>
			<div class="sub">
				eBay harvest filter accept rates per card.
				{#if refreshedAt}
					<span class="meta">Refreshed {fmtRelative(refreshedAt)}.</span>
				{/if}
			</div>
		</div>
		<button class="btn-secondary" onclick={() => load()} disabled={loading}>Refresh</button>
	</div>

	<div class="controls">
		<label>
			<span>Min observations</span>
			<input type="number" min="1" max="500" bind:value={minObs} />
		</label>
		<label>
			<span>Max accept %</span>
			<input type="number" min="0" max="100" bind:value={maxAcceptPct} />
		</label>
		<label>
			<span>Game</span>
			<select bind:value={game}>
				<option value="">All</option>
				<option value="boba">BoBA</option>
				<option value="wonders">Wonders</option>
			</select>
		</label>
		<label>
			<span>Sort</span>
			<select bind:value={sort}>
				<option value="accept_pct_asc">Worst accept rate first</option>
				<option value="total_obs_desc">Most observations first</option>
				<option value="last_observed_desc">Most recently observed</option>
			</select>
		</label>
	</div>

	{#if loading}
		<div class="empty">Loading…</div>
	{:else if rows.length === 0}
		<div class="empty">No cards match these filters.</div>
	{:else}
		<div class="table-wrapper">
			<table>
				<thead>
					<tr>
						<th>Card</th>
						<th>Game</th>
						<th>Parallel</th>
						<th class="num">Obs</th>
						<th class="num">Accept</th>
						<th class="num">Accept %</th>
						<th>Top rejection</th>
						<th class="num">Last seen</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.card_id)}
						<tr onclick={() => openDrawer(row)} class="clickable">
							<td>
								<div class="card-name">{row.hero_name ?? row.name}</div>
								<div class="card-sub">{row.card_number ?? '—'}</div>
							</td>
							<td>{row.game_id}</td>
							<td>{row.parallel ?? '—'}</td>
							<td class="num">{row.total_obs}</td>
							<td class="num">{row.accepted}</td>
							<td class="num" style:color={pctColor(row.accept_pct)}>
								<strong>{Number(row.accept_pct).toFixed(1)}%</strong>
							</td>
							<td>{topRejectionLabel(row)}</td>
							<td class="num">{fmtRelative(row.last_observed)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if drawerCard}
		<div
			class="drawer-backdrop"
			role="presentation"
			onclick={closeDrawer}
			onkeydown={(e) => e.key === 'Escape' && closeDrawer()}
		></div>
		<div class="drawer" role="dialog" aria-modal="true" tabindex="-1">
			<div class="drawer-head">
				<div>
					<div class="drawer-title">
						{drawerCard.hero_name ?? drawerCard.name}
						<span class="drawer-cn">{drawerCard.card_number ?? ''}</span>
					</div>
					<div class="drawer-sub">
						{drawerCard.game_id} · {drawerCard.parallel ?? '—'}
						{#if drawerCard.weapon_type}· weapon: {drawerCard.weapon_type}{/if}
					</div>
				</div>
				<button class="close" onclick={closeDrawer} aria-label="Close">×</button>
			</div>

			<div class="drawer-stats">
				<div class="stat">
					<div class="stat-label">Total obs</div>
					<div class="stat-value">{drawerCard.total_obs}</div>
				</div>
				<div class="stat">
					<div class="stat-label">Accepted</div>
					<div class="stat-value">{drawerCard.accepted}</div>
				</div>
				<div class="stat">
					<div class="stat-label">Accept %</div>
					<div class="stat-value" style:color={pctColor(drawerCard.accept_pct)}>
						{Number(drawerCard.accept_pct).toFixed(1)}%
					</div>
				</div>
			</div>

			<div class="drawer-rejection-mix">
				{#if drawerCard.identity_rejects > 0}
					<span class="chip">identity {drawerCard.identity_rejects}</span>
				{/if}
				{#if drawerCard.weapon_rejects > 0}
					<span class="chip">weapon {drawerCard.weapon_rejects}</span>
				{/if}
				{#if drawerCard.parallel_rejects > 0}
					<span class="chip">parallel {drawerCard.parallel_rejects}</span>
				{/if}
				{#if drawerCard.hard_rejects > 0}
					<span class="chip">hard {drawerCard.hard_rejects}</span>
				{/if}
			</div>

			<div class="drawer-body">
				{#if drawerLoading}
					<div class="empty">Loading samples…</div>
				{:else}
					<section>
						<h4>Recent rejected ({drawerRejected.length})</h4>
						{#if drawerRejected.length === 0}
							<div class="empty-sub">No rejected samples in the 30-day window.</div>
						{:else}
							<ul class="samples">
								{#each drawerRejected as s (s.ebay_item_id + s.observed_at)}
									<li>
										<div class="sample-head">
											<span class="reason">{s.rejection_reason ?? 'unknown'}</span>
											<span class="sample-date">{fmtDate(s.observed_at)}</span>
										</div>
										<div class="sample-title">
											{#if s.item_web_url}
												<a href={s.item_web_url} target="_blank" rel="noopener noreferrer">
													{s.title}
												</a>
											{:else}
												{s.title}
											{/if}
										</div>
										<div class="sample-meta">
											{fmtPrice(s.price_value)}
											{#if s.condition_label}· {s.condition_label}{/if}
										</div>
									</li>
								{/each}
							</ul>
						{/if}
					</section>

					<section>
						<h4>Recent accepted ({drawerAccepted.length})</h4>
						{#if drawerAccepted.length === 0}
							<div class="empty-sub">No accepted samples in the 30-day window.</div>
						{:else}
							<ul class="samples">
								{#each drawerAccepted as s (s.ebay_item_id + s.observed_at)}
									<li>
										<div class="sample-head">
											<span class="reason ok">accepted</span>
											<span class="sample-date">{fmtDate(s.observed_at)}</span>
										</div>
										<div class="sample-title">
											{#if s.item_web_url}
												<a href={s.item_web_url} target="_blank" rel="noopener noreferrer">
													{s.title}
												</a>
											{:else}
												{s.title}
											{/if}
										</div>
										<div class="sample-meta">
											{fmtPrice(s.price_value)}
											{#if s.condition_label}· {s.condition_label}{/if}
										</div>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.filter-health-tab {
		padding: 1rem;
	}
	.header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.header h3 {
		margin: 0 0 0.25rem 0;
	}
	.sub {
		color: var(--text-tertiary, #888);
		font-size: 0.875rem;
	}
	.meta {
		margin-left: 0.5rem;
		opacity: 0.8;
	}

	.btn-secondary {
		padding: 0.4rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-elevated);
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.85rem;
	}
	.btn-secondary:hover {
		color: var(--text-primary);
	}
	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 1rem;
		padding: 0.75rem;
		background: var(--bg-elevated);
		border-radius: 6px;
	}
	.controls label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8125rem;
		color: var(--text-tertiary, #888);
	}
	.controls input,
	.controls select {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg-base, var(--bg-elevated));
		color: var(--text-primary);
		font-size: 0.875rem;
		min-width: 8rem;
	}
	.controls input[type='number'] {
		width: 6rem;
		min-width: 0;
	}

	.empty {
		padding: 2rem;
		text-align: center;
		color: var(--text-tertiary, #888);
	}
	.empty-sub {
		padding: 1rem;
		color: var(--text-tertiary, #888);
		font-size: 0.875rem;
	}

	.table-wrapper {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	th,
	td {
		padding: 0.5rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid var(--border);
	}
	th {
		background: var(--bg-elevated);
		font-weight: 600;
		font-size: 0.8125rem;
		color: var(--text-tertiary, #888);
		position: sticky;
		top: 0;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	tbody tr.clickable {
		cursor: pointer;
		transition: background 0.1s;
	}
	tbody tr.clickable:hover {
		background: var(--bg-elevated);
	}
	.card-name {
		font-weight: 500;
	}
	.card-sub {
		font-size: 0.75rem;
		color: var(--text-tertiary, #888);
	}

	.drawer-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 100;
	}
	.drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(640px, 100vw);
		background: var(--bg-base, #111);
		border-left: 1px solid var(--border);
		z-index: 101;
		display: flex;
		flex-direction: column;
	}

	.drawer-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		padding: 1rem;
		border-bottom: 1px solid var(--border);
	}
	.drawer-title {
		font-size: 1rem;
		font-weight: 600;
	}
	.drawer-cn {
		color: var(--text-tertiary, #888);
		font-weight: 400;
		margin-left: 0.5rem;
	}
	.drawer-sub {
		color: var(--text-tertiary, #888);
		font-size: 0.8125rem;
		margin-top: 0.25rem;
	}
	.close {
		background: transparent;
		border: none;
		font-size: 1.5rem;
		line-height: 1;
		cursor: pointer;
		color: var(--text-tertiary, #888);
		padding: 0 0.5rem;
	}

	.drawer-stats {
		display: flex;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border);
	}
	.stat {
		flex: 1;
	}
	.stat-label {
		font-size: 0.75rem;
		color: var(--text-tertiary, #888);
	}
	.stat-value {
		font-size: 1.25rem;
		font-weight: 600;
	}

	.drawer-rejection-mix {
		padding: 0.5rem 1rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		border-bottom: 1px solid var(--border);
	}
	.chip {
		font-size: 0.75rem;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		background: var(--bg-elevated);
		color: var(--text-tertiary, #888);
	}

	.drawer-body {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}
	.drawer-body section {
		margin-bottom: 1.5rem;
	}
	.drawer-body h4 {
		margin: 0 0 0.5rem 0;
		font-size: 0.875rem;
		color: var(--text-tertiary, #888);
	}

	.samples {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	.samples li {
		padding: 0.625rem;
		background: var(--bg-elevated);
		border-radius: 4px;
	}
	.sample-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.25rem;
	}
	.reason {
		font-size: 0.75rem;
		padding: 0.125rem 0.375rem;
		border-radius: 3px;
		background: var(--danger, #ef4444);
		color: white;
	}
	.reason.ok {
		background: var(--success, #10b981);
	}
	.sample-date {
		font-size: 0.75rem;
		color: var(--text-tertiary, #888);
	}
	.sample-title {
		font-size: 0.875rem;
		line-height: 1.3;
		margin-bottom: 0.25rem;
	}
	.sample-title a {
		color: var(--text-primary);
		text-decoration: none;
	}
	.sample-title a:hover {
		text-decoration: underline;
	}
	.sample-meta {
		font-size: 0.75rem;
		color: var(--text-tertiary, #888);
	}
</style>
