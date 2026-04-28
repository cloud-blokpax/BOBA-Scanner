/**
 * Server-side email sender backed by Resend.
 *
 * Single tiny wrapper used by admin/system notifications (deck builder version
 * alerts, future drift warnings, etc.). Failure mode mirrors logEvent: never
 * throws — falls back to console.warn and returns false so callers can decide
 * whether the failure is worth surfacing.
 *
 * Required env vars:
 *   RESEND_API_KEY  — from resend.com dashboard
 *   ADMIN_EMAIL     — recipient for system alerts (e.g. jamespoto@gmail.com)
 *   EMAIL_FROM      — verified sender address (e.g. alerts@boba.cards once the
 *                     boba.cards domain is verified in Resend; until then,
 *                     onboarding@resend.dev works for testing)
 *
 * NEVER imports from client-side code.
 */

import { env } from '$env/dynamic/private';

export interface SendEmailInput {
	to?: string; // defaults to ADMIN_EMAIL
	subject: string;
	html: string;
	text?: string; // optional plain-text fallback; auto-derived from html if absent
	tags?: Array<{ name: string; value: string }>;
}

interface ResendResponse {
	id?: string;
	message?: string;
	name?: string;
	statusCode?: number;
}

/**
 * Send a transactional email. Returns true on success, false on failure.
 * Logs to console.warn on failure (no Supabase dependency to keep the email
 * path independent of whatever else might be broken at the time).
 */
export async function sendAdminEmail(input: SendEmailInput): Promise<boolean> {
	const apiKey = env.RESEND_API_KEY;
	const from = env.EMAIL_FROM;
	const to = input.to ?? env.ADMIN_EMAIL;

	if (!apiKey || !from || !to) {
		console.warn(
			'[email] Skipped sendAdminEmail: missing RESEND_API_KEY, EMAIL_FROM, or recipient'
		);
		return false;
	}

	const text = input.text ?? htmlToText(input.html);

	try {
		const res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from,
				to: [to],
				subject: input.subject,
				html: input.html,
				text,
				tags: input.tags
			})
		});

		const body = (await res.json()) as ResendResponse;

		if (!res.ok || body.message) {
			console.warn(
				`[email] Resend rejected message: status=${res.status} body=${JSON.stringify(body).slice(0, 500)}`
			);
			return false;
		}

		return true;
	} catch (err) {
		console.warn('[email] Resend request failed:', err instanceof Error ? err.message : err);
		return false;
	}
}

/**
 * Crude HTML → text fallback. Strips tags and decodes a few common entities.
 * Good enough for plain-text email clients that don't render HTML; we don't
 * need pixel-perfect formatting in the fallback.
 */
function htmlToText(html: string): string {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<\/li>/gi, '\n')
		.replace(/<li>/gi, '  • ')
		.replace(/<\/h[1-6]>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
