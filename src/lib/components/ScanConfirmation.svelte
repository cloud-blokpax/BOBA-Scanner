<script lang="ts">
	import { addToCollection, ownedCardCounts } from '$lib/stores/collection';
	import { triggerHaptic } from '$lib/utils/haptics';
	import CardFlipReveal from '$lib/components/CardFlipReveal.svelte';
	import type { ScanResult } from '$lib/types';

	let {
		result,
		capturedImageUrl,
		onScanAnother,
		onClose,
		isAuthenticated = true
	}: {
		result: ScanResult;
		capturedImageUrl: string | null;
		onScanAnother: () => void;
		onClose: () => void;
		isAuthenticated?: boolean;
	} = $props();

	let adding = $state(false);
	let addError = $state<string | null>(null);
	let addSuccess = $state(false);
	let showConfetti = $state(false);

	const card = $derived(result.card);
	const ownedCount = $derived(card ? ($ownedCardCounts.get(card.id) || 0) : 0);
	const isOwned = $derived(ownedCount > 0);
	const isLowConfidence = $derived(result.confidence < 0.7);

	async function handleAdd() {
		if (!card) return;
		adding = true;
		addError = null;
		addSuccess = false;
		try {
			await addToCollection(card.id);
			addSuccess = true;
			triggerHaptic('successAdd');
			showConfetti = true;
			setTimeout(() => { showConfetti = false; }, 800);
		} catch (err) {
			addError = err instanceof Error ? err.message : 'Failed to add card';
		} finally {
			adding = false;
		}
	}

	function methodLabel(method: string): string {
		switch (method) {
			case 'hash_cache': return 'Instant (cached)';
			case 'tesseract': return 'OCR Match';
			case 'claude': return 'AI Identified';
			default: return method;
		}
	}
</script>

<div class="confirmation-overlay">
	<div class="confirmation-backdrop"></div>
	<div class="confirmation-container">
		<div class="sheet-handle"></div>
		{#if card}
			<!-- Card image with flip reveal -->
			<div class="card-image-section">
				<CardFlipReveal
					imageUrl={capturedImageUrl ?? card.image_url ?? null}
					cardName={card.name}
					rarity={card.rarity ?? 'common'}
				/>
			</div>

			<!-- Card details -->
			<div class="card-details">
				<div class="card-header">
					<div class="title-row">
						<h2 class="card-name">{card.name}</h2>
						{#if isOwned}
							<span class="badge badge-owned">In Collection x{ownedCount}</span>
						{:else}
							<span class="badge badge-new">New!</span>
						{/if}
					</div>
					{#if card.hero_name && card.hero_name !== card.name}
						<p class="hero-name">{card.hero_name}</p>
					{/if}
					{#if card.card_number}
						<span class="card-number">#{card.card_number}</span>
					{/if}
				</div>

				<!-- Metadata pills -->
				<div class="meta-pills">
					{#if card.set_code}
						<span class="pill">{card.set_code}</span>
					{/if}
					{#if card.parallel}
						<span class="pill pill-parallel">{card.parallel}</span>
					{/if}
					{#if card.weapon_type}
						<span class="pill">{card.weapon_type}</span>
					{/if}
					{#if card.power}
						<span class="pill pill-power">PWR {card.power}</span>
					{/if}
					{#if card.battle_zone}
						<span class="pill">{card.battle_zone}</span>
					{/if}
					{#if card.rarity}
						<span class="pill pill-rarity rarity-{card.rarity}">{card.rarity.replace('_', ' ')}</span>
					{/if}
				</div>

				{#if isLowConfidence}
					<div class="confidence-warning">
						<span class="warning-icon">!</span>
						<span>Low confidence ({Math.round(result.confidence * 100)}%) — please verify this is the correct card</span>
					</div>
				{/if}

				<!-- Scan stats -->
				<div class="scan-stats">
					<div class="stat">
						<span class="stat-label">Method</span>
						<span class="stat-value">{methodLabel(result.scan_method)}</span>
					</div>
					<div class="stat">
						<span class="stat-label">Confidence</span>
						<span class="stat-value" class:low-conf={isLowConfidence}>{Math.round(result.confidence * 100)}%</span>
					</div>
					<div class="stat">
						<span class="stat-label">Time</span>
						<span class="stat-value">{result.processing_ms}ms</span>
					</div>
				</div>

				{#if addError}
					<p class="error-msg">{addError}</p>
				{/if}

				<!-- Actions -->
				<div class="actions">
					<div class="add-btn-wrapper">
						{#if isAuthenticated}
							<button class="btn btn-add" class:btn-added={addSuccess} onclick={handleAdd} disabled={adding || addSuccess}>
								{#if adding}
									Adding...
								{:else if addSuccess}
									Added!
								{:else if isOwned}
									Add Another Copy
								{:else}
									Add to Collection
								{/if}
							</button>
						{:else}
							<a href="/auth/login?redirectTo=/scan" class="btn btn-add" style="text-align:center;text-decoration:none;">
								Sign in to Save
							</a>
						{/if}
						{#if showConfetti}
							<div class="confetti-burst">
								{#each [0, 60, 120, 180, 240, 300] as angle}
									<span class="confetti-dot" style="--angle: {angle}deg; --dist: {22 + (angle % 3) * 4}px"></span>
								{/each}
							</div>
						{/if}
					</div>
					<a href="/grader" class="btn btn-grade" onclick={onClose}>
						Grade Card
					</a>
					<button class="btn btn-scan-another" onclick={onScanAnother}>
						Scan Another
					</button>
				</div>
			</div>
		{:else}
			<!-- Failed scan -->
			<div class="fail-state">
				{#if capturedImageUrl}
					<div class="fail-image-wrapper">
						<img src={capturedImageUrl} alt="Scanned card" class="card-image" />
						<div class="fail-image-overlay">?</div>
					</div>
				{/if}
				<h2>Card Not Identified</h2>
				{#if result.failReason}
					<p class="fail-reason">{result.failReason}</p>
				{:else}
					<p class="fail-reason">Try adjusting the angle or lighting and scan again.</p>
				{/if}
				<div class="actions">
					<button class="btn btn-add" onclick={onScanAnother}>Try Again</button>
					<button class="btn btn-secondary" onclick={onClose}>Close</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.confirmation-overlay {
		position: fixed;
		inset: 0;
		z-index: calc(var(--z-sticky, 1020) + 30);
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
	}

	.confirmation-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		animation: fade-in 0.2s ease-out;
	}

	.confirmation-container {
		position: relative;
		max-height: 70vh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		padding-bottom: calc(var(--bottom-nav-height, 68px) + var(--safe-bottom, env(safe-area-inset-bottom, 20px)));
		background: var(--bg-base, #070b14);
		border-radius: 20px 20px 0 0;
		animation: sheet-slide-up 0.3s ease-out;
	}

	/* ── Card Image ── */
	.card-image-section {
		display: flex;
		justify-content: center;
		padding: 1.5rem 1.5rem 0;
		background: linear-gradient(180deg, var(--bg-elevated, #121d34) 0%, var(--bg-base, #070b14) 100%);
	}

	.card-image-wrapper {
		position: relative;
		width: 100%;
		max-width: 280px;
		border-radius: 12px;
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		border: 2px solid var(--border-strong, rgba(148,163,184,0.2));
	}

	.card-image-wrapper.rarity-uncommon { border-color: rgba(34, 197, 94, 0.4); }
	.card-image-wrapper.rarity-rare { border-color: rgba(59, 130, 246, 0.4); }
	.card-image-wrapper.rarity-ultra_rare { border-color: rgba(168, 85, 247, 0.4); box-shadow: 0 8px 32px rgba(168, 85, 247, 0.15); }
	.card-image-wrapper.rarity-legendary { border-color: rgba(245, 158, 11, 0.5); box-shadow: 0 8px 32px rgba(245, 158, 11, 0.2); }

	.card-image {
		width: 100%;
		display: block;
		aspect-ratio: 2.5/3.5;
		object-fit: cover;
	}

	/* ── Card Details ── */
	.card-details {
		flex: 1;
		padding: 1.25rem 1.5rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.card-header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.card-name {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1.375rem;
		font-weight: 700;
		color: var(--text-primary, #e2e8f0);
		margin: 0;
	}

	.hero-name {
		font-size: 0.9rem;
		color: var(--text-secondary, #94a3b8);
		margin: 0;
	}

	.card-number {
		font-size: 0.875rem;
		color: var(--text-muted, #475569);
		font-weight: 500;
	}

	/* ── Badges ── */
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 10px;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		animation: badge-pop 0.4s ease-out;
	}

	.badge-owned {
		background: var(--primary-light, rgba(59, 130, 246, 0.12));
		color: var(--primary, #3b82f6);
		border: 1px solid rgba(59, 130, 246, 0.25);
	}

	.badge-new {
		background: var(--success-light, rgba(16, 185, 129, 0.12));
		color: var(--success, #10b981);
		border: 1px solid rgba(16, 185, 129, 0.25);
	}

	/* ── Meta Pills ── */
	.meta-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.pill {
		padding: 0.25rem 0.625rem;
		border-radius: 12px;
		background: var(--bg-surface, #0d1524);
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
	}

	.pill-power {
		color: var(--gold, #f59e0b);
		font-weight: 600;
	}

	.pill-parallel {
		color: var(--primary, #3b82f6);
		border: 1px solid rgba(59, 130, 246, 0.2);
		font-weight: 500;
	}

	.pill-rarity { text-transform: capitalize; font-weight: 600; }
	.pill-rarity.rarity-common { color: #9CA3AF; }
	.pill-rarity.rarity-uncommon { color: #22C55E; }
	.pill-rarity.rarity-rare { color: #3B82F6; }
	.pill-rarity.rarity-ultra_rare { color: #A855F7; }
	.pill-rarity.rarity-legendary { color: #F59E0B; }

	/* ── Low confidence ── */
	.confidence-warning {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: var(--warning-light, rgba(245, 158, 11, 0.12));
		border: 1px solid rgba(245, 158, 11, 0.25);
		font-size: 0.8rem;
		color: var(--warning, #f59e0b);
	}

	.warning-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--warning, #f59e0b);
		color: #000;
		font-size: 0.7rem;
		font-weight: 800;
		flex-shrink: 0;
	}

	.low-conf {
		color: var(--warning, #f59e0b);
	}

	/* ── Scan Stats ── */
	.scan-stats {
		display: flex;
		gap: 1.5rem;
		padding: 0.75rem 0;
		border-top: 1px solid var(--border, rgba(148,163,184,0.1));
		border-bottom: 1px solid var(--border, rgba(148,163,184,0.1));
	}

	.stat {
		display: flex;
		flex-direction: column;
	}

	.stat-label {
		font-size: 0.7rem;
		color: var(--text-muted, #475569);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.stat-value {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--text-primary, #e2e8f0);
	}

	.error-msg {
		color: var(--danger, #ef4444);
		font-size: 0.85rem;
		margin: 0;
	}

	/* ── Actions ── */
	.actions {
		display: flex;
		gap: 0.75rem;
		margin-top: auto;
		padding-top: 0.5rem;
	}

	.btn {
		flex: 1;
		padding: 0.875rem;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		border: none;
		transition: opacity 0.15s, background 0.15s;
	}

	.btn:active {
		opacity: 0.85;
	}

	.btn-add {
		background: var(--primary, #3b82f6);
		color: white;
	}

	.btn-add:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-added {
		background: var(--success, #10b981) !important;
		animation: success-pop 0.35s ease-out;
	}

	.btn-grade {
		background: var(--bg-elevated, #121d34);
		border: 1px solid rgba(168, 85, 247, 0.3);
		color: #a855f7;
		text-align: center;
		text-decoration: none;
	}

	.btn-scan-another {
		background: transparent;
		border: 1px solid var(--border-strong, rgba(148,163,184,0.2));
		color: var(--text-primary, #e2e8f0);
	}

	.btn-secondary {
		background: transparent;
		border: 1px solid var(--border-strong, rgba(148,163,184,0.2));
		color: var(--text-primary, #e2e8f0);
	}

	.add-btn-wrapper {
		flex: 1;
		position: relative;
	}

	.add-btn-wrapper .btn {
		width: 100%;
	}

	/* ── Confetti ── */
	.confetti-burst {
		position: absolute;
		top: 50%;
		left: 50%;
		pointer-events: none;
	}

	.confetti-dot {
		position: absolute;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--gold, #f59e0b);
		animation: confetti-fly 0.7s ease-out forwards;
	}

	.confetti-dot:nth-child(odd) { background: var(--primary, #3b82f6); }
	.confetti-dot:nth-child(3n) { background: var(--success, #10b981); }

	/* ── Fail State ── */
	.fail-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2rem 1.5rem;
		text-align: center;
		gap: 0.75rem;
		flex: 1;
	}

	.fail-state h2 {
		font-family: var(--font-display, 'Syne', sans-serif);
		font-size: 1.25rem;
		color: var(--text-primary, #e2e8f0);
		margin: 0;
	}

	.fail-image-wrapper {
		position: relative;
		width: 200px;
		border-radius: 12px;
		overflow: hidden;
		border: 2px solid var(--danger, #ef4444);
		opacity: 0.7;
		margin-bottom: 0.5rem;
	}

	.fail-image-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.5);
		font-size: 3rem;
		font-weight: 800;
		color: var(--danger, #ef4444);
	}

	.fail-reason {
		color: var(--text-secondary, #94a3b8);
		margin: 0;
		font-size: 0.9rem;
		max-width: 300px;
	}

	.fail-state .actions {
		width: 100%;
		max-width: 360px;
		margin-top: 1rem;
	}

	/* ── Sheet handle ── */
	.sheet-handle {
		width: 40px;
		height: 4px;
		background: rgba(148, 163, 184, 0.3);
		border-radius: 2px;
		margin: 8px auto 0;
		flex-shrink: 0;
	}

	/* ── Animations ── */
	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes sheet-slide-up {
		from { transform: translateY(100%); }
		to { transform: translateY(0); }
	}

	@keyframes badge-pop {
		0% { transform: scale(0.7); opacity: 0; }
		60% { transform: scale(1.05); }
		100% { transform: scale(1); opacity: 1; }
	}

	@keyframes success-pop {
		0% { transform: scale(1); }
		50% { transform: scale(1.04); }
		100% { transform: scale(1); }
	}

	@keyframes confetti-fly {
		0% {
			opacity: 1;
			transform: translate(0, 0) scale(0);
		}
		50% {
			opacity: 1;
			transform: translate(
				calc(cos(var(--angle)) * var(--dist)),
				calc(sin(var(--angle)) * var(--dist))
			) scale(1);
		}
		100% {
			opacity: 0;
			transform: translate(
				calc(cos(var(--angle)) * var(--dist) * 1.5),
				calc(sin(var(--angle)) * var(--dist) * 1.5)
			) scale(0.5);
		}
	}
</style>
