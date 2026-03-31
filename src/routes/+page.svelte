<script lang="ts">
	import { browser } from '$app/environment';
	import { scanImage, scanState, resetScanner, initScanner } from '$lib/stores/scanner.svelte';
	import ScanConfirmation from '$lib/components/ScanConfirmation.svelte';
	import { onMount } from 'svelte';
	import { scanHistory } from '$lib/stores/scan-history.svelte';
	import { personaWeights, personaLoaded, isDefaultPersona, updatePersona, type PersonaId, type PersonaWeights } from '$lib/stores/persona.svelte';
	import { getSuggestedPersona, pruneBehaviorEvents, trackBehavior } from '$lib/services/behavior-tracker';
	import type { ScanResult } from '$lib/types';
	import { getOptimizedImageUrls, getCardImageUrl } from '$lib/utils/image-url';
	import { collectionCount as getCollectionCount } from '$lib/stores/collection.svelte';

	const RARITY_COLORS: Record<string, string> = {
		common: '#94a3b8',
		uncommon: '#4ade80',
		rare: '#3b82f6',
		ultra_rare: '#a855f7',
		legendary: '#f59e0b'
	};

	function getRarityColor(cardId: string | null | undefined): string {
		// Without a card lookup, default to common
		// Once card-db is wired, look up rarity from cardId
		return RARITY_COLORS.common;
	}

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

	// Persona suggestion state
	let suggestedPersona = $state<PersonaWeights | null>(null);
	let suggestionDismissed = $state(false);

	const PERSONA_LABELS: Record<PersonaId, string> = {
		collector: 'Collector',
		deck_builder: 'Deck Builder',
		seller: 'Seller',
		tournament: 'Tournament Player'
	};

	const suggestedPrimary = $derived.by(() => {
		if (!suggestedPersona) return null;
		const entries = Object.entries(suggestedPersona) as [PersonaId, number][];
		const top = entries.filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
		return top[0]?.[0] || null;
	});

	const currentPrimary = $derived.by(() => {
		const w = personaWeights();
		const entries = Object.entries(w) as [PersonaId, number][];
		const top = entries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
		return top[0]?.[0] || 'collector';
	});

	const showSuggestion = $derived(
		suggestedPersona !== null &&
		!suggestionDismissed &&
		suggestedPrimary !== null &&
		suggestedPrimary !== currentPrimary &&
		data.user
	);

	async function applySuggestedPersona() {
		if (!suggestedPersona) return;
		await updatePersona(suggestedPersona);
		suggestionDismissed = true;
	}

	onMount(() => {
		initScanner();

		// Prune old behavioral events and check for persona suggestions
		if (data.user) {
			pruneBehaviorEvents();
			getSuggestedPersona().then((suggested) => {
				if (suggested) suggestedPersona = suggested;
			});
		}
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

		trackBehavior('scan_card');
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
		} catch (err) {
			console.error('[home] Upload scan error:', err);
			uploadResult = {
				card_id: null,
				card: null,
				scan_method: 'claude',
				confidence: 0,
				processing_ms: 0,
				failReason: 'Scan failed — please try again'
			};
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
		trackBehavior('lookup_tournament');
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
			case 'tier1': return 'Checking memory...';
			case 'tier2': return 'Reading card number...';
			case 'tier3': return 'AI analyzing card...';
			case 'processing': return 'Processing...';
			case 'error': return state.error || 'Scan failed';
			default: return '';
		}
	});

	const recentScans = $derived(scanHistory().filter(s => s.success).slice(0, 5));
	const collectionCount = $derived(getCollectionCount());

	function timeAgo(timestamp: number): string {
		const seconds = Math.floor((Date.now() - timestamp) / 1000);
		if (seconds < 60) return 'Just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	// ── Content Block Ordering ──────────────────────────────────

	interface HomeBlock {
		id: string;
		personaAffinity: Partial<PersonaWeights>;
		/** Minimum persona weight to show (0 = always) */
		threshold: number;
		/** Tiebreak sort order */
		basePriority: number;
	}

	const HOME_BLOCKS: HomeBlock[] = [
		{ id: 'scan_hero', personaAffinity: { collector: 1, deck_builder: 0.5, seller: 0.8, tournament: 0.3 }, threshold: 0, basePriority: 0 },
		{ id: 'recent_scans', personaAffinity: { collector: 0.8, deck_builder: 0.3, seller: 0.3, tournament: 0.2 }, threshold: 0, basePriority: 10 },
		{ id: 'tournaments', personaAffinity: { tournament: 1, deck_builder: 0.3, collector: 0.2 }, threshold: 0, basePriority: 15 },
		{ id: 'quick_actions', personaAffinity: { collector: 0.8, deck_builder: 0.8, seller: 0.5, tournament: 0.3 }, threshold: 0, basePriority: 20 },
	];

	function sortBlocksForUser(blocks: HomeBlock[], persona: PersonaWeights): string[] {
		return blocks
			.filter((block) => {
				if (block.threshold === 0) return true;
				for (const [personaId, affinity] of Object.entries(block.personaAffinity)) {
					const userWeight = persona[personaId as PersonaId] || 0;
					if (userWeight >= block.threshold && (affinity as number) > 0) return true;
				}
				return false;
			})
			.sort((a, b) => {
				const scoreA = Object.entries(a.personaAffinity).reduce(
					(sum, [pid, aff]) => sum + (persona[pid as PersonaId] || 0) * ((aff as number) || 0), 0
				);
				const scoreB = Object.entries(b.personaAffinity).reduce(
					(sum, [pid, aff]) => sum + (persona[pid as PersonaId] || 0) * ((aff as number) || 0), 0
				);
				if (scoreB !== scoreA) return scoreB - scoreA;
				return a.basePriority - b.basePriority;
			})
			.map((b) => b.id);
	}

	// ── Custom ordering (drag-and-drop) ─────────────────────────

	let showCustomize = $state(false);
	let customOrder = $state<string[] | null>(null);
	let dragIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	const BLOCK_LABELS: Record<string, string> = {
		scan_hero: 'Scan Card',
		recent_scans: 'Recent Scans',
		tournaments: 'Tournaments',
		quick_actions: 'Quick Actions'
	};

	// Load custom order from localStorage on mount
	$effect(() => {
		if (data.user && browser) {
			try {
				const saved = localStorage.getItem('boba:home_block_order');
				if (saved) customOrder = JSON.parse(saved);
			} catch { /* ignore */ }
		}
	});

	const orderedBlocks = $derived.by(() => {
		if (customOrder && data.user) return customOrder;
		if (data.user && personaLoaded()) return sortBlocksForUser(HOME_BLOCKS, personaWeights());
		return HOME_BLOCKS.map((b) => b.id);
	});

	function handleDragStart(index: number) {
		dragIndex = index;
	}

	function handleDragOver(index: number) {
		dragOverIndex = index;
	}

	function handleDrop(index: number) {
		if (dragIndex === null || dragIndex === index) {
			dragIndex = null;
			dragOverIndex = null;
			return;
		}
		const items = [...(customOrder || orderedBlocks)];
		const [moved] = items.splice(dragIndex, 1);
		items.splice(index, 0, moved);
		customOrder = items;
		localStorage.setItem('boba:home_block_order', JSON.stringify(items));
		dragIndex = null;
		dragOverIndex = null;
	}

	function resetCustomOrder() {
		customOrder = null;
		localStorage.removeItem('boba:home_block_order');
		showCustomize = false;
	}
</script>

<svelte:head>
	<title>BOBA Scanner | AI-Powered Card Recognition</title>
</svelte:head>

<div class="dashboard">
	{#if data.user}
		<!-- Upload scan result overlay -->
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

		<!-- Persona suggestion banner -->
		{#if showSuggestion && suggestedPrimary}
			<div class="persona-suggestion">
				<p class="persona-suggestion-text">
					Based on your activity, you might prefer a <strong>{PERSONA_LABELS[suggestedPrimary]}</strong> layout.
				</p>
				<div class="persona-suggestion-actions">
					<button class="btn-suggestion-apply" onclick={applySuggestedPersona}>Switch</button>
					<button class="btn-suggestion-dismiss" onclick={() => suggestionDismissed = true}>Dismiss</button>
				</div>
			</div>
		{/if}

		<!-- Customize button -->
		<div class="customize-strip">
			<button class="btn-customize" onclick={() => showCustomize = true}>
				<span class="drag-handle">{'\u2630'}</span> Customize
			</button>
		</div>

		<!-- Customize modal -->
		{#if showCustomize}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div class="customize-overlay" onclick={() => showCustomize = false}>
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div class="customize-sheet" onclick={(e) => e.stopPropagation()}>
					<div class="customize-header">
						<h3>Reorder Home Screen</h3>
						<button class="btn-customize-close" onclick={() => showCustomize = false}>{'\u2715'}</button>
					</div>
					<ul class="customize-list">
						{#each (customOrder || orderedBlocks) as blockId, i (blockId)}
							<li
								class="customize-item"
								class:dragging={dragIndex === i}
								class:drag-over={dragOverIndex === i}
								draggable="true"
								ondragstart={() => handleDragStart(i)}
								ondragover={(e) => { e.preventDefault(); handleDragOver(i); }}
								ondrop={() => handleDrop(i)}
								ondragend={() => { dragIndex = null; dragOverIndex = null; }}
							>
								<span class="drag-handle">{'\u2630'}</span>
								<span class="customize-item-label">{BLOCK_LABELS[blockId] || blockId}</span>
							</li>
						{/each}
					</ul>
					{#if customOrder}
						<button class="btn-suggestion-dismiss" style="margin-top: 1rem; width: 100%; text-align: center;" onclick={resetCustomOrder}>
							Reset to Auto
						</button>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Content blocks -->
		{#each orderedBlocks as blockId, i (blockId)}
			<div class="block-entrance" style="animation-delay: {60 * i}ms">

			{#if blockId === 'scan_hero'}
				<!-- HERO SCAN CARD -->
				<div class="scan-hero-card">
					<a href="/scan" class="scan-hero-btn" aria-label="Scan a card">
						<span class="scan-hero-icon">📷</span>
					</a>
					<div class="scan-hero-text">
						<div class="scan-hero-title">Scan a Card</div>
						<div class="scan-hero-desc">Point your camera at any BoBA card to identify it instantly</div>
						<div class="scan-hero-actions">
							<button class="btn-hero-secondary" onclick={handleUploadClick} disabled={uploading}>
								Upload Photo
							</button>
							<a href="/scan?mode=roll" class="btn-hero-secondary">Camera Roll</a>
						</div>
					</div>
					<input
						bind:this={fileInput}
						type="file"
						accept="image/jpeg,image/png,image/webp"
						onchange={handleFileSelected}
						hidden
					/>
				</div>

			{:else if blockId === 'recent_scans'}
				<!-- RECENT SCANS -->
				{#if recentScans.length > 0}
					<div class="section-block">
						<div class="section-header">
							<h2 class="section-heading">Recent Scans</h2>
						</div>
						<div class="recent-scans-strip">
							{#each recentScans as scan}
								{@const resolvedImageUrl = scan.imageUrl || (scan.cardId ? getCardImageUrl({ id: scan.cardId }) : null)}
								{@const isDataUrl = resolvedImageUrl?.startsWith('data:')}
								<div class="scan-card">
									<div class="scan-card-image">
										{#if resolvedImageUrl}
											{@const urls = isDataUrl ? { avif: null, webp: null, fallback: resolvedImageUrl, width: 100 } : getOptimizedImageUrls(resolvedImageUrl, 'thumb')}
											<picture>
												{#if urls.avif}<source srcset={urls.avif} type="image/avif" />{/if}
												{#if urls.webp}<source srcset={urls.webp} type="image/webp" />{/if}
												<img
													src={urls.fallback}
													alt={scan.heroName || scan.cardNumber || 'Card'}
													class="scan-card-img"
													loading="lazy"
													onerror={(e) => {
														const img = e.currentTarget as HTMLImageElement;
														img.style.display = 'none';
														const next = img.parentElement?.querySelector('.scan-card-fallback') as HTMLElement;
														if (next) next.style.display = 'flex';
													}}
												/>
											</picture>
											<div class="scan-card-fallback" style="display:none">🎴</div>
										{:else}
											<div class="scan-card-fallback">🎴</div>
										{/if}
									</div>
									<div class="scan-card-info">
										<span class="scan-card-name">{scan.heroName || scan.cardNumber || 'Unknown'}</span>
										<span class="scan-card-time">{timeAgo(scan.timestamp)}</span>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

			{:else if blockId === 'tournaments'}
				<!-- TOURNAMENTS -->
				<div class="section-block">
					<h2 class="section-heading">Tournaments</h2>

					<div class="tournament-code-strip">
						<input
							type="text"
							class="tournament-code-input"
							bind:value={tournamentCode}
							placeholder="Enter tournament code"
							maxlength="8"
							autocapitalize="characters"
							spellcheck="false"
							onkeydown={(e) => { if (e.key === 'Enter') lookupTournament(); }}
						/>
						<button class="btn-tournament-join" onclick={lookupTournament} disabled={tournamentLoading || tournamentCode.trim().length !== 8}>
							{tournamentLoading ? '...' : 'Join'}
						</button>
					</div>

					{#if tournamentError}
						<p class="tournament-error">{tournamentError}</p>
					{/if}

					{#if tournamentResult}
						<div class="tournament-result-card">
							<div class="tournament-result-header">
								<div>
									<div class="tournament-result-name">{tournamentResult.name}</div>
									<div class="tournament-result-meta">
										{tournamentResult.code} · Heroes: {tournamentResult.max_heroes} · Plays: {tournamentResult.max_plays}
									</div>
								</div>
								<span class="tournament-status-badge">Open</span>
							</div>
							<a href="/tournaments/enter?code={tournamentResult.code}" class="btn-tournament-enter">Enter Tournament</a>
						</div>
					{/if}

					<a href="/tournaments" class="link-subtle">Browse all tournaments →</a>
				</div>

			{:else if blockId === 'quick_actions'}
				<!-- QUICK ACTIONS GRID -->
				<div class="section-block">
					<h2 class="section-heading">Quick Actions</h2>
					<div class="actions-grid">
						<a href="/collection" class="action-tile">
							<span class="action-icon">📦</span>
							<div class="action-text">
								<span class="action-label">Collection</span>
								<span class="action-sub">View & manage</span>
							</div>
						</a>
						<a href="/deck" class="action-tile">
							<span class="action-icon">🃏</span>
							<div class="action-text">
								<span class="action-label">My Decks</span>
								<span class="action-sub">Build & edit</span>
							</div>
						</a>
						<a href="/set-completion" class="action-tile">
							<span class="action-icon">📊</span>
							<div class="action-text">
								<span class="action-label">Set Progress</span>
								<span class="action-sub">Track completion</span>
							</div>
						</a>
						<a href="/deck/architect" class="action-tile">
							<span class="action-icon">🧠</span>
							<div class="action-text">
								<span class="action-label">Playbook</span>
								<span class="action-sub">Architect</span>
							</div>
						</a>
					</div>
				</div>
			{/if}

			</div>
		{/each}

	{:else}
		<!-- UNAUTHENTICATED LANDING -->
		<div class="landing-hero">
			<h1 class="landing-title">BOBA Scanner</h1>
			<p class="landing-subtitle">Scan any BoBA card. See what it's worth instantly.</p>
			<a href="/scan" class="landing-cta">Scan a Card</a>
			<p class="landing-note">No sign-in required — try it free.</p>
		</div>

		<div class="section-block" style="margin-top: 2rem;">
			<h2 class="section-heading">Entering a Tournament?</h2>
			<div class="tournament-code-strip">
				<input
					type="text"
					class="tournament-code-input"
					bind:value={tournamentCode}
					placeholder="ABCD1234"
					maxlength="8"
					autocapitalize="characters"
					spellcheck="false"
					onkeydown={(e) => { if (e.key === 'Enter') lookupTournament(); }}
				/>
				<button class="btn-tournament-join" onclick={lookupTournament} disabled={tournamentLoading || tournamentCode.trim().length !== 8}>
					{tournamentLoading ? 'Looking up...' : 'Join'}
				</button>
			</div>
			{#if tournamentError}
				<p class="tournament-error">{tournamentError}</p>
			{/if}
			{#if tournamentResult}
				<div class="tournament-result-card">
					<div class="tournament-result-header">
						<div>
							<div class="tournament-result-name">{tournamentResult.name}</div>
							<div class="tournament-result-meta">
								{tournamentResult.code} · Heroes: {tournamentResult.max_heroes} · Plays: {tournamentResult.max_plays}
							</div>
						</div>
					</div>
					<a href="/auth/login?redirectTo=/tournaments/enter?code={tournamentResult.code}" class="btn-tournament-enter">Sign in to Enter</a>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.dashboard {
		max-width: 600px;
		margin: 0 auto;
		padding: 0.5rem 1rem 1.5rem;
	}

	/* Entrance animation */
	.block-entrance {
		animation: slideUpFade 0.4s ease-out both;
	}

	@keyframes slideUpFade {
		from { opacity: 0; transform: translateY(16px); }
		to { opacity: 1; transform: translateY(0); }
	}

	/* Section block spacing */
	.section-block {
		margin-bottom: 1.5rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.625rem;
	}

	.section-heading {
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted, #64748b);
		margin: 0 0 0.625rem;
	}

	/* HERO SCAN CARD */
	.scan-hero-card {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		padding: 1.25rem 1.25rem;
		background: linear-gradient(135deg, rgba(245,158,11,0.06), rgba(59,130,246,0.03));
		border: 1px solid rgba(245,158,11,0.12);
		border-radius: var(--radius-xl, 16px);
		margin-bottom: 1.5rem;
	}

	.scan-hero-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 72px;
		height: 72px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--gold, #f59e0b), var(--gold-dark, #d97706));
		flex-shrink: 0;
		text-decoration: none;
		box-shadow: 0 0 0 0 rgba(245,158,11,0.3), var(--shadow-gold, 0 4px 20px rgba(245,158,11,0.35));
		animation: scanBreathe 3s ease-in-out infinite;
		transition: transform 0.12s ease;
	}

	.scan-hero-btn:active {
		transform: scale(0.93);
		animation: none;
	}

	@keyframes scanBreathe {
		0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.3), 0 4px 20px rgba(245,158,11,0.35); }
		50% { box-shadow: 0 0 0 12px rgba(245,158,11,0), 0 8px 32px rgba(245,158,11,0.45); }
	}

	.scan-hero-icon {
		font-size: 1.75rem;
		filter: brightness(0.2);
	}

	.scan-hero-text {
		flex: 1;
		min-width: 0;
	}

	.scan-hero-title {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1.1rem;
		font-weight: 700;
		margin-bottom: 0.2rem;
	}

	.scan-hero-desc {
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
		line-height: 1.35;
		margin-bottom: 0.625rem;
	}

	.scan-hero-actions {
		display: flex;
		gap: 0.5rem;
	}

	.btn-hero-secondary {
		padding: 0.375rem 0.75rem;
		border-radius: var(--radius-md, 8px);
		background: var(--bg-elevated, #121d34);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		color: var(--text-secondary, #94a3b8);
		font-size: 0.75rem;
		font-weight: 500;
		text-decoration: none;
		cursor: pointer;
		transition: border-color var(--transition-fast, 150ms), color var(--transition-fast, 150ms);
	}

	.btn-hero-secondary:hover {
		border-color: var(--border-strong, rgba(148,163,184,0.20));
		color: var(--text-primary, #e2e8f0);
	}

	.btn-hero-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* RECENT SCANS */
	.recent-scans-strip {
		display: flex;
		gap: 0.625rem;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		padding-bottom: 0.25rem;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
	}

	.recent-scans-strip::-webkit-scrollbar {
		display: none;
	}

	.scan-card {
		flex-shrink: 0;
		scroll-snap-align: start;
		width: 100px;
		border-radius: var(--radius-lg, 12px);
		overflow: hidden;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border, rgba(148,163,184,0.06));
		cursor: pointer;
		transition: transform 0.12s ease;
	}

	.scan-card:active {
		transform: scale(0.96);
	}

	.scan-card-image {
		width: 100%;
		aspect-ratio: 5 / 7;
		background: linear-gradient(135deg, var(--bg-elevated, #0f172a), rgba(148,163,184,0.03));
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.scan-card-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.scan-card-fallback {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
	}

	.scan-card-info {
		padding: 0.375rem 0.5rem;
	}

	.scan-card-name {
		display: block;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-primary, #e2e8f0);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.scan-card-time {
		font-size: 0.6rem;
		color: var(--text-muted, #475569);
	}

	/* TOURNAMENTS */
	.tournament-code-strip {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.tournament-code-input {
		flex: 1;
		padding: 0.625rem 0.875rem;
		border-radius: var(--radius-md, 10px);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		background: var(--bg-base, #070b14);
		color: var(--text-primary, #e2e8f0);
		font-family: var(--font-mono, monospace);
		font-size: 0.9rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.tournament-code-input::placeholder {
		text-transform: none;
		letter-spacing: 0.02em;
		color: var(--text-muted, #475569);
		opacity: 0.6;
	}

	.btn-tournament-join {
		padding: 0.625rem 1.25rem;
		background: var(--primary, #3b82f6);
		border: none;
		border-radius: var(--radius-md, 10px);
		color: white;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: opacity var(--transition-fast, 150ms);
	}

	.btn-tournament-join:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.tournament-error {
		color: #ef4444;
		font-size: 0.8rem;
		margin-bottom: 0.75rem;
	}

	.tournament-result-card {
		padding: 0.875rem 1rem;
		background: linear-gradient(135deg, rgba(59,130,246,0.06), rgba(168,85,247,0.03));
		border: 1px solid rgba(59,130,246,0.12);
		border-radius: var(--radius-lg, 14px);
		margin-bottom: 0.75rem;
	}

	.tournament-result-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 0.625rem;
	}

	.tournament-result-name {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.tournament-result-meta {
		font-size: 0.75rem;
		color: var(--text-secondary, #94a3b8);
		margin-top: 0.125rem;
	}

	.tournament-status-badge {
		font-size: 0.65rem;
		font-weight: 700;
		color: #4ade80;
		background: rgba(74,222,128,0.12);
		padding: 0.125rem 0.5rem;
		border-radius: 6px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		flex-shrink: 0;
	}

	.btn-tournament-enter {
		display: block;
		width: 100%;
		padding: 0.5rem;
		background: var(--primary, #3b82f6);
		border: none;
		border-radius: var(--radius-md, 8px);
		color: white;
		font-size: 0.85rem;
		font-weight: 600;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
	}

	.link-subtle {
		display: block;
		font-size: 0.8rem;
		color: var(--text-muted, #475569);
		text-decoration: none;
		margin-top: 0.25rem;
		transition: color var(--transition-fast, 150ms);
	}

	.link-subtle:hover {
		color: var(--text-secondary, #94a3b8);
	}

	/* QUICK ACTIONS GRID */
	.actions-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}

	.action-tile {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 0.875rem;
		background: var(--bg-surface, #0f172a);
		border: 1px solid var(--border, rgba(148,163,184,0.06));
		border-radius: var(--radius-lg, 14px);
		text-decoration: none;
		color: var(--text-primary, #e2e8f0);
		transition: border-color var(--transition-fast, 150ms), background var(--transition-fast, 150ms);
	}

	.action-tile:active {
		transform: scale(0.97);
	}

	.action-tile:hover {
		border-color: var(--border-strong, rgba(148,163,184,0.15));
		background: var(--bg-elevated, #121d34);
	}

	.action-icon {
		font-size: 1.35rem;
		flex-shrink: 0;
	}

	.action-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.action-label {
		font-size: 0.85rem;
		font-weight: 600;
	}

	.action-sub {
		font-size: 0.65rem;
		color: var(--text-muted, #475569);
	}

	/* UPLOAD STATUS */
	.upload-status {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		margin: 1rem 0;
		padding: 1rem;
		border-radius: var(--radius-lg, 12px);
		background: rgba(59, 130, 246, 0.08);
		border: 1px solid rgba(59, 130, 246, 0.15);
		color: var(--text-primary, #e2e8f0);
	}

	.upload-spinner {
		width: 18px;
		height: 18px;
		border: 2px solid rgba(255, 255, 255, 0.2);
		border-top-color: var(--primary, #3b82f6);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	/* UNAUTHENTICATED LANDING */
	.landing-hero {
		text-align: center;
		padding: 2rem 0 1rem;
	}

	.landing-title {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 2.25rem;
		font-weight: 800;
		margin-bottom: 0.5rem;
	}

	.landing-subtitle {
		color: var(--text-secondary, #94a3b8);
		font-size: 1rem;
		margin-bottom: 1.5rem;
	}

	.landing-cta {
		display: block;
		width: 100%;
		max-width: 280px;
		margin: 0 auto;
		padding: 0.875rem 2rem;
		border-radius: var(--radius-lg, 12px);
		background: linear-gradient(135deg, var(--gold, #f59e0b), var(--gold-dark, #d97706));
		color: #0d1524;
		font-size: 1.1rem;
		font-weight: 800;
		text-align: center;
		text-decoration: none;
		box-shadow: var(--shadow-gold, 0 4px 20px rgba(245,158,11,0.35));
	}

	.landing-note {
		font-size: 0.8rem;
		color: var(--text-muted, #475569);
		margin-top: 0.75rem;
		text-align: center;
	}

	/* PERSONA SUGGESTION */
	.persona-suggestion {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0.875rem;
		margin-bottom: 0.5rem;
		border-radius: var(--radius-md, 10px);
		background: rgba(59, 130, 246, 0.06);
		border: 1px solid rgba(59, 130, 246, 0.12);
		font-size: 0.8rem;
	}

	.persona-suggestion-text {
		margin: 0;
		color: var(--text-secondary, #94a3b8);
		text-align: left;
	}

	.persona-suggestion-actions {
		display: flex;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.btn-suggestion-apply {
		padding: 0.25rem 0.625rem;
		border-radius: 6px;
		background: var(--primary, #3b82f6);
		color: white;
		border: none;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-suggestion-dismiss {
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		background: transparent;
		color: var(--text-muted, #475569);
		border: none;
		font-size: 0.75rem;
		cursor: pointer;
	}

	/* CUSTOMIZE */
	.customize-strip {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 0.5rem;
	}

	.btn-customize {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.625rem;
		border-radius: 6px;
		background: transparent;
		border: 1px solid var(--border, rgba(148,163,184,0.08));
		color: var(--text-muted, #475569);
		font-size: 0.7rem;
		cursor: pointer;
		transition: color var(--transition-fast, 150ms), border-color var(--transition-fast, 150ms);
	}

	.btn-customize:hover {
		color: var(--text-primary, #e2e8f0);
		border-color: var(--text-muted, #475569);
	}

	.customize-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: 100;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.customize-sheet {
		width: 100%;
		max-width: 500px;
		max-height: 60vh;
		background: var(--bg-elevated, #121d34);
		border-radius: 16px 16px 0 0;
		padding: 1.25rem 1rem 2rem;
		overflow-y: auto;
	}

	.customize-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	.customize-header h3 {
		margin: 0;
		font-size: 0.95rem;
	}

	.btn-customize-close {
		background: none;
		border: none;
		color: var(--text-muted, #475569);
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0.25rem;
	}

	.customize-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.customize-item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border, rgba(148,163,184,0.08));
		cursor: grab;
		touch-action: none;
		user-select: none;
		font-size: 0.85rem;
	}

	.customize-item.dragging { opacity: 0.5; border-color: var(--primary, #3b82f6); }
	.customize-item.drag-over { border-color: var(--gold, #f59e0b); }

	.drag-handle {
		color: var(--text-muted, #475569);
		font-size: 0.9rem;
		flex-shrink: 0;
	}

	/* RESPONSIVE */
	@media (max-width: 360px) {
		.scan-hero-card {
			flex-direction: column;
			text-align: center;
		}

		.scan-hero-actions {
			justify-content: center;
		}

		.actions-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 600px) {
		.persona-suggestion {
			flex-direction: column;
			text-align: center;
		}
	}
</style>
