<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { showToast } from '$lib/stores/toast.svelte';
	import { getFormat } from '$lib/data/tournament-formats';

	interface DeckSubmission {
		id: string;
		player_name: string;
		player_email: string;
		player_discord: string | null;
		format_id: string;
		format_name: string;
		status: string;
		is_valid: boolean;
		hero_cards: Array<Record<string, unknown>>;
		play_entries: Array<Record<string, unknown>>;
		hot_dog_count: number;
		foil_hot_dog_count: number;
		hero_count: number;
		dbs_total: number | null;
		total_power: number;
		avg_power: number | null;
		validation_violations: Array<{ rule: string; message: string }>;
		validation_warnings: string[];
		validation_stats: Record<string, unknown>;
		submitted_at: string;
		last_updated_at: string;
		verification_code: string | null;
	}

	interface TournamentResult {
		id: string;
		player_name: string;
		final_standing: number;
		placement_label: string | null;
		match_wins: number | null;
		match_losses: number | null;
		match_draws: number | null;
		submission_id: string | null;
	}

	const { data } = $props();
	const tournament = $derived(data.tournament);
	const format = $derived(getFormat(tournament.format_id || ''));

	let activeTab = $state<'overview' | 'submissions' | 'results' | 'share'>('overview');
	const submissions = $derived(data.submissions as DeckSubmission[]);
	const results = $derived(data.results as TournamentResult[]);

	let expandedSubmission = $state<string | null>(null);
	let closingRegistration = $state(false);
	let savingResults = $state(false);

	// Results entry state — re-syncs when page data changes (e.g. after invalidation)
	let resultEntries = $state<Array<{
		player_name: string;
		final_standing: number | string;
		placement_label: string;
		match_wins: string;
		match_losses: string;
		match_draws: string;
		submission_id: string | null;
	}>>([]);

	function buildResultEntries(r: TournamentResult[], s: DeckSubmission[]) {
		return r.length > 0
			? r.map((entry) => ({
					player_name: entry.player_name,
					final_standing: entry.final_standing as number | string,
					placement_label: entry.placement_label || '',
					match_wins: entry.match_wins?.toString() || '',
					match_losses: entry.match_losses?.toString() || '',
					match_draws: entry.match_draws?.toString() || '',
					submission_id: entry.submission_id
				}))
			: s.map((sub) => ({
					player_name: sub.player_name,
					final_standing: '' as number | string,
					placement_label: '',
					match_wins: '',
					match_losses: '',
					match_draws: '',
					submission_id: sub.id
				}));
	}

	$effect(() => {
		resultEntries = buildResultEntries(results, submissions);
	});

	const shareUrl = $derived(`${typeof window !== 'undefined' ? window.location.origin : ''}/tournaments/enter?code=${tournament.code}`);
	const shareText = $derived(`Register your deck for ${tournament.name} at ${shareUrl}. Enter code ${tournament.code} in BOBA Scanner to submit and validate your deck before the event.`);
	const validCount = $derived(submissions.filter((s) => s.is_valid).length);
	const invalidCount = $derived(submissions.filter((s) => !s.is_valid).length);

	function getPlayCounts(sub: DeckSubmission) {
		const plays = (sub.play_entries || []);
		const standard = plays.filter(p => !String(p.card_number || '').startsWith('BPL-')).length;
		const bonus = plays.filter(p => String(p.card_number || '').startsWith('BPL-')).length;
		return { standard, bonus };
	}

	const isOpen = $derived.by(() => {
		if (tournament.registration_closed) return false;
		if (data.isDeadlinePassed) return false;
		return tournament.is_active;
	});

	function formatDateTime(iso: string): string {
		return new Date(iso).toLocaleString('en-US', {
			month: 'short', day: 'numeric', year: 'numeric',
			hour: 'numeric', minute: '2-digit'
		});
	}

	async function closeRegistration() {
		if (!confirm('Close registration? No new submissions will be accepted. This cannot be undone.')) return;
		closingRegistration = true;
		try {
			const res = await fetch('/api/organize/close-registration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tournament_id: tournament.id })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || err.message || 'Failed to close registration');
			}
			await invalidateAll();
			showToast('Registration closed', 'check');
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Failed', 'x');
		}
		closingRegistration = false;
	}

	function exportCsv() {
		const headers = ['player_name', 'player_email', 'format', 'is_valid', 'hero_count', 'dbs_total', 'avg_power', 'hero_card_numbers', 'play_card_numbers'];
		const rows = submissions.map((s) => {
			const heroNums = (s.hero_cards || []).map((c) => c.card_number || '').join(';');
			const playNums = (s.play_entries || []).map((p) => p.card_number || '').join(';');
			return [
				`"${s.player_name}"`, `"${s.player_email}"`, s.format_name,
				s.is_valid, s.hero_count, s.dbs_total ?? '', s.avg_power ?? '',
				`"${heroNums}"`, `"${playNums}"`
			].join(',');
		});
		const csv = [headers.join(','), ...rows].join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${tournament.code}-decks.csv`;
		a.click();
		URL.revokeObjectURL(url);
		showToast('CSV exported', 'check');
	}

	function addManualResultEntry() {
		resultEntries = [...resultEntries, {
			player_name: '',
			final_standing: '',
			placement_label: '',
			match_wins: '',
			match_losses: '',
			match_draws: '',
			submission_id: null
		}];
	}

	async function saveResults() {
		const validEntries = resultEntries.filter(
			(e) => e.player_name.trim() && e.final_standing
		);
		if (validEntries.length === 0) {
			showToast('No results to save', 'x');
			return;
		}

		savingResults = true;
		try {
			const res = await fetch('/api/tournament/results', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tournament_id: tournament.id,
					results: validEntries.map((e) => ({
						player_name: e.player_name.trim(),
						final_standing: parseInt(String(e.final_standing)),
						placement_label: e.placement_label || null,
						match_wins: e.match_wins ? parseInt(e.match_wins) : null,
						match_losses: e.match_losses ? parseInt(e.match_losses) : null,
						match_draws: e.match_draws ? parseInt(e.match_draws) : null,
						submission_id: e.submission_id
					}))
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || 'Failed to save results');
			}
			showToast('Results saved!', 'check');
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Failed', 'x');
		}
		savingResults = false;
	}

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text);
		showToast('Copied to clipboard', 'check');
	}
</script>

<svelte:head>
	<title>Manage: {tournament.name} - BOBA Scanner</title>
</svelte:head>

<div class="dashboard">
	<header class="dash-header">
		<a href="/organize" class="back-link">Back</a>
		<h1>{tournament.name}</h1>
		<span class="code-badge">{tournament.code}</span>
	</header>

	<nav class="tabs">
		<button class:active={activeTab === 'overview'} onclick={() => (activeTab = 'overview')}>Overview</button>
		<button class:active={activeTab === 'submissions'} onclick={() => (activeTab = 'submissions')}>Submissions ({submissions.length})</button>
		<button class:active={activeTab === 'results'} onclick={() => (activeTab = 'results')}>Results</button>
		<button class:active={activeTab === 'share'} onclick={() => (activeTab = 'share')}>Share</button>
	</nav>

	{#if activeTab === 'overview'}
		<div class="tab-panel">
			<div class="stats-row">
				<div class="stat-card">
					<span class="stat-value">{submissions.length}</span>
					<span class="stat-label">Registered</span>
				</div>
				<div class="stat-card">
					<span class="stat-value valid">{validCount}</span>
					<span class="stat-label">Valid</span>
				</div>
				<div class="stat-card">
					<span class="stat-value invalid">{invalidCount}</span>
					<span class="stat-label">Invalid</span>
				</div>
				<div class="stat-card">
					<span class="stat-value" class:open={isOpen} class:closed={!isOpen}>{isOpen ? 'Open' : 'Closed'}</span>
					<span class="stat-label">Status</span>
				</div>
			</div>

			<div class="detail-grid">
				<div class="detail-item">
					<span class="detail-label">Format</span>
					<span>{format?.name || tournament.format_id || 'Custom'}</span>
				</div>
				{#if tournament.event_date}
					<div class="detail-item">
						<span class="detail-label">Date</span>
						<span>{new Date(tournament.event_date).toLocaleDateString()}</span>
					</div>
				{/if}
				{#if tournament.venue}
					<div class="detail-item">
						<span class="detail-label">Venue</span>
						<span>{tournament.venue}</span>
					</div>
				{/if}
				{#if tournament.entry_fee}
					<div class="detail-item">
						<span class="detail-label">Entry Fee</span>
						<span>{tournament.entry_fee}</span>
					</div>
				{/if}
				{#if tournament.prize_pool}
					<div class="detail-item">
						<span class="detail-label">Prize Pool</span>
						<span>{tournament.prize_pool}</span>
					</div>
				{/if}
				{#if tournament.max_players}
					<div class="detail-item">
						<span class="detail-label">Max Players</span>
						<span>{tournament.max_players}</span>
					</div>
				{/if}
				{#if tournament.submission_deadline}
					<div class="detail-item">
						<span class="detail-label">Deadline</span>
						<span>{formatDateTime(tournament.submission_deadline)}</span>
					</div>
				{/if}
			</div>

			{#if tournament.description}
				<div class="description">
					<span class="detail-label">Description</span>
					<p>{tournament.description}</p>
				</div>
			{/if}
		</div>

	{:else if activeTab === 'submissions'}
		<div class="tab-panel">
			<div class="sub-actions">
				{#if isOpen && !tournament.registration_closed}
					<button class="action-btn danger" onclick={closeRegistration} disabled={closingRegistration}>
						{closingRegistration ? 'Closing...' : 'Close Registration'}
					</button>
				{/if}
				<button class="action-btn" onclick={exportCsv} disabled={submissions.length === 0}>
					Export CSV
				</button>
			</div>

			{#if submissions.length === 0}
				<p class="empty">No submissions yet.</p>
			{:else}
				<div class="sub-table-wrapper">
					<table class="sub-table">
						<thead>
							<tr>
								<th>Player</th>
								<th>Valid</th>
								<th>Heroes</th>
								<th>Plays</th>
								<th>DBS</th>
								<th>Avg PWR</th>
								<th>Status</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each submissions as sub}
								{@const counts = getPlayCounts(sub)}
								<tr class:expanded={expandedSubmission === sub.id}>
									<td>
										<div class="player-cell">
											<span class="player-name">{sub.player_name}</span>
											<span class="player-email">{sub.player_email}</span>
										</div>
									</td>
									<td>
										{#if sub.is_valid}
											<span class="valid-badge">Valid</span>
										{:else}
											<span class="invalid-badge">Invalid</span>
										{/if}
									</td>
									<td>{sub.hero_count}</td>
									<td>{counts.standard}{counts.bonus > 0 ? ` + ${counts.bonus}` : ''}</td>
									<td>{sub.dbs_total ?? '—'}</td>
									<td>{sub.avg_power ?? '—'}</td>
									<td><span class="status-badge {sub.status}">{sub.status}</span></td>
									<td>
										<button
											class="expand-btn"
											onclick={() => expandedSubmission = expandedSubmission === sub.id ? null : sub.id}
										>
											{expandedSubmission === sub.id ? 'Collapse' : 'Expand'}
										</button>
									</td>
								</tr>
								{#if expandedSubmission === sub.id}
									<tr class="expanded-row">
										<td colspan="8">
											<div class="expanded-content">
												<div class="deck-section">
													<h4>Heroes ({sub.hero_cards?.length || 0})</h4>
													<div class="card-list">
														{#each (sub.hero_cards || []) as card}
															<div class="card-row">
																<span class="card-num">{card.card_number}</span>
																<span class="card-name">{card.hero_name}</span>
																<span class="card-power">PWR {card.power}</span>
																<span class="card-weapon">{card.weapon_type}</span>
															</div>
														{/each}
													</div>
												</div>

												{#if sub.play_entries?.length > 0}
													{@const stdPlays = sub.play_entries.filter(p => !String(p.card_number || '').startsWith('BPL-'))}
													{@const bnsPlays = sub.play_entries.filter(p => String(p.card_number || '').startsWith('BPL-'))}
													{#if stdPlays.length > 0}
														<div class="deck-section">
															<h4>Plays ({stdPlays.length})</h4>
															<div class="card-list">
																{#each stdPlays as play}
																	<div class="card-row">
																		<span class="card-num">{play.card_number}</span>
																		<span class="card-name">{play.name}</span>
																		<span class="card-dbs">DBS {play.dbs_score ?? '—'}</span>
																	</div>
																{/each}
															</div>
														</div>
													{/if}
													{#if bnsPlays.length > 0}
														<div class="deck-section">
															<h4>Bonus Plays ({bnsPlays.length})</h4>
															<div class="card-list">
																{#each bnsPlays as play}
																	<div class="card-row">
																		<span class="card-num">{play.card_number}</span>
																		<span class="card-name">{play.name}</span>
																		<span class="card-dbs">DBS {play.dbs_score ?? '—'}</span>
																	</div>
																{/each}
															</div>
														</div>
													{/if}
												{/if}

												<div class="deck-section">
													<h4>Hot Dogs: {sub.hot_dog_count}{sub.foil_hot_dog_count ? ` (${sub.foil_hot_dog_count} foil)` : ''}</h4>
												</div>

												{#if !sub.is_valid && sub.validation_violations?.length > 0}
													<div class="violations">
														<h4>Violations</h4>
														{#each sub.validation_violations as v}
															<p class="violation-msg">{v.message}</p>
														{/each}
													</div>
												{/if}

												<div class="sub-meta">
													<span>Submitted: {formatDateTime(sub.submitted_at)}</span>
													{#if sub.verification_code}
														<span>Verify: <code>{sub.verification_code}</code></span>
													{/if}
												</div>
											</div>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

	{:else if activeTab === 'results'}
		<div class="tab-panel">
			<h3>Enter Results</h3>
			<div class="results-table-wrapper">
				<table class="results-table">
					<thead>
						<tr>
							<th>Standing</th>
							<th>Player</th>
							<th>Label</th>
							<th>W</th>
							<th>L</th>
							<th>D</th>
						</tr>
					</thead>
					<tbody>
						{#each resultEntries as entry, i}
							<tr>
								<td>
									<input type="number" bind:value={entry.final_standing} min="1" class="result-input narrow" placeholder="#" />
								</td>
								<td>
									<input type="text" bind:value={entry.player_name} class="result-input" placeholder="Player name" />
								</td>
								<td>
									<select bind:value={entry.placement_label} class="result-input">
										<option value="">—</option>
										<option value="winner">Winner</option>
										<option value="finalist">Finalist</option>
										<option value="top_4">Top 4</option>
										<option value="top_8">Top 8</option>
										<option value="top_16">Top 16</option>
										<option value="other">Other</option>
									</select>
								</td>
								<td><input type="number" bind:value={entry.match_wins} min="0" class="result-input narrow" placeholder="W" /></td>
								<td><input type="number" bind:value={entry.match_losses} min="0" class="result-input narrow" placeholder="L" /></td>
								<td><input type="number" bind:value={entry.match_draws} min="0" class="result-input narrow" placeholder="D" /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="results-actions">
				<button class="action-btn" onclick={addManualResultEntry}>+ Add Manual Entry</button>
				<button class="primary-btn" onclick={saveResults} disabled={savingResults}>
					{savingResults ? 'Saving...' : 'Save Results'}
				</button>
			</div>
		</div>

	{:else if activeTab === 'share'}
		<div class="tab-panel share-panel">
			<div class="share-code">{tournament.code}</div>
			<p class="share-url">{shareUrl}</p>
			<button class="action-btn" onclick={() => copyToClipboard(shareUrl)}>Copy Link</button>
			<div class="share-text-section">
				<h3>Share Text</h3>
				<p class="share-text">{shareText}</p>
				<button class="action-btn" onclick={() => copyToClipboard(shareText)}>Copy Text</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.dashboard {
		max-width: 800px;
		margin: 0 auto;
		padding: 1rem;
	}
	.dash-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.back-link {
		color: var(--accent-primary);
		text-decoration: none;
		font-size: 0.85rem;
	}
	.dash-header h1 {
		font-size: 1.3rem;
		font-weight: 700;
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.code-badge {
		font-family: monospace;
		font-size: 0.85rem;
		padding: 2px 10px;
		border-radius: 6px;
		background: var(--bg-elevated);
		color: var(--accent-primary);
		letter-spacing: 0.05em;
		flex-shrink: 0;
	}

	/* Tabs */
	.tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 1rem;
		overflow-x: auto;
	}
	.tabs button {
		padding: 0.5rem 1rem;
		border: none;
		background: var(--bg-elevated);
		color: var(--text-secondary);
		border-radius: 8px 8px 0 0;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.tabs button.active {
		background: var(--accent-primary);
		color: #fff;
	}

	.tab-panel {
		background: var(--bg-elevated);
		border-radius: 0 12px 12px 12px;
		padding: 1.25rem;
	}

	/* Stats */
	.stats-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.stat-card {
		text-align: center;
		padding: 0.75rem;
		background: var(--bg-base);
		border-radius: 8px;
	}
	.stat-value {
		display: block;
		font-size: 1.5rem;
		font-weight: 700;
	}
	.stat-value.valid { color: #16a34a; }
	.stat-value.invalid { color: #ef4444; }
	.stat-value.open { color: #16a34a; }
	.stat-value.closed { color: #ef4444; }
	.stat-label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	/* Details */
	.detail-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.detail-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.detail-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.description p {
		font-size: 0.9rem;
		color: var(--text-secondary);
		margin-top: 4px;
	}

	/* Submissions */
	.sub-actions {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}
	.action-btn {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.action-btn.danger {
		border-color: #ef444440;
		color: #ef4444;
	}
	.action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.empty {
		text-align: center;
		color: var(--text-tertiary);
		padding: 2rem;
	}

	.sub-table-wrapper { overflow-x: auto; }
	.sub-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}
	.sub-table th {
		text-align: left;
		padding: 0.5rem 0.375rem;
		border-bottom: 1px solid var(--border-color);
		color: var(--text-secondary);
		font-weight: 600;
		white-space: nowrap;
	}
	.sub-table td {
		padding: 0.5rem 0.375rem;
		border-bottom: 1px solid var(--border-color);
		vertical-align: middle;
	}
	.player-cell {
		display: flex;
		flex-direction: column;
	}
	.player-name { font-weight: 600; }
	.player-email { font-size: 0.75rem; color: var(--text-tertiary); }
	.valid-badge {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		background: #16a34a20;
		color: #16a34a;
	}
	.invalid-badge {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		background: #ef444420;
		color: #ef4444;
	}
	.status-badge {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		background: var(--bg-hover);
		color: var(--text-secondary);
		text-transform: capitalize;
	}
	.status-badge.locked { background: #f59e0b20; color: #f59e0b; }
	.expand-btn {
		padding: 2px 8px;
		border: 1px solid var(--border-color);
		border-radius: 4px;
		background: transparent;
		color: var(--accent-primary);
		font-size: 0.75rem;
		cursor: pointer;
	}

	/* Expanded deck view */
	.expanded-row td { padding: 0; }
	.expanded-content {
		padding: 1rem;
		background: var(--bg-base);
		border-radius: 0 0 8px 8px;
	}
	.deck-section { margin-bottom: 0.75rem; }
	.deck-section h4 {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-secondary);
		margin-bottom: 0.375rem;
	}
	.card-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 300px;
		overflow-y: auto;
	}
	.card-row {
		display: flex;
		gap: 0.5rem;
		font-size: 0.8rem;
		padding: 2px 0;
	}
	.card-num {
		color: var(--text-tertiary);
		min-width: 60px;
		font-family: monospace;
		font-size: 0.75rem;
	}
	.card-name { flex: 1; }
	.card-power {
		color: var(--accent-gold, #f59e0b);
		font-weight: 600;
		font-size: 0.75rem;
	}
	.card-weapon {
		color: var(--text-tertiary);
		font-size: 0.75rem;
		text-transform: capitalize;
	}
	.card-dbs {
		color: var(--accent-primary);
		font-weight: 600;
		font-size: 0.75rem;
	}
	.violations { margin-top: 0.5rem; }
	.violations h4 { color: #ef4444; }
	.violation-msg {
		font-size: 0.8rem;
		color: #ef4444;
		padding: 2px 0;
	}
	.sub-meta {
		display: flex;
		gap: 1rem;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 0.5rem;
	}
	.sub-meta code {
		font-size: 0.7rem;
		background: var(--bg-elevated);
		padding: 1px 4px;
		border-radius: 3px;
	}

	/* Results */
	h3 {
		font-size: 1rem;
		font-weight: 700;
		margin-bottom: 0.75rem;
	}
	.results-table-wrapper { overflow-x: auto; }
	.results-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}
	.results-table th {
		text-align: left;
		padding: 0.5rem 0.25rem;
		border-bottom: 1px solid var(--border-color);
		color: var(--text-secondary);
		font-weight: 600;
	}
	.results-table td { padding: 0.375rem 0.25rem; }
	.result-input {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.82rem;
	}
	.result-input.narrow { width: 50px; }
	.results-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 1rem;
		align-items: center;
	}
	.primary-btn {
		padding: 0.6rem 1.5rem;
		border-radius: 10px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }

	/* Share */
	.share-panel { text-align: center; }
	.share-code {
		font-family: monospace;
		font-size: 2.5rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--accent-primary);
		margin-bottom: 0.5rem;
	}
	.share-url {
		font-size: 0.85rem;
		color: var(--text-secondary);
		word-break: break-all;
		margin-bottom: 1rem;
	}
	.share-text-section {
		margin-top: 1.5rem;
		text-align: left;
	}
	.share-text {
		font-size: 0.85rem;
		color: var(--text-secondary);
		background: var(--bg-base);
		border-radius: 8px;
		padding: 0.75rem;
		margin-bottom: 0.75rem;
	}
</style>
