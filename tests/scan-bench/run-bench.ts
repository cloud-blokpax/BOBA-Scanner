/**
 * Scan pipeline benchmark runner.
 *
 * Runs the production scan pipeline against tests/scan-bench/images/ and
 * emits a JSON report at tests/scan-bench/reports/{ISO timestamp}.json.
 *
 * Implementation note: the scan pipeline (recognition.ts, paddle-ocr.ts,
 * upload-card-detector.ts) depends on browser globals (ImageBitmap,
 * OffscreenCanvas, fetch for ONNX models, the OpenCV.js global). We run
 * inside a headless Playwright Chromium against a dev-server-served test
 * page (/test/scan-bench) that loads the actual production pipeline.
 *
 * This means the harness measures the REAL pipeline behavior, not a Node
 * approximation. Latency numbers are real. OCR confidences are real.
 */

import { chromium, type Page } from 'playwright';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_ROOT = __dirname;
const IMAGES_DIR = resolve(BENCH_ROOT, 'images');
const REPORTS_DIR = resolve(BENCH_ROOT, 'reports');
const GROUND_TRUTH_PATH = resolve(BENCH_ROOT, 'ground-truth.json');

const DEV_SERVER = process.env.BENCH_DEV_SERVER || 'http://localhost:5173';
const BENCH_PAGE_URL = `${DEV_SERVER}/test/scan-bench`;

interface GroundTruthEntry {
	card_number: string;
	name: string;
	parallel: string;
	game: 'boba' | 'wonders';
	condition: string;
}

interface PipelineResult {
	cardNumber: string | null;
	name: string | null;
	parallel: string | null;
	cardId: string | null;
	confidence: number;
	winningTier: string | null;
	fallbackUsed: string | null;
	ocrStrategy: string | null;
	_raw?: {
		ocrCardNumber: string | null;
		ocrName: string | null;
		ocrSetCode?: string | null;
		resolvedRow: {
			id: string;
			card_number: string;
			name: string;
			parallel: string | null;
			game_id: string | null;
			set_code: string | null;
		} | null;
		resolverPath: string | null;
		geometry?: {
			detection_method: 'corner_detected' | 'centered_fallback';
			detection_layer: string | null;
			px_per_mm: number | null;
			aspect_ratio: number | null;
			rectification_applied: boolean;
			canonical_size: string;
			corners: Array<{ x: number; y: number }> | null;
		};
	};
}

interface BenchResult {
	filename: string;
	groundTruth: GroundTruthEntry;
	pipeline: PipelineResult;
	match: {
		cardNumberCorrect: boolean;
		nameCorrect: boolean;
		parallelCorrect: boolean;
		fullMatch: boolean;
	};
	latencyMs: number;
	errors: string[];
}

interface BenchReport {
	generatedAt: string;
	appBuildSha: string | null;
	pipelineVersion: string | null;
	totalImages: number;
	results: BenchResult[];
	summary: {
		overall: {
			fullMatch: number;
			cardNumberCorrect: number;
			nameCorrect: number;
			parallelCorrect: number;
		};
		byCondition: Record<string, { fullMatch: number; total: number; avgLatencyMs: number }>;
		byCard: Record<string, { fullMatch: number; total: number }>;
		avgLatencyMs: number;
		haikuFallbackRate: number;
	};
}

async function main() {
	if (!existsSync(IMAGES_DIR)) {
		console.error(`[bench] images dir not found at ${IMAGES_DIR}. See README.`);
		process.exit(1);
	}
	if (!existsSync(GROUND_TRUTH_PATH)) {
		console.error(`[bench] ground-truth.json not found. See README.`);
		process.exit(1);
	}
	if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

	const groundTruth: Record<string, GroundTruthEntry> = JSON.parse(
		readFileSync(GROUND_TRUTH_PATH, 'utf-8')
	);

	const imageFiles = readdirSync(IMAGES_DIR)
		.filter((f) => /\.(jpe?g|png|heic)$/i.test(f))
		.sort();

	if (imageFiles.length === 0) {
		console.error(`[bench] no images found in ${IMAGES_DIR}. See README.`);
		process.exit(1);
	}

	const missingGt = imageFiles.filter((f) => !groundTruth[f]);
	if (missingGt.length > 0) {
		console.error('[bench] images missing ground-truth entries:', missingGt);
		process.exit(1);
	}

	console.log(`[bench] Found ${imageFiles.length} images. Launching headless Chromium…`);

	const browser = await chromium.launch({ headless: true });
	let page: Page | null = null;
	const results: BenchResult[] = [];

	try {
		page = await browser.newPage();
		page.on('console', (msg) => {
			if (msg.type() === 'error') console.error(`[browser] ${msg.text()}`);
		});

		await page.goto(BENCH_PAGE_URL, { waitUntil: 'networkidle' });
		await page.waitForFunction('window.__SCAN_BENCH_READY === true', { timeout: 60_000 });

		if (process.env.BENCH_DUMP_CANONICAL === 'true') {
			await page.evaluate(() => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(window as any).__BENCH_DUMP_CANONICAL = true;
			});
			console.log('[bench] BENCH_DUMP_CANONICAL=true; saving canonicals to tests/scan-bench/canonicals/');
			mkdirSync(resolve(BENCH_ROOT, 'canonicals'), { recursive: true });
		}

		for (const filename of imageFiles) {
			const gt = groundTruth[filename];
			const filePath = resolve(IMAGES_DIR, filename);
			const buf = readFileSync(filePath);
			const base64 = buf.toString('base64');
			const lower = filename.toLowerCase();
			const mime = lower.endsWith('.png')
				? 'image/png'
				: lower.endsWith('.heic')
					? 'image/heic'
					: 'image/jpeg';
			const dataUrl = `data:${mime};base64,${base64}`;

			console.log(`[bench] ${filename} (${gt.condition})…`);

			const start = Date.now();
			let pipelineResult: PipelineResult | null = null;
			const errors: string[] = [];

			// Retry once on context-destroyed / function-missing errors.
			// Bench seen on 9/20 photos post-Doc-1: page navigates mid-run,
			// __runBenchScan disappears. Re-acquire the page and try again.
			for (let attempt = 0; attempt < 2 && !pipelineResult; attempt++) {
				try {
					// Verify __runBenchScan exists before evaluating.
					const exists = await page.evaluate(
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						() => typeof (window as any).__runBenchScan === 'function'
					);
					if (!exists) {
						console.warn(`[bench] ${filename}: __runBenchScan missing, re-acquiring page...`);
						await page.goto(BENCH_PAGE_URL, { waitUntil: 'domcontentloaded' });
						await page.waitForFunction('window.__SCAN_BENCH_READY === true', {
							timeout: 60_000
						});
					}

					pipelineResult = (await page.evaluate(
						async ([url, game]) =>
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							(window as any).__runBenchScan(url, game),
						[dataUrl, gt.game]
					)) as PipelineResult;
				} catch (err) {
					errors.push(`attempt ${attempt + 1}: ${String(err)}`);
					if (attempt === 0) {
						// Force re-navigate before retry.
						try {
							await page.goto(BENCH_PAGE_URL, { waitUntil: 'domcontentloaded' });
							await page.waitForFunction('window.__SCAN_BENCH_READY === true', {
								timeout: 60_000
							});
						} catch (navErr) {
							errors.push(`re-navigate failed: ${String(navErr)}`);
						}
					}
				}
			}

			const latencyMs = Date.now() - start;

			// Doc 1.1 — dump rectified canonical PNG for visual inspection.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const dumpBytes = (pipelineResult as any)?._raw?.canonicalPng;
			if (dumpBytes && Array.isArray(dumpBytes)) {
				const out = resolve(BENCH_ROOT, 'canonicals', filename.replace(/\.jpg$/, '.png'));
				writeFileSync(out, Buffer.from(dumpBytes));
				// Strip from result so it doesn't bloat the report JSON.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				delete (pipelineResult as any)._raw.canonicalPng;
			}

			const r: BenchResult = {
				filename,
				groundTruth: gt,
				pipeline: pipelineResult ?? {
					cardNumber: null,
					name: null,
					parallel: null,
					cardId: null,
					confidence: 0,
					winningTier: null,
					fallbackUsed: null,
					ocrStrategy: null
				},
				match: {
					cardNumberCorrect:
						normalizeCardNumber(pipelineResult?.cardNumber) ===
						normalizeCardNumber(gt.card_number),
					nameCorrect: normalizeName(pipelineResult?.name) === normalizeName(gt.name),
					parallelCorrect:
						normalizeParallel(pipelineResult?.parallel) === normalizeParallel(gt.parallel),
					fullMatch: false
				},
				latencyMs,
				errors
			};
			r.match.fullMatch =
				r.match.cardNumberCorrect && r.match.nameCorrect && r.match.parallelCorrect;
			results.push(r);
			console.log(
				`   → ${r.match.fullMatch ? '✅' : '❌'} cn=${r.pipeline.cardNumber} name=${r.pipeline.name} parallel=${r.pipeline.parallel} (${latencyMs}ms)`
			);
		}
	} finally {
		if (page) await page.close();
		await browser.close();
	}

	const report = buildReport(results);
	const ts = new Date().toISOString().replace(/[:.]/g, '-');
	const reportPath = resolve(REPORTS_DIR, `${ts}.json`);
	writeFileSync(reportPath, JSON.stringify(report, null, 2));
	console.log(`\n[bench] Report saved to ${reportPath}`);
	printSummary(report);
	printFailureBreakdown(report);
}

function normalizeCardNumber(s: string | null | undefined): string {
	if (!s) return '';
	return s.toUpperCase().replace(/[^A-Z0-9/-]/g, '').trim();
}

function normalizeName(s: string | null | undefined): string {
	if (!s) return '';
	return s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function normalizeParallel(s: string | null | undefined): string {
	if (!s) return '';
	return s.toLowerCase().replace(/\s+/g, '').trim();
}

function buildReport(results: BenchResult[]): BenchReport {
	const byCondition: BenchReport['summary']['byCondition'] = {};
	const byCard: BenchReport['summary']['byCard'] = {};
	for (const r of results) {
		const c = r.groundTruth.condition;
		if (!byCondition[c]) byCondition[c] = { fullMatch: 0, total: 0, avgLatencyMs: 0 };
		byCondition[c].total++;
		byCondition[c].avgLatencyMs += r.latencyMs;
		if (r.match.fullMatch) byCondition[c].fullMatch++;

		const cardId = r.filename.split('_')[0];
		if (!byCard[cardId]) byCard[cardId] = { fullMatch: 0, total: 0 };
		byCard[cardId].total++;
		if (r.match.fullMatch) byCard[cardId].fullMatch++;
	}
	for (const c of Object.keys(byCondition)) {
		byCondition[c].avgLatencyMs = Math.round(byCondition[c].avgLatencyMs / byCondition[c].total);
	}

	const total = results.length;
	const fullMatch = results.filter((r) => r.match.fullMatch).length;
	const cardNumberCorrect = results.filter((r) => r.match.cardNumberCorrect).length;
	const nameCorrect = results.filter((r) => r.match.nameCorrect).length;
	const parallelCorrect = results.filter((r) => r.match.parallelCorrect).length;
	const haikuFallback = results.filter((r) => r.pipeline.fallbackUsed === 'haiku').length;

	return {
		generatedAt: new Date().toISOString(),
		appBuildSha: process.env.GIT_SHA || null,
		pipelineVersion: null,
		totalImages: total,
		results,
		summary: {
			overall: { fullMatch, cardNumberCorrect, nameCorrect, parallelCorrect },
			byCondition,
			byCard,
			avgLatencyMs: Math.round(results.reduce((a, r) => a + r.latencyMs, 0) / total),
			haikuFallbackRate: total > 0 ? haikuFallback / total : 0
		}
	};
}

function printSummary(r: BenchReport): void {
	console.log('\n=== SUMMARY ===');
	console.log(`Total: ${r.totalImages}`);
	console.log(
		`Full match: ${r.summary.overall.fullMatch}/${r.totalImages} (${(
			(100 * r.summary.overall.fullMatch) /
			r.totalImages
		).toFixed(1)}%)`
	);
	console.log(`Card number correct: ${r.summary.overall.cardNumberCorrect}/${r.totalImages}`);
	console.log(`Name correct: ${r.summary.overall.nameCorrect}/${r.totalImages}`);
	console.log(`Parallel correct: ${r.summary.overall.parallelCorrect}/${r.totalImages}`);
	console.log(`Avg latency: ${r.summary.avgLatencyMs}ms`);
	console.log(`Haiku fallback rate: ${(r.summary.haikuFallbackRate * 100).toFixed(1)}%`);
	console.log('\nBy condition:');
	for (const [c, s] of Object.entries(r.summary.byCondition)) {
		console.log(
			`  ${c}: ${s.fullMatch}/${s.total} (${((100 * s.fullMatch) / s.total).toFixed(0)}%) ` +
				`avg ${s.avgLatencyMs}ms`
		);
	}
	console.log('\nBy card:');
	for (const [cid, s] of Object.entries(r.summary.byCard)) {
		console.log(`  ${cid}: ${s.fullMatch}/${s.total}`);
	}
}

function printFailureBreakdown(r: BenchReport): void {
	// NEW (Doc 1.1) — surface harness-level errors that masked failures
	// as "no _raw" in Doc 1's bench run.
	const errd = r.results.filter((res) => res.errors && res.errors.length > 0);
	if (errd.length > 0) {
		console.log(`\n=== HARNESS ERRORS (${errd.length}/${r.totalImages}) ===`);
		console.log('  These rows hit Playwright/page errors before the pipeline ran.');
		console.log('  If many, the bench page is navigating mid-run — investigate first.');
		for (const res of errd) {
			console.log(`  ${res.filename}: ${res.errors[0].slice(0, 200)}`);
		}
	}

	// Doc 1, Phase 6: geometry detection summary, the single most important
	// signal for whether the rebuild worked.
	const geomCounts = r.results.reduce(
		(acc, res) => {
			const m = res.pipeline._raw?.geometry?.detection_method;
			const l = res.pipeline._raw?.geometry?.detection_layer;
			if (m === 'corner_detected') {
				acc.detected++;
				if (l) {
					acc.byLayer[l] = (acc.byLayer[l] ?? 0) + 1;
				}
			} else if (m === 'centered_fallback') {
				acc.fallback++;
			} else {
				acc.unknown++;
			}
			return acc;
		},
		{ detected: 0, fallback: 0, unknown: 0, byLayer: {} as Record<string, number> }
	);
	const pxs = r.results
		.map((res) => res.pipeline._raw?.geometry?.px_per_mm)
		.filter((v): v is number => typeof v === 'number');
	const avgPx =
		pxs.length > 0 ? (pxs.reduce((a, b) => a + b, 0) / pxs.length).toFixed(2) : 'n/a';
	const layerLines = Object.entries(geomCounts.byLayer)
		.map(([k, v]) => `    ${k}: ${v}`)
		.join('\n');
	console.log(
		`\n=== GEOMETRY ===\n  corner_detected:   ${geomCounts.detected}/${r.totalImages}` +
			(layerLines ? `\n${layerLines}` : '') +
			`\n  centered_fallback: ${geomCounts.fallback}/${r.totalImages}` +
			`\n  unknown:           ${geomCounts.unknown}/${r.totalImages}` +
			`\n  avg px/mm (detected only): ${avgPx}`
	);

	// Doc 2, Phase 4 — set_code populate rate (BoBA only). Wonders rows have
	// no set_code ROI, so their _raw.ocrSetCode stays null/undefined. Counts
	// non-null on BoBA rows only.
	const bobaRows = r.results.filter((res) => res.groundTruth.game === 'boba');
	const setCodePopulated = bobaRows.filter(
		(res) => typeof res.pipeline._raw?.ocrSetCode === 'string' && res.pipeline._raw.ocrSetCode
	).length;
	console.log(
		`\n=== SET_CODE (BoBA only) ===\n  populated: ${setCodePopulated}/${bobaRows.length}`
	);

	const failed = r.results.filter((res) => !res.match.fullMatch);
	if (failed.length === 0) {
		console.log('\nNo failures. Suspicious — verify ground-truth normalization.');
		return;
	}

	console.log(`\n=== FAILURE BREAKDOWN (${failed.length} of ${r.totalImages}) ===`);

	const buckets: Record<string, string[]> = {
		resolver_miss_no_row: [], // OCR ran but no catalog row resolved
		card_number_mismatch: [], // catalog row found but card_number differs (e.g. Wonders 350 vs 350/401)
		name_mismatch: [], // card_number ok, name wrong
		parallel_mismatch: [], // both ok, parallel wrong
		full_miss_ocr_blank: [] // no OCR output at all
	};

	for (const res of failed) {
		const raw = res.pipeline._raw;
		const ocrCN = raw?.ocrCardNumber ?? res.pipeline.cardNumber;
		const ocrN = raw?.ocrName ?? res.pipeline.name;
		const resolved = raw?.resolvedRow ?? null;

		if (!ocrCN && !ocrN) {
			buckets.full_miss_ocr_blank.push(res.filename);
		} else if (!resolved) {
			buckets.resolver_miss_no_row.push(
				`${res.filename}  ocr_cn=${ocrCN ?? '∅'}  ocr_name=${ocrN ?? '∅'}`
			);
		} else if (!res.match.cardNumberCorrect) {
			buckets.card_number_mismatch.push(
				`${res.filename}  expected=${res.groundTruth.card_number}  got=${res.pipeline.cardNumber}`
			);
		} else if (!res.match.nameCorrect) {
			buckets.name_mismatch.push(
				`${res.filename}  expected=${res.groundTruth.name}  got=${res.pipeline.name}`
			);
		} else if (!res.match.parallelCorrect) {
			buckets.parallel_mismatch.push(
				`${res.filename}  expected=${res.groundTruth.parallel}  got=${res.pipeline.parallel}`
			);
		}
	}

	for (const [bucket, items] of Object.entries(buckets)) {
		if (items.length === 0) continue;
		console.log(`\n${bucket} (${items.length}):`);
		for (const i of items) console.log(`  ${i}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
