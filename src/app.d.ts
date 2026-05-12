import type { SupabaseClient, Session, User } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import type { AppUser } from '$lib/types';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient<Database>;
			safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
			user: User | null;
			session: Session | null;
			/**
			 * Set by `throwLogged()` to suppress the apiErrorMirror handle
			 * from writing a duplicate `app_events` row for the same failure.
			 * Do not read or set this directly outside of diagnostics + hooks.
			 */
			__diagLogged?: boolean;
		}

		interface PageData {
			session: Session | null;
			user: AppUser | null;
		}
	}
}

export {};
