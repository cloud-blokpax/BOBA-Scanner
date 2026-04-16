import { json, error } from '@sveltejs/kit';
import { requireAuth, requireSupabase, parseJsonBody, requireString, requireEmail } from '$lib/server/validate';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import { getAdminClient } from '$lib/server/supabase-admin';
import { calculateTotalDbs } from '$lib/data/boba-dbs-scores';
import { incrementPersona } from '$lib/services/persona';

// Tournament lookup + player count + validation + DBS calc + upsert
export const config = { maxDuration: 60 };

import type { RequestHandler } from './$types';
import type { Card } from '$lib/types';
import type { DeckValidationResult } from '$lib/services/deck-validator';

function generateVerificationCode(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

interface HeroCardInput {
	card_id?: string;
	card_number: string;
	hero_name: string;
	power: number;
	weapon_type: string;
	parallel?: string;
	set_code: string;
	rarity?: string;
}

interface PlayEntryInput {
	card_number: string;
	name: string;
	set_code: string;
	dbs_score?: number;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAuth(locals);
	const supabase = requireSupabase(locals);

	const rateLimit = await checkHeavyMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, {
			status: 429,
			headers: {
				'X-RateLimit-Limit': String(rateLimit.limit),
				'X-RateLimit-Remaining': String(rateLimit.remaining),
				'X-RateLimit-Reset': String(rateLimit.reset)
			}
		});
	}

	// Reject oversized payloads (100KB max for deck submissions)
	const contentLength = Number(request.headers.get('content-length') || 0);
	if (contentLength > 102_400) {
		throw error(413, 'Request body too large (max 100KB)');
	}

	try {
	const body = await parseJsonBody(request);

	const tournamentId = requireString(body.tournament_id, 'tournament_id');
	const playerName = requireString(body.player_name, 'player_name', 100);
	const playerEmail = requireEmail(body.player_email);

	// Load tournament and check registration status
	const { data: tournament, error: tournamentErr } = await supabase
		.from('tournaments')
		.select('*')
		.eq('id', tournamentId)
		.single();

	if (tournamentErr && tournamentErr.code !== 'PGRST116') {
		console.error('[tournament/submit-deck] Tournament lookup failed:', tournamentErr.message);
		throw error(500, 'Failed to load tournament');
	}
	if (!tournament) throw error(404, 'Tournament not found');
	if (!tournament.is_active) throw error(400, 'Tournament is not active');
	if (tournament.registration_closed) throw error(400, 'Registration is closed');

	// Check deadline
	if (tournament.submission_deadline) {
		const deadline = new Date(tournament.submission_deadline);
		if (new Date() > deadline) {
			throw error(400, 'Submission deadline has passed');
		}
	}

	// Check max players (single query to reduce race window)
	if (tournament.max_players) {
		const [{ count }, { data: existingSub }] = await Promise.all([
			supabase
				.from('deck_submissions')
				.select('*', { count: 'exact', head: true })
				.eq('tournament_id', tournamentId),
			supabase
				.from('deck_submissions')
				.select('id')
				.eq('tournament_id', tournamentId)
				.eq('user_id', user.id)
				.maybeSingle()
		]);

		if (!existingSub && count !== null && count >= tournament.max_players) {
			throw error(400, 'Tournament is full');
		}
	}

	// Validate card arrays
	const heroCards = body.hero_cards as HeroCardInput[] | undefined;
	const playEntries = (body.play_entries || []) as PlayEntryInput[];
	const hotDogCount = (body.hot_dog_count as number) || 0;
	const foilHotDogCount = (body.foil_hot_dog_count as number) || 0;
	const isSealed = (tournament as Record<string, unknown>).deck_type === 'sealed';

	if (!Array.isArray(heroCards)) {
		throw error(400, 'Hero cards must be an array');
	}
	if (!isSealed && heroCards.length === 0) {
		throw error(400, 'Hero cards are required');
	}
	if (heroCards.length === 0 && playEntries.length === 0) {
		throw error(400, 'At least one card is required');
	}
	if (heroCards.length > 100) {
		throw error(400, 'Too many hero cards (max 100)');
	}
	if (playEntries.length > 75) {
		throw error(400, 'Too many play entries (max 75)');
	}

	// Run server-side validation (skip for sealed tournaments)
	const formatId = tournament.format_id || 'apex_playmaker';
	let validation: DeckValidationResult;

	if (isSealed) {
		const sealedViolations: { rule: string; message: string; severity: 'error' | 'warning' }[] = [];

		// Validate hero count
		if (heroCards.length > tournament.max_heroes) {
			sealedViolations.push({
				rule: 'sealed_hero_count',
				message: `Too many heroes: ${heroCards.length}/${tournament.max_heroes}`,
				severity: 'error'
			});
		}

		// Validate play count (standard + bonus)
		const maxTotalPlays = tournament.max_plays + (tournament.max_bonus || 0);
		if (playEntries.length > maxTotalPlays) {
			sealedViolations.push({
				rule: 'sealed_play_count',
				message: `Too many plays: ${playEntries.length}/${maxTotalPlays}`,
				severity: 'error'
			});
		}

		// Check for duplicate heroes (by card_id or card_number+parallel)
		const heroKeys = heroCards.map(c => c.card_id || `${c.card_number}:${c.parallel || 'base'}`);
		const dupeHeroKeys = heroKeys.filter((key, i) => key && heroKeys.indexOf(key) !== i);
		if (dupeHeroKeys.length > 0) {
			sealedViolations.push({
				rule: 'sealed_duplicate_heroes',
				message: `Duplicate heroes found (${[...new Set(dupeHeroKeys)].length} duplicates)`,
				severity: 'error'
			});
		}

		// Check for duplicate plays (by card_number)
		const playNums = playEntries.map(p => p.card_number);
		const dupePlayNums = playNums.filter((num, i) => num && playNums.indexOf(num) !== i);
		if (dupePlayNums.length > 0) {
			sealedViolations.push({
				rule: 'sealed_duplicate_plays',
				message: `Duplicate plays found (${[...new Set(dupePlayNums)].length} duplicates)`,
				severity: 'error'
			});
		}

			const sealedTotalPower = heroCards.reduce((sum, c) => sum + (c.power || 0), 0);
		const powers = heroCards.map(c => c.power || 0);
		validation = {
			isValid: sealedViolations.length === 0,
			formatId,
			formatName: 'Sealed',
			violations: sealedViolations,
			warnings: [],
			stats: {
				totalHeroes: heroCards.length,
				totalPower: sealedTotalPower,
				averagePower: heroCards.length > 0
					? Math.round((sealedTotalPower / heroCards.length) * 10) / 10
					: 0,
				maxPower: powers.length > 0 ? Math.max(...powers) : 0,
				minPower: powers.length > 0 ? Math.min(...powers) : 0,
				uniqueVariations: heroCards.length,
				powerLevelCounts: {},
				weaponCounts: {},
				parallelCounts: {},
				madnessUnlockedInserts: [],
				madnessTotalApexAllowed: 0,
				dbsTotal: calculateTotalDbs(playEntries.map(p => ({ cardNumber: p.card_number, setCode: p.set_code })))?.total
					?? playEntries.reduce((sum, p) => sum + (p.dbs_score || 0), 0)
			}
		};
	} else {
		const { validateDeck } = await import('$lib/services/deck-validator');

		const heroCardsForValidation: Card[] = heroCards.map((c) => ({
			id: c.card_id || '',
			card_number: c.card_number,
			hero_name: c.hero_name,
			name: c.hero_name,
			power: c.power,
			weapon_type: c.weapon_type,
			parallel: c.parallel || 'base',
			set_code: c.set_code,
			rarity: null,
			athlete_name: null,
			battle_zone: null,
			image_url: null,
			created_at: ''
		}));

		const playCardsForValidation: Card[] = playEntries.map((p) => ({
			id: '',
			card_number: p.card_number,
			name: p.name,
			hero_name: null,
			power: null,
			weapon_type: null,
			parallel: null,
			set_code: p.set_code,
			rarity: null,
			athlete_name: null,
			battle_zone: null,
			image_url: null,
			created_at: ''
		}));

		validation = validateDeck(heroCardsForValidation, formatId, playCardsForValidation, []);
	}

	// Compute stats
	const powers = heroCards.map((c) => c.power || 0);
	const totalPower = powers.reduce((sum, p) => sum + p, 0);
	const avgPower =
		heroCards.length > 0 ? Math.round((totalPower / heroCards.length) * 10) / 10 : 0;
	const dbsTotal = playEntries.reduce((sum, p) => sum + (p.dbs_score || 0), 0);

	const verificationCode = generateVerificationCode();

	// Upsert the submission — use admin client to bypass RLS for upsert
	const adminClient = getAdminClient() || supabase;
	const submissionData = {
		tournament_id: tournamentId,
		user_id: user.id,
		player_name: playerName,
		player_email: playerEmail,
		player_discord: (body.player_discord as string) || null,
		hero_cards: heroCards as unknown as Record<string, unknown>[],
		play_entries: playEntries as unknown as Record<string, unknown>[],
		hot_dog_count: hotDogCount,
		foil_hot_dog_count: foilHotDogCount,
		format_id: formatId,
		format_name: validation.formatName,
		is_valid: validation.isValid,
		validation_violations: validation.violations as unknown as Record<string, unknown>[],
		validation_warnings: validation.warnings,
		validation_stats: validation.stats as unknown as Record<string, unknown>,
		dbs_total: dbsTotal,
		hero_count: heroCards.length,
		total_power: totalPower,
		avg_power: avgPower,
		source_deck_id: (body.source_deck_id as string) || null,
		status: 'submitted' as const,
		submitted_at: new Date().toISOString(),
		last_updated_at: new Date().toISOString(),
		verification_code: verificationCode
	};

	// Detect first-time submission so persona tracking only credits the user
	// once per tournament — resubmits update the existing row and must not
	// compound the persona weight.
	const { data: priorSub } = await adminClient
		.from('deck_submissions')
		.select('id')
		.eq('tournament_id', tournamentId)
		.eq('user_id', user.id)
		.maybeSingle();
	const isFirstSubmission = !priorSub;

	const { data: submission, error: subErr } = await adminClient
		.from('deck_submissions')
		.upsert(submissionData, { onConflict: 'tournament_id,user_id' })
		.select()
		.single();

	if (subErr) {
		console.error('[tournament/submit-deck] Submission failed:', subErr);
		throw error(500, 'Failed to submit deck');
	}

	if (isFirstSubmission) {
		// Phase 5A: passive persona tracking. Fire-and-forget.
		// Use locals.supabase (user-scoped) so the RPC's auth.uid() resolves.
		incrementPersona(locals.supabase, 'tournament');
	}

	return json({
		success: true,
		submission_id: submission.id,
		verification_code: verificationCode,
		is_valid: validation.isValid,
		violations: validation.violations,
		warnings: validation.warnings,
		stats: validation.stats,
		verify_url: `/deck/verify/${verificationCode}`
	});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[tournament/submit-deck] Unexpected error:', err);
		throw error(500, 'Internal server error');
	}
};
