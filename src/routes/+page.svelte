<script lang="ts">
	import { browser } from '$app/environment';
	import { scanImage, scanState, resetScanner, initScanner } from '$lib/stores/scanner.svelte';
	import ScanConfirmation from '$lib/components/ScanConfirmation.svelte';
	import { onMount } from 'svelte';
	import { scanHistory } from '$lib/stores/scan-history.svelte';
	import { personaWeights, personaLoaded, isDefaultPersona, updatePersona, type PersonaId, type PersonaWeights } from '$lib/stores/persona.svelte';
	import { getSuggestedPersona, pruneBehaviorEvents, trackBehavior } from '$lib/services/behavior-tracker';
	import type { ScanResult } from '$lib/types';
	import { getOptimizedImageUrls } from '$lib/utils/image-url';

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
		// Universal
		{ id: 'scan_upload', personaAffinity: { collector: 1, deck_builder: 0.5, seller: 0.8, tournament: 0.3 }, threshold: 0, basePriority: 0 },

		// Collector
		{ id: 'recent_scans', personaAffinity: { collector: 0.8, deck_builder: 0.3, seller: 0.3, tournament: 0.2 }, threshold: 0, basePriority: 10 },
		{ id: 'collection_summary', personaAffinity: { collector: 1, seller: 0.5 }, threshold: 0.3, basePriority: 20 },

		// Deck Builder
		{ id: 'active_decks', personaAffinity: { deck_builder: 1, tournament: 0.7, collector: 0.3 }, threshold: 0, basePriority: 15 },

		// Seller
		{ id: 'sell_link', personaAffinity: { seller: 1, collector: 0.2 }, threshold: 0.3, basePriority: 25 },

		// Tournament
		{ id: 'tournament_lookup', personaAffinity: { tournament: 1, deck_builder: 0.3 }, threshold: 0, basePriority: 30 },
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
		scan_upload: 'Scan & Upload',
		recent_scans: 'Recent Scans',
		collection_summary: 'Collection',
		active_decks: 'Decks',
		sell_link: 'Sell & Export',
		tournament_lookup: 'Tournaments'
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
	<section class="hero-section">
		<h1>BOBA Scanner</h1>

		{#if data.user}
			<!-- Persona adaptation suggestion -->
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

			<!-- Persona-ordered content blocks -->
			{#each orderedBlocks as blockId (blockId)}
				{#if blockId === 'scan_upload'}
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

				{:else if blockId === 'recent_scans'}
					<div class="recent-scans">
						<h2 class="section-heading">Recent Scans</h2>
						{#if recentScans.length > 0}
							<div class="recent-scans-strip">
								{#each recentScans as scan}
									<div class="recent-scan-card">
										{#if scan.imageUrl}
											{@const urls = getOptimizedImageUrls(scan.imageUrl, 'thumb')}
											<picture class="recent-scan-image-wrap">
												{#if urls.avif}<source srcset={urls.avif} type="image/avif" />{/if}
												{#if urls.webp}<source srcset={urls.webp} type="image/webp" />{/if}
												<img
													src={urls.fallback}
													alt={scan.heroName || scan.cardNumber || 'Card'}
													class="recent-scan-image"
													loading="lazy"
													width={urls.width}
												/>
											</picture>
										{:else}
											<div class="recent-scan-placeholder">{'\u{1F3B4}'}</div>
										{/if}
										<span class="recent-scan-name">{scan.heroName || scan.cardNumber || 'Unknown'}</span>
									</div>
								{/each}
							</div>
						{:else}
							<p class="recent-scans-empty">Scan your first card to see it here.</p>
						{/if}
					</div>

				{:else if blockId === 'collection_summary'}
					<div class="block-link-card">
						<a href="/collection" class="block-link">
							<span class="block-link-icon">{'\u{1F4E6}'}</span>
							<span>My Collection</span>
							<span class="block-link-arrow">&rarr;</span>
						</a>
						<a href="/set-completion" class="block-link sub-link">
							<span class="block-link-icon">{'\u{1F4CA}'}</span>
							<span>Set Completion</span>
							<span class="block-link-arrow">&rarr;</span>
						</a>
					</div>

				{:else if blockId === 'active_decks'}
					<div class="block-link-card">
						<a href="/deck" class="block-link">
							<span class="block-link-icon">{'\u{1F0CF}'}</span>
							<span>My Decks</span>
							<span class="block-link-arrow">&rarr;</span>
						</a>
						<a href="/deck/architect" class="block-link sub-link">
							<span class="block-link-icon">{'\u{1F9E0}'}</span>
							<span>Playbook Architect</span>
							<span class="block-link-arrow">&rarr;</span>
						</a>
					</div>

				{:else if blockId === 'sell_link'}
					<div class="block-link-card">
						<a href="/sell" class="block-link">
							<span class="block-link-icon">{'\u{1F4B0}'}</span>
							<span>Sell Cards</span>
							<span class="block-link-arrow">&rarr;</span>
						</a>
						<a href="/export" class="block-link sub-link">
							<span class="block-link-icon">{'\u{1F4E4}'}</span>
							<span>Export Collection</span>
							<span class="block-link-arrow">&rarr;</span>
						</a>
					</div>

				{:else if blockId === 'tournament_lookup'}
					<div class="tournament-block">
						<h2 class="section-heading">Tournaments</h2>
						<form class="tournament-lookup-form" onsubmit={(e) => { e.preventDefault(); lookupTournament(); }}>
							<input
								type="text"
								class="tournament-code-input"
								bind:value={tournamentCode}
								placeholder="Enter code"
								maxlength="8"
								autocapitalize="characters"
								spellcheck="false"
							/>
							<button type="submit" class="btn-primary" disabled={tournamentLoading || tournamentCode.trim().length !== 8}>
								{tournamentLoading ? '...' : 'Look Up'}
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
								<a href="/tournaments/enter?code={tournamentResult.code}" class="btn-primary btn-small-cta">Enter Tournament</a>
							</div>
						{/if}
						<a href="/tournaments" class="block-link sub-link" style="margin-top: 0.5rem;">
							<span class="block-link-icon">{'\u{1F3C6}'}</span>
							<span>Browse Tournaments</span>
							<span class="block-link-arrow">&rarr;</span>
						</a>
					</div>
				{/if}
			{/each}

		{:else}
			<!-- Unauthenticated landing -->
			<p class="hero-subtitle">Scan any BoBA card. See what it's worth instantly.</p>

			<div class="cta-section">
				<a href="/scan" class="btn-scan-cta">Scan a Card</a>
				<p class="cta-note">No sign-in required — try it free.</p>
			</div>

			<!-- Tournament code entry for guests -->
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
						<a href="/auth/login?redirectTo=/tournaments/enter?code={tournamentResult.code}" class="btn-primary btn-small-cta">Sign in to Enter</a>
					</div>
				{/if}
			</section>
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

	/* Section heading */
	.section-heading {
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #475569);
		margin-bottom: 0.75rem;
		text-align: left;
	}

	/* Recent scans */
	.recent-scans {
		margin-top: 1.5rem;
		text-align: left;
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

	.recent-scan-image-wrap {
		display: block;
		width: 64px;
		height: 80px;
		margin: 0 auto 0.25rem;
		border-radius: 8px;
		overflow: hidden;
	}

	.recent-scan-image {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 8px;
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

	/* Block link cards */
	.block-link-card {
		margin-top: 1rem;
	}

	.block-link {
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

	.block-link:hover {
		border-color: var(--gold, #f59e0b);
	}

	.block-link.sub-link {
		margin-top: 0.375rem;
		background: transparent;
		border-color: transparent;
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-secondary, #94a3b8);
	}

	.block-link.sub-link:hover {
		color: var(--text-primary, #e2e8f0);
		border-color: transparent;
		background: var(--bg-elevated, #121d34);
	}

	.block-link-icon {
		font-size: 1.25rem;
	}

	.block-link-arrow {
		margin-left: auto;
		color: var(--text-muted, #475569);
	}

	/* Tournament block */
	.tournament-block {
		margin-top: 1.5rem;
		text-align: left;
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
		text-align: center;
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

	/* Persona suggestion */
	.persona-suggestion {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 1rem;
		margin: 1rem auto 0;
		max-width: 500px;
		border-radius: 10px;
		background: rgba(59, 130, 246, 0.08);
		border: 1px solid rgba(59, 130, 246, 0.2);
		font-size: 0.85rem;
	}

	.persona-suggestion-text {
		margin: 0;
		color: var(--text-secondary, #94a3b8);
		text-align: left;
	}

	.persona-suggestion-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.btn-suggestion-apply {
		padding: 0.25rem 0.75rem;
		border-radius: 6px;
		background: var(--accent-primary, #3b82f6);
		color: white;
		border: none;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-suggestion-dismiss {
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		background: transparent;
		color: var(--text-muted, #475569);
		border: none;
		font-size: 0.8rem;
		cursor: pointer;
	}

	/* Customize button */
	.customize-strip {
		display: flex;
		justify-content: flex-end;
		margin: 1rem auto 0;
		max-width: 500px;
	}

	.btn-customize {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.75rem;
		border-radius: 6px;
		background: transparent;
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		color: var(--text-muted, #475569);
		font-size: 0.75rem;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.btn-customize:hover {
		color: var(--text-primary, #e2e8f0);
		border-color: var(--text-muted, #475569);
	}

	/* Customize modal */
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
		max-height: 70vh;
		background: var(--bg-elevated, #121d34);
		border-radius: 16px 16px 0 0;
		padding: 1.25rem 1rem 2rem;
		overflow-y: auto;
	}

	.customize-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.customize-header h3 {
		margin: 0;
		font-size: 1rem;
	}

	.btn-customize-close {
		background: none;
		border: none;
		color: var(--text-muted, #475569);
		font-size: 1.25rem;
		cursor: pointer;
		padding: 0.25rem;
	}

	.customize-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.customize-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		border-radius: 8px;
		background: var(--bg-surface, #0d1524);
		border: 1px solid var(--border, rgba(148,163,184,0.10));
		cursor: grab;
		touch-action: none;
		user-select: none;
	}

	.customize-item.dragging {
		opacity: 0.5;
		border-color: var(--accent-primary, #3b82f6);
	}

	.customize-item.drag-over {
		border-color: var(--gold, #f59e0b);
	}

	.drag-handle {
		color: var(--text-muted, #475569);
		font-size: 1rem;
		flex-shrink: 0;
	}

	.customize-item-label {
		font-size: 0.9rem;
		font-weight: 500;
	}

	@media (max-width: 600px) {
		.hero-section h1 {
			font-size: 2rem;
		}

		.persona-suggestion {
			flex-direction: column;
			text-align: center;
		}
	}
</style>
