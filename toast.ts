import { createBrowserClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
import type { Database } from '$lib/types/database';

export const supabase = createBrowserClient<Database>(
	env.PUBLIC_SUPABASE_URL ?? '',
	env.PUBLIC_SUPABASE_ANON_KEY ?? ''
);
