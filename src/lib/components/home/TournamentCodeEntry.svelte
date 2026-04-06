<script lang="ts">
	interface Props { redirectToLogin?: boolean; }
	let { redirectToLogin = false }: Props = $props();

	let tournamentCode = $state('');
	let tournamentLoading = $state(false);
	let tournamentResult = $state<{
		code: string; name: string; max_heroes: number; max_plays: number; max_bonus: number;
	} | null>(null);
	let tournamentError = $state<string | null>(null);

	async function lookupTournament() {
		const code = tournamentCode.trim().toUpperCase();
		if (code.length !== 8) { tournamentError = 'Code must be 8 characters'; return; }
		tournamentLoading = true; tournamentError = null; tournamentResult = null;
		try {
			const res = await fetch(`/api/tournament/${encodeURIComponent(code)}`);
			if (!res.ok) {
				if (res.status === 404) tournamentError = 'Tournament not found';
				else if (res.status === 410) tournamentError = 'This tournament is no longer active';
				else if (res.status === 403) tournamentError = 'Registration for this tournament is closed';
				else tournamentError = 'Failed to look up tournament';
				return;
			}
			tournamentResult = await res.json();
		} catch (err) { console.debug('[home] Tournament lookup failed:', err); tournamentError = 'Network error'; }
		finally { tournamentLoading = false; }
	}
</script>

<div class="section-block">
	<h2 class="section-heading">{redirectToLogin ? 'Entering a Tournament?' : 'Tournaments'}</h2>
	<div class="tournament-code-strip">
		<input type="text" class="tournament-code-input" bind:value={tournamentCode}
			placeholder={redirectToLogin ? 'ABCD1234' : 'Enter tournament code'} maxlength="8"
			autocapitalize="characters" spellcheck="false"
			onkeydown={(e) => { if (e.key === 'Enter') lookupTournament(); }} />
		<button class="btn-tournament-join" onclick={lookupTournament}
			disabled={tournamentLoading || tournamentCode.trim().length !== 8}>
			{tournamentLoading ? (redirectToLogin ? 'Looking up...' : '...') : 'Join'}
		</button>
	</div>
	{#if tournamentError}<p class="tournament-error">{tournamentError}</p>{/if}
	{#if tournamentResult}
		<div class="tournament-result-card">
			<div class="tournament-result-header">
				<div>
					<div class="tournament-result-name">{tournamentResult.name}</div>
					<div class="tournament-result-meta">{tournamentResult.code} · Heroes: {tournamentResult.max_heroes} · Plays: {tournamentResult.max_plays}</div>
				</div>
				{#if !redirectToLogin}<span class="tournament-status-badge">Open</span>{/if}
			</div>
			{#if redirectToLogin}
				<a href="/auth/login?redirectTo=/tournaments/enter?code={tournamentResult.code}" class="btn-tournament-enter">Sign in to Enter</a>
			{:else}
				<a href="/tournaments/enter?code={tournamentResult.code}" class="btn-tournament-enter">Enter Tournament</a>
			{/if}
		</div>
	{/if}
	{#if !redirectToLogin}<a href="/tournaments" class="link-subtle">Browse all tournaments →</a>{/if}
</div>

<style>
	.section-block { margin-bottom: 1.5rem; }
	.section-heading { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted, #64748b); margin: 0 0 0.625rem; }
	.tournament-code-strip { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; }
	.tournament-code-input { flex: 1; padding: 0.625rem 0.875rem; border-radius: var(--radius-md, 10px); border: 1px solid var(--border, rgba(148,163,184,0.10)); background: var(--bg-base, #070b14); color: var(--text-primary, #e2e8f0); font-family: var(--font-mono, monospace); font-size: 0.9rem; letter-spacing: 0.1em; text-transform: uppercase; }
	.tournament-code-input::placeholder { text-transform: none; letter-spacing: 0.02em; color: var(--text-muted, #475569); opacity: 0.6; }
	.btn-tournament-join { padding: 0.625rem 1.25rem; background: var(--primary, #3b82f6); border: none; border-radius: var(--radius-md, 10px); color: white; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: opacity var(--transition-fast, 150ms); }
	.btn-tournament-join:disabled { opacity: 0.5; cursor: not-allowed; }
	.tournament-error { color: #ef4444; font-size: 0.8rem; margin-bottom: 0.75rem; }
	.tournament-result-card { padding: 0.875rem 1rem; background: linear-gradient(135deg, rgba(59,130,246,0.06), rgba(168,85,247,0.03)); border: 1px solid rgba(59,130,246,0.12); border-radius: var(--radius-lg, 14px); margin-bottom: 0.75rem; }
	.tournament-result-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.625rem; }
	.tournament-result-name { font-weight: 600; font-size: 0.9rem; }
	.tournament-result-meta { font-size: 0.75rem; color: var(--text-secondary, #94a3b8); margin-top: 0.125rem; }
	.tournament-status-badge { font-size: 0.65rem; font-weight: 700; color: #4ade80; background: rgba(74,222,128,0.12); padding: 0.125rem 0.5rem; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; }
	.btn-tournament-enter { display: block; width: 100%; padding: 0.5rem; background: var(--primary, #3b82f6); border: none; border-radius: var(--radius-md, 8px); color: white; font-size: 0.85rem; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; }
	.link-subtle { display: block; font-size: 0.8rem; color: var(--text-muted, #475569); text-decoration: none; margin-top: 0.25rem; transition: color var(--transition-fast, 150ms); }
	.link-subtle:hover { color: var(--text-secondary, #94a3b8); }
</style>
