/**
 * POST /api/log — Client error logging endpoint
 *
 * Receives batched error logs and stores in Supabase error_logs table.
 * Falls back to console logging when Supabase is unavailable.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

interface ClientError {
	type?: string;
	message?: string;
	file?: string;
	line?: number;
	col?: number;
	stack?: string;
	url?: string;
	ua?: string;
	session?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const errors: ClientError[] = await request.json();

		if (!Array.isArray(errors) || errors.length === 0) {
			return json({ error: 'Expected array of error objects' }, { status: 400 });
		}

		// Rate limit: max 50 errors per request
		const batch = errors.slice(0, 50);

		const supabaseUrl = env.SUPABASE_URL ?? env.PUBLIC_SUPABASE_URL ?? '';
		const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

		if (supabaseUrl && serviceRoleKey) {
			const rows = batch.map((err) => ({
				type: (err.type || 'error').slice(0, 50),
				message: (err.message || '').slice(0, 1000),
				file: (err.file || '').slice(0, 500),
				line: err.line || 0,
				col: err.col || 0,
				stack: (err.stack || '').slice(0, 2000),
				url: (err.url || '').slice(0, 500),
				user_agent: (err.ua || '').slice(0, 300),
				session_id: (err.session || '').slice(0, 20),
				created_at: new Date().toISOString()
			}));

			await fetch(`${supabaseUrl}/rest/v1/error_logs`, {
				method: 'POST',
				headers: {
					apikey: serviceRoleKey,
					Authorization: `Bearer ${serviceRoleKey}`,
					'Content-Type': 'application/json',
					Prefer: 'return=minimal'
				},
				body: JSON.stringify(rows)
			});
		} else {
			for (const err of batch) {
				console.error(`[CLIENT ${err.type}] ${err.message} @ ${err.file}:${err.line}`);
			}
		}

		return new Response(null, { status: 204 });
	} catch (err) {
		console.error('Error log handler failed:', err);
		return new Response(null, { status: 500 });
	}
};
