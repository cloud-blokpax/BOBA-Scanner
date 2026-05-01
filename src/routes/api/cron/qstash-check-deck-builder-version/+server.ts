/**
 * POST /api/cron/qstash-check-deck-builder-version
 *
 * Weekly QStash-triggered check for deck builder catalog drift.
 *
 * Recommended QStash schedule: 0 14 * * 0 (Sundays 14:00 UTC ≈ 9am ET / 6am PT).
 *
 * Behavior:
 *   1. Verify QStash signature (same security model as qstash-harvest).
 *   2. Fetch https://deck-builder.bobattlearena.com/data/cards.json.
 *   3. Compare its `version` field to app_config.deck_builder_version_last_seen.
 *   4. If unchanged: log info-level event, return early.
 *   5. If changed: compute full diff (DBS, hot_dog_cost, name, ability,
 *      inserts, removals) against current public.play_cards.
 *   6. Email the admin with a summary + actionable next steps.
 *   7. Write an app_event so the diff is captured even if email fails.
 *   8. Update last-seen so we don't alert twice for the same upstream version.
 *
 * The cron does NOT auto-apply changes. Catalog updates need a generated
 * migration + bundle regeneration + commit + deploy. The cron's job is
 * detection and alerting; the human-in-the-loop runs the migration generator.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { Receiver } from '@upstash/qstash';
import type { RequestHandler } from './$types';
import { getAdminClient } from '$lib/server/supabase-admin';
import { sendAdminEmail } from '$lib/server/email';
import { logEvent } from '$lib/server/diagnostics';
import { escapeHtml } from '$lib/utils';

export const config = { maxDuration: 60 };

const CARDS_JSON_URL = 'https://deck-builder.bobattlearena.com/data/cards.json';
const LAST_SEEN_KEY = 'deck_builder_version_last_seen';

interface UpstreamCard {
	id: string;
	name: string;
	release: string;
	type: string;
	number: number | string;
	cost: number | null;
	dbs: number;
	ability: string;
	originalId?: string;
}

interface UpstreamPayload {
	version: string;
	generatedAt?: string;
	totalCards?: number;
	cards: UpstreamCard[];
}

interface DbCard {
	id: string;
	name: string;
	dbs: number;
	hot_dog_cost: number | null;
	ability: string;
}

interface DiffSummary {
	dbs_changed: number;
	hot_dog_cost_changed: number;
	name_changed: number;
	ability_changed: number;
	inserted: string[];
	removed: string[];
	top_dbs_movers: Array<{ id: string; name: string; old: number; new: number; delta: number }>;
}

export const POST: RequestHandler = async ({ request, url }) => {
	// ── 1. Verify QStash signature ──────────────────────────
	const currentSigningKey = env.QSTASH_CURRENT_SIGNING_KEY;
	const nextSigningKey = env.QSTASH_NEXT_SIGNING_KEY;

	if (!currentSigningKey || !nextSigningKey) {
		console.error('[check-deck-builder] QStash signing keys not configured');
		return json({ error: 'QStash signing keys not configured' }, { status: 503 });
	}

	const receiver = new Receiver({ currentSigningKey, nextSigningKey });
	const body = await request.text();
	const signature = request.headers.get('upstash-signature') ?? '';

	try {
		const isValid = await receiver.verify({
			signature,
			body,
			url: `${url.origin}/api/cron/qstash-check-deck-builder-version`
		});
		if (!isValid) {
			console.warn('[check-deck-builder] Invalid QStash signature');
			return json({ error: 'Invalid signature' }, { status: 401 });
		}
	} catch (err) {
		console.warn(
			'[check-deck-builder] Signature verification failed:',
			err instanceof Error ? err.message : err
		);
		return json({ error: 'Signature verification failed' }, { status: 401 });
	}

	// ── 2. Fetch upstream cards.json ────────────────────────
	let upstream: UpstreamPayload;
	try {
		const res = await fetch(CARDS_JSON_URL, {
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) {
			throw new Error(`Upstream returned HTTP ${res.status}`);
		}
		upstream = (await res.json()) as UpstreamPayload;
		if (!upstream?.version || !Array.isArray(upstream.cards)) {
			throw new Error('Upstream JSON missing version or cards array');
		}
	} catch (err) {
		await logEvent({
			level: 'error',
			event: 'deck_builder_check.fetch_failed',
			error: err,
			context: { url: CARDS_JSON_URL }
		});
		return json(
			{ status: 'fetch_failed', error: err instanceof Error ? err.message : 'unknown' },
			{ status: 502 }
		);
	}

	const liveVersion = upstream.version;

	// ── 3. Read last-seen version ──────────────────────────
	const admin = getAdminClient();
	if (!admin) {
		console.error('[check-deck-builder] Supabase admin client not configured');
		return json({ error: 'Admin client unavailable' }, { status: 503 });
	}

	const { data: configRow, error: configErr } = await admin
		.from('app_config')
		.select('value')
		.eq('key', LAST_SEEN_KEY)
		.maybeSingle();

	if (configErr) {
		await logEvent({
			level: 'error',
			event: 'deck_builder_check.config_read_failed',
			error: configErr,
			context: { key: LAST_SEEN_KEY }
		});
		return json({ status: 'config_read_failed' }, { status: 500 });
	}

	const lastSeen = typeof configRow?.value === 'string' ? configRow.value : null;

	// ── 4. No-change path ──────────────────────────────────
	if (lastSeen === liveVersion) {
		await logEvent({
			level: 'info',
			event: 'deck_builder_check.no_change',
			context: { version: liveVersion, generated_at: upstream.generatedAt }
		});
		return json({ status: 'no_change', version: liveVersion });
	}

	// ── 5. Compute diff ────────────────────────────────────
	const { data: dbRows, error: dbErr } = await admin
		.from('play_cards')
		.select('id, name, dbs, hot_dog_cost, ability');

	if (dbErr || !dbRows) {
		await logEvent({
			level: 'error',
			event: 'deck_builder_check.db_read_failed',
			error: dbErr ?? new Error('no rows')
		});
		return json({ status: 'db_read_failed' }, { status: 500 });
	}

	const diff = computeDiff(upstream.cards, dbRows as unknown as DbCard[]);

	// ── 6. Email admin ─────────────────────────────────────
	const emailSent = await sendAdminEmail({
		subject: `[Card Scanner] Deck builder catalog updated: ${lastSeen ?? '(none)'} → ${liveVersion}`,
		html: renderEmail({
			oldVersion: lastSeen,
			newVersion: liveVersion,
			generatedAt: upstream.generatedAt,
			diff,
			totalCards: upstream.cards.length
		}),
		tags: [
			{ name: 'category', value: 'catalog_drift' },
			{ name: 'old_version', value: (lastSeen ?? 'none').replace(/[^a-z0-9_-]/gi, '') },
			{ name: 'new_version', value: liveVersion.replace(/[^a-z0-9_-]/gi, '') }
		]
	});

	// ── 7. Write app_event regardless of email success ────
	await logEvent({
		level: 'warn',
		event: 'deck_builder_check.version_changed',
		context: {
			old_version: lastSeen,
			new_version: liveVersion,
			generated_at: upstream.generatedAt,
			diff_summary: diff,
			total_upstream_cards: upstream.cards.length,
			total_db_cards: dbRows.length,
			email_sent: emailSent
		}
	});

	// ── 8. Update last-seen ────────────────────────────────
	const { error: updateErr } = await admin
		.from('app_config')
		.update({
			value: liveVersion,
			description: `Last cards.json version seen by /api/cron/qstash-check-deck-builder-version. Auto-updated when version changes.`,
			updated_at: new Date().toISOString()
		})
		.eq('key', LAST_SEEN_KEY);

	if (updateErr) {
		await logEvent({
			level: 'error',
			event: 'deck_builder_check.config_write_failed',
			error: updateErr,
			context: { key: LAST_SEEN_KEY, attempted_value: liveVersion }
		});
		return json(
			{ status: 'change_detected_but_config_update_failed', diff, email_sent: emailSent },
			{ status: 500 }
		);
	}

	return json({
		status: 'change_detected',
		old_version: lastSeen,
		new_version: liveVersion,
		diff,
		email_sent: emailSent
	});
};

// ── Diff logic ─────────────────────────────────────────────
function computeDiff(upstream: UpstreamCard[], dbRows: DbCard[]): DiffSummary {
	const liveById = new Map(upstream.map((c) => [c.id, c]));
	const dbById = new Map(dbRows.map((r) => [r.id, r]));

	let dbsChanged = 0;
	let hdcChanged = 0;
	let nameChanged = 0;
	let abilityChanged = 0;
	const moversRaw: Array<{ id: string; name: string; old: number; new: number; delta: number }> = [];

	for (const cid of liveById.keys()) {
		const live = liveById.get(cid)!;
		const db = dbById.get(cid);
		if (!db) continue;

		if (live.dbs !== db.dbs) {
			dbsChanged++;
			moversRaw.push({
				id: cid,
				name: live.name,
				old: db.dbs,
				new: live.dbs,
				delta: live.dbs - db.dbs
			});
		}
		if (normCost(live.cost) !== normCost(db.hot_dog_cost)) hdcChanged++;
		if (live.name !== db.name) nameChanged++;
		if (live.ability !== db.ability) abilityChanged++;
	}

	const inserted = [...liveById.keys()].filter((id) => !dbById.has(id));
	const removed = [...dbById.keys()].filter((id) => !liveById.has(id));

	const topMovers = moversRaw
		.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
		.slice(0, 10);

	return {
		dbs_changed: dbsChanged,
		hot_dog_cost_changed: hdcChanged,
		name_changed: nameChanged,
		ability_changed: abilityChanged,
		inserted,
		removed,
		top_dbs_movers: topMovers
	};
}

function normCost(v: number | null | undefined): number | null {
	return v === undefined ? null : v;
}

// ── Email body ─────────────────────────────────────────────
interface RenderEmailInput {
	oldVersion: string | null;
	newVersion: string;
	generatedAt?: string;
	diff: DiffSummary;
	totalCards: number;
}

function renderEmail(input: RenderEmailInput): string {
	const { oldVersion, newVersion, generatedAt, diff, totalCards } = input;
	const totalChanges =
		diff.dbs_changed +
		diff.hot_dog_cost_changed +
		diff.name_changed +
		diff.ability_changed +
		diff.inserted.length +
		diff.removed.length;

	const moverRows = diff.top_dbs_movers
		.map(
			(m) =>
				`<tr><td style="padding:4px 12px 4px 0;font-family:monospace;">${escapeHtml(m.id)}</td>` +
				`<td style="padding:4px 12px 4px 0;">${escapeHtml(m.name)}</td>` +
				`<td style="padding:4px 12px 4px 0;text-align:right;">${m.old}</td>` +
				`<td style="padding:4px 12px 4px 0;text-align:right;">${m.new}</td>` +
				`<td style="padding:4px 12px 4px 0;text-align:right;color:${m.delta > 0 ? '#0a7' : '#c33'};">${m.delta > 0 ? '+' : ''}${m.delta}</td></tr>`
		)
		.join('');

	const insertedList =
		diff.inserted.length > 0
			? `<p><strong>New cards (${diff.inserted.length}):</strong> <code>${diff.inserted.map(escapeHtml).join('</code>, <code>')}</code></p>`
			: '';

	const removedList =
		diff.removed.length > 0
			? `<p><strong>Removed from upstream (${diff.removed.length}):</strong> <code>${diff.removed.map(escapeHtml).join('</code>, <code>')}</code> — investigate before deleting from DB.</p>`
			: '';

	return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#222;">

<h2 style="margin:0 0 4px 0;">Deck builder catalog drift detected</h2>
<p style="color:#666;margin:0 0 24px 0;">Card Scanner weekly version check</p>

<table style="margin-bottom:16px;">
<tr><td style="padding:2px 16px 2px 0;color:#666;">Old version:</td><td><code>${escapeHtml(oldVersion ?? '(none — first run)')}</code></td></tr>
<tr><td style="padding:2px 16px 2px 0;color:#666;">New version:</td><td><strong><code>${escapeHtml(newVersion)}</code></strong></td></tr>
${generatedAt ? `<tr><td style="padding:2px 16px 2px 0;color:#666;">Upstream generated:</td><td>${escapeHtml(generatedAt)}</td></tr>` : ''}
<tr><td style="padding:2px 16px 2px 0;color:#666;">Total upstream cards:</td><td>${totalCards}</td></tr>
<tr><td style="padding:2px 16px 2px 0;color:#666;">Total changes:</td><td><strong>${totalChanges}</strong></td></tr>
</table>

<h3 style="margin-bottom:8px;">Change summary</h3>
<ul style="margin-top:0;">
<li>DBS values changed: <strong>${diff.dbs_changed}</strong></li>
<li>Hot dog costs changed: <strong>${diff.hot_dog_cost_changed}</strong></li>
<li>Names changed: <strong>${diff.name_changed}</strong></li>
<li>Abilities changed: <strong>${diff.ability_changed}</strong></li>
<li>New cards: <strong>${diff.inserted.length}</strong></li>
<li>Cards missing from upstream: <strong>${diff.removed.length}</strong></li>
</ul>

${insertedList}
${removedList}

${
	diff.top_dbs_movers.length > 0
		? `<h3>Top ${diff.top_dbs_movers.length} DBS movers (by absolute delta)</h3>
<table style="border-collapse:collapse;font-size:13px;">
<thead><tr style="border-bottom:1px solid #ddd;text-align:left;">
<th style="padding:4px 12px 4px 0;">ID</th><th style="padding:4px 12px 4px 0;">Name</th>
<th style="padding:4px 12px 4px 0;text-align:right;">Old</th><th style="padding:4px 12px 4px 0;text-align:right;">New</th>
<th style="padding:4px 12px 4px 0;text-align:right;">Δ</th>
</tr></thead>
<tbody>${moverRows}</tbody>
</table>`
		: ''
}

<h3 style="margin-top:24px;">Next steps</h3>
<ol>
<li>Review the diff above. <code>app_events</code> has the full payload if you need it later (event_name = <code>deck_builder_check.version_changed</code>).</li>
<li>Run <code>npm run generate-dbs-migration</code> to produce a new migration file.</li>
<li>Apply the migration via Supabase MCP.</li>
<li>Run <code>npm run generate-play-bundle</code> to regenerate the bundled JSON + DBS_SCORES.</li>
<li>Commit migration + generated files together. Deploy.</li>
</ol>

<p style="margin-top:32px;color:#999;font-size:12px;">
Triggered by QStash weekly cron. Source: <code>/api/cron/qstash-check-deck-builder-version</code>.
</p>

</body></html>`;
}

