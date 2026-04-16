<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import Scanner from '$lib/components/Scanner.svelte';
	import ScanConfirmation from '$lib/components/ScanConfirmation.svelte';
	import ScannerErrorBoundary from '$lib/components/ScannerErrorBoundary.svelte';
	import CloseButton from '$lib/components/CloseButton.svelte';
	import { initScanner, setScannerActive } from '$lib/stores/scanner.svelte';
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';
	import { isPro, setShowGoProModal } from '$lib/stores/pro.svelte';
	import { ALL_GAMES } from '$lib/games/all-games';
	import type { ScanResult } from '$lib/types';

	// Modes that require Pro (match the gated mode in CameraRollImport)
	const PRO_MODES = new Set(['batch', 'binder', 'roll']);

	let scanResult = $state<ScanResult | null>(null);
	let capturedImageUrl = $state<string | null>(null);
	const isAuthenticated = $derived(!!$page.data.user);
	const multiGameEnabled = featureEnabled('multi_game_ui');

	// Mode from URL param or default
	let scanMode = $state<'single' | 'batch' | 'binder' | 'roll'>('single');

	// Game hint: null = auto-detect, 'boba' or 'wonders' = force specific game
	let gameHint = $state<string | null>(null);
	let gamePickerOpen = $state(false);

	function setGameHint(hint: string | null) {
		gameHint = hint;
		gamePickerOpen = false;
	}

	function currentGameLabel(): string {
		if (!gameHint) return 'Auto';
		const match = ALL_GAMES.find((g) => g.id === gameHint);
		return match ? match.shortName : 'Auto';
	}

	function currentGameIcon(): string {
		if (!gameHint) return '✨';
		const match = ALL_GAMES.find((g) => g.id === gameHint);
		return match ? match.icon : '✨';
	}

	onMount(() => {
		setScannerActive(true);
		initScanner();
		const modeParam = $page.url.searchParams.get('mode');
		if (modeParam === 'batch' || modeParam === 'binder' || modeParam === 'roll') {
			scanMode = modeParam;
		}
	});

	// Revoke blob URL on unmount to prevent memory leak from orphaned object URLs
	onDestroy(() => {
		setScannerActive(false);
		cleanupImageUrl();
	});

	function handleResult(result: ScanResult, imageUrl?: string) {
		scanResult = result;
		capturedImageUrl = imageUrl ?? null;
	}

	function handleScanAnother() {
		cleanupImageUrl();
		scanResult = null;
		capturedImageUrl = null;
	}

	function handleClose() {
		cleanupImageUrl();
		scanResult = null;
		capturedImageUrl = null;
	}

	function cleanupImageUrl() {
		if (capturedImageUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(capturedImageUrl);
		}
	}

	function handleModeChange(mode: 'single' | 'batch' | 'binder' | 'roll') {
		// Gate Pro-only modes — free users get the Go Pro modal instead
		if (PRO_MODES.has(mode) && !isPro()) {
			setShowGoProModal(true);
			return;
		}
		scanMode = mode;
	}

	function exitScanner() {
		setScannerActive(false);
		goto('/');
	}
</script>

<svelte:head>
	<title>Scan | Card Scanner</title>
</svelte:head>

<div class="scan-page">
	<!-- Close button (top left, always visible) -->
	<CloseButton onclick={exitScanner} position="top-left" variant="dark" />

	<ScannerErrorBoundary>
		<!-- Mode selector — top bar, out of the way -->
		{#if !scanResult}
			<div class="mode-bar">
				{#each [
					{ id: 'single', label: 'Single', pro: false },
					{ id: 'batch', label: 'Batch', pro: true },
					{ id: 'binder', label: 'Binder', pro: true },
					{ id: 'roll', label: 'Roll', pro: true },
				] as mode}
					<button
						class="mode-pill"
						class:mode-active={scanMode === mode.id}
						onclick={() => handleModeChange(mode.id as 'single' | 'batch' | 'binder' | 'roll')}
						aria-label={mode.pro && !isPro() ? `${mode.label} (Pro)` : mode.label}
					>
						{mode.label}
						{#if mode.pro && !isPro()}
							<span class="mode-pro-badge" aria-hidden="true">PRO</span>
						{/if}
					</button>
				{/each}
			</div>

			{#if multiGameEnabled()}
				<div class="game-pill-wrapper">
					<button
						class="game-pill"
						class:game-pill-active={gameHint !== null}
						data-game={gameHint ?? 'auto'}
						onclick={() => (gamePickerOpen = !gamePickerOpen)}
						aria-haspopup="listbox"
						aria-expanded={gamePickerOpen}
						aria-label="Select game"
					>
						<span class="game-pill-icon">{currentGameIcon()}</span>
						<span class="game-pill-label">{currentGameLabel()}</span>
						<span class="game-pill-chevron" aria-hidden="true">▾</span>
					</button>
					{#if gamePickerOpen}
						<div class="game-picker" role="listbox">
							<button
								class="game-option"
								class:game-option-active={gameHint === null}
								onclick={() => setGameHint(null)}
								role="option"
								aria-selected={gameHint === null}
							>
								<span class="game-option-icon">✨</span>
								<span class="game-option-label">Auto-detect</span>
							</button>
							{#each ALL_GAMES as game}
								<button
									class="game-option"
									class:game-option-active={gameHint === game.id}
									onclick={() => setGameHint(game.id)}
									role="option"
									aria-selected={gameHint === game.id}
								>
									<span class="game-option-icon">{game.icon}</span>
									<span class="game-option-label">{game.shortName}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		{/if}

		{#if scanMode === 'single'}
			<Scanner onResult={handleResult} {isAuthenticated} paused={!!scanResult} {scanMode} {gameHint} />
		{:else if PRO_MODES.has(scanMode) && !isPro()}
			<!-- Safety net — user shouldn't reach here (handleModeChange blocks) but URL ?mode=batch could bypass -->
			<div class="scan-pro-gate">
				<div class="scan-pro-gate-icon">⭐</div>
				<h3>Pro feature</h3>
				<p>
					{#if scanMode === 'batch'}
						Batch scanning lets you upload and process multiple card photos at once.
					{:else if scanMode === 'binder'}
						Binder scanning reads every card on a binder page in one shot.
					{:else}
						Camera Roll import scans up to 50 photos from your phone library.
					{/if}
				</p>
				<button class="scan-pro-btn" onclick={() => setShowGoProModal(true)}>Go Pro</button>
				<button class="scan-pro-cancel" onclick={() => { scanMode = 'single'; }}>Back to Single</button>
			</div>
		{:else if scanMode === 'batch'}
			{#await import('$lib/components/BatchScanner.svelte') then { default: BatchScanner }}
				<BatchScanner onClose={() => { scanMode = 'single'; }} {isAuthenticated} />
			{/await}
		{:else if scanMode === 'binder'}
			{#await import('$lib/components/BinderScanner.svelte') then { default: BinderScanner }}
				<BinderScanner onClose={() => { scanMode = 'single'; }} {isAuthenticated} />
			{/await}
		{:else if scanMode === 'roll'}
			{#await import('$lib/components/CameraRollImport.svelte') then { default: CameraRollImport }}
				<CameraRollImport {isAuthenticated} onClose={() => { scanMode = 'single'; }} />
			{/await}
		{/if}
		{#if scanResult}
			<ScanConfirmation
				result={scanResult}
				{capturedImageUrl}
				{isAuthenticated}
				onScanAnother={handleScanAnother}
				onClose={handleClose}
			/>
		{/if}
	</ScannerErrorBoundary>
</div>

<style>
	.scan-page {
		/* Full-screen: fill entire viewport */
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		flex-direction: column;
		background: #000;
		overflow: hidden;
	}

	.mode-bar {
		position: fixed;
		top: calc(env(safe-area-inset-top, 0px) + 48px);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 4px;
		z-index: 10;
		padding: 4px;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border-radius: 24px;
	}

	.mode-pill {
		padding: 6px 14px;
		border: none;
		border-radius: 20px;
		background: transparent;
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		font-family: var(--font-sans);
		transition: all 0.15s;
	}

	.mode-pill:active { transform: scale(0.95); }

	.mode-pill.mode-active {
		background: rgba(255, 255, 255, 0.2);
		color: #fff;
	}

	/* Make scanner full-bleed: remove .app-main padding on scan page */
	:global(.app-main:has(.scan-page)) {
		padding: 0 !important;
		max-width: 100% !important;
		overflow: hidden !important;
	}

	/* ── Game selector pill (feature-flag gated) ─────────────── */
	.game-pill-wrapper {
		position: fixed;
		top: calc(env(safe-area-inset-top, 0px) + 96px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
	}

	.game-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 20px;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-sans);
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	.game-pill:active { transform: scale(0.95); }

	.game-pill-active[data-game="boba"] {
		border-color: #f59e0b;
		color: #f59e0b;
	}
	.game-pill-active[data-game="wonders"] {
		border-color: #3B82F6;
		color: #60A5FA;
	}

	.game-pill-icon { font-size: 0.9rem; line-height: 1; }
	.game-pill-chevron { font-size: 0.7rem; opacity: 0.7; }

	.game-picker {
		position: absolute;
		top: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		min-width: 160px;
		padding: 4px;
		background: rgba(0, 0, 0, 0.85);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 12px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.game-option {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.85rem;
		font-weight: 500;
		font-family: var(--font-sans);
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.game-option:hover { background: rgba(255, 255, 255, 0.08); }

	.game-option-active {
		background: rgba(255, 255, 255, 0.15);
		color: #fff;
	}

	.game-option-icon { font-size: 1rem; line-height: 1; }

	.mode-pro-badge {
		display: inline-block;
		margin-left: 0.25rem;
		padding: 1px 5px;
		font-size: 0.55rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		border-radius: 3px;
		background: linear-gradient(135deg, #fbbf24, #f59e0b);
		color: #1f2937;
		vertical-align: middle;
	}
	.scan-pro-gate {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 2rem 1.5rem;
		text-align: center;
		min-height: 60vh;
	}
	.scan-pro-gate-icon { font-size: 3rem; }
	.scan-pro-gate h3 { font-size: 1.25rem; font-weight: 700; margin: 0; }
	.scan-pro-gate p { color: var(--text-secondary); max-width: 320px; margin: 0; line-height: 1.5; }
	.scan-pro-btn {
		margin-top: 0.75rem;
		padding: 0.875rem 1.75rem;
		border-radius: 12px;
		border: none;
		background: linear-gradient(135deg, #fbbf24, #f59e0b);
		color: #1f2937;
		font-size: 1rem;
		font-weight: 700;
		cursor: pointer;
	}
	.scan-pro-cancel {
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 0.875rem;
		cursor: pointer;
		padding: 0.5rem;
	}
</style>
