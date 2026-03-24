<script lang="ts">
	import { scanImage,scanState, resetScanner, initScanner } from '$lib/stores/scanner.svelte';
	import ScanConfirmation from '$lib/components/ScanConfirmation.svelte';
	import { onMount } from 'svelte';
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
</script>

<svelte:head>
	<title>BOBA Scanner | AI-Powered Card Recognition</title>
</svelte:head>

<div class="dashboard">
	<section class="hero-section">
		<h1>BOBA Scanner</h1>
		<p class="hero-subtitle">AI-Powered Bo Jackson Trading Card Recognition</p>

		{#if data.user}
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

			<div class="quick-actions">
				<a href="/scan" class="action-card primary">
					<span class="action-icon">📷</span>
					<span class="action-label">Scan Cards</span>
					<span class="action-desc">Use camera to identify</span>
				</a>
				<button class="action-card upload" onclick={handleUploadClick} disabled={uploading}>
					<span class="action-icon">📁</span>
					<span class="action-label">Upload Image</span>
					<span class="action-desc">Identify from a photo</span>
				</button>
				<input
					bind:this={fileInput}
					type="file"
					accept="image/jpeg,image/png,image/webp"
					onchange={handleFileSelected}
					hidden
				/>
				<a href="/collection" class="action-card">
					<span class="action-icon">📚</span>
					<span class="action-label">My Collection</span>
					<span class="action-desc">View and manage your cards</span>
				</a>
				<a href="/deck" class="action-card">
					<span class="action-icon">🃏</span>
					<span class="action-label">Deck Builder</span>
					<span class="action-desc">Build competitive decks</span>
				</a>
			</div>
		{:else}
			<div class="cta-section">
				<p>Scan and identify Bo Jackson Battle Arena cards instantly.</p>
				<a href="/scan" class="btn-primary btn-large">Try Scanning Now</a>
				<a href="/auth/login" class="btn-secondary btn-large cta-signin">Sign in for Full Features</a>
			</div>
		{/if}
	</section>

	{#if !data.user}
		<section class="synopsis-section">
			<div class="synopsis-grid">
				<div class="synopsis-card">
					<span class="synopsis-icon">📷</span>
					<h3>Scan</h3>
					<p>Scan cards with your camera</p>
				</div>
				<div class="synopsis-card">
					<span class="synopsis-icon">📚</span>
					<h3>Collect</h3>
					<p>Build and manage your collection</p>
				</div>
				<div class="synopsis-card">
					<span class="synopsis-icon">🏆</span>
					<h3>Compete</h3>
					<p>Enter tournaments and build decks</p>
				</div>
			</div>
		</section>

		<section class="tournament-lookup-section">
			<h2>Enter Tournament Code</h2>
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
					<a href="/auth/login?redirectTo=/tournaments/enter?code={tournamentResult.code}" class="btn-primary btn-small-cta">Sign in to Enter</a>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.dashboard {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	.hero-section {
		text-align: center;
		margin-bottom: 3rem;
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
		margin-bottom: 2rem;
	}

	.quick-actions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-top: 2rem;
	}

	.action-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1.5rem;
		border-radius: 12px;
		background: var(--surface-secondary, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		text-decoration: none;
		color: inherit;
		transition: transform 0.2s, border-color 0.2s;
	}

	.action-card:hover {
		transform: translateY(-2px);
		border-color: var(--accent-primary, #3b82f6);
	}

	.action-card.primary {
		border-color: var(--accent-primary, #3b82f6);
		background: var(--accent-primary-dim, rgba(59, 130, 246, 0.1));
	}

	.action-icon {
		font-size: 2rem;
		margin-bottom: 0.5rem;
	}

	.action-label {
		font-weight: 600;
		font-size: 1rem;
	}

	.action-desc {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
		margin-top: 0.25rem;
	}

	.cta-section {
		margin-top: 2rem;
	}

	.cta-section p {
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 1rem;
	}

	.btn-large {
		padding: 0.75rem 2rem;
		font-size: 1.1rem;
		display: inline-block;
		text-decoration: none;
	}

	.cta-signin {
		margin-top: 0.75rem;
		font-size: 0.95rem;
	}

	.synopsis-section {
		margin-top: 3rem;
	}

	.synopsis-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
	}

	.synopsis-card {
		text-align: center;
		padding: 1.25rem;
		border-radius: 12px;
		background: var(--surface-secondary, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
	}

	.synopsis-icon {
		font-size: 1.5rem;
		display: block;
		margin-bottom: 0.5rem;
	}

	.synopsis-card h3 {
		font-size: 1rem;
		font-weight: 700;
		margin-bottom: 0.25rem;
	}

	.synopsis-card p {
		font-size: 0.85rem;
		color: var(--text-secondary, #94a3b8);
		line-height: 1.4;
	}

	.tournament-lookup-section {
		margin-top: 2.5rem;
		text-align: center;
	}

	.tournament-lookup-section h2 {
		font-family: 'Syne', sans-serif;
		margin-bottom: 1rem;
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

	.btn-secondary {
		background: transparent;
		border: 1px solid var(--border-color, #1e293b);
		color: var(--text-primary, #f1f5f9);
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

	.action-card.upload:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	@media (max-width: 600px) {
		.synopsis-grid {
			grid-template-columns: 1fr;
		}

		.hero-section h1 {
			font-size: 2rem;
		}
	}
</style>
