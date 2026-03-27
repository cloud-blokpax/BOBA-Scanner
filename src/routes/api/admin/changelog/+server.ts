/**
 * /api/admin/changelog — Changelog CRUD
 *
 * GET: List changelog entries
 * POST: Create new entry
 * PUT: Update existing entry
 * DELETE: Delete entry
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 50, 200));
	const publishedOnly = url.searchParams.get('published') === 'true';

	let query = admin
		.from('changelog_entries')
		.select('*')
		.order('created_at', { ascending: false })
		.limit(limit);

	if (publishedOnly) {
		query = query.eq('published', true);
	}

	const { data, error: dbError } = await query;
	if (dbError) throw error(500, dbError.message);

	return json({ entries: data || [] });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const { user } = await locals.safeGetSession();
	const body = await request.json();
	const { title, body: content, is_notification } = body;

	if (!title?.trim()) throw error(400, 'Title is required');

	const { data, error: dbError } = await admin
		.from('changelog_entries')
		.insert({
			title: title.trim(),
			body: content || '',
			is_notification: is_notification === true,
			created_by: user!.id,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		})
		.select()
		.single();

	if (dbError) throw error(500, dbError.message);

	return json({ entry: data }, { status: 201 });
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const body = await request.json();
	const { id, title, body: content, published, is_notification } = body;

	if (!id) throw error(400, 'Entry ID is required');

	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (title !== undefined) updates.title = title;
	if (content !== undefined) updates.body = content;
	if (published !== undefined) {
		updates.published = published;
		if (published) updates.published_at = new Date().toISOString();
	}
	if (is_notification !== undefined) updates.is_notification = is_notification;

	const { error: dbError } = await admin
		.from('changelog_entries')
		.update(updates)
		.eq('id', id);

	if (dbError) throw error(500, dbError.message);

	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const { id } = await request.json();
	if (!id) throw error(400, 'Entry ID is required');

	const { error: dbError } = await admin
		.from('changelog_entries')
		.delete()
		.eq('id', id);

	if (dbError) throw error(500, dbError.message);

	return json({ success: true });
};
