<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast';

	interface Registration {
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
	let registrations = $state<Registration[]>([]);
	let loading = $state(true);
	let errorMsg = $state<string | null>(null);

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

			// Verify ownership
			if ((tData as TournamentDetail).creator_id !== currentUser.id) {
				errorMsg = 'You can only view tournaments you created';
				loading = false;
				return;
			}

			tournament = tData as TournamentDetail;

			// Load registrations
			const { data: regData, error: regError } = await client
				.from('tournament_registrations')
				.select('id, email, name, discord_id, deck_csv, created_at')
				.eq('tournament_id', id)
				.order('created_at', { ascending: true });

			if (regError) throw regError;
			registrations = (regData || []) as Registration[];
		} catch {
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

	function downloadDeckCsv(reg: Registration) {
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

	async function copyCode(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			showToast('Code copied', 'check');
		} catch {
			showToast('Copy failed', 'x');
		}
	}
</script>

<svelte:head>
	<title>{tournament ? tournament.name : 'Tournament Detail'} - BOBA Scanner</title>
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

		<h2 class="section-title">Registrations ({registrations.length})</h2>

		{#if registrations.length === 0}
			<div class="empty">
				<p>No one has registered yet. Share the code <strong>{tournament.code}</strong> to get started.</p>
			</div>
		{:else}
			<div class="registrations-list">
				{#each registrations as reg, i}
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
	.section-title {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 0.75rem;
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
</style>
