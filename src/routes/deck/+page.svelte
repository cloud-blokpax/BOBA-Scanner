<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { fetchUserDecks, deleteDeck, computeDeckStats, createDeck, updateDeckContents, getFormatDefaults, type UserDeck } from '$lib/services/deck-service';
	import { getFormatOptions } from '$lib/data/tournament-formats';
	import { showToast } from '$lib/stores/toast.svelte';

	const formatOptions = getFormatOptions();
	const isAuthenticated = $derived(!!$page.data.user);

	let decks = $state<UserDeck[]>([]);
	let loading = $state(true);
	let activeFilter = $state('all');
	let deleteConfirmId = $state<string | null>(null);
	let menuOpenId = $state<string | null>(null);

	// Tab state
	let activeTab = $state<'decks' | 'tournament'>('decks');

	// Tournament lookup state
	let tournamentCode = $state('');
	let tournamentLoading = $state(false);
	let tournamentResult = $state<{
		code: string;
		name: string;
		max_heroes: number;
		max_plays: number;
		max_bonus: number;
	} | null>(null);
	let tournamentError = $state<string | null>(null);

	// Legacy import state
	let showLegacyImportPrompt = $state(false);
	let legacyDeck = $state<Record<string, unknown> | null>(null);

	async function loadDecks() {
		if (!isAuthenticated) {
			loading = false;
			return;
		}
		loading = true;
		decks = await fetchUserDecks(activeFilter);
		loading = false;
	}

	function setFilter(filter: string) {
		activeFilter = filter;
		loadDecks();
	}

	async function handleDelete(deckId: string) {
		const ok = await deleteDeck(deckId);
		if (ok) {
			decks = decks.filter(d => d.id !== deckId);
			showToast('Deck deleted', 'check');
		}
		deleteConfirmId = null;
	}

	async function importLegacyDeck() {
		if (!legacyDeck) return;
		const formatId = (legacyDeck.formatId as string) || 'spec_playmaker';
		const defaults = getFormatDefaults(formatId);
		const deckId = await createDeck({
			...defaults,
			name: (legacyDeck.name as string) || 'Imported Deck',
		});

		if (deckId) {
			await updateDeckContents(deckId, {
				hero_card_ids: (legacyDeck.heroCardIds as string[]) || [],
				play_entries: (legacyDeck.playEntries as Array<{ cardNumber: string; setCode: string; name: string; dbs: number }>) || [],
				hot_dog_count: (legacyDeck.hotDogCount as number) ?? 10
			});
			localStorage.removeItem('boba-deck-draft');
			showLegacyImportPrompt = false;
			await loadDecks();
			showToast('Deck imported successfully!', 'check');
		}
	}

	function formatDate(dateStr: string): string {
		const d = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24) return `${diffHours}h ago`;
		const diffDays = Math.floor(diffHours / 24);
		if (diffDays < 7) return `${diffDays}d ago`;
		return d.toLocaleDateString();
	}

	function formatName(formatId: string): string {
		const fmt = formatOptions.find(f => f.id === formatId);
		return fmt?.name || formatId;
	}

	async function lookupTournament() {
		const code = tournamentCode.trim().toUpperCase();
		if (code.length !== 8) {
			tournamentError = 'Code must be 8 characters';
			return;
		}
		tournamentLoading = true;
		tournamentError = null;
		tournamentResult = null;
		try {
			const res = await fetch(`/api/tournament/${encodeURIComponent(code)}`);
			if (!res.ok) {
				tournamentError = res.status === 404 ? 'Tournament not found' : 'Failed to look up tournament';
				return;
			}
			tournamentResult = await res.json();
		} catch {
			tournamentError = 'Network error';
		} finally {
			tournamentLoading = false;
		}
	}

	onMount(async () => {
		// Check URL tab param
		const tabParam = $page.url.searchParams.get('tab');
		if (tabParam === 'tournament') {
			activeTab = tabParam;
		}

		// Check for legacy localStorage deck
		try {
			const raw = localStorage.getItem('boba-deck-draft');
			if (raw) {
				const legacy = JSON.parse(raw);
				if (legacy.heroCardIds?.length > 0 || legacy.playEntries?.length > 0) {
					showLegacyImportPrompt = true;
					legacyDeck = legacy;
				}
			}
		} catch { /* ignore */ }

		await loadDecks();
	});
</script>

<svelte:head>
	<title>Decks | BOBA Scanner</title>
</svelte:head>

<div class="decks-page">
	<!-- Tab bar -->
	<div class="tab-bar">
		<button class="tab-btn" class:tab-active={activeTab === 'decks'} onclick={() => activeTab = 'decks'}>My Decks</button>
		<button class="tab-btn" class:tab-active={activeTab === 'tournament'} onclick={() => activeTab = 'tournament'}>Tournament</button>
	</div>

	{#if activeTab === 'decks'}
		<!-- My Decks Tab -->
		{#if !isAuthenticated}
			<div class="auth-prompt">
				<p>Sign in to save and manage decks.</p>
				<a href="/auth/login?redirectTo=/deck" class="btn-signin">Sign In</a>
			</div>
		{:else}
			<div class="page-header">
				<h1>My Decks</h1>
				<div class="header-actions">
					<a href="/deck/architect" class="btn-architect">Playbook Architect</a>
					<a href="/deck/new" class="btn-create">+ New Deck</a>
				</div>
			</div>

			{#if showLegacyImportPrompt}
				<div class="legacy-banner">
					<p>Found a deck from your previous session. Import it?</p>
					<div class="legacy-actions">
						<button class="btn-import" onclick={importLegacyDeck}>Import Deck</button>
						<button class="btn-dismiss" onclick={() => { localStorage.removeItem('boba-deck-draft'); showLegacyImportPrompt = false; }}>Dismiss</button>
					</div>
				</div>
			{/if}

			<!-- Format filter bar -->
			<div class="filter-bar">
				<button class="filter-btn" class:active={activeFilter === 'all'} onclick={() => setFilter('all')}>All</button>
				{#each formatOptions as fmt}
					<button class="filter-btn" class:active={activeFilter === fmt.id} onclick={() => setFilter(fmt.id)}>{fmt.name}</button>
				{/each}
			</div>

			{#if loading}
				<div class="loading-state">Loading decks...</div>
			{:else if decks.length === 0}
				<div class="empty-state">
					<div class="empty-icon">🃏</div>
					<p>No decks yet — create your first one!</p>
					<a href="/deck/new" class="btn-create">+ Create New Deck</a>
				</div>
			{:else}
				<div class="deck-grid">
					{#each decks as deck (deck.id)}
						{@const stats = computeDeckStats(deck)}
						<div class="deck-card">
							<button class="deck-card-body" type="button" onclick={() => goto(`/deck/${deck.id}`)}>
								<div class="deck-card-top">
									<h3 class="deck-card-name">{deck.name}</h3>
									<span class="format-badge">{formatName(deck.format_id)}</span>
								</div>
								<div class="deck-card-stats">
									<div class="mini-stat">
										<span class="mini-stat-value">{stats.heroCount}/{stats.heroTarget}</span>
										<span class="mini-stat-label">Heroes</span>
									</div>
									<div class="mini-stat">
										<span class="mini-stat-value">{stats.playCount}/{stats.playTarget}</span>
										<span class="mini-stat-label">Plays</span>
									</div>
									<div class="mini-stat">
										<span class="mini-stat-value">{stats.totalDbs}/{stats.dbsCap}</span>
										<span class="mini-stat-label">DBS</span>
									</div>
								</div>
								<div class="progress-track">
									<div
										class="progress-fill"
										style:width="{Math.round((stats.heroPercent + stats.playPercent) / 2)}%"
										style:background={stats.isComplete ? 'var(--color-success, #22C55E)' : stats.heroPercent >= 50 ? 'var(--color-warning, #F59E0B)' : 'var(--color-error, #EF4444)'}
									></div>
								</div>
								{#if deck.notes}
									<p class="deck-card-notes">{deck.notes.split('\n')[0]}</p>
								{/if}
								<div class="deck-card-footer">
									<span class="deck-card-date">{formatDate(deck.last_edited_at)}</span>
									{#if stats.isComplete}
										<span class="complete-badge">Complete</span>
									{/if}
								</div>
							</button>
							<div class="deck-card-menu">
								<button class="menu-trigger" onclick={(e) => { e.stopPropagation(); menuOpenId = menuOpenId === deck.id ? null : deck.id; }}>
									&#8942;
								</button>
								{#if menuOpenId === deck.id}
									<div class="menu-dropdown">
										<button class="menu-item" onclick={() => { menuOpenId = null; goto(`/deck/${deck.id}`); }}>Edit</button>
										<button class="menu-item" onclick={() => { menuOpenId = null; goto(`/deck/${deck.id}/view`); }}>View</button>
										<button class="menu-item menu-item-danger" onclick={() => { menuOpenId = null; deleteConfirmId = deck.id; }}>Delete</button>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}

	{:else if activeTab === 'tournament'}
		<!-- Tournament Tab -->
		<div class="tournament-tab-content">
			<h1>Tournament Entry</h1>
			<p class="subtitle">Enter a tournament code to see format rules and register.</p>

			<form class="tournament-form" onsubmit={(e) => { e.preventDefault(); lookupTournament(); }}>
				<input
					type="text"
					class="tournament-input"
					bind:value={tournamentCode}
					placeholder="ABCD1234"
					maxlength="8"
					autocapitalize="characters"
					spellcheck="false"
				/>
				<button type="submit" class="btn-create" disabled={tournamentLoading || tournamentCode.trim().length !== 8}>
					{tournamentLoading ? 'Looking up...' : 'Look Up'}
				</button>
			</form>

			{#if tournamentError}
				<p class="tournament-error">{tournamentError}</p>
			{/if}

			{#if tournamentResult}
				<div class="tournament-result">
					<div class="tournament-name">{tournamentResult.name}</div>
					<div class="tournament-code">{tournamentResult.code}</div>
					<div class="tournament-params">
						<span>Heroes: {tournamentResult.max_heroes}</span>
						<span>Plays: {tournamentResult.max_plays}</span>
						<span>Bonus: {tournamentResult.max_bonus}</span>
					</div>
					{#if isAuthenticated}
						<a href="/tournaments/enter?code={tournamentResult.code}" class="btn-create" style="display:inline-block;text-decoration:none;">Enter Tournament</a>
					{:else}
						<a href="/auth/login?redirectTo=/tournaments/enter?code={tournamentResult.code}" class="btn-create" style="display:inline-block;text-decoration:none;">Sign in to Enter</a>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Delete confirmation modal -->
	{#if deleteConfirmId}
		<div class="modal-overlay" role="presentation" onkeydown={(e) => e.key === 'Escape' && (deleteConfirmId = null)}>
			<button class="modal-overlay-dismiss" type="button" aria-label="Close" tabindex="-1" onclick={() => deleteConfirmId = null}></button>
			<div class="modal-content">
				<h3>Delete Deck?</h3>
				<p>This action cannot be undone.</p>
				<div class="modal-actions">
					<button class="btn-cancel" onclick={() => deleteConfirmId = null}>Cancel</button>
					<button class="btn-delete" onclick={() => deleteConfirmId && handleDelete(deleteConfirmId)}>Delete</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.decks-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 1rem;
	}

	/* Tab bar */
	.tab-bar {
		display: flex;
		gap: 2px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 10px;
		padding: 3px;
		margin-bottom: 1.25rem;
	}

	.tab-btn {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--text-muted, #475569);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}

	.tab-active {
		background: rgba(245, 158, 11, 0.15);
		color: var(--gold, #f59e0b);
	}

	/* Auth prompt */
	.auth-prompt {
		text-align: center;
		padding: 3rem 1rem;
		color: var(--text-secondary, #94a3b8);
	}

	.btn-signin {
		display: inline-block;
		margin-top: 1rem;
		padding: 0.5rem 1.25rem;
		border-radius: 8px;
		background: var(--accent-primary, #3b82f6);
		color: white;
		text-decoration: none;
		font-weight: 600;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary, #f1f5f9);
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.btn-architect {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		background: rgba(245, 158, 11, 0.12);
		color: var(--gold, #f59e0b);
		font-size: 0.85rem;
		font-weight: 600;
		text-decoration: none;
		border: 1px solid rgba(245, 158, 11, 0.3);
		cursor: pointer;
	}

	.btn-create {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		background: var(--accent-primary, #3b82f6);
		color: white;
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		border: none;
		cursor: pointer;
	}

	.legacy-banner {
		padding: 0.75rem 1rem;
		border-radius: 8px;
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.3);
		margin-bottom: 1rem;
	}
	.legacy-banner p { color: var(--text-primary); font-size: 0.9rem; margin-bottom: 0.5rem; }
	.legacy-actions { display: flex; gap: 0.5rem; }
	.btn-import { padding: 0.375rem 0.75rem; border-radius: 6px; background: var(--accent-primary, #3b82f6); color: white; border: none; font-size: 0.85rem; cursor: pointer; }
	.btn-dismiss { padding: 0.375rem 0.75rem; border-radius: 6px; background: transparent; border: 1px solid var(--border-color, #1e293b); color: var(--text-secondary); font-size: 0.85rem; cursor: pointer; }

	.filter-bar {
		display: flex; gap: 0.375rem; overflow-x: auto; padding-bottom: 0.5rem; margin-bottom: 1rem;
		-webkit-overflow-scrolling: touch;
	}
	.filter-btn {
		padding: 0.375rem 0.75rem; border-radius: 20px; border: 1px solid var(--border-color, #1e293b);
		background: transparent; color: var(--text-secondary, #94a3b8); font-size: 0.8rem; cursor: pointer;
		white-space: nowrap; flex-shrink: 0;
	}
	.filter-btn.active { background: rgba(59, 130, 246, 0.15); border-color: rgba(59, 130, 246, 0.3); color: #60a5fa; }

	.loading-state, .empty-state { text-align: center; padding: 3rem 1rem; color: var(--text-secondary, #94a3b8); }
	.empty-icon { font-size: 3rem; margin-bottom: 0.75rem; }
	.empty-state p { margin-bottom: 1rem; }

	.deck-grid { display: grid; grid-template-columns: 1fr; gap: 0.75rem; }
	@media (min-width: 600px) { .deck-grid { grid-template-columns: 1fr 1fr; } }

	.deck-card { position: relative; border-radius: 10px; border: 1px solid var(--border-color, #1e293b); background: var(--bg-surface, #0d1524); overflow: hidden; }
	.deck-card-body { padding: 0.875rem; cursor: pointer; }
	.deck-card-body:hover { background: var(--bg-hover, rgba(255, 255, 255, 0.02)); }
	.deck-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.625rem; }
	.deck-card-name { font-size: 1rem; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
	.format-badge { padding: 0.2rem 0.5rem; border-radius: 10px; background: rgba(59, 130, 246, 0.15); color: #60a5fa; font-size: 0.7rem; font-weight: 600; white-space: nowrap; flex-shrink: 0; }
	.deck-card-stats { display: flex; gap: 1rem; margin-bottom: 0.5rem; }
	.mini-stat { display: flex; flex-direction: column; }
	.mini-stat-value { font-size: 0.85rem; font-weight: 600; color: var(--text-primary); }
	.mini-stat-label { font-size: 0.7rem; color: var(--text-tertiary, #64748b); }
	.progress-track { height: 4px; border-radius: 2px; background: var(--bg-elevated, #1e293b); overflow: hidden; margin-bottom: 0.5rem; }
	.progress-fill { height: 100%; border-radius: 2px; transition: width 0.3s ease; }
	.deck-card-notes { font-size: 0.8rem; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 0.375rem; }
	.deck-card-footer { display: flex; justify-content: space-between; align-items: center; }
	.deck-card-date { font-size: 0.75rem; color: var(--text-tertiary); }
	.complete-badge { padding: 0.125rem 0.5rem; border-radius: 10px; background: rgba(34, 197, 94, 0.15); color: #22C55E; font-size: 0.7rem; font-weight: 600; }

	.deck-card-menu { position: absolute; top: 0.5rem; right: 0.5rem; }
	.menu-trigger { background: none; border: none; color: var(--text-secondary); font-size: 1.2rem; cursor: pointer; padding: 0.25rem 0.5rem; border-radius: 4px; line-height: 1; }
	.menu-trigger:hover { background: var(--bg-hover); }
	.menu-dropdown { position: absolute; top: 100%; right: 0; background: var(--bg-elevated); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.25rem; min-width: 100px; z-index: 10; }
	.menu-item { display: block; width: 100%; padding: 0.5rem 0.75rem; border: none; background: none; color: var(--text-primary); font-size: 0.85rem; cursor: pointer; text-align: left; border-radius: 6px; }
	.menu-item:hover { background: var(--bg-hover); }
	.menu-item-danger { color: var(--color-error, #ef4444); }
	.menu-item-danger:hover { background: rgba(239, 68, 68, 0.1); }

	/* Tournament tab */
	.tournament-tab-content {
		padding: 1rem 0;
	}
	.tournament-tab-content h1 { font-size: 1.3rem; margin-bottom: 0.25rem; }
	.subtitle { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1rem; }

	/* Tournament tab */
	.tournament-form {
		display: flex; gap: 0.75rem; max-width: 400px;
	}
	.tournament-input {
		flex: 1; padding: 0.625rem 0.875rem; border-radius: 8px;
		border: 1px solid var(--border-color); background: var(--bg-surface);
		color: var(--text-primary); font-family: monospace; font-size: 1.1rem;
		letter-spacing: 0.15em; text-transform: uppercase; text-align: center;
	}
	.tournament-error { color: #ef4444; font-size: 0.85rem; margin-top: 0.75rem; }
	.tournament-result {
		margin-top: 1rem; padding: 1.25rem; border-radius: 12px;
		background: var(--bg-surface); border: 1px solid var(--border-color);
		max-width: 400px;
	}
	.tournament-name { font-weight: 700; font-size: 1.1rem; margin-bottom: 0.25rem; }
	.tournament-code { font-family: monospace; font-size: 0.85rem; color: var(--accent-primary, #3b82f6); letter-spacing: 0.1em; margin-bottom: 0.75rem; }
	.tournament-params { display: flex; gap: 1rem; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1rem; }

	/* Modal */
	.modal-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 100; }
	.modal-overlay-dismiss { position: absolute; inset: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); border: none; appearance: none; cursor: default; }
	.modal-content { background: var(--bg-elevated); border: 1px solid var(--border-color); border-radius: 12px; padding: 1.5rem; max-width: 360px; width: 90%; position: relative; z-index: 1; }
	.modal-content h3 { color: var(--text-primary); margin-bottom: 0.5rem; }
	.modal-content p { color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1rem; }
	.modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
	.btn-cancel { padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid var(--border-color); background: transparent; color: var(--text-secondary); cursor: pointer; }
	.btn-delete { padding: 0.5rem 1rem; border-radius: 6px; border: none; background: var(--color-error, #ef4444); color: white; font-weight: 600; cursor: pointer; }
</style>
