// Weekly storage health check — Supabase Edge Function.
//
// Triggered by QStash on a weekly schedule (recommended: `0 9 * * 1`,
// Monday 09:00 UTC). Reads three RPCs added in migration 075 and the
// archive_watermark table from migration 061, logs a snapshot to
// storage_health_log, and emits an alert payload if any threshold is
// crossed.
//
// Auth: `Authorization: Bearer <CRON_SECRET>`. CRON_SECRET is the same
// shared secret the SvelteKit cron routes use.
//
// Out of scope: email/SMS alerting (logs only), auto-remediation,
// historical trending (query storage_health_log directly).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const STORAGE_THRESHOLDS = {
	total_db_mb: 8000, // 8 GB ceiling
	archival_tables_mb: 500, // archival tables should stay well below
	storage_buckets_mb: 100 // migrating to R2; expected to shrink
};

// Archive cron runs daily. Anything older than 25h means the cron is stuck.
const ARCHIVE_STALE_HOURS = 25;

interface ArchiveStatus {
	table: string;
	last_run: string | null;
	rows_archived: number | null;
	age_hours: number | null;
}

interface StorageMetrics {
	total_db_mb: number;
	archival_tables_mb: number;
	storage_buckets_mb: number;
	largest_table: { name: string; size_mb: number };
	archive_status: ArchiveStatus[];
}

Deno.serve(async (req) => {
	const authHeader = req.headers.get('authorization');
	const cronSecret = Deno.env.get('CRON_SECRET');
	if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
		return new Response('Unauthorized', { status: 401 });
	}

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	if (!supabaseUrl || !serviceRoleKey) {
		return new Response(
			JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured' }),
			{ status: 503, headers: { 'Content-Type': 'application/json' } }
		);
	}

	const supabase = createClient(supabaseUrl, serviceRoleKey);

	try {
		const [dbSizeRes, archivalRes, bucketRes, watermarkRes] = await Promise.all([
			supabase.rpc('get_database_size'),
			supabase.rpc('get_archival_table_sizes'),
			supabase.rpc('get_storage_bucket_sizes'),
			supabase
				.from('archive_watermark')
				.select('source_table, last_run_at, last_run_rows')
				.eq('app_id', 'card-scanner')
				.order('source_table')
		]);

		if (dbSizeRes.error) throw new Error(`get_database_size: ${dbSizeRes.error.message}`);
		if (archivalRes.error) throw new Error(`get_archival_table_sizes: ${archivalRes.error.message}`);
		if (bucketRes.error) throw new Error(`get_storage_bucket_sizes: ${bucketRes.error.message}`);
		if (watermarkRes.error) throw new Error(`archive_watermark: ${watermarkRes.error.message}`);

		const dbSizeRows = (dbSizeRes.data ?? []) as Array<{ size_mb: number }>;
		const archivalRows = (archivalRes.data ?? []) as Array<{ name: string; size_mb: number }>;
		const bucketRows = (bucketRes.data ?? []) as Array<{ bucket: string; size_mb: number }>;
		const watermarkRows = (watermarkRes.data ?? []) as Array<{
			source_table: string;
			last_run_at: string | null;
			last_run_rows: number | null;
		}>;

		const totalDbMb = Number(dbSizeRows[0]?.size_mb ?? 0);
		const archivalTablesMb = archivalRows.reduce((sum, t) => sum + Number(t.size_mb ?? 0), 0);
		const storageBucketsMb = bucketRows.reduce((sum, b) => sum + Number(b.size_mb ?? 0), 0);
		const largestTable = archivalRows[0] ?? { name: 'none', size_mb: 0 };

		const archiveStatus: ArchiveStatus[] = watermarkRows.map((w) => ({
			table: w.source_table,
			last_run: w.last_run_at,
			rows_archived: w.last_run_rows,
			age_hours: w.last_run_at
				? Math.round((Date.now() - new Date(w.last_run_at).getTime()) / (1000 * 60 * 60))
				: null
		}));

		const metrics: StorageMetrics = {
			total_db_mb: totalDbMb,
			archival_tables_mb: Number(archivalTablesMb.toFixed(2)),
			storage_buckets_mb: Number(storageBucketsMb.toFixed(2)),
			largest_table: { name: largestTable.name, size_mb: Number(largestTable.size_mb) },
			archive_status: archiveStatus
		};

		const alerts: string[] = [];

		if (metrics.total_db_mb > STORAGE_THRESHOLDS.total_db_mb) {
			alerts.push(
				`Total DB (${metrics.total_db_mb} MB) exceeds ${STORAGE_THRESHOLDS.total_db_mb} MB threshold`
			);
		}
		if (metrics.archival_tables_mb > STORAGE_THRESHOLDS.archival_tables_mb) {
			alerts.push(
				`Archival tables (${metrics.archival_tables_mb} MB) exceed ${STORAGE_THRESHOLDS.archival_tables_mb} MB threshold`
			);
		}
		if (metrics.storage_buckets_mb > STORAGE_THRESHOLDS.storage_buckets_mb) {
			alerts.push(
				`Storage buckets (${metrics.storage_buckets_mb} MB) exceed ${STORAGE_THRESHOLDS.storage_buckets_mb} MB threshold`
			);
		}

		const staleArchives = metrics.archive_status.filter(
			(a) => a.age_hours === null || a.age_hours > ARCHIVE_STALE_HOURS
		);
		if (staleArchives.length > 0) {
			alerts.push(
				`Archive system stale for: ${staleArchives.map((a) => a.table).join(', ')}`
			);
		}

		const { error: logErr } = await supabase.from('storage_health_log').insert({
			total_db_mb: metrics.total_db_mb,
			archival_tables_mb: metrics.archival_tables_mb,
			storage_buckets_mb: metrics.storage_buckets_mb,
			largest_table_name: metrics.largest_table.name,
			largest_table_mb: metrics.largest_table.size_mb,
			alerts: alerts.length > 0 ? alerts : null
		});
		if (logErr) {
			console.error('storage_health_log insert failed:', logErr.message);
		}

		if (alerts.length > 0) {
			console.error('STORAGE ALERTS:\n' + alerts.join('\n'));
		}

		return new Response(
			JSON.stringify({
				status: alerts.length > 0 ? 'alert' : 'healthy',
				metrics,
				alerts
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('Storage health check failed:', message);
		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
});
