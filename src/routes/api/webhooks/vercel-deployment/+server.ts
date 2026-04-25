/**
 * POST /api/webhooks/vercel-deployment
 *
 * Receives Vercel deployment.succeeded events. For each event:
 *   1. Verifies HMAC-SHA1 signature against VERCEL_WEBHOOK_SECRET.
 *   2. Filters to production target (skips preview/dev).
 *   3. Records the deploy in app_deployments.
 *   4. Scans the commit message for `Fixes diag <code>` references.
 *   5. For each referenced short code, looks up the fingerprint and
 *      auto-marks it as 'fixed' via the triage_fingerprint RPC.
 *
 * Idempotent: vercel_deploy_id UNIQUE prevents duplicate deployment rows;
 * triage_fingerprint with same hash + same SHA is a no-op.
 */

import { json, error } from '@sveltejs/kit';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAdminClient } from '$lib/server/supabase-admin';
import { env } from '$env/dynamic/private';
import { logEvent } from '$lib/server/diagnostics';
import type { RequestHandler } from './$types';

const FIXES_REGEX = /fixes\s+diag\s+([a-z0-9]{6})/gi;

interface VercelDeployMeta {
	githubCommitSha?: string;
	gitCommitSha?: string;
	githubCommitMessage?: string;
	gitCommitMessage?: string;
	githubCommitAuthorName?: string;
	gitCommitAuthorName?: string;
}

interface VercelDeploymentPayload {
	type?: string;
	payload?: Record<string, unknown>;
	id?: string;
	url?: string;
	target?: string;
	meta?: VercelDeployMeta;
	deployment?: {
		id?: string;
		url?: string;
		target?: string;
		meta?: VercelDeployMeta;
	};
}

export const POST: RequestHandler = async ({ request }) => {
	const sig = request.headers.get('x-vercel-signature');
	const secret = env.VERCEL_WEBHOOK_SECRET;

	if (!sig || !secret) {
		throw error(401, 'unauthorized');
	}

	// Read raw body for signature verification (must be exact bytes)
	const rawBody = await request.text();

	const expected = createHmac('sha1', secret).update(rawBody).digest('hex');
	const sigBuf = Buffer.from(sig);
	const expBuf = Buffer.from(expected);
	if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
		throw error(401, 'invalid_signature');
	}

	let payload: VercelDeploymentPayload;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		throw error(400, 'invalid_json');
	}

	// Only act on succeeded production deploys
	if (payload?.type !== 'deployment.succeeded') {
		return json({ ignored: 'not a succeeded deployment', type: payload?.type });
	}

	// Vercel webhook payload shape varies slightly across versions. Try multiple paths.
	const deploy = (payload.payload as VercelDeploymentPayload | undefined) ?? payload;
	const deployment = deploy.deployment;
	const target = deploy.target ?? deployment?.target;

	if (target !== 'production') {
		return json({ ignored: 'not production', target });
	}

	const sha =
		deploy.meta?.githubCommitSha ??
		deploy.meta?.gitCommitSha ??
		deployment?.meta?.githubCommitSha ??
		deployment?.meta?.gitCommitSha;

	const commitMessage =
		deploy.meta?.githubCommitMessage ??
		deploy.meta?.gitCommitMessage ??
		deployment?.meta?.githubCommitMessage ??
		'';

	const commitAuthor =
		deploy.meta?.githubCommitAuthorName ??
		deploy.meta?.gitCommitAuthorName ??
		null;

	const deployUrl = deploy.url ?? deployment?.url ?? null;
	const vercelDeployId = deploy.id ?? deployment?.id ?? null;

	if (!sha) {
		void logEvent({
			level: 'warn',
			event: 'webhook.vercel.no_commit_sha',
			source: 'edge',
			context: { payload_keys: Object.keys(deploy ?? {}) }
		});
		return json({ ignored: 'no commit SHA in payload' });
	}

	const admin = getAdminClient();
	if (!admin) throw error(503, 'database_unavailable');

	// Find diag references
	const matches = [...commitMessage.matchAll(FIXES_REGEX)];
	const fixedShortCodes = matches.map((m) => m[1].toLowerCase());

	let fingerprintsFixed: string[] = [];
	if (fixedShortCodes.length > 0) {
		const { data: events } = await admin
			.from('app_events')
			.select('short_code, fingerprint_hash')
			.in('short_code', fixedShortCodes);

		fingerprintsFixed = [
			...new Set(
				(events ?? [])
					.map((e) => e.fingerprint_hash)
					.filter((h): h is string => !!h)
			)
		];
	}

	// Record the deployment row. ON CONFLICT no-op via vercel_deploy_id UNIQUE.
	const { error: insertError } = await admin.from('app_deployments').insert({
		release_git_sha: sha,
		deploy_url: deployUrl,
		deploy_target: 'production',
		commit_message: commitMessage.slice(0, 5000),
		commit_author: commitAuthor,
		vercel_deploy_id: vercelDeployId,
		fingerprints_fixed: fingerprintsFixed
	});

	// 23505 = unique_violation: webhook retry, already recorded
	if (insertError && (insertError as { code?: string }).code !== '23505') {
		void logEvent({
			level: 'error',
			event: 'webhook.vercel.deployment_insert_failed',
			source: 'edge',
			error: insertError,
			context: { sha, vercelDeployId }
		});
	}

	// Mark each fingerprint as fixed via the RPC
	const triageResults: Array<{ hash: string; ok: boolean; error?: string }> = [];
	for (const hash of fingerprintsFixed) {
		const { error: triageError } = await admin.rpc('triage_fingerprint', {
			p_hash: hash,
			p_new_status: 'fixed',
			p_note: `Auto-marked fixed by deploy ${sha.slice(0, 7)}: ${commitMessage.split('\n')[0].slice(0, 200)}`,
			p_author: 'auto',
			p_release_git_sha: sha
		});
		triageResults.push({
			hash,
			ok: !triageError,
			error: triageError?.message
		});
		if (triageError) {
			void logEvent({
				level: 'error',
				event: 'webhook.vercel.triage_fingerprint_failed',
				source: 'edge',
				error: triageError,
				context: { hash, sha }
			});
		}
	}

	void logEvent({
		level: 'info',
		event: 'webhook.vercel.deployment_processed',
		source: 'edge',
		context: {
			sha,
			referenced_codes: fixedShortCodes,
			fingerprints_marked_fixed: fingerprintsFixed,
			triage_results: triageResults
		}
	});

	return json({
		ok: true,
		deploy_sha: sha,
		fingerprints_marked_fixed: fingerprintsFixed,
		referenced_short_codes: fixedShortCodes
	});
};
