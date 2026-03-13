<script lang="ts">
	import { scanImage, scanState, resetScanner, initScanner } from '$lib/stores/scanner';
	import { onMount } from 'svelte';
	import type { ScanResult } from '$lib/types';

	let { data } = $props();
	let fileInput = $state<HTMLInputElement | null>(null);
	let uploadResult = $state<ScanResult | null>(null);
	let uploading = $state(false);

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
		try {
			const result = await scanImage(file);
			uploadResult = result;
		} finally {
			uploading = false;
			input.value = '';
		}
	}

	function dismissResult() {
		uploadResult = null;
		resetScanner();
	}

	const statusText = $derived.by(() => {
		const state = $scanState;
		switch (state.status) {
			case 'tier1': return 'Checking cache...';
			case 'tier2': return 'Running OCR...';
			case 'tier3': return 'AI identifying...';
			case 'processing': return 'Processing...';
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
			{#if uploadResult?.card}
				<div class="upload-result">
					<h2 class="result-title">Card Found!</h2>
					<div class="result-card">
						<div class="result-name">{uploadResult.card.hero_name || uploadResult.card.name}</div>
						<div class="result-number">#{uploadResult.card.card_number}</div>
						{#if uploadResult.card.parallel}
							<div class="result-parallel">{uploadResult.card.parallel}</div>
						{/if}
						<div class="result-meta">
							<span>Confidence: {Math.round((uploadResult.confidence ?? 0) * 100)}%</span>
							<span>Method: {uploadResult.scan_method}</span>
						</div>
					</div>
					<button class="btn-primary" onclick={dismissResult}>Scan Another</button>
				</div>
			{:else if uploadResult && !uploadResult.card}
				<div class="upload-result">
					<h2 class="result-title">Card Not Recognized</h2>
					<p class="result-desc">{uploadResult.failReason || 'Try a clearer photo or use the camera scanner.'}</p>
					{#if uploadResult.failReason}
						<p class="result-hint">Check browser console (F12) for detailed scan logs.</p>
					{/if}
					<button class="btn-primary" onclick={dismissResult}>Try Again</button>
				</div>
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
				<p>Sign in to start scanning and collecting Bo Jackson Battle Arena cards.</p>
				<a href="/auth/login" class="btn-primary btn-large">Get Started</a>
			</div>
		{/if}
	</section>

	{#if !data.user}
		<section class="features-section">
			<h2>Three-Tier Recognition</h2>
			<div class="feature-grid">
				<div class="feature-card">
					<span class="feature-icon">⚡</span>
					<h3>Hash Cache</h3>
					<p>Instant recognition for previously scanned cards. Free.</p>
				</div>
				<div class="feature-card">
					<span class="feature-icon">🔍</span>
					<h3>OCR Engine</h3>
					<p>Client-side text recognition with fuzzy matching. Free.</p>
				</div>
				<div class="feature-card">
					<span class="feature-icon">🤖</span>
					<h3>Claude AI</h3>
					<p>Advanced AI identification for ambiguous cards.</p>
				</div>
			</div>
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
	}

	.features-section {
		margin-top: 3rem;
	}

	.features-section h2 {
		font-family: 'Syne', sans-serif;
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.feature-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
	}

	.feature-card {
		text-align: center;
		padding: 1.25rem;
		border-radius: 12px;
		background: var(--surface-secondary, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
	}

	.feature-icon {
		font-size: 1.5rem;
		display: block;
		margin-bottom: 0.5rem;
	}

	.feature-card h3 {
		font-size: 0.95rem;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.feature-card p {
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		line-height: 1.4;
	}

	.upload-result {
		margin: 2rem 0;
		padding: 1.5rem;
		border-radius: 12px;
		background: var(--surface-secondary, #0d1524);
		border: 1px solid var(--border-color, #1e293b);
		text-align: center;
	}

	.result-title {
		font-family: 'Syne', sans-serif;
		font-size: 1.3rem;
		margin-bottom: 1rem;
	}

	.result-card {
		margin-bottom: 1rem;
	}

	.result-name {
		font-size: 1.2rem;
		font-weight: 700;
	}

	.result-number {
		color: var(--text-secondary, #94a3b8);
		font-size: 0.9rem;
	}

	.result-parallel {
		color: var(--accent-primary, #3b82f6);
		font-size: 0.85rem;
		margin-top: 0.25rem;
	}

	.result-meta {
		display: flex;
		justify-content: center;
		gap: 1.5rem;
		margin-top: 0.75rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
	}

	.result-desc {
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 1rem;
	}

	.result-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary, #64748b);
		margin-bottom: 1rem;
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
		.feature-grid {
			grid-template-columns: 1fr;
		}

		.hero-section h1 {
			font-size: 2rem;
		}
	}
</style>
