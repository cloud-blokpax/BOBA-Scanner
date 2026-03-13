// Supabase database type definitions (generated from schema)
// These types enable proper TypeScript checking with Supabase client

export interface Database {
	public: {
		Tables: {
			cards: {
				Row: {
					id: string;
					card_id_legacy: string | null;
					name: string;
					hero_name: string | null;
					athlete_name: string | null;
					set_code: string;
					card_number: string | null;
					power: number | null;
					rarity: string | null;
					weapon_type: string | null;
					battle_zone: string | null;
					image_url: string | null;
					year: number | null;
					parallel: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					card_id_legacy?: string | null;
					name: string;
					hero_name?: string | null;
					athlete_name?: string | null;
					set_code: string;
					card_number?: string | null;
					power?: number | null;
					rarity?: string | null;
					weapon_type?: string | null;
					battle_zone?: string | null;
					image_url?: string | null;
					year?: number | null;
					parallel?: string | null;
				};
				Update: Partial<Database['public']['Tables']['cards']['Insert']>;
				Relationships: [];
			};
			collections_v2: {
				Row: {
					id: string;
					user_id: string;
					card_id: string;
					quantity: number;
					condition: string;
					notes: string | null;
					added_at: string;
				};
				Insert: {
					id?: string;
					user_id?: string;
					card_id: string;
					quantity?: number;
					condition?: string;
					notes?: string | null;
				};
				Update: Partial<Database['public']['Tables']['collections_v2']['Insert']>;
				Relationships: [
					{
						foreignKeyName: 'collections_v2_card_id_fkey';
						columns: ['card_id'];
						isOneToOne: false;
						referencedRelation: 'cards';
						referencedColumns: ['id'];
					}
				];
			};
			scans: {
				Row: {
					id: string;
					user_id: string;
					card_id: string | null;
					image_path: string | null;
					scan_method: string;
					confidence: number | null;
					processing_ms: number | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					card_id?: string | null;
					image_path?: string | null;
					scan_method?: string;
					confidence?: number | null;
					processing_ms?: number | null;
				};
				Update: Partial<Database['public']['Tables']['scans']['Insert']>;
				Relationships: [];
			};
			price_cache: {
				Row: {
					card_id: string;
					source: string;
					price_low: number | null;
					price_mid: number | null;
					price_high: number | null;
					listings_count: number | null;
					fetched_at: string;
				};
				Insert: {
					card_id: string;
					source?: string;
					price_low?: number | null;
					price_mid?: number | null;
					price_high?: number | null;
					listings_count?: number | null;
					fetched_at?: string;
				};
				Update: Partial<Database['public']['Tables']['price_cache']['Insert']>;
				Relationships: [];
			};
			hash_cache: {
				Row: {
					phash: string;
					card_id: string;
					confidence: number;
					scan_count: number;
					last_seen: string;
				};
				Insert: {
					phash: string;
					card_id: string;
					confidence: number;
					scan_count?: number;
					last_seen?: string;
				};
				Update: Partial<Database['public']['Tables']['hash_cache']['Insert']>;
				Relationships: [];
			};
			users: {
				Row: {
					id: string;
					google_id: string;
					email: string;
					name: string | null;
					picture: string | null;
					auth_user_id: string | null;
					card_limit: number;
					api_calls_limit: number;
					api_calls_used: number;
					cards_in_collection: number;
					is_admin: boolean;
					is_member: boolean;
					member_until: string | null;
					created_at: string;
				};
				Insert: {
					google_id: string;
					email: string;
					name?: string | null;
					picture?: string | null;
					auth_user_id?: string | null;
				};
				Update: Partial<Database['public']['Tables']['users']['Insert']>;
				Relationships: [];
			};
			system_settings: {
				Row: {
					key: string;
					value: string;
				};
				Insert: {
					key: string;
					value: string;
				};
				Update: Partial<Database['public']['Tables']['system_settings']['Insert']>;
				Relationships: [];
			};
			feature_flags: {
				Row: {
					feature_key: string;
					display_name: string;
					description: string | null;
					enabled_globally: boolean;
					enabled_for_guest: boolean;
					enabled_for_authenticated: boolean;
					enabled_for_member: boolean;
					enabled_for_admin: boolean;
					updated_at: string;
				};
				Insert: {
					feature_key: string;
					display_name: string;
					description?: string | null;
					enabled_globally?: boolean;
					enabled_for_guest?: boolean;
					enabled_for_authenticated?: boolean;
					enabled_for_member?: boolean;
					enabled_for_admin?: boolean;
					updated_at?: string;
				};
				Update: Partial<Database['public']['Tables']['feature_flags']['Insert']>;
				Relationships: [];
			};
			tournaments: {
				Row: {
					id: string;
					creator_id: string;
					code: string;
					name: string;
					max_heroes: number;
					max_plays: number;
					max_bonus: number;
					usage_count: number;
					is_active: boolean;
					created_at: string;
				};
				Insert: {
					creator_id: string;
					code: string;
					name: string;
					max_heroes?: number;
					max_plays?: number;
					max_bonus?: number;
					is_active?: boolean;
					usage_count?: number;
				};
				Update: Partial<Database['public']['Tables']['tournaments']['Insert']>;
				Relationships: [];
			};
			themes: {
				Row: {
					id: string;
					name: string;
					description: string | null;
					config: Record<string, unknown>;
					is_public: boolean;
					created_by: string | null;
					created_at: string;
				};
				Insert: {
					name: string;
					config: Record<string, unknown>;
					description?: string | null;
					is_public?: boolean;
					created_by?: string | null;
				};
				Update: Partial<Database['public']['Tables']['themes']['Insert']>;
				Relationships: [];
			};
			scan_metrics: {
				Row: {
					id: string;
					scan_method: string;
					processing_ms: number;
					confidence: number | null;
					cache_hit: boolean;
					created_at: string;
				};
				Insert: {
					scan_method: string;
					processing_ms: number;
					confidence?: number | null;
					cache_hit?: boolean;
				};
				Update: Partial<Database['public']['Tables']['scan_metrics']['Insert']>;
				Relationships: [];
			};
		};
		Views: Record<string, never>;
		Functions: Record<string, never>;
		Enums: Record<string, never>;
		CompositeTypes: Record<string, never>;
	};
}
