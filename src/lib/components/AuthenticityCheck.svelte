<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import type { AuthenticityResult } from '$lib/services/authenticity-check';

	let {
		cardId,
		capturedImageUrl = null,
		onClose
	}: {
		cardId: string;
		capturedImageUrl?: string | null;
		onClose: () => void;
	} = $props();

	let checking = $state(false);
	let result = $state<AuthenticityResult | null>(null);

	async function runCheck() {
		if (!capturedImageUrl) {
			showToast('No card image available', 'x');
			return;
		}
		checking = true;
		try {
			const res = await fetch(capturedImageUrl);
			const blob = await res.blob();
			const { checkAuthenticity } = await import('$lib/services/authenticity-check');
			result = await checkAuthenticity(cardId, blob);
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Verification failed', 'x');
		}
		checking = false;
	}

	function verdictColor(v: AuthenticityResult['verdict']): string {
		switch (v) {
			case 'likely_genuine': return '#22c55e';
			case 'review_recommended': return '#f59e0b';
			case 'suspect': return '#ef4444';
		}
	}

	function verdictLabel(v: AuthenticityResult['verdict']): string {
		switch (v) {
			case 'likely_genuine': return 'Likely Genuine';
			case 'review_recommended': return 'Review Recommended';
			case 'suspect': return 'Suspect — Inspect Closely';
		}
	}

	function scoreBarColor(score: number): string {
		if (score >= 80) return '#22c55e';
		if (score >= 55) return '#f59e0b';
		return '#ef4444';
	}

	$effect(() => {
		runCheck();
	});
</script>

<div class="auth-check">
	{#if checking}
		<div class="loading-state">
			<div class="spinner"></div>
			<p>Verifying authenticity...</p>
			<p class="hint">Loading OpenCV and analyzing card</p>
		</div>

	{:else if result}
		{#if result.overallScore === -1}
			<div class="no-ref">
				<div class="no-ref-icon">?</div>
				<p>No reference image available for this card.</p>
				<p class="hint">Authenticity verification requires a champion reference image to compare against.</p>
			</div>
		{:else}
			<!-- Verdict -->
			<div class="verdict" style="border-color: {verdictColor(result.verdict)}">
				<div class="verdict-score" style="color: {verdictColor(result.verdict)}">{result.overallScore}%</div>
				<div class="verdict-label" style="color: {verdictColor(result.verdict)}">{verdictLabel(result.verdict)}</div>
			</div>

			<!-- Metric Cards -->
			<div class="metrics">
				<div class="metric-card">
					<div class="metric-header">
						<span class="metric-name">Color Match</span>
						<span class="metric-value">{result.metrics.color.score}/100</span>
					</div>
					<div class="score-bar"><div class="score-fill" style="width: {result.metrics.color.score}%; background: {scoreBarColor(result.metrics.color.score)}"></div></div>
					<p class="metric-detail">{result.metrics.color.details}</p>
					{#if result.metrics.color.deltaE >= 0}
						<span class="metric-sub">ΔE: {result.metrics.color.deltaE}</span>
					{/if}
				</div>

				<div class="metric-card">
					<div class="metric-header">
						<span class="metric-name">Structure Match</span>
						<span class="metric-value">{result.metrics.structure.score}/100</span>
					</div>
					<div class="score-bar"><div class="score-fill" style="width: {result.metrics.structure.score}%; background: {scoreBarColor(result.metrics.structure.score)}"></div></div>
					<p class="metric-detail">{result.metrics.structure.details}</p>
					{#if result.metrics.structure.ssim >= 0}
						<span class="metric-sub">SSIM: {result.metrics.structure.ssim}</span>
					{/if}
				</div>

				<div class="metric-card">
					<div class="metric-header">
						<span class="metric-name">Text Verification</span>
						<span class="metric-value">{result.metrics.text.score}/100</span>
					</div>
					<div class="score-bar"><div class="score-fill" style="width: {result.metrics.text.score}%; background: {scoreBarColor(result.metrics.text.score)}"></div></div>
					<p class="metric-detail">{result.metrics.text.details}</p>
				</div>
			</div>

			<!-- Anomalies -->
			{#if result.anomalies.length > 0}
				<div class="anomalies">
					<h4>Anomalies Detected</h4>
					{#each result.anomalies as anomaly}
						<p class="anomaly-item">{anomaly}</p>
					{/each}
				</div>
			{/if}

			<div class="meta">Processed in {result.processingMs}ms</div>
		{/if}

		<!-- Disclaimer -->
		<div class="disclaimer">
			This analysis compares against reference images and cannot guarantee authenticity. Physical inspection by a professional is recommended for high-value cards. This tool cannot detect rosette print patterns, card stock thickness, or UV fluorescence.
		</div>
	{/if}

	<button class="btn-close" onclick={onClose}>Close</button>
</div>

<style>
	.auth-check {
		display: flex; flex-direction: column; gap: 1rem; padding: 1rem;
	}
	.loading-state { text-align: center; padding: 2rem 0; }
	.spinner {
		width: 36px; height: 36px; border: 3px solid var(--border-color);
		border-top-color: var(--accent-primary); border-radius: 50%;
		animation: spin 0.8s linear infinite; margin: 0 auto 1rem;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.hint { font-size: 0.8rem; color: var(--text-tertiary); }

	.no-ref { text-align: center; padding: 1.5rem 0; }
	.no-ref-icon {
		width: 48px; height: 48px; border-radius: 50%; background: var(--bg-elevated);
		display: flex; align-items: center; justify-content: center;
		font-size: 1.5rem; font-weight: 700; color: var(--text-secondary);
		margin: 0 auto 0.75rem;
	}

	.verdict {
		text-align: center; padding: 1rem; border-radius: 12px;
		border: 2px solid; background: var(--bg-elevated);
	}
	.verdict-score { font-size: 2rem; font-weight: 800; }
	.verdict-label { font-size: 0.9rem; font-weight: 600; }

	.metrics { display: flex; flex-direction: column; gap: 0.75rem; }
	.metric-card {
		background: var(--bg-elevated); border-radius: 10px; padding: 0.75rem 1rem;
	}
	.metric-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
	.metric-name { font-size: 0.85rem; font-weight: 600; }
	.metric-value { font-size: 0.8rem; color: var(--text-secondary); }
	.score-bar {
		height: 6px; border-radius: 3px; background: var(--bg-base);
		overflow: hidden; margin-bottom: 0.5rem;
	}
	.score-fill {
		height: 100%; border-radius: 3px; transition: width 0.5s ease;
	}
	.metric-detail { font-size: 0.75rem; color: var(--text-secondary); line-height: 1.3; }
	.metric-sub { font-size: 0.7rem; color: var(--text-tertiary); }

	.anomalies {
		background: rgba(239, 68, 68, 0.08); border-radius: 10px; padding: 0.75rem 1rem;
	}
	.anomalies h4 { font-size: 0.85rem; font-weight: 600; color: #ef4444; margin-bottom: 0.5rem; }
	.anomaly-item { font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.375rem; line-height: 1.3; }

	.meta { font-size: 0.7rem; color: var(--text-tertiary); text-align: center; }

	.disclaimer {
		font-size: 0.7rem; color: var(--text-tertiary); line-height: 1.4;
		padding: 0.75rem; background: var(--bg-elevated); border-radius: 8px;
	}

	.btn-close {
		width: 100%; padding: 0.75rem; border-radius: 10px; border: none;
		background: var(--bg-elevated); color: var(--text-primary);
		font-size: 0.9rem; font-weight: 600; cursor: pointer;
		border: 1px solid var(--border-color);
	}
</style>
