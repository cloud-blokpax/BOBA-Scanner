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
			requestId: string;
		}

		interface PageData {
			session: Session | null;
			user: AppUser | null;
		}
	}
}

export {};
