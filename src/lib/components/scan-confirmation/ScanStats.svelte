<script lang="ts">
	import type { ValidationMethod } from '$lib/types';

	let {
		scanMethod,
		confidence,
		processingMs,
		isLowConfidence,
		validationMethod = null,
		validationWarnings = []
	}: {
		scanMethod: string;
		confidence: number;
		processingMs: number;
		isLowConfidence: boolean;
		validationMethod?: ValidationMethod | null;
		validationWarnings?: string[];
	} = $props();

	function methodLabel(method: string): string {
		switch (method) {
			case 'hash_cache': return 'Instant (cached)';
			case 'tesseract': return 'OCR Match';
			case 'claude': return 'AI Identified';
			case 'manual': return 'Manual Search';
			default: return method;
		}
	}

	function validationLabel(method: ValidationMethod | null): string | null {
		switch (method) {
			case 'exact_match': return 'Verified';
			case 'fuzzy_match': return 'Fuzzy matched';
			case 'name_only_fallback': return 'Name match only';
			case 'unvalidated': return 'Unverified';
			default: return null;
		}
	}

	const validationBadge = $derived(validationLabel(validationMethod));
	const isFuzzyMatch = $derived(validationMethod === 'fuzzy_match');
	const isNameFallback = $derived(validationMethod === 'name_only_fallback');
	const showValidationWarning = $derived(isNameFallback || validationMethod === 'unvalidated');
</script>

<div class="scan-stats">
	<div class="stat">
		<span class="stat-label">Method</span>
		<span class="stat-value">{methodLabel(scanMethod)}</span>
	</div>
	<div class="stat">
		<span class="stat-label">Confidence</span>
		<span class="stat-value" class:low-conf={isLowConfidence}>{Math.round(confidence * 100)}%</span>
	</div>
	<div class="stat">
		<span class="stat-label">Time</span>
		<span class="stat-value">{processingMs}ms</span>
	</div>
	{#if validationBadge}
		<div class="stat">
			<span class="stat-label">Match</span>
			<span
				class="stat-value validation-badge"
				class:badge-verified={validationMethod === 'exact_match'}
				class:badge-fuzzy={isFuzzyMatch}
				class:badge-fallback={isNameFallback}
				class:badge-unverified={validationMethod === 'unvalidated'}
			>{validationBadge}</span>
		</div>
	{/if}
</div>

{#if showValidationWarning}
	<div class="confidence-warning validation-warning">
		<span class="warning-icon">!</span>
		<span>Verify card number — matched by hero name only</span>
	</div>
{:else if isFuzzyMatch}
	<div class="confidence-warning fuzzy-warning">
		<span class="warning-icon">~</span>
		<span>Card number was fuzzy-matched — please confirm</span>
	</div>
{:else if isLowConfidence}
	<div class="confidence-warning">
		<span class="warning-icon">!</span>
		<span>Low confidence ({Math.round(confidence * 100)}%) — please verify this is the correct card</span>
	</div>
{/if}

<style>
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

	.low-conf {
		color: var(--warning, #f59e0b);
	}

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

	.validation-badge {
		font-size: 0.75rem;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
	}

	.badge-verified {
		color: var(--success, #22c55e);
	}

	.badge-fuzzy {
		color: var(--warning, #f59e0b);
	}

	.badge-fallback, .badge-unverified {
		color: var(--error, #ef4444);
	}

	.fuzzy-warning {
		background: var(--warning-light, rgba(245, 158, 11, 0.12));
		border: 1px solid rgba(245, 158, 11, 0.25);
		color: var(--warning, #f59e0b);
	}

	.validation-warning {
		background: rgba(239, 68, 68, 0.12);
		border: 1px solid rgba(239, 68, 68, 0.25);
		color: var(--error, #ef4444);
	}

	.validation-warning .warning-icon {
		background: var(--error, #ef4444);
	}

	.fuzzy-warning .warning-icon {
		background: var(--warning, #f59e0b);
	}
</style>
