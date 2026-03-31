<script lang="ts">
	import { onMount } from 'svelte';
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	interface Tournament {
		id: string;
		code: string;
		name: string;
		max_heroes: number;
		max_plays: number;
		max_bonus: number;
		usage_count: number;
		is_active: boolean;
		require_email: boolean;
		require_name: boolean;
		require_discord: boolean;
		created_at: string;
		creator_id: string;
	}

	let tournaments = $state<Tournament[]>([]);
	let loading = $state(true);
	let publicUserId = $state<string | null>(null);

	// Tournament code entry
	let entryCode = $state('');
	let entryLoading = $state(false);
	let entryError = $state<string | null>(null);

	async function resolvePublicUserId(): Promise<string | null> {
		if (publicUserId) return publicUserId;
		const currentUser = $page.data.user;
		const sb = getSupabase();
		if (!currentUser || !sb) return null;

		const { data } = await sb
			.from('users')
			.select('id')
			.eq('auth_user_id', currentUser.id)
			.maybeSingle();

		if (data?.id) {
			publicUserId = data.id;
		}
		return publicUserId;
	}

	async function loadTournaments() {
		loading = true;
		try {
			const sb = getSupabase();
			if (!sb) {
				tournaments = [];
				loading = false;
				return;
			}

			const pubId = await resolvePublicUserId();

			// creator_id references public.users(id), not auth.users(id)
			const query = pubId
				? sb.from('tournaments').select('*').or(`creator_id.eq.${pubId},is_active.eq.true`)
				: sb.from('tournaments').select('*').eq('is_active', true);

			const { data, error } = await query.order('created_at', { ascending: false });

			if (error) throw error;
			tournaments = (data || []) as Tournament[];
		} catch (err) {
			console.error('Failed to load tournaments:', err);
			showToast('Failed to load tournaments', 'x');
		}
		loading = false;
	}

	async function toggleActive(tournament: Tournament) {
		try {
			const sb = getSupabase();
			if (!sb) return;
			const { error } = await sb
				.from('tournaments')
				.update({ is_active: !tournament.is_active })
				.eq('id', tournament.id);
			if (error) throw error;
			tournament.is_active = !tournament.is_active;
			tournaments = [...tournaments];
		} catch (err) {
			console.error('Failed to toggle tournament active state:', err);
			showToast('Failed to update', 'x');
		}
	}

	async function copyCode(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			showToast('Code copied', 'check');
		} catch (err) {
			console.debug('[tournaments] Clipboard copy failed:', err);
			showToast('Copy failed', 'x');
		}
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	async function enterTournament() {
		const code = entryCode.trim().toUpperCase();
		if (code.length !== 8) {
			entryError = 'Code must be 8 characters';
			return;
		}
		entryLoading = true;
		entryError = null;
		try {
			const res = await fetch(`/api/tournament/${encodeURIComponent(code)}`);
			if (!res.ok) {
				entryError = res.status === 404 ? 'Tournament not found' : 'Failed to look up tournament';
				return;
			}
			goto(`/tournaments/enter?code=${code}`);
		} catch (err) {
			console.debug('[tournaments] Tournament entry lookup failed:', err);
			entryError = 'Network error';
		} finally {
			entryLoading = false;
		}
	}

	const myTournaments = $derived(
		tournaments.filter((t) => publicUserId && t.creator_id === publicUserId)
	);

	const otherTournaments = $derived(
		tournaments.filter((t) => !publicUserId || t.creator_id !== publicUserId)
	);

	onMount(() => {
		loadTournaments();
	});
</script>

<svelte:head>
	<title>Tournaments - BOBA Scanner</title>
</svelte:head>

<div class="tournaments-page">
	<header class="page-header">
		<h1>Tournaments</h1>
		<a href="/organize" class="create-btn">+ Create</a>
	</header>

	<!-- Enter tournament by code -->
	<div class="enter-section">
		<h2>Enter a Tournament</h2>
		<form class="enter-form" onsubmit={(e) => { e.preventDefault(); enterTournament(); }}>
			<input
				type="text"
				class="code-entry-input"
				bind:value={entryCode}
				placeholder="ABCD1234"
				maxlength="8"
				autocapitalize="characters"
				spellcheck="false"
			/>
			<button type="submit" class="enter-btn" disabled={entryLoading || entryCode.trim().length !== 8}>
				{entryLoading ? 'Looking up...' : 'Enter'}
			</button>
		</form>
		{#if entryError}
			<p class="entry-error">{entryError}</p>
		{/if}
	</div>

	{#if loading}
		<div class="loading">Loading tournaments...</div>
	{:else}
		{#if myTournaments.length > 0}
			<h2 class="section-title">My Tournaments</h2>
			<div class="tournament-list">
				{#each myTournaments as t}
					<div class="tournament-card" class:inactive={!t.is_active}>
						<div class="tournament-header">
							<div>
								<div class="tournament-name">{t.name}</div>
								<button class="tournament-code" onclick={() => copyCode(t.code)}>
									{t.code}
								</button>
							</div>
							<span class="status-badge" class:active={t.is_active}>
								{t.is_active ? 'Active' : 'Inactive'}
							</span>
						</div>

						<div class="tournament-meta">
							<span>Heroes: {t.max_heroes}</span>
							<span>Plays: {t.max_plays}</span>
							<span>Bonus: {t.max_bonus}</span>
						</div>

						<div class="requirement-tags">
							{#if t.require_name}<span class="req-tag">Name required</span>{/if}
							{#if t.require_discord}<span class="req-tag">Discord required</span>{/if}
						</div>

						<div class="tournament-footer">
							<span class="usage">{t.usage_count} entries · {formatDate(t.created_at)}</span>
							<div class="footer-actions">
								<a href="/tournaments/detail?id={t.id}" class="view-btn">View Entries</a>
								<button class="toggle-btn" onclick={() => toggleActive(t)}>
									{t.is_active ? 'Deactivate' : 'Activate'}
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if otherTournaments.length > 0}
			<h2 class="section-title">Active Tournaments</h2>
			<div class="tournament-list">
				{#each otherTournaments as t}
					<div class="tournament-card" class:inactive={!t.is_active}>
						<div class="tournament-header">
							<div>
								<div class="tournament-name">{t.name}</div>
								<button class="tournament-code" onclick={() => copyCode(t.code)}>
									{t.code}
								</button>
							</div>
							<span class="status-badge" class:active={t.is_active}>
								{t.is_active ? 'Active' : 'Inactive'}
							</span>
						</div>

						<div class="tournament-meta">
							<span>Heroes: {t.max_heroes}</span>
							<span>Plays: {t.max_plays}</span>
							<span>Bonus: {t.max_bonus}</span>
						</div>

						<div class="tournament-footer">
							<span class="usage">{t.usage_count} entries · {formatDate(t.created_at)}</span>
							<a href="/tournaments/enter?code={t.code}" class="enter-link">Enter</a>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if tournaments.length === 0}
			<div class="empty">
				<p>No tournaments yet.</p>
			</div>
		{/if}
	{/if}
</div>

<style>
	.tournaments-page {
		max-width: 600px;
		margin: 0 auto;
		padding: 1rem;
	}
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}
	h1 { font-size: 1.5rem; font-weight: 700; }
	.create-btn {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-primary);
		font-size: 0.85rem;
		cursor: pointer;
		text-decoration: none;
	}

	/* Enter section */
	.enter-section {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 1.5rem;
	}
	.enter-section h2 {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}
	.enter-form {
		display: flex;
		gap: 0.5rem;
	}
	.code-entry-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-family: monospace;
		font-size: 1rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		text-align: center;
	}
	.enter-btn {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.enter-btn:disabled { opacity: 0.5; }
	.entry-error {
		color: #ef4444;
		font-size: 0.8rem;
		margin-top: 0.5rem;
	}

	/* Tournament list */
	.section-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
		margin-top: 1rem;
	}
	.loading, .empty {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}
	.tournament-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.tournament-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
	}
	.tournament-card.inactive { opacity: 0.6; }
	.tournament-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 0.5rem;
	}
	.tournament-name { font-weight: 600; font-size: 1rem; }
	.tournament-code {
		background: var(--bg-base);
		border: none;
		border-radius: 4px;
		padding: 2px 8px;
		font-family: monospace;
		font-size: 0.85rem;
		color: var(--accent-primary);
		cursor: pointer;
		letter-spacing: 0.05em;
		margin-top: 4px;
	}
	.tournament-code:hover { background: var(--bg-hover); }
	.status-badge {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 4px;
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
	.status-badge.active {
		background: #22c55e20;
		color: #22c55e;
	}
	.tournament-meta {
		display: flex;
		gap: 1rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}
	.requirement-tags {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.req-tag {
		font-size: 0.7rem;
		padding: 2px 6px;
		border-radius: 4px;
		background: rgba(59, 130, 246, 0.1);
		color: var(--accent-primary);
	}
	.tournament-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.usage {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}
	.footer-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.view-btn {
		font-size: 0.75rem;
		color: var(--accent-primary);
		text-decoration: none;
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--accent-primary);
	}
	.view-btn:hover { background: rgba(59, 130, 246, 0.1); }
	.enter-link {
		font-size: 0.8rem;
		color: var(--accent-primary);
		text-decoration: none;
		font-weight: 600;
	}
	.toggle-btn {
		background: none;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 0.25rem 0.625rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.toggle-btn:hover { background: var(--bg-hover); }
</style>
