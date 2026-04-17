<script lang="ts">
	// gameId prop signals BoBA-only intent; currently identical behavior regardless.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let { gameId: _gameId = 'boba' }: { gameId?: 'boba' } = $props();
</script>

<div class="section-block">
	<h2 class="section-heading">Quick Actions</h2>
	<div class="actions-grid">
		<a href="/boba/collection" class="action-tile">
			<span class="action-icon">📦</span>
			<div class="action-text"><span class="action-label">Collection</span><span class="action-sub">Set progress · Grading · Export</span></div>
		</a>
		<a href="/war-room" class="action-tile">
			<span class="action-icon">📈</span>
			<div class="action-text"><span class="action-label">War Room</span><span class="action-sub">Market Pulse · Explorer · Pack sim</span></div>
		</a>
		<a href="/deck" class="action-tile">
			<span class="action-icon">🧠</span>
			<div class="action-text"><span class="action-label">Playbook</span><span class="action-sub">Decks · Architect · Splitter · Shop</span></div>
		</a>
		<a href="/sell" class="action-tile">
			<span class="action-icon">🏷️</span>
			<div class="action-text"><span class="action-label">Sell</span><span class="action-sub">eBay listings · Export</span></div>
		</a>
	</div>
</div>

<style>
	.section-block { margin-bottom: 1.5rem; }
	.section-heading { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted, #64748b); margin: 0 0 0.625rem; }
	.actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
	.action-tile { display: flex; align-items: center; gap: 0.75rem; padding: 0.875rem; background: var(--bg-surface, #0f172a); border: 1px solid var(--border, rgba(148,163,184,0.06)); border-radius: var(--radius-lg, 14px); text-decoration: none; color: var(--text-primary, #e2e8f0); transition: border-color var(--transition-fast, 150ms), background var(--transition-fast, 150ms); }
	.action-tile:active { transform: scale(0.97); }
	.action-tile:hover { border-color: var(--border-strong, rgba(148,163,184,0.15)); background: var(--bg-elevated, #121d34); }
	.action-icon { font-size: 1.35rem; flex-shrink: 0; }
	.action-text { display: flex; flex-direction: column; min-width: 0; }
	.action-label { font-size: 0.85rem; font-weight: 600; }
	.action-sub { font-size: 0.65rem; color: var(--text-muted, #475569); }
	@media (max-width: 360px) { .actions-grid { grid-template-columns: 1fr; } }
</style>
