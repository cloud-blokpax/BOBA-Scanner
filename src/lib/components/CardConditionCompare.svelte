<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ComparisonResult } from '$lib/services/card-condition-compare';

	let phase = $state<'captureA' | 'captureB' | 'processing' | 'results'>('captureA');
	let imageFileA = $state<File | null>(null);
	let imageFileB = $state<File | null>(null);
	let previewA = $state<string | null>(null);
	let previewB = $state<string | null>(null);
	let result = $state<ComparisonResult | null>(null);
	let showHeatOverlay = $state(false);
	let overlayOpacity = $state(0.6);

	function handleFileA(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		imageFileA = file;
		const reader = new FileReader();
		reader.onload = () => { previewA = reader.result as string; };
		reader.readAsDataURL(file);
	}

	function handleFileB(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		imageFileB = file;
		const reader = new FileReader();
		reader.onload = () => { previewB = reader.result as string; };
		reader.readAsDataURL(file);
	}

	function proceedToB() {
		if (!imageFileA) return;
		phase = 'captureB';
	}

	async function runComparison() {
		if (!imageFileA || !imageFileB) return;
		phase = 'processing';

		try {
			const { compareCards } = await import('$lib/services/card-condition-compare');
			result = await compareCards(imageFileA, imageFileB);
			phase = 'results';
			showToast('Comparison complete', 'check');
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Comparison failed', 'x');
			phase = 'captureA';
		}
	}

	function reset() {
		phase = 'captureA';
		imageFileA = null;
		imageFileB = null;
		previewA = null;
		previewB = null;
		result = null;
		showHeatOverlay = false;
	}

	function verdictLabel(rec: ComparisonResult['recommendation']): string {
		switch (rec) {
			case 'A': return 'Card A is in better condition';
			case 'B': return 'Card B is in better condition';
			default: return 'Cards are similar in condition';
		}
	}

	function verdictColor(rec: ComparisonResult['recommendation']): string {
		switch (rec) {
			case 'A': return '#3b82f6';
			case 'B': return '#8b5cf6';
			default: return '#22c55e';
		}
	}
</script>

<div class="compare-container">
	{#if phase === 'captureA'}
		<div class="capture-phase">
			<h2>Card A</h2>
			<p class="hint">Upload the first card image</p>
			{#if previewA}
				<div class="preview-wrap">
					<img src={previewA} alt="Card A" class="card-preview" />
					<button class="change-btn" onclick={() => { imageFileA = null; previewA = null; }}>Change</button>
				</div>
				<button class="btn-primary" onclick={proceedToB}>Next: Card B</button>
			{:else}
				<label class="upload-area">
					<input type="file" accept="image/*" onchange={handleFileA} hidden />
					<div class="upload-content">
						<div class="upload-icon">A</div>
						<span>Photograph or select Card A</span>
					</div>
				</label>
			{/if}
		</div>

	{:else if phase === 'captureB'}
		<div class="capture-phase">
			<h2>Card B</h2>
			<p class="hint">Upload the second card image (same card, different copy)</p>
			{#if previewB}
				<div class="preview-wrap">
					<img src={previewB} alt="Card B" class="card-preview" />
					<button class="change-btn" onclick={() => { imageFileB = null; previewB = null; }}>Change</button>
				</div>
				<button class="btn-primary" onclick={runComparison}>Compare Cards</button>
			{:else}
				<label class="upload-area">
					<input type="file" accept="image/*" onchange={handleFileB} hidden />
					<div class="upload-content">
						<div class="upload-icon">B</div>
						<span>Photograph or select Card B</span>
					</div>
				</label>
			{/if}
			<button class="btn-text" onclick={() => { phase = 'captureA'; }}>Back to Card A</button>
		</div>

	{:else if phase === 'processing'}
		<div class="processing">
			<div class="spinner"></div>
			<p>Loading OpenCV and analyzing cards...</p>
			<p class="hint">This may take a moment on first use</p>
		</div>

	{:else if result}
		<div class="results">
			<!-- Verdict Badge -->
			<div class="verdict-badge" style="background: {verdictColor(result.recommendation)}20; border-color: {verdictColor(result.recommendation)}">
				<span class="verdict-text" style="color: {verdictColor(result.recommendation)}">{verdictLabel(result.recommendation)}</span>
			</div>

			<!-- Card images side by side -->
			<div class="cards-row">
				<div class="card-col">
					<h3>Card A <span class="score">Score: {result.overallScoreA}</span></h3>
					<div class="card-image-wrap">
						<img src={result.alignedA} alt="Card A aligned" class="aligned-card" />
						{#if showHeatOverlay}
							<img
								src={result.heatOverlayA}
								alt="Heat overlay A"
								class="heat-overlay"
								style="opacity: {overlayOpacity}"
							/>
						{/if}
					</div>
					{#if result.centeringA}
						<div class="centering">L/R: {result.centeringA.lr} | T/B: {result.centeringA.tb}</div>
					{/if}
				</div>
				<div class="card-col">
					<h3>Card B <span class="score">Score: {result.overallScoreB}</span></h3>
					<div class="card-image-wrap">
						<img src={result.alignedB} alt="Card B aligned" class="aligned-card" />
						{#if showHeatOverlay}
							<img
								src={result.heatOverlayB}
								alt="Heat overlay B"
								class="heat-overlay"
								style="opacity: {overlayOpacity}"
							/>
						{/if}
					</div>
					{#if result.centeringB}
						<div class="centering">L/R: {result.centeringB.lr} | T/B: {result.centeringB.tb}</div>
					{/if}
				</div>
			</div>

			<!-- Heat overlay controls -->
			<div class="overlay-controls">
				<label class="toggle-row">
					<input type="checkbox" bind:checked={showHeatOverlay} />
					<span>Show Difference Heat Map</span>
				</label>
				{#if showHeatOverlay}
					<label class="opacity-row">
						<span>Opacity</span>
						<input type="range" min="0.1" max="1" step="0.05" bind:value={overlayOpacity} />
					</label>
				{/if}
			</div>

			<!-- Region scores table -->
			<div class="region-table">
				<h3>Region Analysis</h3>
				<table>
					<thead>
						<tr><th>Region</th><th>Diff %</th></tr>
					</thead>
					<tbody>
						<tr><td>Top-Left Corner</td><td>{result.regions.topLeftCorner.a}%</td></tr>
						<tr><td>Top-Right Corner</td><td>{result.regions.topRightCorner.a}%</td></tr>
						<tr><td>Bottom-Left Corner</td><td>{result.regions.bottomLeftCorner.a}%</td></tr>
						<tr><td>Bottom-Right Corner</td><td>{result.regions.bottomRightCorner.a}%</td></tr>
						<tr><td>Top Edge</td><td>{result.regions.topEdge.a}%</td></tr>
						<tr><td>Bottom Edge</td><td>{result.regions.bottomEdge.a}%</td></tr>
						<tr><td>Left Edge</td><td>{result.regions.leftEdge.a}%</td></tr>
						<tr><td>Right Edge</td><td>{result.regions.rightEdge.a}%</td></tr>
						<tr><td>Center</td><td>{result.regions.center.a}%</td></tr>
					</tbody>
				</table>
			</div>

			<div class="meta-row">
				<span>Processed in {result.processingMs}ms</span>
			</div>

			<button class="btn-primary" onclick={reset}>Compare Again</button>
		</div>
	{/if}
</div>

<style>
	.compare-container {
		max-width: 600px;
		margin: 0 auto;
	}
	.capture-phase {
		text-align: center;
	}
	h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.25rem; }
	h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 0.5rem; }
	.hint { font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 1rem; }
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
		display: flex; flex-direction: column; align-items: center; gap: 0.5rem; color: var(--text-secondary);
	}
	.upload-icon {
		font-size: 1.5rem; font-weight: 800; width: 48px; height: 48px;
		display: flex; align-items: center; justify-content: center;
		border-radius: 50%; background: var(--bg-elevated); color: var(--accent-primary);
	}
	.preview-wrap { position: relative; text-align: center; margin-bottom: 1rem; }
	.card-preview { max-width: 100%; max-height: 300px; border-radius: 12px; object-fit: contain; }
	.change-btn {
		position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.6);
		color: #fff; border: none; border-radius: 8px; padding: 0.375rem 0.75rem;
		font-size: 0.8rem; cursor: pointer;
	}
	.btn-primary {
		width: 100%; padding: 0.875rem; border-radius: 12px; border: none;
		background: var(--accent-primary); color: #fff; font-size: 1rem;
		font-weight: 600; cursor: pointer; margin-top: 1rem;
	}
	.btn-text {
		background: none; border: none; color: var(--text-secondary);
		font-size: 0.85rem; cursor: pointer; margin-top: 0.75rem; text-decoration: underline;
	}
	.processing { text-align: center; padding: 3rem 1rem; }
	.spinner {
		width: 40px; height: 40px; border: 3px solid var(--border-color);
		border-top-color: var(--accent-primary); border-radius: 50%;
		animation: spin 0.8s linear infinite; margin: 0 auto 1rem;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.results { display: flex; flex-direction: column; gap: 1rem; }
	.verdict-badge {
		text-align: center; padding: 0.75rem 1rem; border-radius: 12px;
		border: 1px solid; font-weight: 600;
	}
	.verdict-text { font-size: 0.95rem; }
	.cards-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
	.card-col { text-align: center; }
	.card-image-wrap { position: relative; border-radius: 8px; overflow: hidden; }
	.aligned-card { width: 100%; display: block; border-radius: 8px; }
	.heat-overlay {
		position: absolute; inset: 0; width: 100%; height: 100%;
		mix-blend-mode: multiply; pointer-events: none;
	}
	.score { font-size: 0.75rem; font-weight: 400; color: var(--text-secondary); }
	.centering { font-size: 0.7rem; color: var(--text-tertiary); margin-top: 0.25rem; }
	.overlay-controls {
		background: var(--bg-elevated); border-radius: 10px; padding: 0.75rem 1rem;
	}
	.toggle-row {
		display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; cursor: pointer;
	}
	.opacity-row {
		display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem;
		margin-top: 0.5rem; color: var(--text-secondary);
	}
	.opacity-row input { flex: 1; }
	.region-table {
		background: var(--bg-elevated); border-radius: 10px; padding: 1rem;
	}
	.region-table table { width: 100%; font-size: 0.8rem; border-collapse: collapse; }
	.region-table th {
		text-align: left; padding: 0.375rem 0.5rem; color: var(--text-secondary);
		border-bottom: 1px solid var(--border-color); font-weight: 500;
	}
	.region-table td {
		padding: 0.375rem 0.5rem; border-bottom: 1px solid rgba(148,163,184,0.06);
	}
	.meta-row { font-size: 0.75rem; color: var(--text-tertiary); text-align: center; }
</style>
