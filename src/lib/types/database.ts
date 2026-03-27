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
					updated_at: string;
					search_vector: string | null;
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
					updated_at?: string;
				};
				Update: Partial<Database['public']['Tables']['cards']['Insert']>;
				Relationships: [];
			};
			collections: {
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
				Update: Partial<Database['public']['Tables']['collections']['Insert']>;
				Relationships: [
					{
						foreignKeyName: 'collections_card_id_fkey';
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
					google_id: string | null;
					email: string;
					name: string | null;
					picture: string | null;
					auth_user_id: string | null;
					card_limit: number;
					api_calls_limit: number;
					api_calls_used: number;
					cards_in_collection: number;
					is_admin: boolean;
					is_pro: boolean;
					is_organizer: boolean;
					pro_until: string | null;
					discord_id: string | null;
					persona: Record<string, number> | null;
					created_at: string;
				};
				Insert: {
					google_id?: string | null;
					email: string;
					name?: string | null;
					picture?: string | null;
					auth_user_id?: string | null;
					discord_id?: string | null;
					persona?: Record<string, number> | null;
					is_organizer?: boolean;
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
					enabled_for_pro: boolean;
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
					enabled_for_pro?: boolean;
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
					require_email: boolean;
					require_name: boolean;
					require_discord: boolean;
					created_at: string;
					format_id: string | null;
					description: string | null;
					venue: string | null;
					event_date: string | null;
					entry_fee: string | null;
					prize_pool: string | null;
					max_players: number | null;
					submission_deadline: string | null;
					registration_closed: boolean;
					deadline_mode: string;
					results_entered: boolean;
					results_entered_at: string | null;
					results_entered_by: string | null;
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
					require_email?: boolean;
					require_name?: boolean;
					require_discord?: boolean;
					format_id?: string | null;
					description?: string | null;
					venue?: string | null;
					event_date?: string | null;
					entry_fee?: string | null;
					prize_pool?: string | null;
					max_players?: number | null;
					submission_deadline?: string | null;
					registration_closed?: boolean;
					deadline_mode?: string;
					results_entered?: boolean;
					results_entered_at?: string | null;
					results_entered_by?: string | null;
				};
				Update: Partial<Database['public']['Tables']['tournaments']['Insert']>;
				Relationships: [];
			};
			tournament_registrations: {
				Row: {
					id: string;
					tournament_id: string;
					user_id: string | null;
					email: string;
					name: string | null;
					discord_id: string | null;
					deck_csv: string | null;
					created_at: string;
				};
				Insert: {
					tournament_id: string;
					user_id?: string | null;
					email: string;
					name?: string | null;
					discord_id?: string | null;
					deck_csv?: string | null;
				};
				Update: Partial<Database['public']['Tables']['tournament_registrations']['Insert']>;
				Relationships: [
					{
						foreignKeyName: 'tournament_registrations_tournament_id_fkey';
						columns: ['tournament_id'];
						isOneToOne: false;
						referencedRelation: 'tournaments';
						referencedColumns: ['id'];
					}
				];
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
			parallel_rarity_config: {
				Row: {
					id: string;
					parallel_name: string;
					rarity: string;
					sort_order: number;
					updated_at: string;
					updated_by: string | null;
				};
				Insert: {
					parallel_name: string;
					rarity?: string;
					sort_order?: number;
					updated_at?: string;
					updated_by?: string | null;
				};
				Update: Partial<Database['public']['Tables']['parallel_rarity_config']['Insert']>;
				Relationships: [];
			};
			price_history: {
				Row: {
					id: string;
					card_id: string;
					source: string;
					price_low: number | null;
					price_mid: number | null;
					price_high: number | null;
					listings_count: number | null;
					recorded_at: string;
				};
				Insert: {
					card_id: string;
					source?: string;
					price_low?: number | null;
					price_mid?: number | null;
					price_high?: number | null;
					listings_count?: number | null;
					recorded_at?: string;
				};
				Update: Partial<Database['public']['Tables']['price_history']['Insert']>;
				Relationships: [];
			};
			user_feature_overrides: {
				Row: {
					user_id: string;
					feature_key: string;
					enabled: boolean;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					user_id: string;
					feature_key: string;
					enabled?: boolean;
					updated_at?: string;
				};
				Update: Partial<Database['public']['Tables']['user_feature_overrides']['Insert']>;
				Relationships: [];
			};
			ebay_seller_tokens: {
				Row: {
					user_id: string;
					access_token: string;
					access_token_expires_at: string;
					refresh_token: string;
					refresh_token_expires_at: string;
					scopes: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					user_id: string;
					access_token: string;
					access_token_expires_at: string;
					refresh_token: string;
					refresh_token_expires_at: string;
					scopes?: string | null;
					updated_at?: string;
				};
				Update: Partial<Database['public']['Tables']['ebay_seller_tokens']['Insert']>;
				Relationships: [];
			};
			listing_templates: {
				Row: {
					id: string;
					user_id: string;
					card_id: string;
					title: string;
					description: string | null;
					price: number;
					condition: string | null;
					sku: string;
					status: string;
					ebay_listing_id: string | null;
					ebay_listing_url: string | null;
					error_message: string | null;
					created_at: string;
					updated_at: string | null;
				};
				Insert: {
					user_id: string;
					card_id: string;
					title: string;
					description?: string | null;
					price: number;
					condition?: string | null;
					sku: string;
					status?: string;
					ebay_listing_id?: string | null;
					ebay_listing_url?: string | null;
					error_message?: string | null;
					updated_at?: string | null;
				};
				Update: Partial<Database['public']['Tables']['listing_templates']['Insert']>;
				Relationships: [];
			};
			api_call_logs: {
				Row: {
					id: string;
					user_id: string | null;
					call_type: string;
					error_message: string | null;
					success: boolean;
					created_at: string;
				};
				Insert: {
					user_id?: string | null;
					call_type: string;
					error_message?: string | null;
					success?: boolean;
				};
				Update: Partial<Database['public']['Tables']['api_call_logs']['Insert']>;
				Relationships: [];
			};
			app_config: {
				Row: {
					key: string;
					value: unknown;
					description: string | null;
					updated_at: string;
				};
				Insert: {
					key: string;
					value: unknown;
					description?: string | null;
					updated_at?: string;
				};
				Update: Partial<Database['public']['Tables']['app_config']['Insert']>;
				Relationships: [];
			};
			deck_shop_refresh_log: {
				Row: {
					id: string;
					user_id: string;
					card_count: number;
					created_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					card_count?: number;
					created_at?: string;
				};
				Update: Partial<Database['public']['Tables']['deck_shop_refresh_log']['Insert']>;
				Relationships: [];
			};

			user_decks: {
				Row: {
					id: string;
					user_id: string;
					name: string;
					format_id: string;
					is_custom_format: boolean;
					notes: string | null;
					hero_deck_min: number;
					hero_deck_max: number | null;
					play_deck_size: number;
					bonus_plays_max: number;
					hot_dog_deck_size: number;
					dbs_cap: number;
					spec_power_cap: number | null;
					combined_power_cap: number | null;
					hero_card_ids: string[];
					play_entries: unknown[];
					hot_dog_count: number;
					is_shared: boolean;
					created_at: string;
					updated_at: string;
					last_edited_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					name?: string;
					format_id?: string;
					is_custom_format?: boolean;
					notes?: string | null;
					hero_deck_min?: number;
					hero_deck_max?: number | null;
					play_deck_size?: number;
					bonus_plays_max?: number;
					hot_dog_deck_size?: number;
					dbs_cap?: number;
					spec_power_cap?: number | null;
					combined_power_cap?: number | null;
					hero_card_ids?: string[];
					play_entries?: unknown[];
					hot_dog_count?: number;
					is_shared?: boolean;
				};
				Update: Partial<Database['public']['Tables']['user_decks']['Insert']>;
				Relationships: [];
			};
			card_reference_images: {
				Row: {
					card_id: string;
					image_path: string;
					phash: string | null;
					phash_256: string | null;
					confidence: number;
					contributed_by: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					card_id: string;
					image_path: string;
					phash?: string | null;
					phash_256?: string | null;
					confidence: number;
					contributed_by?: string | null;
				};
				Update: Partial<Database['public']['Tables']['card_reference_images']['Insert']>;
				Relationships: [];
			};
			shared_decks: {
				Row: {
					id: string;
					user_id: string;
					name: string;
					format_id: string;
					hero_card_ids: string[];
					play_entries: unknown[];
					view_count: number;
					created_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					name: string;
					format_id: string;
					hero_card_ids?: string[];
					play_entries?: unknown[];
					view_count?: number;
				};
				Update: Partial<Database['public']['Tables']['shared_decks']['Insert']>;
				Relationships: [];
			};
			deck_submissions: {
				Row: {
					id: string;
					tournament_id: string;
					user_id: string;
					player_name: string;
					player_email: string;
					player_discord: string | null;
					hero_cards: unknown[];
					play_entries: unknown[];
					hot_dog_count: number;
					foil_hot_dog_count: number;
					format_id: string;
					format_name: string;
					is_valid: boolean;
					validation_violations: unknown[];
					validation_warnings: unknown[];
					validation_stats: Record<string, unknown>;
					dbs_total: number | null;
					hero_count: number;
					total_power: number;
					avg_power: number | null;
					source_deck_id: string | null;
					status: string;
					submitted_at: string;
					last_updated_at: string;
					locked_at: string | null;
					verification_code: string | null;
				};
				Insert: {
					tournament_id: string;
					user_id: string;
					player_name: string;
					player_email: string;
					player_discord?: string | null;
					hero_cards?: unknown[];
					play_entries?: unknown[];
					hot_dog_count?: number;
					foil_hot_dog_count?: number;
					format_id: string;
					format_name: string;
					is_valid?: boolean;
					validation_violations?: unknown[];
					validation_warnings?: unknown[];
					validation_stats?: Record<string, unknown>;
					dbs_total?: number | null;
					hero_count?: number;
					total_power?: number;
					avg_power?: number | null;
					source_deck_id?: string | null;
					status?: string;
					submitted_at?: string;
					last_updated_at?: string;
					verification_code?: string | null;
				};
				Update: Partial<Database['public']['Tables']['deck_submissions']['Insert']>;
				Relationships: [
					{
						foreignKeyName: 'deck_submissions_tournament_id_fkey';
						columns: ['tournament_id'];
						isOneToOne: false;
						referencedRelation: 'tournaments';
						referencedColumns: ['id'];
					}
				];
			};
			tournament_results: {
				Row: {
					id: string;
					tournament_id: string;
					submission_id: string | null;
					player_name: string;
					player_user_id: string | null;
					final_standing: number;
					placement_label: string | null;
					match_wins: number | null;
					match_losses: number | null;
					match_draws: number | null;
					entered_at: string;
					entered_by: string;
				};
				Insert: {
					tournament_id: string;
					submission_id?: string | null;
					player_name: string;
					player_user_id?: string | null;
					final_standing: number;
					placement_label?: string | null;
					match_wins?: number | null;
					match_losses?: number | null;
					match_draws?: number | null;
					entered_by: string;
				};
				Update: Partial<Database['public']['Tables']['tournament_results']['Insert']>;
				Relationships: [
					{
						foreignKeyName: 'tournament_results_tournament_id_fkey';
						columns: ['tournament_id'];
						isOneToOne: false;
						referencedRelation: 'tournaments';
						referencedColumns: ['id'];
					}
				];
			};
			community_corrections: {
				Row: {
					id: string;
					ocr_reading: string;
					correct_card_number: string;
					confirmation_count: number;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					ocr_reading: string;
					correct_card_number: string;
					confirmation_count?: number;
				};
				Update: Partial<Database['public']['Tables']['community_corrections']['Insert']>;
				Relationships: [];
			};
		};
		Views: Record<string, never>;
		Functions: {
			find_similar_hash: {
				Args: { query_hash: string; max_distance?: number };
				Returns: Array<{ phash: string; card_id: string; confidence: number; scan_count: number; distance: number; phash_256?: string }>;
			};
			upsert_hash_cache: {
				Args: { p_phash: string; p_card_id: string; p_confidence?: number; p_phash_256?: string };
				Returns: void;
			};
			submit_correction: {
				Args: { p_ocr_reading: string; p_correct_card_number: string };
				Returns: void;
			};
			lookup_correction: {
				Args: { p_ocr_reading: string };
				Returns: Array<{ correct_card_number: string; confirmation_count: number }>;
			};
			award_badge_if_new: {
				Args: { p_user_id: string; p_badge_key: string; p_badge_name?: string; p_description?: string; p_icon?: string };
				Returns: boolean;
			};
			submit_reference_image: {
				Args: { p_card_id: string; p_image_path: string; p_confidence: number; p_user_id: string; p_user_name: string; p_blur_variance?: number };
				Returns: { accepted: boolean; is_new_card: boolean; old_confidence?: number; new_confidence?: number; previous_holder?: string };
			};
			increment_tournament_usage: {
				Args: { tid: string };
				Returns: void;
			};
			increment_shared_deck_views: {
				Args: { deck_id: string };
				Returns: void;
			};
			activate_pro: {
				Args: {
					p_user_id: string;
					p_tier_key: string;
					p_tier_amount: number;
					p_payment_method: string;
				};
				Returns: {
					pro_until: string;
					time_added: boolean;
					cooldown_active: boolean;
				};
			};
		};
		Enums: Record<string, never>;
		CompositeTypes: Record<string, never>;
	};
}
