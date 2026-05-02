import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth/require-admin';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { DetectorTrainingLabel, LabelState } from '$lib/types/detector-labels';

const VALID_STATES: LabelState[] = [
	'auto_pending',
	'auto_labelled',
	'auto_failed',
	'human_confirmed',
	'human_corrected',
	'rejected'
];

interface RowWithCard extends DetectorTrainingLabel {
	cards: {
		name: string | null;
		hero_name: string | null;
		card_number: string | null;
		parallel: string | null;
	} | null;
}

export const load: PageServerLoad = async (event) => {
	await requireAdmin(event);

	const admin = getAdminClient();
	const url = event.url;

	const stateParam = url.searchParams.get('state') ?? 'auto_labelled';
	const stateFilter: LabelState = VALID_STATES.includes(stateParam as LabelState)
		? (stateParam as LabelState)
		: 'auto_labelled';

	const minScore = Number.isFinite(parseFloat(url.searchParams.get('min_score') ?? ''))
		? parseFloat(url.searchParams.get('min_score') ?? '0')
		: 0;
	const maxScore = Number.isFinite(parseFloat(url.searchParams.get('max_score') ?? ''))
		? parseFloat(url.searchParams.get('max_score') ?? '1')
		: 1;

	if (!admin) {
		return {
			rows: [] as RowWithCard[],
			stateFilter,
			minScore,
			maxScore,
			totals: {} as Record<string, number>
		};
	}

	// Active-learning queue: lowest auto_quality_score first within auto_labelled.
	// Other states sort by oldest-pending so reviewers tackle the longest-waiting
	// items first.
	const orderColumn = stateFilter === 'auto_labelled' ? 'auto_quality_score' : 'created_at';
	const orderAscending = true;

	const { data: rows, error: rowsError } = await admin
		// detector_training_labels isn't in the regenerated database types yet —
		// the table is brand new (migration 20260502000007). Cast at the call
		// site rather than hand-edit the generated types file.
		.from('detector_training_labels' as never)
		.select('*, cards(name, hero_name, card_number, parallel)')
		.eq('label_state', stateFilter)
		.gte('auto_quality_score', minScore)
		.lte('auto_quality_score', maxScore)
		.order(orderColumn, { ascending: orderAscending })
		.limit(50);

	if (rowsError) {
		console.error('[admin/detector-labels] load failed', rowsError);
		return {
			rows: [] as RowWithCard[],
			stateFilter,
			minScore,
			maxScore,
			totals: {} as Record<string, number>
		};
	}

	// Totals strip — counts by state. PostgREST doesn't aggregate without an
	// RPC, so pull just the state column and tally client-side. Cheap on a
	// table this small.
	const { data: totalsRaw } = await admin
		.from('detector_training_labels' as never)
		.select('label_state');

	const totals: Record<string, number> = {};
	for (const r of (totalsRaw as { label_state: string }[] | null) ?? []) {
		totals[r.label_state] = (totals[r.label_state] ?? 0) + 1;
	}

	return {
		rows: (rows ?? []) as unknown as RowWithCard[],
		stateFilter,
		minScore,
		maxScore,
		totals
	};
};
