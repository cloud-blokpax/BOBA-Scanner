<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { fade } from 'svelte/transition';
	import Scanner from '$lib/components/Scanner.svelte';
	import { initScanner } from '$lib/stores/scanner';
	import { triggerHaptic } from '$lib/utils/haptics';
	import {
		speedGame,
		gamePhase,
		gameScore,
		scanCount,
		timeRemaining,
		resetGame,
		startCountdown,
		tickCountdown,
		setTimeRemaining,
		finishGame,
		recordScan,
		highScores,
		addHighScore,
		RARITY_POINTS
	} from '$lib/stores/speed-game';
	import type { ScanResult, CardRarity } from '$lib/types';

	const RARITY_COLORS: Record<string, string> = {
		common: '#9CA3AF',
		uncommon: '#22C55E',
		rare: '#3B82F6',
		ultra_rare: '#A855F7',
		legendary: '#F59E0B'
	};

	const isAuthenticated = $derived(!!$page.data.user);

	// Duration selection
	let selectedDuration = $state(60);

	// Game timer state
	let endTime = $state<number | null>(null);
	let rafId: number | null = null;
	let countdownInterval: ReturnType<typeof setInterval> | null = null;

	// Speed toasts
	let toasts = $state<Array<{ id: number; name: string; points: number; rarity: string }>>([]);
	let toastCounter = 0;

	// Score animation on finish
	let displayScore = $state(0);
	let scoreAnimId: number | null = null;

	// Track whether a new high score was set
	let isNewHighScore = $state(false);

	onMount(() => {
		initScanner();
		resetGame(selectedDuration);
	});

	onDestroy(() => {
		cleanup();
		resetGame();
	});

	function cleanup() {
		if (rafId !== null) cancelAnimationFrame(rafId);
		if (countdownInterval !== null) clearInterval(countdownInterval);
		if (scoreAnimId !== null) cancelAnimationFrame(scoreAnimId);
		rafId = null;
		countdownInterval = null;
		scoreAnimId = null;
		endTime = null;
	}

	function handleStart() {
		resetGame(selectedDuration);
		isNewHighScore = false;
		startCountdown();
		triggerHaptic('tap');

		countdownInterval = setInterval(() => {
			triggerHaptic('tap');
			tickCountdown();

			// Check if we transitioned to playing
			const unsub = gamePhase.subscribe((phase) => {
				if (phase === 'playing') {
					if (countdownInterval !== null) {
						clearInterval(countdownInterval);
						countdownInterval = null;
					}
					startGameTimer();
				}
			});
			// Immediately unsubscribe after check
			unsub();
		}, 1000);
	}

	function startGameTimer() {
		endTime = Date.now() + selectedDuration * 1000;
		rafId = requestAnimationFrame(gameTick);
	}

	function gameTick() {
		if (!endTime) return;
		const remaining = Math.max(0, (endTime - Date.now()) / 1000);
		setTimeRemaining(remaining);

		if (remaining <= 0) {
			finishGame();
			onGameFinished();
			return;
		}
		rafId = requestAnimationFrame(gameTick);
	}

	function onGameFinished() {
		if (rafId !== null) cancelAnimationFrame(rafId);
		rafId = null;

		// Animate score count-up
		const finalScore = $gameScore;
		const startTime = performance.now();
		const duration = 1000;
		displayScore = 0;

		function animateScore(now: number) {
			const elapsed = now - startTime;
			const progress = Math.min(elapsed / duration, 1);
			// Ease-out cubic
			const eased = 1 - Math.pow(1 - progress, 3);
			displayScore = Math.round(finalScore * eased);
			if (progress < 1) {
				scoreAnimId = requestAnimationFrame(animateScore);
			} else {
				displayScore = finalScore;
				scoreAnimId = null;
			}
		}
		scoreAnimId = requestAnimationFrame(animateScore);

		// Check for high score
		isNewHighScore = addHighScore(finalScore, $scanCount, selectedDuration);
		triggerHaptic('success');
	}

	function handleSpeedResult(result: ScanResult, imageUrl?: string) {
		if ($gamePhase !== 'playing') return;

		if (result.card) {
			const pts = recordScan(result);
			const r = result.card.rarity;
			if (r === 'legendary') triggerHaptic('legendary');
			else if (r === 'ultra_rare') triggerHaptic('ultraRare');
			else triggerHaptic('success');

			showSpeedToast(result.card.hero_name || result.card.name, pts, r || 'common');
		}

		// Clean up blob URL
		if (imageUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(imageUrl);
		}
	}

	function showSpeedToast(name: string, points: number, rarity: string) {
		const id = ++toastCounter;
		toasts = [...toasts, { id, name, points, rarity }];
		setTimeout(() => {
			toasts = toasts.filter((t) => t.id !== id);
		}, 800);
	}

	function handlePlayAgain() {
		cleanup();
		isNewHighScore = false;
		displayScore = 0;
		resetGame(selectedDuration);
	}

	// Derive timer color
	const timerColor = $derived.by(() => {
		const t = $timeRemaining;
		if (t > 15) return '#22C55E';
		if (t > 10) return '#F59E0B';
		return '#EF4444';
	});

	const timerPulse = $derived($timeRemaining < 5 && $gamePhase === 'playing');
	const timerPercent = $derived.by(() => {
		const game = $speedGame;
		return game.duration > 0 ? (game.timeRemaining / game.duration) * 100 : 0;
	});

	// Results derived values
	const avgScanTime = $derived.by(() => {
		const entries = $speedGame.entries;
		if (entries.length === 0) return 0;
		return Math.round(entries.reduce((sum, e) => sum + e.processingMs, 0) / entries.length);
	});

	const tierBreakdown = $derived.by(() => {
		const entries = $speedGame.entries;
		return {
			hash_cache: entries.filter((e) => e.scanMethod === 'hash_cache').length,
			tesseract: entries.filter((e) => e.scanMethod === 'tesseract').length,
			claude: entries.filter((e) => e.scanMethod === 'claude').length
		};
	});

	const bestEntry = $derived.by(() => {
		const entries = $speedGame.entries;
		if (entries.length === 0) return null;
		const RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2, ultra_rare: 3, legendary: 4 };
		return entries.reduce((best, e) => {
			const eRank = RANK[e.rarity ?? 'common'] ?? 0;
			const bRank = RANK[best.rarity ?? 'common'] ?? 0;
			return eRank > bRank ? e : best;
		});
	});

	function formatDuration(secs: number): string {
		if (secs === 30) return '30s';
		if (secs === 60) return '1min';
		if (secs === 90) return '1.5min';
		return `${secs}s`;
	}
</script>

<svelte:head>
	<title>Speed Challenge | BOBA Scanner</title>
</svelte:head>

<div class="speed-page">
	{#if $gamePhase === 'idle'}
		<!-- Pre-Game Screen -->
		<div class="idle-screen">
			<h1 class="speed-title">Speed Scanner</h1>
			<p class="speed-subtitle">Scan as many cards as possible before time runs out!</p>

			<div class="points-table">
				<h3>Points by Rarity</h3>
				{#each Object.entries(RARITY_POINTS) as [rarity, points]}
					<div class="points-row">
						<span class="rarity-label" style="color: {RARITY_COLORS[rarity] || '#9CA3AF'}">{rarity.replace('_', ' ')}</span>
						<span class="points-value">+{points}</span>
					</div>
				{/each}
			</div>

			<div class="duration-picker">
				<span class="duration-label">Duration</span>
				<div class="duration-options">
					{#each [30, 60, 90] as dur}
						<button
							class="duration-btn"
							class:active={selectedDuration === dur}
							onclick={() => { selectedDuration = dur; resetGame(dur); }}
						>
							{formatDuration(dur)}
						</button>
					{/each}
				</div>
			</div>

			{#if $highScores.length > 0}
				<div class="high-scores">
					<h3>High Scores</h3>
					{#each $highScores as hs, i}
						<div class="hs-row">
							<span class="hs-rank">#{i + 1}</span>
							<span class="hs-score">{hs.score} pts</span>
							<span class="hs-cards">{hs.cardCount} cards</span>
							<span class="hs-dur">{formatDuration(hs.duration)}</span>
						</div>
					{/each}
				</div>
			{/if}

			<button class="start-btn" onclick={handleStart}>Start</button>
		</div>
	{:else if $gamePhase === 'countdown'}
		<!-- Countdown Overlay -->
		<div class="countdown-overlay">
			{#key $speedGame.countdownValue}
				<div class="countdown-number">
					{$speedGame.countdownValue}
				</div>
			{/key}
		</div>
		<!-- Scanner initializing in background -->
		<div class="scanner-bg">
			<Scanner onResult={handleSpeedResult} {isAuthenticated} paused={true} />
		</div>
	{:else if $gamePhase === 'playing'}
		<!-- Active Game -->
		<div class="game-hud">
			<!-- Timer bar -->
			<div class="timer-bar-track" class:pulse={timerPulse}>
				<div
					class="timer-bar-fill"
					style="width: {timerPercent}%; background: {timerColor};"
				></div>
			</div>
			<div class="hud-stats">
				<div class="hud-cards">Cards: {$scanCount}</div>
				<div class="hud-time" style="color: {timerColor};">{Math.ceil($timeRemaining)}s</div>
				<div class="hud-score">{$gameScore}</div>
			</div>
		</div>

		<!-- Speed toasts -->
		<div class="speed-toasts">
			{#each toasts as toast (toast.id)}
				<div
					class="speed-toast"
					style="color: {RARITY_COLORS[toast.rarity] || '#9CA3AF'};"
					transition:fade={{ duration: 200 }}
				>
					<span class="toast-name">{toast.name}</span>
					<span class="toast-points">+{toast.points}</span>
				</div>
			{/each}
		</div>

		<Scanner onResult={handleSpeedResult} {isAuthenticated} paused={false} />
	{:else if $gamePhase === 'finished'}
		<!-- Results Screen -->
		<div class="results-overlay">
			<div class="results-container">
				<h2 class="results-title">Time's Up!</h2>

				{#if isNewHighScore}
					<div class="new-hs-badge">New High Score!</div>
				{/if}

				<div class="score-display">{displayScore}</div>
				<div class="score-label">points</div>

				<div class="results-stats">
					<div class="result-stat">
						<span class="rs-value">{$scanCount}</span>
						<span class="rs-label">Cards Scanned</span>
					</div>
					{#if bestEntry}
						<div class="result-stat">
							<span class="rs-value" style="color: {RARITY_COLORS[bestEntry.rarity ?? 'common']}">{bestEntry.heroName || 'Unknown'}</span>
							<span class="rs-label">Best Card ({(bestEntry.rarity ?? 'common').replace('_', ' ')})</span>
						</div>
					{/if}
					<div class="result-stat">
						<span class="rs-value">{avgScanTime}ms</span>
						<span class="rs-label">Avg Scan Time</span>
					</div>
				</div>

				{#if $scanCount > 0}
					<div class="tier-breakdown">
						<h3>Recognition Breakdown</h3>
						<div class="tier-bars">
							{#if tierBreakdown.hash_cache > 0}
								<div class="tier-row">
									<span class="tier-name">Cache (T1)</span>
									<span class="tier-count">{tierBreakdown.hash_cache}</span>
								</div>
							{/if}
							{#if tierBreakdown.tesseract > 0}
								<div class="tier-row">
									<span class="tier-name">OCR (T2)</span>
									<span class="tier-count">{tierBreakdown.tesseract}</span>
								</div>
							{/if}
							{#if tierBreakdown.claude > 0}
								<div class="tier-row">
									<span class="tier-name">AI (T3)</span>
									<span class="tier-count">{tierBreakdown.claude}</span>
								</div>
							{/if}
						</div>
					</div>

					<div class="scan-log">
						<h3>Scan Log</h3>
						<div class="log-list">
							{#each $speedGame.entries as entry, i}
								<div class="log-entry">
									<span class="log-index">{i + 1}.</span>
									<span class="log-name" style="color: {RARITY_COLORS[entry.rarity ?? 'common']}">{entry.heroName || entry.cardId}</span>
									<span class="log-points">+{entry.points}</span>
									<span class="log-time">{entry.processingMs}ms</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div class="results-actions">
					<button class="start-btn" onclick={handlePlayAgain}>Play Again</button>
					<a href="/scan" class="back-link">Back to Scanner</a>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.speed-page {
		height: calc(100dvh - var(--header-height, 56px) - var(--bottom-nav-height, 68px) - var(--safe-bottom, env(safe-area-inset-bottom, 20px)));
		display: flex;
		flex-direction: column;
		position: relative;
		overflow: hidden;
	}

	:global(.app-main:has(.speed-page)) {
		padding: 0 !important;
		max-width: 100% !important;
		overflow: hidden !important;
	}

	/* ── Idle Screen ── */
	.idle-screen {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem 1.5rem;
		gap: 1.25rem;
		overflow-y: auto;
	}

	.speed-title {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 2rem;
		font-weight: 800;
		color: var(--text-primary, #e2e8f0);
		margin: 0;
	}

	.speed-subtitle {
		font-size: 0.95rem;
		color: var(--text-secondary, #94a3b8);
		text-align: center;
		margin: 0;
	}

	.points-table {
		width: 100%;
		max-width: 280px;
		background: var(--bg-surface, #0d1524);
		border-radius: 12px;
		padding: 1rem;
	}

	.points-table h3 {
		margin: 0 0 0.75rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.points-row {
		display: flex;
		justify-content: space-between;
		padding: 0.3rem 0;
		font-size: 0.9rem;
	}

	.rarity-label {
		text-transform: capitalize;
		font-weight: 500;
	}

	.points-value {
		font-weight: 700;
		color: var(--text-primary, #e2e8f0);
	}

	/* ── Duration Picker ── */
	.duration-picker {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.duration-label {
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.duration-options {
		display: flex;
		gap: 0.5rem;
	}

	.duration-btn {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border-color, rgba(148, 163, 184, 0.2));
		background: var(--bg-surface, #0d1524);
		color: var(--text-secondary, #94a3b8);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}

	.duration-btn.active {
		background: var(--accent-primary, #3b82f6);
		color: white;
		border-color: var(--accent-primary, #3b82f6);
	}

	/* ── High Scores ── */
	.high-scores {
		width: 100%;
		max-width: 280px;
		background: var(--bg-surface, #0d1524);
		border-radius: 12px;
		padding: 1rem;
	}

	.high-scores h3 {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.hs-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0;
		font-size: 0.85rem;
	}

	.hs-rank {
		color: var(--text-tertiary, #475569);
		font-weight: 600;
		min-width: 1.5rem;
	}

	.hs-score {
		font-weight: 700;
		color: var(--text-primary, #e2e8f0);
		flex: 1;
	}

	.hs-cards, .hs-dur {
		color: var(--text-secondary, #94a3b8);
		font-size: 0.8rem;
	}

	/* ── Start Button ── */
	.start-btn {
		padding: 0.875rem 3rem;
		border-radius: 12px;
		border: none;
		background: var(--accent-primary, #3b82f6);
		color: white;
		font-size: 1.1rem;
		font-weight: 700;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.start-btn:active {
		opacity: 0.85;
	}

	/* ── Countdown ── */
	.countdown-overlay {
		position: absolute;
		inset: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.countdown-number {
		font-size: 8rem;
		font-weight: 800;
		color: white;
		font-family: var(--font-display, 'Syne', sans-serif);
		animation: countdown-pop 0.9s ease-out;
	}

	@keyframes countdown-pop {
		0% { transform: scale(0.5); opacity: 0; }
		30% { transform: scale(1.2); opacity: 1; }
		100% { transform: scale(1); opacity: 0.3; }
	}

	.scanner-bg {
		position: absolute;
		inset: 0;
	}

	/* ── Game HUD ── */
	.game-hud {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 20;
		pointer-events: none;
	}

	.timer-bar-track {
		height: 4px;
		background: rgba(255, 255, 255, 0.1);
	}

	.timer-bar-track.pulse {
		animation: timer-pulse 0.5s ease-in-out infinite;
	}

	.timer-bar-fill {
		height: 100%;
		transition: width 0.1s linear;
		border-radius: 0 2px 2px 0;
	}

	@keyframes timer-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.6; }
	}

	.hud-stats {
		display: flex;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
	}

	.hud-cards {
		font-size: 0.85rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.8);
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
	}

	.hud-time {
		font-size: 0.85rem;
		font-weight: 700;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
	}

	.hud-score {
		font-size: 1.25rem;
		font-weight: 800;
		color: white;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
	}

	/* ── Speed Toasts ── */
	.speed-toasts {
		position: absolute;
		top: 3rem;
		right: 0.75rem;
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		pointer-events: none;
	}

	.speed-toast {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.6rem;
		background: rgba(0, 0, 0, 0.7);
		border-radius: 6px;
		font-size: 0.8rem;
		font-weight: 600;
		animation: toast-slide 0.8s ease-out forwards;
	}

	.toast-name {
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toast-points {
		color: white;
		font-weight: 800;
	}

	@keyframes toast-slide {
		0% { transform: translateX(20px); opacity: 0; }
		15% { transform: translateX(0); opacity: 1; }
		70% { opacity: 1; }
		100% { opacity: 0; transform: translateY(-10px); }
	}

	/* ── Results Screen ── */
	.results-overlay {
		flex: 1;
		overflow-y: auto;
		background: var(--bg-base, #070b14);
	}

	.results-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2rem 1.5rem;
		gap: 1rem;
	}

	.results-title {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1.5rem;
		font-weight: 800;
		color: var(--text-primary, #e2e8f0);
		margin: 0;
	}

	.new-hs-badge {
		padding: 0.3rem 0.75rem;
		border-radius: 8px;
		background: rgba(245, 158, 11, 0.15);
		border: 1px solid rgba(245, 158, 11, 0.4);
		color: #F59E0B;
		font-size: 0.85rem;
		font-weight: 700;
		animation: badge-pop 0.4s ease-out;
	}

	@keyframes badge-pop {
		0% { transform: scale(0.7); opacity: 0; }
		60% { transform: scale(1.05); }
		100% { transform: scale(1); opacity: 1; }
	}

	.score-display {
		font-size: 4rem;
		font-weight: 900;
		color: var(--accent-primary, #3b82f6);
		line-height: 1;
		font-family: var(--font-display, 'Syne', sans-serif);
	}

	.score-label {
		font-size: 0.9rem;
		color: var(--text-secondary, #94a3b8);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-top: -0.5rem;
	}

	.results-stats {
		display: flex;
		gap: 1.5rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.result-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
	}

	.rs-value {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text-primary, #e2e8f0);
	}

	.rs-label {
		font-size: 0.7rem;
		color: var(--text-secondary, #94a3b8);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		text-align: center;
	}

	/* ── Tier Breakdown ── */
	.tier-breakdown {
		width: 100%;
		max-width: 320px;
		background: var(--bg-surface, #0d1524);
		border-radius: 12px;
		padding: 1rem;
	}

	.tier-breakdown h3 {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.tier-bars {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.tier-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
	}

	.tier-name {
		color: var(--text-secondary, #94a3b8);
	}

	.tier-count {
		font-weight: 700;
		color: var(--text-primary, #e2e8f0);
	}

	/* ── Scan Log ── */
	.scan-log {
		width: 100%;
		max-width: 320px;
		background: var(--bg-surface, #0d1524);
		border-radius: 12px;
		padding: 1rem;
	}

	.scan-log h3 {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.log-list {
		max-height: 200px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.log-entry {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
	}

	.log-index {
		color: var(--text-tertiary, #475569);
		min-width: 1.5rem;
	}

	.log-name {
		flex: 1;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.log-points {
		font-weight: 700;
		color: var(--text-primary, #e2e8f0);
	}

	.log-time {
		color: var(--text-tertiary, #475569);
		font-size: 0.75rem;
	}

	/* ── Results Actions ── */
	.results-actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.back-link {
		font-size: 0.9rem;
		color: var(--text-secondary, #94a3b8);
		text-decoration: none;
	}

	.back-link:hover {
		color: var(--text-primary, #e2e8f0);
	}
</style>
