<script lang="ts">
	import { addToCollection, ownedCardCounts } from '$lib/stores/collection';
	import type { ScanResult } from '$lib/types';

	let {
		result,
		onClose,
		onScanAnother
	}: {
		result: ScanResult | null;
		onClose: () => void;
		onScanAnother: () => void;
	} = $props();

	let adding = $state(false);
	let addError = $state<string | null>(null);
	let addSuccess = $state(false);
	let showConfetti = $state(false);

	const ownedCount = $derived(
		result?.card ? ($ownedCardCounts.get(result.card.id) || 0) : 0
	);

	const isOwned = $derived(ownedCount > 0);
	const isLowConfidence = $derived(result ? result.confidence < 0.7 : false);

	async function handleAdd() {
		if (!result?.card) return;
		adding = true;
		addError = null;
		addSuccess = false;
		try {
			await addToCollection(result.card.id);
			addSuccess = true;
			triggerHaptic();
			triggerConfetti();
		} catch (err) {
			addError = err instanceof Error ? err.message : 'Failed to add card';
		} finally {
			adding = false;
		}
	}

	function triggerHaptic() {
		if ('vibrate' in navigator) {
			navigator.vibrate([30, 50, 30]);
		}
	}

	function triggerConfetti() {
		showConfetti = true;
		setTimeout(() => { showConfetti = false; }, 800);
	}

	function methodLabel(method: string): string {
		switch (method) {
			case 'hash_cache':
				return 'Instant (cached)';
			case 'tesseract':
				return 'OCR Match';
			case 'claude':
				return 'AI Identified';
			default:
				return method;
		}
	}
</script>

{#if result}
	<div class="bottom-sheet" role="dialog" aria-modal="true">
		<div class="sheet-handle"></div>

		{#if result.card}
			<div class="result-success">
				<div class="result-header">
					<div class="result-title-row">
						<h2>{result.card.name}</h2>
						{#if isOwned}
							<span class="ownership-badge owned">In Collection x{ownedCount}</span>
						{:else}
							<span class="ownership-badge new-card">New!</span>
						{/if}
					</div>
					{#if result.card.card_number}
						<span class="result-number">#{result.card.card_number}</span>
					{/if}
				</div>

				<div class="result-meta">
					{#if result.card.set_code}
						<span class="meta-pill">{result.card.set_code}</span>
					{/if}
					{#if result.card.weapon_type}
						<span class="meta-pill">{result.card.weapon_type}</span>
					{/if}
					{#if result.card.power}
						<span class="meta-pill power">PWR {result.card.power}</span>
					{/if}
					{#if result.card.rarity}
						<span class="meta-pill rarity rarity-{result.card.rarity}">{result.card.rarity.replace('_', ' ')}</span>
					{/if}
				</div>

				{#if isLowConfidence}
					<div class="confidence-warning">
						<span class="warning-icon">!</span>
						<span>Low confidence ({Math.round(result.confidence * 100)}%) — please verify this is the correct card</span>
					</div>
				{/if}

				<div class="result-stats">
					<span class="stat-item">
						<span class="stat-label">Method</span>
						<span class="stat-value">{methodLabel(result.scan_method)}</span>
					</span>
					<span class="stat-item">
						<span class="stat-label">Confidence</span>
						<span class="stat-value" class:low-conf={isLowConfidence}>{Math.round(result.confidence * 100)}%</span>
					</span>
					<span class="stat-item">
						<span class="stat-label">Time</span>
						<span class="stat-value">{result.processing_ms}ms</span>
					</span>
				</div>

				{#if addError}
					<p class="add-error">{addError}</p>
				{/if}

				<div class="result-actions">
					<div class="add-btn-wrapper">
						<button class="btn-primary" class:success-added={addSuccess} onclick={handleAdd} disabled={adding || addSuccess}>
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
						{#if showConfetti}
							<div class="confetti-container">
								<span class="confetti-dot" style="--angle: 0deg; --dist: 28px; --color: var(--accent-primary)"></span>
								<span class="confetti-dot" style="--angle: 60deg; --dist: 24px; --color: var(--success)"></span>
								<span class="confetti-dot" style="--angle: 120deg; --dist: 30px; --color: var(--accent-gold)"></span>
								<span class="confetti-dot" style="--angle: 180deg; --dist: 22px; --color: var(--accent-primary)"></span>
								<span class="confetti-dot" style="--angle: 240deg; --dist: 26px; --color: var(--success)"></span>
								<span class="confetti-dot" style="--angle: 300deg; --dist: 32px; --color: var(--accent-gold)"></span>
							</div>
						{/if}
					</div>
					<button class="btn-secondary" onclick={onScanAnother}>
						Scan Another
					</button>
				</div>
			</div>
		{:else}
			<div class="result-fail">
				<h2>Card Not Identified</h2>
				<p>Try adjusting the angle or lighting and scan again.</p>
				<div class="result-actions">
					<button class="btn-primary" onclick={onScanAnother}>Try Again</button>
					<button class="btn-secondary" onclick={onClose}>Close</button>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.bottom-sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: var(--surface-secondary, #0d1524);
		border-radius: 16px 16px 0 0;
		padding: 1rem 1.5rem 2rem;
		z-index: 500;
		box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
		max-height: 60vh;
		overflow-y: auto;
	}

	.sheet-handle {
		width: 40px;
		height: 4px;
		border-radius: 2px;
		background: var(--border-color, #1e293b);
		margin: 0 auto 1rem;
	}

	.result-header h2 {
		font-family: 'Syne', sans-serif;
		font-size: 1.25rem;
		font-weight: 700;
	}

	.result-number {
		font-size: 0.9rem;
		color: var(--text-secondary, #94a3b8);
	}

	.result-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0.75rem 0;
	}

	.meta-pill {
		padding: 0.25rem 0.625rem;
		border-radius: 12px;
		background: var(--surface-primary, #070b14);
		font-size: 0.8rem;
		color: var(--text-secondary, #94a3b8);
	}

	.meta-pill.power {
		color: var(--accent-gold, #f59e0b);
		font-weight: 600;
	}

	.result-stats {
		display: flex;
		gap: 1.5rem;
		margin: 1rem 0;
		padding: 0.75rem 0;
		border-top: 1px solid var(--border-color, #1e293b);
		border-bottom: 1px solid var(--border-color, #1e293b);
	}

	.stat-item {
		display: flex;
		flex-direction: column;
	}

	.stat-label {
		font-size: 0.7rem;
		color: var(--text-tertiary, #64748b);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.stat-value {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.result-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.result-actions button {
		flex: 1;
		padding: 0.875rem;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.btn-primary {
		background: var(--accent-primary, #3b82f6);
		color: white;
		border: none;
	}

	.btn-primary:disabled {
		opacity: 0.5;
	}

	.btn-secondary {
		background: transparent;
		border: 1px solid var(--border-color, #1e293b);
		color: var(--text-primary, #f1f5f9);
	}

	.add-error {
		color: #ef4444;
		font-size: 0.85rem;
		margin-bottom: 0.5rem;
	}

	.result-fail {
		text-align: center;
	}

	.result-fail h2 {
		font-family: 'Syne', sans-serif;
		margin-bottom: 0.5rem;
	}

	.result-fail p {
		color: var(--text-secondary, #94a3b8);
		margin-bottom: 1rem;
	}

	/* ── Ownership badges ── */
	.result-title-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.ownership-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 10px;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		animation: badge-appear 0.4s ease-out;
	}

	.ownership-badge.owned {
		background: var(--accent-primary-dim, rgba(59, 130, 246, 0.1));
		color: var(--accent-primary, #3b82f6);
		border: 1px solid rgba(59, 130, 246, 0.25);
	}

	.ownership-badge.new-card {
		background: var(--success-light, rgba(16, 185, 129, 0.12));
		color: var(--success, #10b981);
		border: 1px solid rgba(16, 185, 129, 0.25);
	}

	/* ── Low confidence warning ── */
	.confidence-warning {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		margin: 0.75rem 0;
		border-radius: 8px;
		background: var(--warning-light, rgba(245, 158, 11, 0.12));
		border: 1px solid rgba(245, 158, 11, 0.25);
		font-size: 0.8rem;
		color: var(--warning, #f59e0b);
		animation: slide-up-fade 0.3s ease-out;
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

	/* ── Rarity pill colors ── */
	.rarity.rarity-common { color: var(--rarity-common, #9CA3AF); }
	.rarity.rarity-uncommon { color: var(--rarity-uncommon, #22C55E); }
	.rarity.rarity-rare { color: var(--rarity-rare, #3B82F6); }
	.rarity.rarity-ultra_rare { color: var(--rarity-epic, #A855F7); }
	.rarity.rarity-legendary { color: var(--rarity-legendary, #F59E0B); }

	/* ── Add button success animation ── */
	.success-added {
		background: var(--success, #10b981) !important;
		animation: success-pop 0.35s ease-out;
	}

	.add-btn-wrapper {
		flex: 1;
		position: relative;
	}

	.add-btn-wrapper .btn-primary {
		width: 100%;
	}

	/* ── Confetti burst ── */
	.confetti-container {
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
		background: var(--color);
		transform-origin: center;
		animation: confetti-fly 0.7s ease-out forwards;
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
