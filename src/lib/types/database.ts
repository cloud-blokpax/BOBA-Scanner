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
					game_id: string;
					metadata: Record<string, unknown> | null;
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
					game_id?: string;
					metadata?: Record<string, unknown> | null;
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
			scan_sessions: {
				Row: {
					id: string;
					user_id: string;
					game_id: string;
					device_model: string | null;
					os_name: string | null;
					os_version: string | null;
					browser_name: string | null;
					browser_version: string | null;
					app_version: string | null;
					viewport_width: number | null;
					viewport_height: number | null;
					device_memory_gb: number | null;
					network_type: string | null;
					capabilities: Record<string, unknown>;
					started_at: string;
					ended_at: string | null;
					extras: Record<string, unknown>;
					schema_version: number;
					created_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					game_id?: string;
					device_model?: string | null;
					os_name?: string | null;
					os_version?: string | null;
					browser_name?: string | null;
					browser_version?: string | null;
					app_version?: string | null;
					viewport_width?: number | null;
					viewport_height?: number | null;
					device_memory_gb?: number | null;
					network_type?: string | null;
					capabilities?: Record<string, unknown>;
					started_at?: string;
					ended_at?: string | null;
					extras?: Record<string, unknown>;
					schema_version?: number;
					created_at?: string;
				};
				Update: Partial<Database['public']['Tables']['scan_sessions']['Insert']>;
				Relationships: [];
			};
			scans: {
				Row: {
					id: string;
					session_id: string;
					user_id: string;
					game_id: string;
					photo_storage_path: string | null;
					photo_thumbnail_path: string | null;
					photo_bytes: number | null;
					photo_width: number | null;
					photo_height: number | null;
					parent_scan_id: string | null;
					retake_chain_idx: number;
					capture_context: Record<string, unknown>;
					quality_signals: Record<string, unknown>;
					thermal_state: string | null;
					battery_level: number | null;
					composite_quality: number | null;
					outcome: 'pending' | 'auto_confirmed' | 'user_confirmed' | 'user_corrected' | 'disputed' | 'abandoned' | 'timeout' | 'low_quality_rejected';
					pipeline_version: string;
					extras: Record<string, unknown>;
					schema_version: number;
					captured_at: string;
					capture_latency_ms: number | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					session_id: string;
					user_id: string;
					game_id?: string;
					photo_storage_path?: string | null;
					photo_thumbnail_path?: string | null;
					photo_bytes?: number | null;
					photo_width?: number | null;
					photo_height?: number | null;
					parent_scan_id?: string | null;
					retake_chain_idx?: number;
					capture_context?: Record<string, unknown>;
					quality_signals?: Record<string, unknown>;
					outcome?: 'pending' | 'auto_confirmed' | 'user_confirmed' | 'user_corrected' | 'disputed' | 'abandoned' | 'timeout' | 'low_quality_rejected';
					pipeline_version: string;
					extras?: Record<string, unknown>;
					schema_version?: number;
					captured_at?: string;
					capture_latency_ms?: number | null;
					created_at?: string;
				};
				Update: Partial<Database['public']['Tables']['scans']['Insert']>;
				Relationships: [];
			};
			scan_tier_results: {
				Row: {
					id: string;
					scan_id: string;
					user_id: string;
					tier: 'tier1_hash' | 'tier1_embedding' | 'tier2_ocr' | 'tier3_claude';
					engine: 'phash' | 'dhash' | 'multicrop_hash' | 'mobileclip_v1' | 'dinov2_s14' | 'dinov2_base' | 'paddleocr_pp_v5' | 'tesseract_v5' | 'claude_haiku' | 'claude_sonnet';
					engine_version: string;
					raw_output: Record<string, unknown>;
					parsed_card_id: string | null;
					parsed_parallel: string | null;
					parsed_confidence: number | null;
					latency_ms: number | null;
					cost_usd: number | null;
					errored: boolean;
					error_message: string | null;
					extras: Record<string, unknown>;
					schema_version: number;
					created_at: string;
				};
				Insert: {
					id?: string;
					scan_id: string;
					user_id: string;
					tier: 'tier1_hash' | 'tier1_embedding' | 'tier2_ocr' | 'tier3_claude';
					engine: 'phash' | 'dhash' | 'multicrop_hash' | 'mobileclip_v1' | 'dinov2_s14' | 'dinov2_base' | 'paddleocr_pp_v5' | 'tesseract_v5' | 'claude_haiku' | 'claude_sonnet';
					engine_version: string;
					raw_output: Record<string, unknown>;
					latency_ms?: number | null;
					cost_usd?: number | null;
					errored?: boolean;
					error_message?: string | null;
					extras?: Record<string, unknown>;
					schema_version?: number;
					created_at?: string;
				};
				Update: Partial<Database['public']['Tables']['scan_tier_results']['Insert']>;
				Relationships: [];
			};
			scan_resolutions: {
				Row: {
					id: string;
					scan_id: string;
					user_id: string;
					card_id: string | null;
					parallel: string;
					consensus_score: number | null;
					tier_agreement_bits: number | null;
					confirmed_at: string | null;
					confirmed_by: string | null;
					superseded_at: string | null;
					superseded_by: string | null;
					extras: Record<string, unknown>;
					schema_version: number;
					created_at: string;
				};
				Insert: {
					id?: string;
					scan_id: string;
					user_id: string;
					card_id?: string | null;
					parallel?: string;
					consensus_score?: number | null;
					tier_agreement_bits?: number | null;
					confirmed_at?: string | null;
					confirmed_by?: string | null;
					superseded_at?: string | null;
					superseded_by?: string | null;
					extras?: Record<string, unknown>;
					schema_version?: number;
					created_at?: string;
				};
				Update: Partial<Database['public']['Tables']['scan_resolutions']['Insert']>;
				Relationships: [];
			};
			scan_disputes: {
				Row: {
					id: string;
					resolution_id: string;
					scan_id: string;
					disputing_user_id: string;
					proposed_card_id: string | null;
					proposed_parallel: string | null;
					reason_text: string | null;
					revalidation_raw: Record<string, unknown> | null;
					revalidation_verdict: string | null;
					revalidated_at: string | null;
					resolution: 'pending' | 'upheld' | 'rejected' | 'inconclusive';
					resolved_at: string | null;
					resolved_by: string | null;
					extras: Record<string, unknown>;
					schema_version: number;
					created_at: string;
				};
				Insert: {
					id?: string;
					resolution_id: string;
					scan_id: string;
					disputing_user_id: string;
					proposed_card_id?: string | null;
					proposed_parallel?: string | null;
					reason_text?: string | null;
					revalidation_raw?: Record<string, unknown> | null;
					revalidation_verdict?: string | null;
					revalidated_at?: string | null;
					resolution?: 'pending' | 'upheld' | 'rejected' | 'inconclusive';
					resolved_at?: string | null;
					resolved_by?: string | null;
					extras?: Record<string, unknown>;
					schema_version?: number;
					created_at?: string;
				};
				Update: Partial<Database['public']['Tables']['scan_disputes']['Insert']>;
				Relationships: [];
			};
			price_cache: {
				Row: {
					card_id: string;
					source: string;
					price_low: number | null;
					price_mid: number | null;
					price_high: number | null;
					buy_now_low: number | null;
					buy_now_mid: number | null;
					buy_now_count: number | null;
					confidence_score: number | null;
					filtered_count: number | null;
					listings_count: number | null;
					fetched_at: string;
					game_id: string;
					parallel: string;
				};
				Insert: {
					card_id: string;
					source?: string;
					price_low?: number | null;
					price_mid?: number | null;
					price_high?: number | null;
					buy_now_low?: number | null;
					buy_now_mid?: number | null;
					buy_now_count?: number | null;
					confidence_score?: number | null;
					filtered_count?: number | null;
					listings_count?: number | null;
					fetched_at?: string;
					game_id?: string;
					parallel?: string;
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
					source: 'ebay_seed' | 'official_seed' | 'user_scan' | 'consensus' | 'claude_confirmed' | 'admin';
					superseded_at: string | null;
					consensus_count: number;
					dispute_count: number;
					last_confirmed_at: string | null;
					extras: Record<string, unknown>;
					schema_version: number;
					created_at: string;
				};
				Insert: {
					phash: string;
					card_id: string;
					confidence: number;
					scan_count?: number;
					last_seen?: string;
					source?: 'ebay_seed' | 'official_seed' | 'user_scan' | 'consensus' | 'claude_confirmed' | 'admin';
					superseded_at?: string | null;
					consensus_count?: number;
					dispute_count?: number;
					last_confirmed_at?: string | null;
					extras?: Record<string, unknown>;
					schema_version?: number;
					created_at?: string;
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
					nav_config: { visible: string[] } | null;
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
					nav_config?: { visible: string[] } | null;
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
					card_id: string | null;
					title: string;
					description: string | null;
					price: number;
					condition: string | null;
					sku: string;
					status: string;
					ebay_listing_id: string | null;
					ebay_listing_url: string | null;
					error_message: string | null;
					scan_image_url: string | null;
					hero_name: string | null;
					card_number: string | null;
					set_code: string | null;
					parallel: string | null;
					weapon_type: string | null;
					sold_at: string | null;
					sold_price: number | null;
					ebay_offer_id: string | null;
					game_id: string;
					created_at: string;
					updated_at: string | null;
				};
				Insert: {
					user_id: string;
					card_id?: string | null;
					title: string;
					description?: string | null;
					price: number;
					condition?: string | null;
					sku: string;
					status?: string;
					ebay_listing_id?: string | null;
					ebay_listing_url?: string | null;
					error_message?: string | null;
					scan_image_url?: string | null;
					hero_name?: string | null;
					card_number?: string | null;
					set_code?: string | null;
					parallel?: string | null;
					weapon_type?: string | null;
					sold_at?: string | null;
					sold_price?: number | null;
					ebay_offer_id?: string | null;
					game_id?: string;
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
			pack_configurations: {
				Row: {
					id: string;
					box_type: string;
					set_code: string;
					display_name: string;
					slots: Record<string, unknown>[];
					packs_per_box: number;
					is_active: boolean;
					box_guarantees: Record<string, unknown> | null;
					created_at: string;
					updated_at: string;
					updated_by: string | null;
				};
				Insert: {
					id?: string;
					box_type: string;
					set_code: string;
					display_name: string;
					slots: Record<string, unknown>[];
					packs_per_box?: number;
					is_active?: boolean;
					box_guarantees?: Record<string, unknown> | null;
					updated_at?: string;
					updated_by?: string | null;
				};
				Update: Partial<Database['public']['Tables']['pack_configurations']['Insert']>;
				Relationships: [];
			};
			deck_snapshots: {
				Row: {
					id: string;
					code: string;
					deck_id: string;
					format_id: string | null;
					is_valid: boolean;
					violations: unknown[];
					hero_cards: unknown[];
					play_cards: unknown[];
					hot_dog_count: number;
					player_name: string;
					locked_at: string;
					created_at: string;
				};
				Insert: {
					id?: string;
					code: string;
					deck_id: string;
					format_id?: string | null;
					is_valid?: boolean;
					violations?: unknown[];
					hero_cards?: unknown[];
					play_cards?: unknown[];
					hot_dog_count?: number;
					player_name?: string;
					locked_at?: string;
				};
				Update: Partial<Database['public']['Tables']['deck_snapshots']['Insert']>;
				Relationships: [];
			};
			user_badges: {
				Row: {
					id: string;
					user_id: string;
					badge_key: string;
					badge_name: string;
					badge_description: string | null;
					badge_icon: string | null;
					earned_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					badge_key: string;
					badge_name: string;
					badge_description?: string | null;
					badge_icon?: string | null;
					earned_at?: string;
				};
				Update: Partial<Database['public']['Tables']['user_badges']['Insert']>;
				Relationships: [];
			};
			price_harvest_log: {
				Row: {
					id: string;
					run_id: string;
					card_id: string;
					priority: number;
					search_query: string | null;
					price_changed: boolean;
					threshold_rejected: boolean;
					duration_ms: number | null;
					created_at: string;
					old_price_mid: number | null;
					new_price_mid: number | null;
					previous_mid: number | null;
					price_delta: number | null;
					price_delta_pct: number | null;
					auction_count: number | null;
					is_new_price: boolean;
					success: boolean;
					buy_now_low: number | null;
					buy_now_count: number | null;
					listings_count: number | null;
					error_message: string | null;
					processed_at: string | null;
				};
				Insert: {
					id?: string;
					run_id: string;
					card_id: string;
					priority?: number;
					search_query?: string | null;
					price_changed?: boolean;
					threshold_rejected?: boolean;
					duration_ms?: number | null;
					old_price_mid?: number | null;
					new_price_mid?: number | null;
					previous_mid?: number | null;
					price_delta?: number | null;
					price_delta_pct?: number | null;
					auction_count?: number | null;
					is_new_price?: boolean;
					success?: boolean;
					buy_now_low?: number | null;
					buy_now_count?: number | null;
					listings_count?: number | null;
					error_message?: string | null;
					processed_at?: string | null;
				};
				Update: Partial<Database['public']['Tables']['price_harvest_log']['Insert']>;
				Relationships: [];
			};
			error_logs: {
				Row: {
					id: string;
					type: string;
					message: string;
					stack: string | null;
					url: string | null;
					user_agent: string | null;
					session_id: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					type: string;
					message: string;
					stack?: string | null;
					url?: string | null;
					user_agent?: string | null;
					session_id?: string | null;
				};
				Update: Partial<Database['public']['Tables']['error_logs']['Insert']>;
				Relationships: [];
			};
			changelog_entries: {
				Row: {
					id: string;
					title: string;
					body: string;
					published: boolean;
					is_notification: boolean;
					published_at: string | null;
					created_at: string;
					updated_at: string;
					created_by: string | null;
				};
				Insert: {
					id?: string;
					title: string;
					body: string;
					published?: boolean;
					is_notification?: boolean;
					published_at?: string | null;
					created_by?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: Partial<Database['public']['Tables']['changelog_entries']['Insert']>;
				Relationships: [];
			};
			admin_activity_log: {
				Row: {
					id: string;
					admin_id: string;
					action: string;
					entity_type: string | null;
					entity_id: string | null;
					details: Record<string, unknown> | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					admin_id: string;
					action: string;
					entity_type?: string | null;
					entity_id?: string | null;
					details?: Record<string, unknown> | null;
				};
				Update: Partial<Database['public']['Tables']['admin_activity_log']['Insert']>;
				Relationships: [];
			};
			ebay_api_log: {
				Row: {
					id: string;
					calls_used: number;
					calls_remaining: number;
					calls_limit: number;
					reset_at: string;
					chain_depth: number;
					cards_processed: number;
					cards_updated: number;
					cards_errored: number;
					status: string;
					recorded_at: string;
				};
				Insert: {
					id?: string;
					calls_used: number;
					calls_remaining: number;
					calls_limit: number;
					reset_at: string;
					chain_depth?: number;
					cards_processed?: number;
					cards_updated?: number;
					cards_errored?: number;
					status?: string;
					recorded_at?: string;
				};
				Update: Partial<Database['public']['Tables']['ebay_api_log']['Insert']>;
				Relationships: [];
			};
			dbs_scores: {
				Row: {
					id: string;
					set_code: string;
					card_number: string;
					dbs_score: number;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					set_code: string;
					card_number: string;
					dbs_score: number;
				};
				Update: Partial<Database['public']['Tables']['dbs_scores']['Insert']>;
				Relationships: [];
			};
			play_cards: {
				Row: {
					id: string;
					card_number: string;
					name: string;
					release: string;
					dbs: number | null;
					hot_dog_cost: number | null;
					ability_text: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					card_number: string;
					name: string;
					release: string;
					dbs?: number | null;
					hot_dog_cost?: number | null;
					ability_text?: string | null;
				};
				Update: Partial<Database['public']['Tables']['play_cards']['Insert']>;
				Relationships: [];
			};
			donations: {
				Row: {
					id: string;
					user_id: string;
					tier_key: string;
					tier_amount: number;
					payment_method: string;
					time_added: string;
					created_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					tier_key: string;
					tier_amount: number;
					payment_method: string;
					time_added: string;
				};
				Update: Partial<Database['public']['Tables']['donations']['Insert']>;
				Relationships: [];
			};
			play_price_cache: {
				Row: {
					card_id: string;
					source: string;
					price_low: number | null;
					price_mid: number | null;
					price_high: number | null;
					buy_now_low: number | null;
					buy_now_mid: number | null;
					buy_now_count: number | null;
					confidence_score: number | null;
					filtered_count: number | null;
					listings_count: number | null;
					fetched_at: string;
				};
				Insert: {
					card_id: string;
					source?: string;
					price_low?: number | null;
					price_mid?: number | null;
					price_high?: number | null;
					buy_now_low?: number | null;
					buy_now_mid?: number | null;
					buy_now_count?: number | null;
					confidence_score?: number | null;
					filtered_count?: number | null;
					listings_count?: number | null;
					fetched_at?: string;
				};
				Update: Partial<Database['public']['Tables']['play_price_cache']['Insert']>;
				Relationships: [];
			};
			play_price_history: {
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
				Update: Partial<Database['public']['Tables']['play_price_history']['Insert']>;
				Relationships: [];
			};
			scraping_test: {
				Row: {
					card_id: string;
					st_price: number | null;
					st_low: number | null;
					st_high: number | null;
					st_source_id: string | null;
					st_card_name: string | null;
					st_set_name: string | null;
					st_variant: string | null;
					st_rarity: string | null;
					st_image_url: string | null;
					st_raw_data: Record<string, unknown> | null;
					st_updated: string | null;
					created_at: string;
				};
				Insert: {
					card_id: string;
					st_price?: number | null;
					st_low?: number | null;
					st_high?: number | null;
					st_source_id?: string | null;
					st_card_name?: string | null;
					st_set_name?: string | null;
					st_variant?: string | null;
					st_rarity?: string | null;
					st_image_url?: string | null;
					st_raw_data?: Record<string, unknown> | null;
					st_updated?: string | null;
				};
				Update: Partial<Database['public']['Tables']['scraping_test']['Insert']>;
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
			upsert_hash_cache_v2: {
				Args: {
					p_phash: string;
					p_card_id: string;
					p_phash_256?: string | null;
					p_game_id?: string;
					p_parallel?: string;
					p_source?: 'ebay_seed' | 'official_seed' | 'user_scan' | 'consensus' | 'claude_confirmed' | 'admin';
					p_confidence?: number;
				};
				Returns: boolean;
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
					p_days?: number;
				};
				Returns: {
					pro_until: string;
					time_added: boolean;
					cooldown_active: boolean;
				};
			};
			get_harvest_candidates: {
				Args: { p_run_id: string; p_limit?: number };
				Returns: Array<{ card_id: string; priority: number; card_type: string; name: string }>;
			};
			get_play_harvest_candidates: {
				Args: { p_limit: number };
				Returns: Array<{ id: string; hero_name: string | null; name: string; card_number: string; athlete_name: string | null; card_parallel_name: string | null; weapon_type: string | null; parallel: string | null; priority: number }>;
			};
			get_harvest_summary: {
				Args: { p_run_id: string };
				Returns: Record<string, unknown>;
			};
			get_price_status_summary: {
				Args: Record<string, never>;
				Returns: Array<{ card_type: string; total: number; priced: number; unpriced: number }>;
			};
			get_card_price_details: {
				Args: { p_search?: string | null; p_filter?: string; p_sort?: string; p_order?: string; p_limit?: number; p_offset?: number };
				Returns: Array<Record<string, unknown>>;
			};
			get_card_price_details_count: {
				Args: { p_search?: string | null; p_filter?: string };
				Returns: Array<{ total: number }>;
			};
			cleanup_old_records: {
				Args: Record<string, never>;
				Returns: void;
			};
			get_weekly_listing_count: {
				Args: { p_user_id: string };
				Returns: number;
			};
			get_daily_trends: {
				Args: { p_days?: number };
				Returns: Array<{ trend_date: string; scan_count: number; signup_count: number; error_count: number }>;
			};
		};
		Enums: Record<string, never>;
		CompositeTypes: Record<string, never>;
	};
}
