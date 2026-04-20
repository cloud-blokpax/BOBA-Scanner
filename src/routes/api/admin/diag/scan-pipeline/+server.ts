/**
 * GET /api/admin/diag/scan-pipeline
 *
 * Phase 1 / Session 1.1.1d — diagnostic endpoint for the new scan pipeline.
 *
 * New-pipeline tables (scan_sessions, scans, scan_tier_results) are
 * receiving zero rows despite successful end-to-end scans. This endpoint
 * exercises each DB write stage using the *user's authenticated Supabase
 * client* so any RLS or schema failure that would silently bail in
 * production fails loudly here.
 *
 * Never uses service role for the tests themselves — only for cleanup
 * (service-role cascade delete, since user-side delete policies on these
 * tables are not guaranteed).
 *
 * Idempotent, read-mostly: creates throwaway rows marked with the
 * '1.1.1d-diagnostic' / '1.1.1d-diag' version strings and deletes them
 * before returning. Any rows that escape can be swept with:
 *   DELETE FROM scan_sessions WHERE app_version = '1.1.1d-diagnostic';
 */

import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

type Stage = {
	name: string;
	ok: boolean;
	detail: unknown;
};

export const GET: RequestHandler = async ({ locals }) => {
	const user = await requireAdmin(locals);
	const stages: Stage[] = [];

	// ── Stage 1: auth identity ──────────────────────────────────────
	stages.push({
		name: 'auth_identity',
		ok: true,
		detail: {
			auth_user_id: user.id,
			email: user.email,
			role: user.role ?? null,
			app_metadata_keys: Object.keys(user.app_metadata ?? {}),
			has_session: Boolean(user.id)
		}
	});

	const userClient = locals.supabase;
	if (!userClient) {
		stages.push({
			name: 'user_client_available',
			ok: false,
			detail: 'locals.supabase is null — auth hook may be broken'
		});
		return json({ verdict: 'failed_at_user_client_available', auth_user_id: user.id, stages });
	}

	// ── Stage 2: public.users profile lookup (what flag store does) ─
	try {
		const { data: profile, error: profileErr } = await userClient
			.from('users')
			.select('id, auth_user_id, is_admin, is_pro')
			.eq('auth_user_id', user.id)
			.maybeSingle();
		stages.push({
			name: 'users_profile_select',
			ok: !profileErr,
			detail: profileErr
				? { code: profileErr.code, message: profileErr.message }
				: { profile }
		});
	} catch (err) {
		stages.push({
			name: 'users_profile_select',
			ok: false,
			detail: err instanceof Error ? err.message : String(err)
		});
	}

	// ── Stage 3: feature_flags SELECT ───────────────────────────────
	try {
		const { data: flags, error: flagsErr } = await userClient
			.from('feature_flags')
			.select('feature_key, enabled_globally, enabled_for_admin, enabled_for_authenticated');
		stages.push({
			name: 'feature_flags_select',
			ok: !flagsErr,
			detail: flagsErr
				? { code: flagsErr.code, message: flagsErr.message }
				: {
						count: flags?.length ?? 0,
						keys: (flags ?? []).map((f) => f.feature_key),
						new_scan_pipeline:
							(flags ?? []).find((f) => f.feature_key === 'new_scan_pipeline') ?? null
					}
		});
	} catch (err) {
		stages.push({
			name: 'feature_flags_select',
			ok: false,
			detail: err instanceof Error ? err.message : String(err)
		});
	}

	// ── Stage 4: INSERT scan_sessions (the first pipeline DB write) ──
	let throwawaySessionId: string | null = null;
	try {
		const { data: sess, error: sessErr } = await userClient
			.from('scan_sessions')
			.insert({
				user_id: user.id,
				game_id: 'boba',
				app_version: '1.1.1d-diagnostic',
				capabilities: { diag: true },
				extras: { diag_origin: 'api/admin/diag/scan-pipeline' }
			})
			.select('id')
			.single();
		if (sessErr || !sess) {
			stages.push({
				name: 'scan_sessions_insert',
				ok: false,
				detail: sessErr
					? { code: sessErr.code, message: sessErr.message, hint: sessErr.hint, details: sessErr.details }
					: 'no row returned'
			});
		} else {
			throwawaySessionId = sess.id;
			stages.push({
				name: 'scan_sessions_insert',
				ok: true,
				detail: { session_id: sess.id }
			});
		}
	} catch (err) {
		stages.push({
			name: 'scan_sessions_insert',
			ok: false,
			detail: err instanceof Error ? err.message : String(err)
		});
	}

	// ── Stage 5: INSERT scans (second pipeline DB write) ────────────
	let throwawayScanId: string | null = null;
	if (throwawaySessionId) {
		try {
			const { data: scan, error: scanErr } = await userClient
				.from('scans')
				.insert({
					session_id: throwawaySessionId,
					user_id: user.id,
					game_id: 'boba',
					pipeline_version: '1.1.1d-diag',
					outcome: 'pending',
					capture_context: { diag: true },
					quality_signals: {},
					extras: { diag_origin: 'api/admin/diag/scan-pipeline' }
				})
				.select('id')
				.single();
			if (scanErr || !scan) {
				stages.push({
					name: 'scans_insert',
					ok: false,
					detail: scanErr
						? { code: scanErr.code, message: scanErr.message, hint: scanErr.hint, details: scanErr.details }
						: 'no row returned'
				});
			} else {
				throwawayScanId = scan.id;
				stages.push({
					name: 'scans_insert',
					ok: true,
					detail: { scan_id: scan.id }
				});
			}
		} catch (err) {
			stages.push({
				name: 'scans_insert',
				ok: false,
				detail: err instanceof Error ? err.message : String(err)
			});
		}
	}

	// ── Stage 6: INSERT scan_tier_results (third pipeline DB write) ──
	if (throwawayScanId) {
		try {
			const { error: trErr } = await userClient
				.from('scan_tier_results')
				.insert({
					scan_id: throwawayScanId,
					user_id: user.id,
					tier: 'tier3_claude',
					engine: 'claude_haiku',
					engine_version: '1.1.1d-diag',
					raw_output: { diag: true }
				});
			stages.push({
				name: 'scan_tier_results_insert',
				ok: !trErr,
				detail: trErr
					? { code: trErr.code, message: trErr.message, hint: trErr.hint, details: trErr.details }
					: 'ok'
			});
		} catch (err) {
			stages.push({
				name: 'scan_tier_results_insert',
				ok: false,
				detail: err instanceof Error ? err.message : String(err)
			});
		}
	}

	// ── Cleanup: service-role cascade DELETE of the throwaway rows ──
	// User-client DELETE may be blocked by RLS depending on how owner-
	// delete policies are shaped. Service-role cleanup is reliable and
	// the FK ON DELETE CASCADE handles scans + scan_tier_results.
	const adminClient = getAdminClient();
	if (adminClient && throwawaySessionId) {
		try {
			const { error: delErr } = await adminClient
				.from('scan_sessions')
				.delete()
				.eq('id', throwawaySessionId);
			stages.push({
				name: 'cleanup_throwaway',
				ok: !delErr,
				detail: delErr ? { message: delErr.message } : 'ok'
			});
		} catch (err) {
			stages.push({
				name: 'cleanup_throwaway',
				ok: false,
				detail: err instanceof Error ? err.message : String(err)
			});
		}
	} else if (!adminClient) {
		stages.push({
			name: 'cleanup_throwaway',
			ok: false,
			detail: 'service-role admin client not available — throwaway rows may persist'
		});
	}

	// ── Verdict ─────────────────────────────────────────────────────
	const failedStage = stages.find((s) => !s.ok);
	const verdict = failedStage ? `failed_at_${failedStage.name}` : 'all_stages_ok';

	return json({
		verdict,
		auth_user_id: user.id,
		stages
	});
};
