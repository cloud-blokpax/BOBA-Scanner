<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast.svelte';

	interface DeckSubmission {
		id: string;
		player_name: string;
		player_email: string;
		player_discord: string | null;
		status: string;
		is_valid: boolean;
		hero_count: number;
		hero_cards: Array<Record<string, unknown>>;
		play_entries: Array<Record<string, unknown>>;
		hot_dog_count: number;
		foil_hot_dog_count: number;
		dbs_total: number | null;
		avg_power: number | null;
		total_power: number;
		validation_violations: Array<{ rule: string; message: string }>;
		validation_warnings: string[];
		submitted_at: string;
		verification_code: string | null;
	}

	interface LegacyRegistration {
		id: string;
		email: string;
		name: string | null;
		discord_id: string | null;
		deck_csv: string | null;
		created_at: string;
	}

	interface TournamentDetail {
		id: string;
		code: string;
		name: string;
		max_heroes: number;
		max_plays: number;
		max_bonus: number;
		require_email: boolean;
		require_name: boolean;
		require_discord: boolean;
		is_active: boolean;
		usage_count: number;
		created_at: string;
		creator_id: string;
	}

	let tournament = $state<TournamentDetail | null>(null);
	let submissions = $state<DeckSubmission[]>([]);
	let legacyRegistrations = $state<LegacyRegistration[]>([]);
	let useLegacyView = $state(false);
	let loading = $state(true);
	let errorMsg = $state<string | null>(null);
	let expandedSubmission = $state<string | null>(null);

	function getPlayCounts(sub: DeckSubmission) {
		const plays = (sub.play_entries || []);
		const standard = plays.filter(p => !String(p.card_number || '').startsWith('BPL-')).length;
		const bonus = plays.filter(p => String(p.card_number || '').startsWith('BPL-')).length;
		return { standard, bonus };
	}

	onMount(async () => {
		const id = $page.url.searchParams.get('id');
		if (!id) {
			errorMsg = 'No tournament ID provided';
			loading = false;
			return;
		}

		const currentUser = $page.data.user;
		if (!currentUser) {
			errorMsg = 'Sign in required';
			loading = false;
			return;
		}

		const client = getSupabase();
		if (!client) {
			errorMsg = 'Database not configured';
			loading = false;
			return;
		}

		try {
			// Resolve public user ID (creator_id references users.id, not auth.users.id)
			const { data: profile } = await client
				.from('users')
				.select('id, is_admin, is_organizer')
				.eq('auth_user_id', currentUser.id)
				.maybeSingle();

			const publicUserId = profile?.id;
			const isAdmin = profile?.is_admin === true || (currentUser as unknown as Record<string, unknown>).is_admin === true;

			// Load tournament
			const { data: tData, error: tError } = await client
				.from('tournaments')
				.select('id, code, name, max_heroes, max_plays, max_bonus, require_email, require_name, require_discord, is_active, usage_count, created_at, creator_id')
				.eq('id', id)
				.maybeSingle();

			if (tError || !tData) {
				errorMsg = 'Tournament not found';
				loading = false;
				return;
			}

			// Verify ownership OR admin access
			if ((tData as TournamentDetail).creator_id !== publicUserId && !isAdmin) {
				errorMsg = 'You can only view tournaments you created';
				loading = false;
				return;
			}

			tournament = tData as TournamentDetail;

			// Load deck submissions (modern flow)
			const { data: subData, error: subError } = await client
				.from('deck_submissions')
				.select('id, player_name, player_email, player_discord, status, is_valid, hero_count, hero_cards, play_entries, hot_dog_count, foil_hot_dog_count, dbs_total, avg_power, total_power, validation_violations, validation_warnings, submitted_at, verification_code')
				.eq('tournament_id', id)
				.order('submitted_at', { ascending: true });

			if (subError) throw subError;
			submissions = (subData || []) as DeckSubmission[];

			// Fallback: check legacy registrations for old tournaments
			if (submissions.length === 0) {
				const { data: regData } = await client
					.from('tournament_registrations')
					.select('id, email, name, discord_id, deck_csv, created_at')
					.eq('tournament_id', id)
					.order('created_at', { ascending: true });

				if (regData && regData.length > 0) {
					legacyRegistrations = regData as LegacyRegistration[];
					useLegacyView = true;
				}
			}
		} catch (err) {
			console.debug('[tournament-detail] Tournament data load failed:', err);
			errorMsg = 'Failed to load tournament data';
		}
		loading = false;
	});

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function downloadDeckCsv(reg: LegacyRegistration) {
		if (!reg.deck_csv) {
			showToast('No deck data available', 'x');
			return;
		}
		const blob = new Blob([reg.deck_csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `deck-${(reg.name || reg.email).replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function exportCsv() {
		if (submissions.length === 0) {
			showToast('No submissions to export', 'x');
			return;
		}
		const headers = ['player_name', 'player_email', 'player_discord', 'is_valid', 'status', 'hero_count', 'dbs_total', 'avg_power', 'submitted_at'];
		const rows = submissions.map((s) => [
			`"${s.player_name}"`,
			`"${s.player_email}"`,
			`"${s.player_discord || ''}"`,
			s.is_valid,
			s.status,
			s.hero_count,
			s.dbs_total ?? '',
			s.avg_power != null ? Math.round(s.avg_power) : '',
			s.submitted_at
		].join(','));
		const csv = [headers.join(','), ...rows].join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${tournament?.code || 'tournament'}-submissions.csv`;
		a.click();
		URL.revokeObjectURL(url);
		showToast('CSV exported', 'check');
	}

	async function copyCode(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			showToast('Code copied', 'check');
		} catch (err) {
			console.debug('[tournament-detail] Clipboard copy failed:', err);
			showToast('Copy failed', 'x');
		}
	}
</script>

<svelte:head>
	<title>{tournament ? tournament.name : 'Tournament Detail'} - Card Scanner</title>
</svelte:head>

<div class="detail-page">
	{#if loading}
		<div class="loading">Loading...</div>
	{:else if errorMsg}
		<div class="error-state">
			<p>{errorMsg}</p>
			<a href="/tournaments" class="back-link">Back to Tournaments</a>
		</div>
	{:else if tournament}
		<header class="page-header">
			<div>
				<h1>{tournament.name}</h1>
				<button class="code-badge" onclick={() => copyCode(tournament!.code)}>
					{tournament.code}
				</button>
			</div>
			<a href="/tournaments" class="back-btn">Back</a>
		</header>

		<div class="tournament-info">
			<div class="info-row">
				<span>Heroes: {tournament.max_heroes}</span>
				<span>Plays: {tournament.max_plays}</span>
				<span>Bonus: {tournament.max_bonus}</span>
			</div>
			<div class="info-row">
				<span>Status: {tournament.is_active ? 'Active' : 'Inactive'}</span>
				<span>Created: {formatDate(tournament.created_at)}</span>
			</div>
			<div class="info-row requirements">
				<span>Email: required</span>
				<span>Name: {tournament.require_name ? 'required' : 'optional'}</span>
				<span>Discord: {tournament.require_discord ? 'required' : 'optional'}</span>
			</div>
		</div>

		<div class="section-header">
			<h2 class="section-title">{useLegacyView ? 'Registrations' : 'Submissions'} ({useLegacyView ? legacyRegistrations.length : submissions.length})</h2>
			{#if submissions.length > 0}
				<button class="export-btn" onclick={exportCsv}>Export CSV</button>
			{/if}
		</div>

		{#if submissions.length === 0 && legacyRegistrations.length === 0}
			<div class="empty">
				<p>No one has registered yet. Share the code <strong>{tournament.code}</strong> to get started.</p>
			</div>
		{:else if useLegacyView}
			<div class="registrations-list">
				{#each legacyRegistrations as reg, i}
					<div class="registration-card">
						<div class="reg-header">
							<span class="reg-number">#{i + 1}</span>
							<span class="reg-date">{formatDate(reg.created_at)}</span>
						</div>
						<div class="reg-details">
							<div class="reg-field">
								<span class="reg-label">Email</span>
								<span class="reg-value">{reg.email}</span>
							</div>
							{#if reg.name}
								<div class="reg-field">
									<span class="reg-label">Name</span>
									<span class="reg-value">{reg.name}</span>
								</div>
							{/if}
							{#if reg.discord_id}
								<div class="reg-field">
									<span class="reg-label">Discord</span>
									<span class="reg-value">{reg.discord_id}</span>
								</div>
							{/if}
						</div>
						<div class="reg-footer">
							{#if reg.deck_csv}
								<button class="deck-download-btn" onclick={() => downloadDeckCsv(reg)}>
									Download Deck CSV
								</button>
							{:else}
								<span class="no-deck">No deck submitted</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="registrations-list">
				{#each submissions as sub, i}
					{@const counts = getPlayCounts(sub)}
					<div class="registration-card" class:expandable={true}>
						<button class="card-toggle" onclick={() => expandedSubmission = expandedSubmission === sub.id ? null : sub.id}>
							<div class="reg-header">
								<span class="reg-number">#{i + 1}</span>
								<div class="reg-badges">
									{#if sub.is_valid}
										<span class="valid-badge">Valid</span>
									{:else}
										<span class="invalid-badge">Invalid</span>
									{/if}
									<span class="status-badge {sub.status}">{sub.status}</span>
								</div>
								<span class="reg-date">{formatDate(sub.submitted_at)}</span>
							</div>
							<div class="reg-details">
								<div class="reg-field">
									<span class="reg-label">Name</span>
									<span class="reg-value">{sub.player_name}</span>
								</div>
								<div class="reg-field">
									<span class="reg-label">Email</span>
									<span class="reg-value">{sub.player_email}</span>
								</div>
								{#if sub.player_discord}
									<div class="reg-field">
										<span class="reg-label">Discord</span>
										<span class="reg-value">{sub.player_discord}</span>
									</div>
								{/if}
							</div>
							<div class="reg-stats">
								<span>Heroes: {sub.hero_count}</span>
								<span>Plays: {counts.standard}</span>
								{#if counts.bonus > 0}
									<span>Bonus: {counts.bonus}</span>
								{/if}
								<span>DBS: {sub.dbs_total ?? '—'}</span>
								<span>Avg PWR: {sub.avg_power != null ? Math.round(sub.avg_power) : '—'}</span>
							</div>
							{#if !sub.is_valid && sub.validation_violations.length > 0}
								<div class="violations">
									{#each sub.validation_violations as v}
										<span class="violation">{v.message}</span>
									{/each}
								</div>
							{/if}
						</button>

						{#if expandedSubmission === sub.id}
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
									{@const standardPlays = sub.play_entries.filter(p => !String(p.card_number || '').startsWith('BPL-'))}
									{@const bonusPlays = sub.play_entries.filter(p => String(p.card_number || '').startsWith('BPL-'))}
									{#if standardPlays.length > 0}
										<div class="deck-section">
											<h4>Plays ({standardPlays.length})</h4>
											<div class="card-list">
												{#each standardPlays as play}
													<div class="card-row">
														<span class="card-num">{play.card_number}</span>
														<span class="card-name">{play.name}</span>
														<span class="card-dbs">DBS {play.dbs_score ?? '—'}</span>
													</div>
												{/each}
											</div>
										</div>
									{/if}
									{#if bonusPlays.length > 0}
										<div class="deck-section">
											<h4>Bonus Plays ({bonusPlays.length})</h4>
											<div class="card-list">
												{#each bonusPlays as play}
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
									<h4>Hot Dogs: {sub.hot_dog_count ?? 0}{sub.foil_hot_dog_count ? ` (${sub.foil_hot_dog_count} foil)` : ''}</h4>
								</div>

								{#if sub.verification_code}
									<div class="sub-meta">
										<span>Verify: <code>{sub.verification_code}</code></span>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.detail-page {
		max-width: 700px;
		margin: 0 auto;
		padding: 1rem;
	}
	.loading, .error-state {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}
	.back-link {
		display: inline-block;
		margin-top: 1rem;
		color: var(--accent-primary);
		text-decoration: none;
	}
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
	}
	.page-header h1 {
		font-size: 1.4rem;
		font-weight: 700;
	}
	.code-badge {
		font-family: monospace;
		font-size: 0.85rem;
		padding: 2px 8px;
		border-radius: 4px;
		background: var(--bg-base);
		color: var(--accent-primary);
		letter-spacing: 0.05em;
		border: none;
		cursor: pointer;
		margin-top: 4px;
	}
	.code-badge:hover { background: var(--bg-hover); }
	.back-btn {
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		font-size: 0.85rem;
		color: var(--text-secondary);
		text-decoration: none;
	}
	.back-btn:hover { background: var(--bg-hover); }

	/* Info */
	.tournament-info {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 1.5rem;
	}
	.info-row {
		display: flex;
		gap: 1rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-bottom: 0.375rem;
	}
	.info-row:last-child { margin-bottom: 0; }
	.requirements {
		margin-top: 0.25rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-color);
	}

	/* Section */
	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}
	.section-title {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 0;
	}
	.export-btn {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--accent-primary);
		background: transparent;
		color: var(--accent-primary);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	.export-btn:hover {
		background: rgba(59, 130, 246, 0.1);
	}
	.empty {
		text-align: center;
		padding: 2rem;
		color: var(--text-tertiary);
		background: var(--bg-elevated);
		border-radius: 12px;
		font-size: 0.9rem;
	}

	/* Registration cards */
	.registrations-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.registration-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
		border: 1px solid transparent;
	}
	.reg-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.reg-number {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-tertiary);
	}
	.reg-date {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}
	.reg-details {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}
	.reg-field {
		display: flex;
		gap: 0.5rem;
		font-size: 0.85rem;
	}
	.reg-label {
		font-weight: 600;
		color: var(--text-secondary);
		min-width: 4.5rem;
	}
	.reg-value {
		color: var(--text-primary);
		word-break: break-all;
	}
	.reg-footer {
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-color);
	}
	.deck-download-btn {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--accent-primary);
		background: transparent;
		color: var(--accent-primary);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.deck-download-btn:hover {
		background: rgba(59, 130, 246, 0.1);
	}
	.no-deck {
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}

	/* Submission badges */
	.reg-badges {
		display: flex;
		gap: 0.375rem;
		align-items: center;
	}
	.valid-badge {
		font-size: 0.7rem;
		padding: 1px 6px;
		border-radius: 4px;
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
		font-weight: 600;
	}
	.invalid-badge {
		font-size: 0.7rem;
		padding: 1px 6px;
		border-radius: 4px;
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
		font-weight: 600;
	}
	.status-badge {
		font-size: 0.7rem;
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--bg-base);
		color: var(--text-secondary);
		text-transform: capitalize;
	}
	.status-badge.locked {
		background: rgba(59, 130, 246, 0.15);
		color: #3b82f6;
	}
	.reg-stats {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		font-size: 0.8rem;
		color: var(--text-secondary);
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-color);
	}
	.violations {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-top: 0.5rem;
	}
	.violation {
		font-size: 0.75rem;
		color: #ef4444;
		text-align: left;
	}

	/* Expandable card */
	.card-toggle {
		display: block;
		width: 100%;
		background: none;
		border: none;
		padding: 0;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.expandable {
		transition: border-color 0.15s;
	}
	.expandable:hover {
		border-color: var(--accent-primary);
	}

	/* Expanded deck view */
	.expanded-content {
		padding-top: 0.75rem;
		margin-top: 0.75rem;
		border-top: 1px solid var(--border-color);
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
	.sub-meta {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 0.5rem;
	}
	.sub-meta code {
		font-size: 0.7rem;
		background: var(--bg-base);
		padding: 1px 4px;
		border-radius: 3px;
	}
</style>
