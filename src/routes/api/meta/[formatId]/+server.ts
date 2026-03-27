/**
 * GET /api/meta/[formatId]
 *
 * Fetches deck submission data for a given tournament format.
 * The client performs meta aggregation via buildMetaSnapshot().
 *
 * Query params:
 *   - days: number of days back to fetch (default 90, max 365)
 *
 * Auth: optional — meta data is public (growth hook).
 * Rate limited via checkCollectionRateLimit.
 *
 * NOTE: The deck_submissions and tournament_results tables may not
 * yet be in the generated Supabase types. Queries use explicit typing
 * until the migration is applied and types are regenerated.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkCollectionRateLimit } from '$lib/server/rate-limit';
import { getFormat } from '$lib/data/tournament-formats';
import type { DeckSubmissionData } from '$lib/services/meta-analyzer';

interface SubmissionRow {
	id: string;
	tournament_id: string;
	user_id: string;
	format_id: string;
	submitted_at: string;
	hero_snapshot: DeckSubmissionData['heroes'] | null;
	play_snapshot: DeckSubmissionData['plays'] | null;
}

interface ResultRow {
	tournament_id: string;
	user_id: string;
	placement: number | null;
	wins: number;
	losses: number;
}

export const GET: RequestHandler = async ({ params, url, locals, getClientAddress }) => {
	const { formatId } = params;

	// Validate format exists
	const format = getFormat(formatId);
	if (!format) {
		return json({ error: 'Unknown format' }, { status: 404 });
	}

	// Rate limit
	const { user } = await locals.safeGetSession();
	const rateLimitKey = user?.id ?? getClientAddress();
	const rateLimit = await checkCollectionRateLimit(rateLimitKey);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, {
			status: 429,
			headers: {
				'Retry-After': String(Math.ceil(rateLimit.reset / 1000)),
				'X-RateLimit-Limit': String(rateLimit.limit),
				'X-RateLimit-Remaining': '0'
			}
		});
	}

	const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '90', 10) || 90));
	const sinceDate = new Date();
	sinceDate.setDate(sinceDate.getDate() - days);
	const sinceISO = sinceDate.toISOString();

	try {
		const supabase = locals.supabase;
		if (!supabase) {
			return json({ submissions: [], formatId, sampleSize: 0 });
		}

		// Fetch submissions — cast to bypass generated types until migration is applied
		const { data: rawSubmissions, error: subError } = await (supabase as unknown as {
			from: (table: string) => {
				select: (cols: string) => {
					eq: (col: string, val: string | boolean) => {
						eq: (col: string, val: string | boolean) => {
							gte: (col: string, val: string) => {
								order: (col: string, opts: { ascending: boolean }) => {
									limit: (n: number) => Promise<{ data: SubmissionRow[] | null; error: unknown }>;
								};
							};
						};
					};
				};
			};
		})
			.from('deck_submissions')
			.select('id, tournament_id, user_id, format_id, submitted_at, hero_snapshot, play_snapshot')
			.eq('format_id', formatId)
			.eq('is_locked', true)
			.gte('submitted_at', sinceISO)
			.order('submitted_at', { ascending: false })
			.limit(200);

		if (subError || !rawSubmissions) {
			return json({ submissions: [], formatId, sampleSize: 0 });
		}

		const submissions = rawSubmissions as SubmissionRow[];

		// Fetch tournament results for win/loss data
		const tournamentIds = [...new Set(submissions.map((s) => s.tournament_id))];
		const userIds = [...new Set(submissions.map((s) => s.user_id))];

		const resultsMap = new Map<string, { wins: number; losses: number; placement: number | null }>();

		if (tournamentIds.length > 0 && userIds.length > 0) {
			const { data: rawResults } = await (supabase as unknown as {
				from: (table: string) => {
					select: (cols: string) => {
						in: (col: string, vals: string[]) => {
							in: (col: string, vals: string[]) => Promise<{ data: ResultRow[] | null; error: unknown }>;
						};
					};
				};
			})
				.from('tournament_results')
				.select('tournament_id, user_id, placement, wins, losses')
				.in('tournament_id', tournamentIds)
				.in('user_id', userIds);

			if (rawResults) {
				for (const r of rawResults as ResultRow[]) {
					const key = `${r.tournament_id}:${r.user_id}`;
					resultsMap.set(key, {
						wins: r.wins || 0,
						losses: r.losses || 0,
						placement: r.placement ?? null
					});
				}
			}
		}

		// Build response — strip user IDs for privacy
		const metaSubmissions: DeckSubmissionData[] = submissions.map((sub) => {
			const resultKey = `${sub.tournament_id}:${sub.user_id}`;
			const result = resultsMap.get(resultKey);

			return {
				submissionId: sub.id,
				formatId: sub.format_id,
				tournamentId: sub.tournament_id,
				eventDate: sub.submitted_at,
				placement: result?.placement ?? null,
				wins: result?.wins ?? 0,
				losses: result?.losses ?? 0,
				heroes: sub.hero_snapshot || [],
				plays: sub.play_snapshot || []
			};
		});

		return json({
			submissions: metaSubmissions,
			formatId,
			sampleSize: metaSubmissions.length
		});
	} catch {
		return json({ submissions: [], formatId, sampleSize: 0 });
	}
};
