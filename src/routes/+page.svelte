<script lang="ts">
	import { scanImage, scanState, resetScanner, initScanner } from '$lib/stores/scanner.svelte';
	import ScanConfirmation from '$lib/components/ScanConfirmation.svelte';
	import { onMount } from 'svelte';
	import { scanHistory } from '$lib/stores/scan-history.svelte';
	import type { ScanResult } from '$lib/types';

	let { data } = $props();
	let fileInput = $state<HTMLInputElement | null>(null);
	let uploadResult = $state<ScanResult | null>(null);
	let uploadImageUrl = $state<string | null>(null);
	let uploading = $state(false);
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

	onMount(() => {
		initScanner();
	});

	function handleUploadClick() {
		fileInput?.click();
	}

	async function handleFileSelected(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		uploading = true;
		uploadResult = null;

		// Create preview URL for the uploaded image
		if (uploadImageUrl) URL.revokeObjectURL(uploadImageUrl);
		uploadImageUrl = URL.createObjectURL(file);

		try {
			const result = await scanImage(file);
			if (result) {
				uploadResult = result;
			} else {
				const errorMsg = scanState().error || 'Scan failed unexpectedly';
				uploadResult = {
					card_id: null,
					card: null,
					scan_method: 'claude',
					confidence: 0,
					processing_ms: 0,
					failReason: errorMsg
				};
			}
		} finally {
			uploading = false;
			input.value = '';
		}
	}

	function dismissResult() {
		if (uploadImageUrl) {
			URL.revokeObjectURL(uploadImageUrl);
			uploadImageUrl = null;
		}
		uploadResult = null;
		resetScanner();
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
		} catch (err) {
			console.debug('[home] Tournament lookup failed:', err);
			tournamentError = 'Network error';
		} finally {
			tournamentLoading = false;
		}
	}

	const statusText = $derived.by(() => {
		const state = scanState();
		switch (state.status) {
			case 'tier1': return 'Checking cache...';
			case 'tier2': return 'Running OCR...';
			case 'tier3': return 'AI identifying...';
			case 'processing': return 'Processing...';
			case 'error': return state.error || 'Scan failed';
			default: return '';
		}
	});

	const recentScans = $derived(scanHistory().filter(s => s.success).slice(0, 5));
</script>

<svelte:head>
	<title>BOBA Scanner | AI-Powered Card Recognition</title>
</svelte:head>

<div class="dashboard">
	<section class="hero-section">
		<h1>BOBA Scanner</h1>

		{#if data.user}
			<!-- Authenticated dashboard -->
			{#if uploadResult}
				<ScanConfirmation
					result={uploadResult}
					capturedImageUrl={uploadImageUrl}
					isAuthenticated={!!data.user}
					onScanAnother={dismissResult}
					onClose={dismissResult}
				/>
			{:else if uploading}
				<div class="upload-status">
					<div class="upload-spinner"></div>
					<span>{statusText || 'Processing...'}</span>
				</div>
			{/if}

			<!-- Quick-scan strip -->
			<div class="quick-scan-strip">
				<a href="/scan" class="btn-quick-scan">Scan Card</a>
				<button class="btn-quick-upload" onclick={handleUploadClick} disabled={uploading}>
					Upload Photo
				</button>
				<input
					bind:this={fileInput}
					type="file"
					accept="image/jpeg,image/png,image/webp"
					onchange={handleFileSelected}
					hidden
				/>
			</div>
			<div class="import-strip">
				<a href="/scan?mode=roll" class="btn-import-photos">Import from Photos</a>
			</div>

			<!-- Recent Scans -->
			<div class="recent-scans">
				<h2 class="section-heading">Recent Scans</h2>
				{#if recentScans.length > 0}
					<div class="recent-scans-strip">
						{#each recentScans as scan}
							<div class="recent-scan-card">
								<div class="recent-scan-placeholder">🎴</div>
								<span class="recent-scan-name">{scan.heroName || scan.cardNumber || 'Unknown'}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="recent-scans-empty">Scan your first card to see it here.</p>
				{/if}
			</div>

			<!-- Deck summary -->
			<div class="deck-summary">
				<a href="/deck" class="deck-summary-link">
					<span class="deck-summary-icon">🃏</span>
					<span>My Decks</span>
					<span class="deck-summary-arrow">&rarr;</span>
				</a>
			</div>
		{:else}
			<!-- Unauthenticated landing -->
			<p class="hero-subtitle">Scan any BoBA card. See what it's worth instantly.</p>

			<div class="cta-section">
				<a href="/scan" class="btn-scan-cta">Scan a Card</a>
				<p class="cta-note">No sign-in required — try it free.</p>
			</div>
		{/if}
	</section>

	<!-- Tournament code entry (available for all users) -->
	<section class="tournament-lookup-section">
		<h2>Entering a Tournament?</h2>
		<form class="tournament-lookup-form" onsubmit={(e) => { e.preventDefault(); lookupTournament(); }}>
			<input
				type="text"
				class="tournament-code-input"
				bind:value={tournamentCode}
				placeholder="ABCD1234"
				maxlength="8"
				autocapitalize="characters"
				spellcheck="false"
			/>
			<button type="submit" class="btn-primary" disabled={tournamentLoading || tournamentCode.trim().length !== 8}>
				{tournamentLoading ? 'Looking up...' : 'Look Up'}
			</button>
		</form>

		{#if tournamentError}
			<p class="tournament-error">{tournamentError}</p>
		{/if}

		{#if tournamentResult}
			<div class="tournament-result">
				<div class="tournament-result-name">{tournamentResult.name}</div>
				<div class="tournament-result-code">{tournamentResult.code}</div>
				<div class="tournament-result-params">
					<span>Heroes: {tournamentResult.max_heroes}</span>
					<span>Plays: {tournamentResult.max_plays}</span>
					<span>Bonus: {tournamentResult.max_bonus}</span>
				</div>
				{#if data.user}
					<a href="/tournaments/enter?code={tournamentResult.code}" class="btn-primary btn-small-cta">Enter Tournament</a>
				{:else}
					<a href="/auth/login?redirectTo=/tournaments/enter?code={tournamentResult.code}" class="btn-primary btn-small-cta">Sign in to Enter</a>
				{/if}
			</div>
		{/if}
	</section>
</div>

<style>
	.dashboard {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.hero-section {
		text-align: center;
		margin-bottom: 2rem;
	}

	.hero-section h1 {
		font-family: 'Syne', sans-serif;
		font-size: 2.5rem;
		font-weight: 800;
		margin-bottom: 0.5rem;
	}

	.hero-subtitle {
		color: var(--text-secondary, #94a3b8);
		font-size: 1.1rem;
		margin-bottom: 1.5rem;
	}

	/* Quick-scan strip (authenticated) */
	.quick-scan-strip {
		display: flex;
		gap: 0.75rem;
		margin: 1.5rem auto 0;
		max-width: 400px;
	}

	.btn-quick-scan {
		flex: 1;
		padding: 0.75rem;
		border-radius: 10px;
		background: linear-gradient(135deg, var(--gold, #f59e0b), var(--gold-dark, #d97706));
		color: #0d1524;
		font-weight: 700;
		font-size: 0.95rem;
		text-align: center;
		text-decoration: none;
		border: none;
		cursor: pointer;
		box-shadow: 0 4px 16px rgba(245,158,11,0.3);
	}

	.btn-quick-upload {
		flex: 1;
		padding: 0.75rem;
		border-radius: 10px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		color: var(--text-primary, #e2e8f0);
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.btn-quick-upload:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.import-strip {
		margin-top: 0.5rem;
		max-width: 400px;
		margin-left: auto;
		margin-right: auto;
	}

	.btn-import-photos {
		display: block;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: transparent;
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		color: var(--text-secondary, #94a3b8);
		font-weight: 600;
		font-size: 0.85rem;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
	}

	.btn-import-photos:hover {
		border-color: var(--gold, #f59e0b);
		color: var(--gold, #f59e0b);
	}

	/* Recent scans */
	.recent-scans {
		margin-top: 1.5rem;
		text-align: left;
	}

	.section-heading {
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #475569);
		margin-bottom: 0.75rem;
	}

	.recent-scans-strip {
		display: flex;
		gap: 0.75rem;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		padding-bottom: 0.5rem;
		-webkit-overflow-scrolling: touch;
	}

	.recent-scan-card {
		flex-shrink: 0;
		scroll-snap-align: start;
		width: 80px;
		text-align: center;
	}

	.recent-scan-placeholder {
		width: 64px;
		height: 80px;
		margin: 0 auto 0.25rem;
		border-radius: 8px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
	}

	.recent-scan-name {
		font-size: 0.7rem;
		color: var(--text-secondary, #94a3b8);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: block;
	}

	.recent-scans-empty {
		font-size: 0.85rem;
		color: var(--text-muted, #475569);
		text-align: center;
		padding: 1rem;
	}

	/* Deck summary */
	.deck-summary {
		margin-top: 1rem;
	}

	.deck-summary-link {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-radius: 10px;
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		text-decoration: none;
		color: var(--text-primary, #e2e8f0);
		font-weight: 600;
		font-size: 0.95rem;
		transition: border-color 0.15s;
	}

	.deck-summary-link:hover {
		border-color: var(--gold, #f59e0b);
	}

	.deck-summary-icon {
		font-size: 1.25rem;
	}

	.deck-summary-arrow {
		margin-left: auto;
		color: var(--text-muted, #475569);
	}

	/* CTA section (unauthenticated) */
	.cta-section {
		margin-top: 1.5rem;
	}

	.btn-scan-cta {
		display: block;
		width: 100%;
		max-width: 320px;
		margin: 0 auto;
		padding: 1rem 2rem;
		border-radius: 12px;
		background: linear-gradient(135deg, var(--gold, #f59e0b), var(--gold-dark, #d97706));
		color: #0d1524;
		font-size: 1.15rem;
		font-weight: 800;
		text-align: center;
		text-decoration: none;
		box-shadow: 0 4px 20px rgba(245,158,11,0.35);
		transition: transform 0.15s, box-shadow 0.15s;
	}

	.btn-scan-cta:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 32px rgba(245,158,11,0.45);
	}

	.cta-note {
		font-size: 0.85rem;
		color: var(--text-muted, #475569);
		margin-top: 0.75rem;
	}

	/* Tournament lookup */
	.tournament-lookup-section {
		margin-top: 2rem;
		text-align: center;
	}

	.tournament-lookup-section h2 {
		font-family: 'Syne', sans-serif;
		font-size: 1.1rem;
		margin-bottom: 0.75rem;
	}

	.tournament-lookup-form {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
		max-width: 400px;
		margin: 0 auto;
	}

	.tournament-code-input {
		flex: 1;
		padding: 0.625rem 0.875rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, #1e293b);
		background: var(--surface-secondary, #0d1524);
		color: var(--text-primary, #f1f5f9);
		font-family: monospace;
		font-size: 1.1rem;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		text-align: center;
	}

	.tournament-code-input::placeholder {
		text-transform: none;
		letter-spacing: 0.05em;
		color: var(--text-secondary, #94a3b8);
		opacity: 0.5;
	}

	.tournament-error {
		color: #ef4444;
		font-size: 0.85rem;
		margin-top: 0.75rem;
	}

	.tournament-result {
		margin-top: 1rem;
		padding: 1.25rem;
		border-radius: 12px;
		background: var(--surface-secondary, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		max-width: 400px;
		margin-left: auto;
		margin-right: auto;
	}

	.tournament-result-name {
		font-weight: 700;
		font-size: 1.1rem;
		margin-bottom: 0.25rem;
	}

	.tournament-result-code {
		font-family: monospace;
		font-size: 0.85rem;
		color: var(--accent-primary, #3b82f6);
		letter-spacing: 0.1em;
		margin-bottom: 0.75rem;
	}

	.tournament-result-params {
		display: flex;
		justify-content: center;
		gap: 1rem;
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 1rem;
	}

	.btn-small-cta {
		display: inline-block;
		padding: 0.5rem 1.25rem;
		font-size: 0.9rem;
		text-decoration: none;
		border-radius: 8px;
	}

	.btn-primary {
		background: var(--accent-primary, #3b82f6);
		color: white;
		border: none;
	}

	.upload-status {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		margin: 2rem 0;
		padding: 1rem;
		border-radius: 12px;
		background: rgba(59, 130, 246, 0.1);
		border: 1px solid rgba(59, 130, 246, 0.2);
		color: var(--text-primary, #f1f5f9);
	}

	.upload-spinner {
		width: 18px;
		height: 18px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: var(--accent-primary, #3b82f6);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@media (max-width: 600px) {
		.hero-section h1 {
			font-size: 2rem;
		}
	}
</style>
