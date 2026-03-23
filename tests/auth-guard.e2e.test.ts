/**
 * End-to-end tests for authentication hooks and route guards.
 *
 * Tests the auth flow: Supabase client init, session validation,
 * and route protection for authenticated-only pages.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────

const mockGetSession = vi.fn();
const mockGetUser = vi.fn();
const mockCreateServerClient = vi.fn();

vi.mock('@supabase/ssr', () => ({
	createServerClient: (...args: unknown[]) => mockCreateServerClient(...args)
}));

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
		PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key'
	}
}));

vi.mock('@sveltejs/kit/hooks', () => ({
	sequence: (...handlers: any[]) => {
		// Return a combined handler that runs handlers in sequence
		return async (opts: any) => {
			let result: any;
			for (const handler of handlers) {
				result = await handler({
					...opts,
					resolve: opts.resolve || ((event: any) => ({ status: 200 }))
				});
			}
			return result;
		};
	}
}));

import { handle } from '../src/hooks.server';

// ── Helpers ──────────────────────────────────────────────────

function makeEvent(pathname: string, overrides: Record<string, unknown> = {}) {
	return {
		url: new URL(`http://localhost${pathname}`),
		cookies: {
			getAll: vi.fn().mockReturnValue([]),
			set: vi.fn()
		},
		locals: {} as Record<string, unknown>,
		getClientAddress: () => '127.0.0.1',
		...overrides
	};
}

function mockResolve(event: any) {
	return Promise.resolve({ status: 200, headers: new Headers() });
}

// ── Tests ────────────────────────────────────────────────────

describe('Auth Hooks E2E', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Default: authenticated user
		mockGetSession.mockResolvedValue({
			data: { session: { access_token: 'test-token' } }
		});
		mockGetUser.mockResolvedValue({
			data: { user: { id: 'user-1', email: 'test@example.com' } },
			error: null
		});

		mockCreateServerClient.mockReturnValue({
			auth: {
				getSession: mockGetSession,
				getUser: mockGetUser
			}
		});
	});

	describe('supabase client initialization', () => {
		it('creates Supabase server client with correct config', async () => {
			const event = makeEvent('/');
			await handle({ event, resolve: mockResolve } as any);

			expect(mockCreateServerClient).toHaveBeenCalledWith(
				'https://test.supabase.co',
				'test-anon-key',
				expect.objectContaining({
					cookies: expect.any(Object)
				})
			);
		});

		it('sets safeGetSession on event.locals', async () => {
			const event = makeEvent('/');
			await handle({ event, resolve: mockResolve } as any);

			expect(event.locals.safeGetSession).toBeDefined();
			expect(typeof event.locals.safeGetSession).toBe('function');
		});

		it('populates user and session on event.locals', async () => {
			const event = makeEvent('/');
			await handle({ event, resolve: mockResolve } as any);

			expect(event.locals.user).toEqual({ id: 'user-1', email: 'test@example.com' });
			expect(event.locals.session).toEqual({ access_token: 'test-token' });
		});
	});

	describe('safeGetSession security', () => {
		it('returns null user when getSession returns no session', async () => {
			mockGetSession.mockResolvedValue({ data: { session: null } });

			const event = makeEvent('/');
			await handle({ event, resolve: mockResolve } as any);

			const result = await event.locals.safeGetSession();
			expect(result.user).toBeNull();
			expect(result.session).toBeNull();
		});

		it('returns null user when getUser validation fails', async () => {
			mockGetUser.mockResolvedValue({
				data: { user: null },
				error: new Error('JWT expired')
			});

			const event = makeEvent('/');
			await handle({ event, resolve: mockResolve } as any);

			const result = await event.locals.safeGetSession();
			expect(result.user).toBeNull();
			expect(result.session).toBeNull();
		});

		it('validates JWT via getUser, not just session cookies', async () => {
			const event = makeEvent('/');
			await handle({ event, resolve: mockResolve } as any);
			await event.locals.safeGetSession();

			// Must call getUser() for server-side JWT validation
			expect(mockGetUser).toHaveBeenCalled();
		});
	});

	describe('route protection', () => {
		const protectedRoutes = [
			'/collection',
			'/deck',
			'/admin',
			'/grader',
			'/export',
			'/marketplace',
			'/set-completion',
			'/tournaments'
		];

		for (const route of protectedRoutes) {
			it(`redirects unauthenticated users from ${route}`, async () => {
				mockGetSession.mockResolvedValue({ data: { session: null } });
				mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

				const event = makeEvent(route);

				try {
					await handle({ event, resolve: mockResolve } as any);
					// If no error thrown, the redirect should have happened
					expect(true).toBe(false); // Should not reach here
				} catch (err: any) {
					expect(err.status).toBe(303);
					expect(err.location).toContain('/auth/login');
					expect(err.location).toContain(encodeURIComponent(route));
				}
			});
		}

		it('allows unauthenticated access to public routes', async () => {
			mockGetSession.mockResolvedValue({ data: { session: null } });
			mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

			const event = makeEvent('/');
			const result = await handle({ event, resolve: mockResolve } as any);
			// Should not throw — public route is accessible
			expect(result).toBeDefined();
		});

		it('allows authenticated access to protected routes', async () => {
			const event = makeEvent('/collection');
			const result = await handle({ event, resolve: mockResolve } as any);
			expect(result).toBeDefined();
		});

		it('allows unauthenticated access to /scan', async () => {
			mockGetSession.mockResolvedValue({ data: { session: null } });
			mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

			const event = makeEvent('/scan');
			const result = await handle({ event, resolve: mockResolve } as any);
			expect(result).toBeDefined();
		});
	});
});

describe('Auth Hooks — Supabase not configured', () => {
	it('provides no-op auth when Supabase env vars are missing', async () => {
		// Override the mock to simulate missing config
		vi.doMock('$env/dynamic/public', () => ({
			env: {
				PUBLIC_SUPABASE_URL: '',
				PUBLIC_SUPABASE_ANON_KEY: ''
			}
		}));

		// Re-import to get fresh module
		vi.resetModules();
		const { handle: handleFresh } = await import('../src/hooks.server');

		const event = makeEvent('/');
		await handleFresh({ event, resolve: mockResolve } as any);

		expect(event.locals.safeGetSession).toBeDefined();
		const result = await event.locals.safeGetSession();
		expect(result.user).toBeNull();
		expect(result.session).toBeNull();
	});
});
