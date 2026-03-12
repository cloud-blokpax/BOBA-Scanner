<script lang="ts">
	import { showToast } from '$lib/stores/toast';

	interface GradeResult {
		overallGrade: number;
		subGrades: {
			centering: number;
			corners: number;
			edges: number;
			surface: number;
		};
		qualifier: string | null;
		confidence: number;
		recommendations: string[];
		gradeVersion: number;
	}

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
		reader.readAsDataURL(file);
	}

	async function compressImage(file: File): Promise<string> {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
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
				resolve(canvas.toDataURL('image/jpeg', 0.92));
			};
			img.src = URL.createObjectURL(file);
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

			const data = await res.json();
			const text = data.content?.[0]?.text || '';
			const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
			result = JSON.parse(cleaned);
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
			<div class="overall-grade" style="color: {gradeColor(result.overallGrade)}">
				<div class="grade-number">{result.overallGrade}</div>
				<div class="grade-scale">/ 10</div>
			</div>

			{#if result.qualifier}
				<div class="qualifier">{result.qualifier}</div>
			{/if}

			<div class="confidence">
				Confidence: {(result.confidence * 100).toFixed(0)}%
			</div>

			<div class="sub-grades">
				<div class="sub-grade">
					<span class="sub-label">Centering</span>
					<span class="sub-value" style="color: {gradeColor(result.subGrades.centering)}">{result.subGrades.centering}</span>
				</div>
				<div class="sub-grade">
					<span class="sub-label">Corners</span>
					<span class="sub-value" style="color: {gradeColor(result.subGrades.corners)}">{result.subGrades.corners}</span>
				</div>
				<div class="sub-grade">
					<span class="sub-label">Edges</span>
					<span class="sub-value" style="color: {gradeColor(result.subGrades.edges)}">{result.subGrades.edges}</span>
				</div>
				<div class="sub-grade">
					<span class="sub-label">Surface</span>
					<span class="sub-value" style="color: {gradeColor(result.subGrades.surface)}">{result.subGrades.surface}</span>
				</div>
			</div>

			{#if result.recommendations.length > 0}
				<div class="recommendations">
					<h3>Recommendations</h3>
					<ul>
						{#each result.recommendations as rec}
							<li>{rec}</li>
						{/each}
					</ul>
				</div>
			{/if}

			<button class="grade-btn" onclick={runGrading} disabled={grading}>
				{grading ? 'Re-analyzing...' : 'Re-grade'}
			</button>
		</div>
	{/if}
</div>

<style>
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
	.sub-value { font-size: 1.25rem; font-weight: 700; }
	.recommendations {
		text-align: left;
		margin-bottom: 1rem;
	}
	.recommendations h3 {
		font-size: 0.85rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}
	.recommendations ul {
		padding-left: 1.25rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.recommendations li { margin-bottom: 0.25rem; }
</style>
