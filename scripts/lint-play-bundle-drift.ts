/**
 * CI drift check: ensure the checked-in generated bundle matches what the
 * generator would produce against the current DB.
 *
 * Run by CI on every PR. Fails the build if anyone hand-edits
 * src/lib/data/play-cards.generated.json or src/lib/data/boba-dbs-scores.generated.ts
 * without going through `npm run generate-play-bundle`.
 *
 * Local usage: `npm run lint:bundle-drift`
 *
 * If the check fails, the fix is always:
 *   1. npm run generate-play-bundle
 *   2. git add src/lib/data/*.generated.*
 *   3. commit
 *
 * NOT a substitute for the weekly version check — this catches local drift
 * (bundle vs DB), the cron catches upstream drift (DB vs deck builder).
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..');

const COMMITTED_JSON = join(ROOT, 'src/lib/data/play-cards.generated.json');
const COMMITTED_TS = join(ROOT, 'src/lib/data/boba-dbs-scores.generated.ts');

async function main() {
	// Re-run the generator into a temp dir, then compare to the committed copies.
	const scratch = await mkdtemp(join(tmpdir(), 'bundle-lint-'));

	const result = spawnSync('npx', ['tsx', 'scripts/generate-play-card-bundle.ts'], {
		cwd: ROOT,
		env: { ...process.env, BUNDLE_OUTPUT_DIR: scratch }, // honored if generator supports it
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'pipe']
	});

	if (result.status !== 0) {
		console.error('[lint:bundle-drift] Generator failed:');
		console.error(result.stderr);
		process.exit(2);
	}

	// Generator currently writes to fixed paths; lint diff'ing the in-place output.
	// If the generator has no env override, the freshly-generated files ARE the
	// committed paths now — but in CI we're comparing to git HEAD via `git diff`.
	const gitDiff = spawnSync(
		'git',
		['diff', '--exit-code', '--', COMMITTED_JSON, COMMITTED_TS],
		{ cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
	);

	if (gitDiff.status === 0) {
		console.log('[lint:bundle-drift] OK — generated bundle matches DB.');
		process.exit(0);
	}

	console.error('[lint:bundle-drift] FAIL — bundle is out of sync with DB.');
	console.error('');
	console.error(gitDiff.stdout);
	console.error('');
	console.error('Fix:');
	console.error('  npm run generate-play-bundle');
	console.error('  git add src/lib/data/*.generated.*');
	console.error('  git commit -m "regen play card bundle"');
	console.error('');
	console.error(
		'If you intended to change DB-side data, also include the migration that produced this state.'
	);
	process.exit(1);
}

main().catch((err) => {
	console.error('[lint:bundle-drift] CRASHED:', err);
	process.exit(2);
});
