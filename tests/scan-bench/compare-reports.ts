/**
 * Diff two BenchReport JSONs and surface deltas.
 * Used to compare baseline vs post-rebuild.
 *
 * Usage:
 *   tsx tests/scan-bench/compare-reports.ts <baseline.json> <new.json>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.argv.length < 4) {
	console.error('Usage: compare-reports.ts <baseline.json> <new.json>');
	process.exit(1);
}

const baselinePath = resolve(process.argv[2]);
const newPath = resolve(process.argv[3]);

interface MinReport {
	totalImages: number;
	results: Array<{
		filename: string;
		groundTruth: { condition: string };
		match: {
			fullMatch: boolean;
			cardNumberCorrect: boolean;
			nameCorrect: boolean;
			parallelCorrect: boolean;
		};
		latencyMs: number;
	}>;
	summary: {
		overall: {
			fullMatch: number;
			cardNumberCorrect: number;
			nameCorrect: number;
			parallelCorrect: number;
		};
		byCondition: Record<string, { fullMatch: number; total: number; avgLatencyMs: number }>;
		avgLatencyMs: number;
		haikuFallbackRate: number;
	};
}

const a: MinReport = JSON.parse(readFileSync(baselinePath, 'utf-8'));
const b: MinReport = JSON.parse(readFileSync(newPath, 'utf-8'));

const dFull = b.summary.overall.fullMatch - a.summary.overall.fullMatch;
const dCN = b.summary.overall.cardNumberCorrect - a.summary.overall.cardNumberCorrect;
const dName = b.summary.overall.nameCorrect - a.summary.overall.nameCorrect;
const dPar = b.summary.overall.parallelCorrect - a.summary.overall.parallelCorrect;
const dLat = b.summary.avgLatencyMs - a.summary.avgLatencyMs;
const dHaiku = b.summary.haikuFallbackRate - a.summary.haikuFallbackRate;

console.log('=== OVERALL DELTA ===');
console.log(
	`Full match:        ${a.summary.overall.fullMatch} → ${b.summary.overall.fullMatch} (${signed(dFull)})`
);
console.log(
	`Card number:       ${a.summary.overall.cardNumberCorrect} → ${b.summary.overall.cardNumberCorrect} (${signed(dCN)})`
);
console.log(
	`Name:              ${a.summary.overall.nameCorrect} → ${b.summary.overall.nameCorrect} (${signed(dName)})`
);
console.log(
	`Parallel:          ${a.summary.overall.parallelCorrect} → ${b.summary.overall.parallelCorrect} (${signed(dPar)})`
);
console.log(
	`Avg latency:       ${a.summary.avgLatencyMs}ms → ${b.summary.avgLatencyMs}ms (${signed(dLat)}ms)`
);
console.log(
	`Haiku fallback:    ${(a.summary.haikuFallbackRate * 100).toFixed(1)}% → ${(b.summary.haikuFallbackRate * 100).toFixed(1)}% (${signed(dHaiku * 100, 1)}pp)`
);

console.log('\n=== BY CONDITION ===');
const conditions = new Set([
	...Object.keys(a.summary.byCondition),
	...Object.keys(b.summary.byCondition)
]);
for (const c of [...conditions].sort()) {
	const aC = a.summary.byCondition[c];
	const bC = b.summary.byCondition[c];
	if (!aC || !bC) continue;
	const dM = bC.fullMatch - aC.fullMatch;
	const dL = bC.avgLatencyMs - aC.avgLatencyMs;
	console.log(
		`  ${c}: ${aC.fullMatch}/${aC.total} → ${bC.fullMatch}/${bC.total} (${signed(dM)})  latency ${aC.avgLatencyMs}ms → ${bC.avgLatencyMs}ms (${signed(dL)}ms)`
	);
}

console.log('\n=== PER-FILE FLIPS ===');
const aByFile = new Map(a.results.map((r) => [r.filename, r]));
const flips: string[] = [];
for (const r of b.results) {
	const prev = aByFile.get(r.filename);
	if (!prev) continue;
	if (prev.match.fullMatch !== r.match.fullMatch) {
		const arrow = prev.match.fullMatch ? '✅→❌ REGRESSION' : '❌→✅ FIX';
		flips.push(`  ${arrow}  ${r.filename}`);
	}
}
if (flips.length === 0) console.log('  (no flips)');
else console.log(flips.join('\n'));

const regressions = flips.filter((f) => f.includes('REGRESSION')).length;
if (regressions > 0) {
	console.log(`\n⚠️  ${regressions} regression(s) detected. Review before deploy.`);
	process.exit(2);
}

function signed(n: number, decimals = 0): string {
	if (n === 0) return '±0';
	const sign = n > 0 ? '+' : '';
	return `${sign}${n.toFixed(decimals)}`;
}
