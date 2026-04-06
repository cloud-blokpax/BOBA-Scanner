<script lang="ts">
	import { scanImage, scanState, resetScanner, initScanner } from '$lib/stores/scanner.svelte';
	import ScanConfirmation from '$lib/components/ScanConfirmation.svelte';
	import type { ScanResult } from '$lib/types';

	let fileInput = $state<HTMLInputElement | null>(null);
	let uploadResult = $state<ScanResult | null>(null);
	let uploadImageUrl = $state<string | null>(null);
	let uploading = $state(false);

	// Scanner initializes lazily on first use — no eager worker/OCR loading

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

	function handleUploadClick() {
		fileInput?.click();
	}

	async function handleFileSelected(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		uploading = true;
		uploadResult = null;
		await initScanner(); // Lazy init — only load workers when user actually scans

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
</script>

{#if uploadResult}
	<ScanConfirmation
		result={uploadResult}
		capturedImageUrl={uploadImageUrl}
		isAuthenticated={true}
		onScanAnother={dismissResult}
		onClose={dismissResult}
	/>
{:else if uploading}
	<div class="upload-status">
		<div class="upload-spinner"></div>
		<span>{statusText || 'Processing...'}</span>
	</div>
{/if}

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

<style>
	.scan-hero-card {
		display: flex; align-items: center; gap: 1.25rem;
		padding: 1.25rem; background: linear-gradient(135deg, rgba(245,158,11,0.06), rgba(59,130,246,0.03));
		border: 1px solid rgba(245,158,11,0.12); border-radius: var(--radius-xl, 16px); margin-bottom: 1.5rem;
	}
	.scan-hero-btn {
		display: flex; align-items: center; justify-content: center;
		width: 72px; height: 72px; border-radius: 50%; flex-shrink: 0; text-decoration: none;
		background: linear-gradient(135deg, var(--gold, #f59e0b), var(--gold-dark, #d97706));
		box-shadow: 0 0 0 0 rgba(245,158,11,0.3), var(--shadow-gold, 0 4px 20px rgba(245,158,11,0.35));
		animation: scanBreathe 3s ease-in-out infinite; transition: transform 0.12s ease;
	}
	.scan-hero-btn:active { transform: scale(0.93); animation: none; }
	@keyframes scanBreathe {
		0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.3), 0 4px 20px rgba(245,158,11,0.35); }
		50% { box-shadow: 0 0 0 12px rgba(245,158,11,0), 0 8px 32px rgba(245,158,11,0.45); }
	}
	.scan-hero-icon { font-size: 1.75rem; filter: brightness(0.2); }
	.scan-hero-text { flex: 1; min-width: 0; }
	.scan-hero-title { font-family: var(--font-display, 'Syne', sans-serif); font-size: 1.1rem; font-weight: 700; margin-bottom: 0.2rem; }
	.scan-hero-desc { font-size: 0.8rem; color: var(--text-secondary, #94a3b8); line-height: 1.35; margin-bottom: 0.625rem; }
	.scan-hero-actions { display: flex; gap: 0.5rem; }
	.btn-hero-secondary {
		padding: 0.375rem 0.75rem; border-radius: var(--radius-md, 8px);
		background: var(--bg-elevated, #121d34); border: 1px solid var(--border, rgba(148,163,184,0.10));
		color: var(--text-secondary, #94a3b8); font-size: 0.75rem; font-weight: 500;
		text-decoration: none; cursor: pointer; transition: border-color var(--transition-fast, 150ms), color var(--transition-fast, 150ms);
	}
	.btn-hero-secondary:hover { border-color: var(--border-strong, rgba(148,163,184,0.20)); color: var(--text-primary, #e2e8f0); }
	.btn-hero-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
	.upload-status {
		display: flex; align-items: center; justify-content: center; gap: 0.75rem;
		margin: 1rem 0; padding: 1rem; border-radius: var(--radius-lg, 12px);
		background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.15);
		color: var(--text-primary, #e2e8f0);
	}
	.upload-spinner {
		width: 18px; height: 18px; border: 2px solid rgba(255, 255, 255, 0.2);
		border-top-color: var(--primary, #3b82f6); border-radius: 50%; animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (max-width: 360px) {
		.scan-hero-card { flex-direction: column; text-align: center; }
		.scan-hero-actions { justify-content: center; }
	}
</style>
