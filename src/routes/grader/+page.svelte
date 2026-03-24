<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import { featureEnabled } from '$lib/stores/feature-flags.svelte';
	import type { GradeResult } from '$lib/types';

	const hasGrader = featureEnabled('condition_grader');

	let imageFile = $state<File | null>(null);
	let imagePreview = $state<string | null>(null);
	let grading = $state(false);
	let result = $state<GradeResult | null>(null);

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		imageFile = file;
		result = null;

		const reader = new FileReader();
		reader.onload = () => {
			imagePreview = reader.result as string;
		};
		reader.onerror = () => {
			showToast('Failed to read image file', 'x');
			imageFile = null;
		};
		reader.readAsDataURL(file);
	}

	async function compressImage(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			const objectUrl = URL.createObjectURL(file);
			img.onload = () => {
				URL.revokeObjectURL(objectUrl);
				const canvas = document.createElement('canvas');
				const maxDim = 2000;
				let w = img.width;
				let h = img.height;
				if (w > maxDim || h > maxDim) {
					const ratio = Math.min(maxDim / w, maxDim / h);
					w *= ratio;
					h *= ratio;
				}
				canvas.width = w;
				canvas.height = h;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(img, 0, 0, w, h);
				// Strip data URL prefix — API expects raw base64
				const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
				resolve(dataUrl.replace(/^data:image\/\w+;base64,/, ''));
			};
			img.onerror = () => {
				URL.revokeObjectURL(objectUrl);
				reject(new Error('Failed to load image'));
			};
			img.src = objectUrl;
		});
	}

	async function runGrading() {
		if (!imageFile) return;
		grading = true;
		result = null;

		try {
			const imageData = await compressImage(imageFile);
			const res = await fetch('/api/grade', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ imageData })
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || `Grading failed: ${res.status}`);
			}

			result = await res.json();
			showToast('Grading complete', 'check');
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Grading failed', 'x');
		}
		grading = false;
	}

	function gradeColor(grade: number): string {
		if (grade >= 9) return '#22c55e';
		if (grade >= 7) return '#eab308';
		if (grade >= 5) return '#f97316';
		return '#ef4444';
	}
</script>

<svelte:head>
	<title>Card Grader - BOBA Scanner</title>
</svelte:head>

{#if hasGrader()}
<div class="grader-page">
	<header class="page-header">
		<h1>AI Card Grader</h1>
		<p class="subtitle">Get a PSA-scale condition grade using AI vision analysis</p>
	</header>

	<div class="upload-section">
		{#if imagePreview}
			<div class="preview-container">
				<img src={imagePreview} alt="Card to grade" class="card-preview" />
				<button class="change-btn" onclick={() => { imageFile = null; imagePreview = null; result = null; }}>
					Change Image
				</button>
			</div>
		{:else}
			<label class="upload-area">
				<input type="file" accept="image/*" onchange={handleFileSelect} hidden />
				<div class="upload-content">
					<div class="upload-icon">+</div>
					<span>Upload a card image</span>
					<span class="upload-hint">JPG, PNG - clear, well-lit photo</span>
				</div>
			</label>
		{/if}
	</div>

	{#if imagePreview && !result}
		<button class="grade-btn" onclick={runGrading} disabled={grading}>
			{grading ? 'Analyzing...' : 'Grade This Card'}
		</button>
	{/if}

	{#if result}
		<div class="result-card">
			<div class="overall-grade" style="color: {gradeColor(result.grade)}">
				<div class="grade-number">{result.grade}</div>
				<div class="grade-scale">/ 10</div>
			</div>

			{#if result.grade_label}
				<div class="grade-label">{result.grade_label}</div>
			{/if}

			{#if result.qualifier}
				<div class="qualifier">Qualifier: {result.qualifier}</div>
			{/if}

			{#if result.confidence}
				<div class="confidence">
					Confidence: {result.confidence}%
				</div>
			{/if}

			<div class="sub-grades">
				<div class="sub-grade">
					<span class="sub-label">Centering</span>
					<span class="sub-value">{result.front_centering || 'N/A'}</span>
				</div>
				<div class="sub-grade">
					<span class="sub-label">Corners</span>
					<span class="sub-value">{result.corners || 'N/A'}</span>
				</div>
				<div class="sub-grade">
					<span class="sub-label">Edges</span>
					<span class="sub-value">{result.edges || 'N/A'}</span>
				</div>
				<div class="sub-grade">
					<span class="sub-label">Surface</span>
					<span class="sub-value">{result.surface || 'N/A'}</span>
				</div>
			</div>

			{#if result.summary}
				<div class="summary">
					<h3>Assessment</h3>
					<p>{result.summary}</p>
				</div>
			{/if}

			{#if result.submit_recommendation}
				<div class="submit-rec">
					Submit for grading: <strong>{result.submit_recommendation}</strong>
				</div>
			{/if}

			<button class="grade-btn" onclick={runGrading} disabled={grading}>
				{grading ? 'Re-analyzing...' : 'Re-grade'}
			</button>
		</div>
	{/if}
</div>
{:else}
<div class="pro-gate">
	<div class="pro-gate-icon">🔬</div>
	<h2>AI Card Grader</h2>
	<p>Get instant PSA-scale grade estimates with AI-powered analysis of corners, edges, surface, and centering.</p>
	<button class="btn-gold" onclick={() => { import('$lib/stores/pro.svelte').then(m => m.setShowGoProModal(true)); }}>Go Pro</button>
</div>
{/if}

<style>
	.pro-gate {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 3rem 1.5rem;
		min-height: 50vh;
	}
	.pro-gate-icon { font-size: 3rem; margin-bottom: 1rem; }
	.pro-gate h2 {
		font-family: 'Syne', sans-serif;
		font-weight: 700;
		margin-bottom: 0.5rem;
	}
	.pro-gate p {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin-bottom: 1.5rem;
		max-width: 300px;
		line-height: 1.4;
	}
	.btn-gold {
		padding: 0.75rem 2rem;
		border-radius: 10px;
		border: none;
		background: var(--gold);
		color: #000;
		font-size: 1rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: var(--shadow-gold);
	}
	.grader-page {
		max-width: 500px;
		margin: 0 auto;
		padding: 1rem;
	}
	.page-header { margin-bottom: 1.5rem; }
	h1 { font-size: 1.5rem; font-weight: 700; }
	.subtitle {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}
	.upload-area {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px dashed var(--border-color);
		border-radius: 16px;
		padding: 3rem 1rem;
		cursor: pointer;
		transition: border-color 0.2s;
	}
	.upload-area:hover { border-color: var(--accent-primary); }
	.upload-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-secondary);
	}
	.upload-icon {
		font-size: 2rem;
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: var(--bg-elevated);
	}
	.upload-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}
	.preview-container {
		position: relative;
		text-align: center;
	}
	.card-preview {
		max-width: 100%;
		max-height: 400px;
		border-radius: 12px;
		object-fit: contain;
	}
	.change-btn {
		position: absolute;
		top: 8px;
		right: 8px;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.375rem 0.75rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.grade-btn {
		width: 100%;
		padding: 0.875rem;
		border-radius: 12px;
		border: none;
		background: var(--accent-primary);
		color: #fff;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		margin-top: 1rem;
	}
	.grade-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.result-card {
		background: var(--bg-elevated);
		border-radius: 16px;
		padding: 1.5rem;
		margin-top: 1.5rem;
		text-align: center;
	}
	.overall-grade {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 4px;
		margin-bottom: 0.5rem;
	}
	.grade-number { font-size: 3rem; font-weight: 800; }
	.grade-scale { font-size: 1.25rem; color: var(--text-tertiary); }
	.qualifier {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
	}
	.confidence {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		margin-bottom: 1.25rem;
	}
	.sub-grades {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.sub-grade {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.75rem;
		background: var(--bg-base);
		border-radius: 10px;
	}
	.sub-label {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	.sub-value { font-size: 0.8rem; font-weight: 500; color: var(--text-primary); }
	.grade-label {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 0.25rem;
	}
	.summary {
		text-align: left;
		margin-bottom: 1rem;
	}
	.summary h3 {
		font-size: 0.85rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}
	.summary p {
		font-size: 0.8rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}
	.submit-rec {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}
</style>
