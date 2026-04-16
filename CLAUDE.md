# CLAUDE.md — Card Scanner

## Project Overview

Card Scanner (boba.cards) is an AI-powered **multi-game** trading card scanner and pricing platform. It uses a three-tier recognition pipeline (hash cache, OCR, Claude AI) to identify cards from photos, with most scans completing for free via client-side processing. The app is a mobile-first PWA built with SvelteKit and deployed on Vercel.

**Supported games:**

| Game | ID | Icon | Card DB Table | Cards |
|------|-----|------|---------------|-------|
| Bo Jackson Battle Arena | `boba` | 🏈 | `cards` (game_id='boba') | ~17,000+ |
| Wonders of The First | `wonders` | 🐉 | `cards` (game_id='wonders') + `wotf_cards` | ~1,000+ |
| Game 3 (placeholder) | `game3` | 🎴 | — | Skeleton only, not registered |

Game-specific behavior lives behind a `GameConfig` interface (`src/lib/games/types.ts`). Each game implements its own OCR regions, Claude prompts, eBay query builders, themes, and navigation. The resolver (`src/lib/games/resolver.ts`) lazy-loads and caches game modules.

**App name:** Configurable via `system_settings.app_name` (default: "Card Scanner", legacy: "BOBA Scanner").

## Tech Stack

- **Framework**: SvelteKit 2 (`@sveltejs/kit ^2.54.0`) with Svelte 5 (`^5.53.10`, runes mode: `$state`, `$derived`, `$props`)
- **Language**: TypeScript ^5.9.3 (strict mode)
- **Build Tool**: Vite ^7.3.1
- **Deployment**: Vercel (adapter-vercel, Node.js 22.x runtime)
- **Database**: Supabase (PostgreSQL + auth + realtime) — `@supabase/supabase-js ^2.99.1`, `@supabase/ssr ^0.9.0`
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk ^0.78.0`) — Haiku for scanning, Sonnet for grading
- **OCR**: Tesseract.js 7 (client-side, runs in Web Worker)
- **Image Processing**: sharp ^0.34.5 (server-side CDR), Web Workers with Comlink ^4.4.2 (client-side)
- **Computer Vision**: OpenCV.js (`@techstark/opencv-js ^4.12.0`) for card cropping and authenticity checks
- **Image Comparison**: ssim.js ^3.5.0 for structural similarity in condition comparison
- **Virtualization**: `@tanstack/svelte-virtual ^3.13.22` for long lists
- **Rate Limiting**: Upstash Redis (`@upstash/redis ^1.36.4`, `@upstash/ratelimit ^2.0.8`) with in-memory fallback
- **Pricing**: eBay Browse API + Seller API integration
- **Caching**: IndexedDB (client), Supabase price_cache (server), Vercel edge (CDN)
- **PWA**: Service Worker with differentiated caching strategies
- **QR Codes**: qrcode ^1.5.4 (deck sharing/verification)
- **Randomization**: seedrandom ^3.0.5 (deterministic pack simulation)
- **Testing**: Vitest ^4.0.18

## Commands

```bash
npm run dev          # Start dev server (Vite)
npm run build        # Production build
npm run preview      # Preview production build locally
npm run check        # TypeScript + Svelte type checking
npm run check:watch  # Type checking in watch mode
npm test             # Run tests (vitest)
npm run test:watch   # Tests in watch mode
npm run generate:card-seed  # Generate SQL seed from card-database.json
npm run db:types     # Generate TypeScript types from Supabase schema
```

## Project Structure

```
Card-Scanner/
├── src/
│   ├── app.html                    # HTML shell (PWA meta, CSP via Vercel headers)
│   ├── app.d.ts                    # Global type declarations (App.Locals, App.PageData)
│   ├── hooks.server.ts             # Server hooks: 5-handle sequence (rate limit → supabase → security headers → auth guard → request logger)
│   ├── styles/index.css            # Global CSS (dark theme, CSS custom properties)
│   ├── params/
│   │   └── game.ts                 # Param matcher for [game=game] routes (boba, wonders)
│   ├── routes/
│   │   ├── +layout.svelte          # Root layout: header, bottom nav, auth state, game-aware nav
│   │   ├── +layout.server.ts       # Root server load: session/user from Supabase
│   │   ├── +layout.ts              # Client layout load
│   │   ├── +error.svelte           # Error page
│   │   ├── +page.svelte            # Homepage / dashboard
│   │   ├── scan/+page.svelte       # Card scanning interface (multi-game auto-detect)
│   │   ├── collection/+page.svelte # Card collection management (game-filterable)
│   │   ├── [game=game]/            # Game-scoped route group
│   │   │   ├── +layout.svelte      # Game layout: loads GameConfig from URL param
│   │   │   ├── +layout.ts          # Resolves GameConfig, passes theme/nav to children
│   │   │   ├── collection/+page.svelte  # Sets game filter, redirects to /collection
│   │   │   ├── market/+page.svelte      # Sets game filter, redirects to /market
│   │   │   └── set-completion/+page.svelte # Sets game filter, redirects to /set-completion
│   │   ├── deck/                   # Deck builder (BoBA-specific)
│   │   │   ├── +page.svelte        # Deck list / management
│   │   │   ├── +page.server.ts     # Deck list server load
│   │   │   ├── new/+page.svelte    # Create new deck
│   │   │   ├── [id]/+page.svelte   # Edit deck by ID
│   │   │   ├── [id]/view/+page.svelte # View deck (read-only)
│   │   │   ├── architect/+page.svelte # Playbook architect (AI-assisted deck building)
│   │   │   ├── shop/+page.svelte   # Deck shop (find missing cards)
│   │   │   ├── splitter/+page.svelte # Deck splitter utility
│   │   │   └── verify/[code]/+page.svelte # Deck verification by share code
│   │   ├── grader/+page.svelte     # AI card condition grading
│   │   ├── export/+page.svelte     # Collection export (CSV, etc.)
│   │   ├── sell/+page.svelte       # Sell cards (eBay listing, Whatnot CSV)
│   │   ├── settings/+page.svelte   # User settings page
│   │   ├── set-completion/+page.svelte # Set completion tracker
│   │   ├── packs/+page.svelte      # Pack simulator
│   │   ├── market/                 # Market & pricing
│   │   │   ├── +page.svelte        # Market overview
│   │   │   └── explore/+page.svelte # Market explorer
│   │   ├── war-room/+page.svelte   # War room analytics dashboard
│   │   ├── organize/               # Tournament organizer
│   │   │   ├── +page.svelte        # Organizer dashboard
│   │   │   └── [code]/+page.svelte # Manage specific tournament
│   │   ├── tournaments/            # Tournament participation
│   │   │   ├── +page.svelte        # Tournament list
│   │   │   ├── detail/+page.svelte # Tournament detail view
│   │   │   └── enter/+page.svelte  # Tournament entry form
│   │   ├── wonders/
│   │   │   └── dragon-points/+page.svelte # Wonders dragon points calculator
│   │   ├── batch/+page.ts          # Batch scanner redirect
│   │   ├── binder/+page.ts         # Binder scanner redirect
│   │   ├── admin/                  # Admin dashboard
│   │   │   ├── +page.svelte        # Admin page: responsive mobile/desktop layout, tab routing
│   │   │   ├── +page.server.ts     # Admin server load
│   │   │   ├── AdminSidebar.svelte # Desktop persistent sidebar (metrics, health, eBay quota)
│   │   │   ├── AdminPulseTab.svelte # Overview: metric cards, alerts, trends, quick actions
│   │   │   ├── AdminUsersTab.svelte # User management: search, filters, bulk actions
│   │   │   ├── AdminCardsTab.svelte # Card health: pricing stats, misidentification queue
│   │   │   ├── AdminCardPrices.svelte # Card price details panel
│   │   │   ├── AdminScansTab.svelte # Scan analytics: metrics, sparkline, hourly heatmap
│   │   │   ├── AdminEbayTab.svelte  # eBay quota gauge, price freshness, harvest trigger
│   │   │   ├── AdminFeaturesTab.svelte # Feature flag management
│   │   │   ├── AdminChangelogTab.svelte # CRUD for changelog entries
│   │   │   ├── AdminSystemTab.svelte # System health, data export, DB links
│   │   │   ├── AdminParallelsTab.svelte # Parallel type management (legacy)
│   │   │   ├── AdminConfigTab.svelte    # Configuration management (legacy)
│   │   │   ├── AdminPacksTab.svelte     # Pack configuration (legacy)
│   │   │   ├── AdminLogsTab.svelte      # Log viewer (legacy)
│   │   │   ├── AdminStatsTab.svelte     # Statistics overview (legacy)
│   │   │   ├── HarvestResults.svelte    # Harvest results display
│   │   │   ├── Sparkline.svelte         # Admin sparkline chart
│   │   │   └── dragon-points/           # Wonders dragon points admin
│   │   │       ├── +page.svelte
│   │   │       └── +page.server.ts
│   │   ├── auth/
│   │   │   ├── login/+page.svelte  # Login page
│   │   │   ├── callback/+server.ts # OAuth callback handler
│   │   │   ├── ebay/+server.ts     # eBay OAuth entry point
│   │   │   └── ebay/callback/+server.ts # eBay OAuth callback
│   │   ├── privacy/+page.svelte    # Privacy policy
│   │   ├── terms/+page.svelte      # Terms of service
│   │   └── api/
│   │       ├── scan/+server.ts     # POST: Claude AI card identification (Tier 3, multi-game)
│   │       ├── grade/+server.ts    # POST: AI condition grading (Claude Sonnet)
│   │       ├── badges/+server.ts   # POST: Badge award endpoint
│   │       ├── go-pro/+server.ts   # POST: Pro subscription upgrade
│   │       ├── log/+server.ts      # POST: Client-side error logging
│   │       ├── profile/+server.ts  # GET/PUT: User profile management
│   │       ├── price/[cardId]/
│   │       │   ├── +server.ts      # GET: eBay price lookup with caching
│   │       │   └── history/+server.ts # GET: Price history
│   │       ├── deck/
│   │       │   ├── refresh-prices/+server.ts # POST: Deck price refresh
│   │       │   └── lock/+server.ts        # POST: Lock deck for tournament
│   │       ├── reference-image/
│   │       │   ├── +server.ts             # POST: Reference image upload/submission
│   │       │   └── leaderboard/+server.ts # GET: Reference image leaderboard
│   │       ├── tournament/
│   │       │   ├── [code]/+server.ts    # GET: Tournament info by code
│   │       │   ├── results/+server.ts   # POST: Submit tournament results
│   │       │   └── submit-deck/+server.ts # POST: Submit deck for tournament
│   │       ├── listings/
│   │       │   └── weekly-count/+server.ts # GET: Free-tier weekly listing count
│   │       ├── organize/
│   │       │   ├── create/+server.ts        # POST: Create tournament
│   │       │   └── close-registration/+server.ts # POST: Close tournament registration
│   │       ├── market/
│   │       │   ├── explore/+server.ts   # GET: Market explorer data
│   │       │   ├── facets/+server.ts    # GET: Market filter facets
│   │       │   ├── pulse/+server.ts     # GET: Market pulse/trends
│   │       │   └── war-room/+server.ts  # GET: War room analytics data
│   │       ├── whatnot/
│   │       │   └── export/+server.ts    # POST: Whatnot CSV bulk export
│   │       ├── cron/
│   │       │   ├── price-harvest/+server.ts  # Cron: Automated eBay price harvesting
│   │       │   └── qstash-harvest/+server.ts # QStash: Webhook-triggered harvesting
│   │       ├── admin/
│   │       │   ├── stats/+server.ts          # GET: Aggregated dashboard metrics, trends, alerts
│   │       │   ├── changelog/+server.ts      # CRUD: Changelog entry management
│   │       │   ├── scan-flags/+server.ts     # GET/PUT: Misidentification flag review
│   │       │   ├── scan-analytics/+server.ts # GET: Scan analytics data
│   │       │   ├── export/+server.ts         # POST: CSV/JSON data export
│   │       │   ├── users/+server.ts          # PUT/POST: User management and bulk operations
│   │       │   ├── user-overrides/+server.ts # GET/PUT: Per-user feature overrides
│   │       │   ├── feature-flags/+server.ts  # Admin: manage feature flags
│   │       │   ├── pack-config/+server.ts    # Admin: manage pack configurations
│   │       │   ├── parallels/+server.ts      # Admin: manage parallel types
│   │       │   ├── app-config/+server.ts     # Admin: application configuration
│   │       │   ├── card-health/+server.ts    # Admin: card health metrics
│   │       │   ├── card-prices/+server.ts    # Admin: card price management
│   │       │   ├── ebay-metrics/+server.ts   # Admin: eBay API metrics
│   │       │   ├── harvest-config/+server.ts # Admin: harvest configuration
│   │       │   ├── harvest-log/+server.ts    # Admin: harvest log viewer
│   │       │   ├── logs/+server.ts           # Admin: system log viewer
│   │       │   ├── trigger-harvest/+server.ts # Admin: manual harvest trigger
│   │       │   ├── dragon-points/+server.ts  # Admin: Wonders dragon points config
│   │       │   ├── migrate-images/+server.ts # Admin: image migration utility
│   │       │   └── st-data/+server.ts        # Admin: external pricing data lookup
│   │       └── ebay/
│   │           ├── browse/+server.ts    # eBay Browse API proxy
│   │           ├── listing/+server.ts   # POST: Generate/post eBay listings
│   │           ├── create-draft/+server.ts # POST: Create eBay draft listing
│   │           ├── listings/+server.ts  # GET: List user's eBay listings
│   │           ├── end-listing/+server.ts # POST: End an eBay listing
│   │           ├── sync-status/+server.ts # GET: Sync eBay listing statuses (sold tracking)
│   │           ├── status/+server.ts    # GET: eBay seller auth status
│   │           ├── setup/+server.ts     # POST: eBay account setup (policies, location)
│   │           ├── validate/+server.ts  # POST: Validate eBay listing readiness
│   │           ├── diagnose/+server.ts  # GET: eBay connection diagnostics
│   │           └── disconnect/+server.ts # POST: Disconnect eBay seller auth
│   ├── lib/
│   │   ├── actions/tilt.ts         # Svelte action: 3D tilt effect for cards
│   │   ├── games/                  # Multi-game architecture
│   │   │   ├── types.ts            # GameConfig interface contract
│   │   │   ├── resolver.ts         # Lazy-loading game config resolver + cache
│   │   │   ├── all-games.ts        # Static game registry (id, name, icon)
│   │   │   ├── multi-game-prompt.ts # Multi-game Claude prompt utilities
│   │   │   ├── boba/               # BoBA game module
│   │   │   │   ├── config.ts       # GameConfig implementation
│   │   │   │   ├── extract.ts      # Card number extraction (OCR Tier 2)
│   │   │   │   ├── prompt.ts       # Claude system/user prompts + tool definition
│   │   │   │   ├── theme.ts        # Visual theme (colors, accents)
│   │   │   │   └── nav.ts          # Navigation items + protected routes
│   │   │   ├── wonders/            # Wonders of The First game module
│   │   │   │   ├── config.ts       # GameConfig implementation
│   │   │   │   ├── extract.ts      # Card number extraction (OCR Tier 2)
│   │   │   │   ├── prompt.ts       # Claude system/user prompts + tool definition
│   │   │   │   ├── theme.ts        # Visual theme (colors, accents)
│   │   │   │   ├── nav.ts          # Navigation items + protected routes
│   │   │   │   ├── dragon-points.ts # Dragon Points scoring engine
│   │   │   │   └── dragon-points-config.ts # Dragon Points configuration/rules
│   │   │   └── game3/              # Game 3 skeleton (NOT registered in resolver)
│   │   │       ├── config.ts       # Placeholder GameConfig
│   │   │       ├── extract.ts      # Placeholder extractor
│   │   │       ├── prompt.ts       # Placeholder prompts
│   │   │       ├── theme.ts        # Placeholder theme
│   │   │       └── nav.ts          # Placeholder navigation
│   │   ├── components/
│   │   │   ├── Scanner.svelte      # Single-card scanner component
│   │   │   ├── BatchScanner.svelte # Multi-card batch scanning
│   │   │   ├── BinderScanner.svelte# Binder page scanning
│   │   │   ├── CameraRollImport.svelte # Import cards from camera roll
│   │   │   ├── ScanConfirmation.svelte # Scan result confirmation UI
│   │   │   ├── ScanEffects.svelte  # Visual effects for scanning
│   │   │   ├── ScannerErrorBoundary.svelte # Error boundary for scanner components
│   │   │   ├── CardDetail.svelte   # Card detail view
│   │   │   ├── CardGrid.svelte     # Grid display for card collections
│   │   │   ├── CardCorrection.svelte # Manual correction UI
│   │   │   ├── CardFlipReveal.svelte # Card flip/reveal animation
│   │   │   ├── CategoryTabs.svelte  # Reusable category tab navigation
│   │   │   ├── OptimizedCardImage.svelte # Optimized image display with lazy loading
│   │   │   ├── PriceDisplay.svelte # Price information display
│   │   │   ├── PriceTrends.svelte  # Price trend charts (premium)
│   │   │   ├── SkeletonCardGrid.svelte # Loading skeleton for card grids
│   │   │   ├── GoProModal.svelte   # Pro subscription upgrade modal
│   │   │   ├── AffiliateNotice.svelte # Affiliate disclosure notice
│   │   │   ├── CloseButton.svelte  # Reusable close/dismiss button
│   │   │   ├── Toast.svelte        # Toast notification component
│   │   │   ├── UpdateBanner.svelte # App version update banner
│   │   │   ├── DragonPointsCard.svelte # Wonders dragon points display card
│   │   │   ├── VariantBadge.svelte # Wonders variant badge (paper/foil indicator)
│   │   │   ├── VariantSelector.svelte # Wonders variant picker
│   │   │   ├── WondersVariantPricePanel.svelte # Wonders variant-specific pricing
│   │   │   ├── scan-confirmation/  # Scan confirmation sub-components
│   │   │   │   ├── ScanActions.svelte
│   │   │   │   ├── ScanCardHeader.svelte
│   │   │   │   ├── ScanCardImage.svelte
│   │   │   │   ├── ScanFailState.svelte
│   │   │   │   ├── ScanMetaPills.svelte
│   │   │   │   ├── ScanPriceSection.svelte
│   │   │   │   └── ScanStats.svelte
│   │   │   ├── scanner/            # Scanner sub-components
│   │   │   │   ├── ScannerControls.svelte
│   │   │   │   ├── ScannerStatus.svelte
│   │   │   │   ├── ScannerViewfinder.svelte
│   │   │   │   ├── use-scanner-camera.svelte.ts  # Camera management composable
│   │   │   │   ├── use-scanner-analysis.svelte.ts # Scan analysis composable
│   │   │   │   └── overlay-price-lookup.ts # Price overlay logic
│   │   │   ├── sell/               # Sell page sub-components
│   │   │   │   ├── BrowseView.svelte    # Scanned cards + listings browser
│   │   │   │   ├── ListingView.svelte   # Individual listing editor (eBay + Whatnot)
│   │   │   │   ├── ListingHistory.svelte # Listing history (active/ended)
│   │   │   │   ├── EbaySetupGuide.svelte # eBay connection guide
│   │   │   │   ├── SellExportTab.svelte  # Whatnot/CSV export tab
│   │   │   │   └── WhatnotPendingView.svelte # Whatnot pending items
│   │   │   ├── home/               # Homepage sub-components
│   │   │   │   ├── QuickActionsGrid.svelte  # Quick action buttons
│   │   │   │   ├── RecentScansStrip.svelte  # Recent scans horizontal strip
│   │   │   │   ├── ScanHeroCard.svelte      # Scan CTA hero card
│   │   │   │   └── TournamentCodeEntry.svelte # Tournament code input
│   │   │   ├── collection/         # Collection sub-components
│   │   │   │   ├── OverviewTab.svelte   # Collection overview tab
│   │   │   │   └── WeaponsTab.svelte    # Weapons breakdown tab
│   │   │   ├── deck/               # Deck builder sub-components
│   │   │   │   ├── DeckHeader.svelte
│   │   │   │   ├── DeckHeroesTab.svelte
│   │   │   │   ├── DeckPlaysTab.svelte
│   │   │   │   ├── DeckSettingsModal.svelte
│   │   │   │   ├── DeckShopTab.svelte
│   │   │   │   └── DeckStatsTab.svelte
│   │   │   ├── architect/          # Playbook architect sub-components
│   │   │   │   ├── ArchetypeSelector.svelte
│   │   │   │   ├── ComboStatusCard.svelte
│   │   │   │   ├── DBSBudgetCard.svelte
│   │   │   │   ├── DeadCardAlert.svelte
│   │   │   │   ├── DrawConsistencyCard.svelte
│   │   │   │   ├── HDFlowCard.svelte
│   │   │   │   └── PlayBrowser.svelte
│   │   │   ├── market/             # Market sub-components
│   │   │   │   ├── Sparkline.svelte # Reusable SVG sparkline with area fill
│   │   │   │   ├── ExplorerFilters.svelte # Market explorer filter panel
│   │   │   │   ├── ExplorerResults.svelte # Market explorer results grid
│   │   │   │   ├── explorer-types.ts      # Explorer TypeScript types
│   │   │   │   └── use-explorer-filters.svelte.ts # Explorer filter composable
│   │   │   ├── packs/              # Pack simulator sub-components
│   │   │   │   ├── BoxSummary.svelte    # Box opening summary
│   │   │   │   └── PackCardReveal.svelte # Card reveal animation
│   │   │   ├── tournament/         # Tournament sub-components
│   │   │   │   └── SealedDeckEntry.svelte # Sealed deck entry form
│   │   │   ├── tournament-entry/   # Tournament entry wizard
│   │   │   │   ├── InfoStep.svelte      # Player info step
│   │   │   │   ├── ConfirmStep.svelte   # Confirmation step
│   │   │   │   ├── DoneStep.svelte      # Completion step
│   │   │   │   └── types.ts             # Entry form types
│   │   │   └── war-room/           # War room sub-components
│   │   │       ├── AnimatedNum.svelte   # Animated number transitions
│   │   │       ├── ScatterPlot.svelte   # Scatter plot visualization
│   │   │       ├── WIcon.svelte         # War room icon component
│   │   │       ├── HeroTable.svelte     # Hero card data table
│   │   │       ├── PlayTable.svelte     # Play card data table
│   │   │       └── war-room-constants.ts # War room configuration
│   │   ├── data/
│   │   │   ├── play-cards.json     # Play card database (409 cards across 4 releases: Alpha, Griffey, Alpha Update, Alpha Blast — with DBS values and hot dog costs)
│   │   │   ├── boba-config.ts      # OCR regions, scan config, rate limits
│   │   │   ├── boba-weapons.ts     # Weapon hierarchy with rarity and tier rankings
│   │   │   ├── boba-parallels.ts   # All parallel/treatment types with Madness unlock eligibility
│   │   │   ├── boba-dbs-scores.ts  # DBS point values for all Play cards (409 entries, maintained manually)
│   │   │   ├── tournament-formats.ts # Machine-readable rules for all 21 competitive format variants
│   │   │   ├── combo-engines.ts    # Combo detection engines for playbook analysis
│   │   │   ├── pack-defaults.ts    # Default pack configurations for pack simulator
│   │   │   ├── play-categories.ts  # Play card category/tag taxonomy
│   │   │   ├── playbook-archetypes.ts # Playbook archetype definitions for AI-assisted deck building
│   │   │   ├── category-tabs.ts    # Category tab configuration
│   │   │   ├── parallel-prefixes.ts # Parallel name prefix mappings
│   │   │   └── variants.ts         # Wonders variant system (Paper, Classic Foil, Formless Foil, Orbital Color Match, Stone Foil)
│   │   ├── server/
│   │   │   ├── admin-guard.ts      # Admin authorization guard for API endpoints
│   │   │   ├── anthropic.ts        # Anthropic Claude client singleton
│   │   │   ├── api-response.ts     # Standardized API response helpers
│   │   │   ├── rate-limit.ts       # Upstash Redis rate limiting + in-memory fallback
│   │   │   ├── redis.ts            # Redis client singleton
│   │   │   ├── rpc.ts              # Supabase RPC helper utilities
│   │   │   ├── ebay-auth.ts        # eBay OAuth token management (Browse API)
│   │   │   ├── ebay-seller-auth.ts # eBay Seller OAuth Authorization Code Grant (per-user)
│   │   │   ├── ebay-condition.ts   # eBay condition mapping (USED_VERY_GOOD for ungraded TCG)
│   │   │   ├── ebay-policies.ts    # eBay seller business policies (fulfillment, payment, return)
│   │   │   ├── ebay-query.ts       # eBay search query construction (BoBA)
│   │   │   ├── ebay-query-wonders.ts # eBay search query construction (Wonders)
│   │   │   ├── grading-prompts.ts  # Card grading prompt construction for Claude Vision
│   │   │   ├── supabase-admin.ts   # Supabase admin/service-role client
│   │   │   └── validate.ts         # Request validation helpers
│   │   ├── services/
│   │   │   ├── recognition.ts      # Three-tier recognition pipeline orchestrator
│   │   │   ├── recognition-tiers.ts # Tier 1/2/3 implementation functions (game-aware)
│   │   │   ├── recognition-validation.ts # Cross-validation logic for scan results
│   │   │   ├── recognition-workers.ts # Web Worker lifecycle management
│   │   │   ├── card-db.ts          # Card database: load, index, search, fuzzy match
│   │   │   ├── card-db-search.ts   # Card database search utilities
│   │   │   ├── ocr.ts              # OCR service layer
│   │   │   ├── supabase.ts         # Browser Supabase client (optional, null-safe)
│   │   │   ├── camera.ts           # Camera access and capture
│   │   │   ├── idb.ts              # IndexedDB wrapper (cards, hashes, collections, prices)
│   │   │   ├── sync.ts             # Collection sync (IDB ↔ Supabase)
│   │   │   ├── collection-service.ts # Collection business logic
│   │   │   ├── deck-validator.ts   # Deck building rules validation
│   │   │   ├── deck-service.ts     # Deck business logic (format defaults, deck stats)
│   │   │   ├── deck-gap-finder.ts  # Analyzes deck gaps and selects cards for price refresh
│   │   │   ├── playbook-engine.ts  # Playbook analysis engine (combos, draw consistency, HD flow)
│   │   │   ├── card-cropper.ts     # Card region cropping for analysis
│   │   │   ├── pack-simulator.ts   # Deterministic pack opening simulation
│   │   │   ├── badges.ts           # Client-side badge award helper with toast notifications
│   │   │   ├── community-corrections.ts # Community-verified OCR correction mappings
│   │   │   ├── reference-images.ts # Reference image handling and leaderboard
│   │   │   ├── ebay.ts             # eBay client-side price fetching
│   │   │   ├── listing-generator.ts# eBay listing template generation (game-aware titles/descriptions)
│   │   │   ├── whatnot-export.ts   # Whatnot CSV export service
│   │   │   ├── parallel-config.ts  # Parallel/treatment configuration
│   │   │   ├── scan-learning.ts    # Correction tracking for scan improvement
│   │   │   ├── scan-image-utils.ts # Scan image utility functions
│   │   │   ├── export-templates.ts # Export format definitions
│   │   │   ├── dead-card-detector.ts # Dead card detection in playbooks
│   │   │   ├── error-tracking.ts   # Client error reporting
│   │   │   ├── version.svelte.ts   # Version checking (runes store)
│   │   │   ├── app-name.ts         # App name service (reads system_settings.app_name)
│   │   │   └── user-game-prefs.ts  # Multi-game user preference management
│   │   ├── stores/                 # All stores use .svelte.ts extension (Svelte 5 runes)
│   │   │   ├── collection.svelte.ts    # Collection state store (game-filterable)
│   │   │   ├── scanner.svelte.ts       # Scanner state store
│   │   │   ├── scan-history.svelte.ts  # Scan history store
│   │   │   ├── prices.svelte.ts        # Price data store
│   │   │   ├── auth.svelte.ts          # Auth state store
│   │   │   ├── tags.svelte.ts          # User tags store
│   │   │   ├── toast.svelte.ts         # Toast notification store
│   │   │   ├── feature-flags.svelte.ts # Feature flag store
│   │   │   ├── nav-config.svelte.ts    # Navigation configuration store
│   │   │   ├── pro.svelte.ts           # Pro subscription state store
│   │   │   ├── playbook-architect.svelte.ts # Playbook architect state store
│   │   │   ├── ui-prefs.svelte.ts      # UI preference store
│   │   │   └── whatnot-batch.svelte.ts  # Whatnot batch export state store
│   │   ├── types/
│   │   │   ├── index.ts            # App types (Card, ScanResult, PriceData, etc.)
│   │   │   ├── database.ts         # Supabase database types
│   │   │   └── pack-simulator.ts   # Pack simulator types
│   │   ├── utils/
│   │   │   ├── index.ts            # Shared utilities (escapeHtml, formatPrice, debounce)
│   │   │   ├── extract-card-number.ts # OCR card number extraction logic (BoBA re-export)
│   │   │   ├── fuzzy-match.ts      # Fuzzy string matching (Levenshtein distance)
│   │   │   ├── haptics.ts          # Vibration/haptics patterns for mobile
│   │   │   ├── ebay-title.ts       # eBay listing title generation (game-aware: BoBA vs Wonders)
│   │   │   ├── image-url.ts        # Image URL generation and caching
│   │   │   ├── payment-links.ts    # Payment/upgrade link generation
│   │   │   └── pricing.ts          # Price calculation and formatting
│   │   └── workers/
│   │       └── image-processor.ts  # Web Worker: dHash, resize, blur detection, OCR preprocess
├── tests/
│   ├── card-db.test.ts             # Unit: card database operations
│   ├── ocr-extract.test.ts         # Unit: OCR card number extraction
│   ├── rate-limit.test.ts          # Unit: rate limiting logic
│   ├── deck-validator.test.ts      # Unit: deck building rules validation
│   ├── pricing.test.ts             # Unit: price calculation and formatting
│   ├── fuzzy-match.test.ts         # Unit: fuzzy string matching
│   ├── playbook-engine.test.ts     # Unit: playbook analysis engine
│   ├── api-price.integration.test.ts   # Integration: price API
│   ├── api-scan.integration.test.ts    # Integration: scan API
│   ├── api-grade.integration.test.ts   # Integration: grade API
│   ├── sync.test.ts                    # Unit: collection sync (IDB ↔ Supabase)
│   ├── auth-guard.e2e.test.ts          # E2E: auth guard routes
│   └── recognition-pipeline.e2e.test.ts # E2E: full recognition pipeline
├── docs/
│   ├── adding-a-new-game.md        # Guide for adding a third game (6-step checklist)
│   └── game-audit.md               # Multi-game architecture audit findings
├── .claude/
│   └── CONTEXT.md                  # Claude Code locked decisions and constraints
├── src/service-worker.ts            # SvelteKit service worker (differentiated caching)
├── static/
│   ├── manifest.json               # PWA manifest
│   ├── version.json                # App version metadata
│   └── robots.txt                  # Disallow all crawlers
├── scripts/
│   ├── generate-card-seed.js       # Generate SQL seed from card-database.json
│   └── json-to-card-seed.js        # JSON to SQL seed conversion utility
├── middleware.ts                    # Vercel Edge Middleware: bot/scraper/AI-crawler blocking
├── svelte.config.js                # SvelteKit config (Vercel adapter, path aliases, CSP)
├── vite.config.ts                  # Vite config (sourcemaps, ES2020, Web Workers as ES modules)
├── tsconfig.json                   # TypeScript config (strict, bundler resolution, excludes tests/)
├── vercel.json                     # Vercel headers (security, caching)
└── .github/workflows/ci.yml        # CI: type check → test → build → bundle size check
```

## Architecture

### Multi-Game System

The app is a single Supabase project with `game_id` column scoping on game-aware tables. All game-specific behavior is encapsulated in `GameConfig` modules:

```
src/lib/games/
├── types.ts       # GameConfig interface (identity, OCR, Claude prompts, eBay, theme, nav)
├── resolver.ts    # Lazy-loads + caches GameConfig by game ID
├── all-games.ts   # Static registry for UI rendering (game pickers, filters)
├── boba/          # BoBA: variant baked into card_number via prefixes (BF-, SBF-, RAD-)
├── wonders/       # Wonders: variant as separate attribute via Claude detection
└── game3/         # Skeleton template (not registered, not importable)
```

**Locked decisions** (from `.claude/CONTEXT.md`):
- Path-based routing, NOT subdomains. Game context from URL path prefix or user preference
- Game as filter, not silo — collections/sell show all games by default
- Single Supabase project with `game_id` column scoping
- BoBA columns (`hero_name`, `weapon_type`, `battle_zone`, `athlete_name`) stay as first-class columns; `metadata` JSONB for Wonders-specific fields only
- Zero regression — every BoBA feature must work identically
- Default `game_id = 'boba'` everywhere

### Three-Tier Recognition Pipeline

The core scanning feature uses a waterfall approach to minimize API costs:

1. **Tier 1 — Hash Cache (Free, instant)**: Computes a perceptual hash (dHash) of the card image using a Web Worker, then checks IndexedDB and Supabase `hash_cache` for a match. Previously scanned cards are recognized in <50ms.
1. **Tier 2 — OCR + Fuzzy Match (Free, ~1-3s)**: Tesseract.js extracts text from game-specific card regions (defined per `GameConfig.ocrRegions`). The extracted card number is fuzzy-matched against the local card database using Levenshtein distance. In auto-detect mode, all registered games' extractors are tried in registration order (BoBA first).
1. **Tier 3 — Claude AI (~$0.002/scan)**: If Tiers 1-2 fail, the card image is sent to `POST /api/scan` where it's sanitized via sharp (EXIF stripping, pixel bomb protection, re-encoding) and sent to Claude Haiku with game-specific prompts and tool definitions. The `identify_card` tool name is hardcoded — all games must use it.

Pipeline code is split across four files: `recognition.ts` (orchestrator), `recognition-tiers.ts` (tier 1/2/3 logic), `recognition-validation.ts` (cross-validation), `recognition-workers.ts` (worker lifecycle).

### Card Database Loading

The card database has a layered loading strategy (see `card-db.ts`):

1. IndexedDB cache (may have fresher Supabase data from a previous session)
1. Paginated Supabase fetch (first-time load or corrupt IDB), then background refresh

Cards are loaded with `game_id` awareness. Play card merging is gated on `_activeGameIds.includes('boba')` — play cards are a BoBA concept.

### Wonders Variant System

Wonders cards have a physical variant attribute (defined in `data/variants.ts`):

| Code | Name | Description |
|------|------|-------------|
| `paper` | Paper | Solid black border, matte |
| `cf` | Classic Foil | Lined border, foil treatment |
| `ff` | Formless Foil | Borderless bleed, foil |
| `ocm` | Orbital Color Match | Lined border + serial number |
| `sf` | Stone Foil | Like OCM but 1/1 rarity |

Variants are stored as a `variant` column (with CHECK constraint) on `collections`, `scans`, `hash_cache`, `price_cache`, `price_history`, `listing_templates`, and `price_harvest_log`. The `price_cache` PK is `(card_id, source, variant)` — a three-column composite.

### Authentication

- Google OAuth via Supabase Auth
- eBay Seller OAuth via Authorization Code Grant (per-user, managed by `ebay-seller-auth.ts`)
- Server-side auth via `hooks.server.ts` using `getUser()` (JWT validation, not just session cookies)
- Protected routes (via `authGuard` in `hooks.server.ts`):
  - Shared: `/collection`, `/sell`, `/admin`, `/grader`, `/export`, `/market`, `/set-completion`, `/tournaments`, `/settings`, `/organize`, `/war-room`
  - BoBA-scoped: `/boba/collection`, `/boba/set-completion`, `/boba/market`
  - Wonders-scoped: `/wonders/collection`, `/wonders/set-completion`, `/wonders/market`, `/wonders/dragon-points`
- Public routes (no auth): `/scan`, `/packs`, `/privacy`, `/terms`
- API routes handle their own auth checks

### Server Hooks Pipeline

`hooks.server.ts` runs 5 sequenced handles via `sequence()`:

1. **globalRateLimit** — 100 requests/minute per IP with periodic Map cleanup
2. **supabaseHandle** — Creates Supabase server client, `safeGetSession()` with `getUser()` JWT validation, graceful fallback on corrupted cookies
3. **securityHeaders** — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (camera self-only)
4. **authGuard** — Redirects unauthenticated users from protected routes to `/auth/login`
5. **requestLogger** — Structured JSON logging for API routes (method, path, status, duration, user_id)

Plus a `handleError` handler for structured error logging.

### Data Flow

- **Client state**: Svelte stores (`src/lib/stores/`) backed by IndexedDB for offline persistence
- **Server state**: Supabase PostgreSQL (collections synced via `sync.ts`)
- **Offline support**: SvelteKit service worker (`src/service-worker.ts`) caches app shell, card database served stale-while-revalidate, API calls always go to network

## Testing

The test suite uses Vitest with three tiers:

- **Unit tests**: `card-db.test.ts`, `ocr-extract.test.ts`, `rate-limit.test.ts`, `deck-validator.test.ts`, `pricing.test.ts`, `fuzzy-match.test.ts`, `playbook-engine.test.ts`, `sync.test.ts`
- **Integration tests**: `api-price`, `api-scan`, `api-grade` — test API routes with mocked dependencies
- **E2E tests**: `auth-guard.e2e.test.ts`, `recognition-pipeline.e2e.test.ts`

Testing patterns:

- Mocking via `vi.mock()`, `vi.hoisted()`, `vi.fn()`
- External dependencies mocked: sharp, Anthropic SDK, Supabase, Redis, IndexedDB
- Tests live in `/tests/` directory (excluded from `tsconfig.json`)
- Run with `npm test` (single run) or `npm run test:watch` (watch mode)

### Coverage Gaps (Priority Order)

Estimated module coverage is ~30%. Key untested areas by priority:

1. **Critical business logic**: `idb.ts` (IndexedDB offline storage), `collection-service.ts` (collection mutations with Supabase + IDB fallback)
2. **Security & utilities**: `utils/index.ts` (`escapeHtml` is XSS-critical), `middleware.ts` (bot-blocking regex), `api/upload` (CDR/EXIF stripping)
3. **Feature quality**: `scan-learning.ts` (OCR corrections), `export-templates.ts` (CSV escaping), `ebay.ts` (URL building, price calc)
4. **Nice to have**: Store pure logic (collection locking, flag evaluation), `error-tracking.ts`, `version.svelte.ts`, `listing-generator.ts`

### What NOT to Test (Low ROI)

- **Svelte components** — UI tests are brittle for a mobile-first PWA; manual QA is more effective
- **Web Workers** — require Canvas/ImageBitmap browser APIs; tested implicitly via recognition pipeline E2E tests
- **Static data files** — configuration, not logic
- **`supabase.ts`** — thin client init; tested implicitly by integration tests

## Database Schema

Schema changes are applied manually via the Supabase SQL Editor (no CLI, no automated migrations). This section is the canonical reference for the production database schema. Card seed data is generated via `scripts/generate-card-seed.js` (requires a local `card-database.json` file, not checked into the repo).

**Multi-game scoping**: The following tables have a `game_id TEXT DEFAULT 'boba'` column: `cards`, `collections`, `scans`, `hash_cache`, `price_cache`, `price_history`, `listing_templates`, `price_harvest_log`, `scraping_test`. Many also have a `variant TEXT DEFAULT 'paper'` column with CHECK constraint `(paper, cf, ff, ocm, sf)`.

#### Extensions
- `uuid-ossp` — UUID generation
- `pg_trgm` — Trigram search

#### Tables — Users & Auth

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | Auth + profile | `id` (UUID PK), `auth_user_id` (FK auth.users), `email`, `name`, `google_id`, `picture`, `discord_id`, `is_admin`, `is_pro`, `pro_until`, `is_member`, `member_until`, `is_organizer`, `persona` (JSONB), `nav_config` (JSONB), `active_theme_id`, `custom_theme` (JSONB), `can_invite` |
| `donations` | Pro tier payments | `user_id`, `tier_key`, `tier_amount`, `payment_method`, `time_added` |
| `user_badges` | Achievement badges | `user_id` (FK auth.users), `badge_key`, `badge_name`, `badge_description`, `badge_icon`, `earned_at` |
| `user_feature_overrides` | Per-user feature toggles | `user_id`, `feature_key`, `enabled` — PK (user_id, feature_key) |
| `user_game_prefs` | Multi-game preferences | `user_id` (UNIQUE, FK auth.users), `default_game`, `enabled_games` (TEXT[], default `{boba}`) |
| `ebay_seller_tokens` | eBay OAuth creds (service_role only) | `user_id` (PK, FK auth.users), `access_token`, `refresh_token`, `ebay_username`, `scopes`, expiry timestamps |
| `error_logs` | Client error reporting (service_role only) | `type`, `message`, `stack`, `url`, `user_agent`, `session_id` |

#### Tables — Cards & Collections

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `cards` | Unified card database (all games) | `id` (UUID PK), `name`, `hero_name`, `athlete_name`, `set_code`, `card_number`, `power`, `weapon_type`, `parallel`, `rarity`, `battle_zone`, `image_url`, `search_vector` (TSVECTOR), `game_id` (TEXT, default 'boba'), `metadata` (JSONB, default '{}'), `year` (INT), `card_id_legacy` (INT UNIQUE), `created_at`, `updated_at` |
| `wotf_cards` | Wonders card reference data | `id` (UUID PK), `name`, `display_name`, `type_line`, `subtype`, `set_name`, `set_code`, `collector_number`, `normalized_name`, `image_path`, `artist`, `flavor_text`, `rules_text`, `rarity`, `card_class`, `hierarchy`, `lineage`, `faction`, `cost`, `power`, `dbs`, `orbital_cost` (JSONB), `orbitals` (JSONB), `is_core`, `is_landscape`, `card_copies_limit`, `reprint`, `traits`, `activate_on_1`, `ability_text_1`, `activate_on_2`, `ability_text_2`, `variant_type` (default 'paper') |
| `play_cards` | BoBA Play/Hot Dog cards | `id` (TEXT PK), `card_number`, `name`, `release`, `type`, `number`, `hot_dog_cost`, `dbs`, `ability` |
| `collections` | User card collections | `id` (UUID PK), `user_id` (FK auth.users), `card_id` (FK cards), `quantity`, `condition`, `notes`, `scan_image_url`, `game_id` (default 'boba'), `variant` (default 'paper', CHECK) |
| `collections_v2` | Next-gen collection table (unused) | `id` (UUID PK), `user_id` (FK auth.users), `card_id` (FK cards), `quantity`, `condition`, `notes` |
| `scans` | Image recognition results | `id` (UUID PK), `user_id` (FK auth.users), `card_id` (FK cards), `hero_name`, `card_number`, `scan_method`, `confidence`, `processing_ms`, `game_id` (default 'boba'), `variant` (default 'paper', CHECK) |
| `hash_cache` | Perceptual hash cache | `phash` (TEXT PK), `card_id` (FK cards), `confidence`, `scan_count`, `phash_256`, `game_id` (default 'boba'), `variant` (default 'paper', CHECK) |
| `card_reference_images` | Reference image competition | `card_id` (TEXT PK), `image_path`, `phash`, `confidence`, `contributed_by`, `contributor_name`, `blur_variance`, `times_challenged`, `previous_confidence` |
| `scan_metrics` | Aggregate scan performance | `scan_method`, `processing_time_ms`, `confidence`, `cache_hit`, `cache_layer` |
| `pack_configurations` | Pack simulator config | `box_type`, `set_code`, `display_name`, `slots` (JSONB), `packs_per_box`, `msrp_cents`, `is_active` |

#### Tables — Pricing & Commerce

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `price_cache` | Current eBay prices | **PK: (`card_id`, `source`, `variant`)**. `price_low/mid/high`, `buy_now_low/mid`, `buy_now_count`, `filtered_count`, `confidence_score`, `fetched_at`, `game_id` (default 'boba') |
| `play_price_cache` | Current prices for play cards | **PK: (`card_id` TEXT, `source`)**. `price_low/mid/high`, `buy_now_low/mid/count`, `filtered_count`, `confidence_score`, `fetched_at` |
| `price_history` | Historical hero price tracking | `card_id` (UUID), `source`, `price_low/mid/high`, `listings_count`, `recorded_at`, `game_id`, `variant` |
| `play_price_history` | Historical play price tracking | `card_id` (TEXT), `source`, `price_low/mid/high`, `listings_count`, `recorded_at` |
| `price_harvest_log` | eBay harvest results | `run_id`, `chain_depth`, `priority` (1-4), `card_id`, `hero_name`, `card_name`, `card_number`, `search_query`, full eBay result data, `price_changed`, `threshold_rejected`, `duration_ms`, `game_id`, `variant` |
| `listing_templates` | eBay listing drafts | `id` (UUID PK), `user_id`, `card_id` (FK cards), `title`, `description`, `price`, `suggested_price`, `condition`, `status` CHECK (`draft/pending/published/sold/ended/error`), `ebay_listing_id`, `ebay_offer_id`, `ebay_listing_url`, `sku`, `scan_image_url`, `image_url`, `hero_name`, `card_number`, `set_code`, `parallel`, `weapon_type`, `sold_at`, `sold_price`, `game_id`, `variant`, `error_message` |
| `scraping_test` | External pricing intelligence | `id` (UUID PK), `card_id` (UUID UNIQUE, FK cards), `st_price/low/high`, `st_source_id`, `st_card_name`, `st_set_name`, `st_variant`, `st_rarity`, `st_image_url`, `st_raw_data` (JSONB), `st_updated`, `game_id` |
| `ebay_api_log` | eBay quota tracking | `calls_used/remaining/limit`, `chain_depth`, `cards_processed/updated/errored`, `status` (running/quota_exhausted/no_cards_remaining/triggered_manual) |

#### Tables — Tournaments

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `tournaments` | Tournament definitions | `creator_id` (FK users), `code` (UNIQUE), `name`, `format_id`, `description`, `venue`, `event_date`, `entry_fee`, `prize_pool`, `deck_type` CHECK (constructed/sealed), `max_players`, `submission_deadline`, `registration_closed`, `deadline_mode` (default 'manual'), `results_entered`, `results_entered_at`, `results_entered_by`, `max_heroes`, `max_plays`, `max_bonus`, `usage_count` |
| `tournament_registrations` | Player registrations | `tournament_id`, `user_id`, `email`, `name`, `discord_id`, `deck_csv` |
| `deck_submissions` | Tournament deck submissions | `tournament_id`, `user_id`, `player_name`, `player_email`, `player_discord`, `hero_cards` (JSONB), `play_entries` (JSONB), `hot_dog_count`, `foil_hot_dog_count`, `format_id`, `format_name`, `is_valid`, `validation_violations` (JSONB), `validation_warnings` (JSONB), `validation_stats` (JSONB), `dbs_total`, `hero_count`, `total_power`, `avg_power`, `source_deck_id` (FK user_decks), `status` (submitted/locked/withdrawn), `verification_code` (UNIQUE), `locked_at` |
| `tournament_results` | Organizer-entered results | `tournament_id`, `submission_id` (FK deck_submissions), `player_name`, `player_user_id`, `final_standing`, `placement_label`, `match_wins/losses/draws`, `entered_by` |

#### Tables — Decks

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `user_decks` | Saved deck lists | `id` (UUID PK), `user_id` (FK auth.users), `name`, `format_id`, `hero_card_ids` (TEXT[]), `play_entries` (JSONB), `hot_dog_count`, `hero_deck_min/max`, `play_deck_size`, `bonus_plays_max`, `hot_dog_deck_size`, `dbs_cap`, `spec_power_cap`, `combined_power_cap`, `is_shared`, `is_custom_format`, `notes`, `last_edited_at` |
| `deck_snapshots` | QR verification snapshots | `code` (UNIQUE), `user_id`, `deck_id`, `deck_name`, `format_id`, `format_name`, `is_valid`, `violations` (JSONB), `stats` (JSONB), `hero_cards` (JSONB), `play_cards` (JSONB), `player_name`, `locked_at` |
| `deck_shop_refresh_log` | Deck shop refresh events | `user_id`, `card_count` |

#### Tables — Wonders-Specific

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `dragon_points_config` | Wonders scoring config | **PK: (`config_type`, `key`)**. `config_type` CHECK (base_table/class_multiplier/year_bonus/bonus_card), `value` (JSONB), `description`, `updated_by` (FK auth.users) |

#### Tables — System & Admin

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `system_settings` | Global app config | `key` (TEXT PK), `value` — seeds: maintenance_mode, max_daily_scans, app_version, app_name |
| `app_config` | Application config | `key` (TEXT PK), `value` (JSONB), `description` |
| `feature_flags` | Feature gating | `feature_key` (PK), `display_name`, `icon`, `enabled_globally`, `enabled_for_guest/authenticated/member/pro/admin` |
| `api_call_logs` | API usage tracking | `user_id` (FK users), `call_type`, `success`, `error_message`, `cost`, `cards_processed` |
| `scan_flags` | Wrong card reports | `user_id`, `scan_id`, `card_identified`, `card_suggested`, `image_url`, `status`, `notes`, `resolved_by`, `resolved_at` |
| `changelog_entries` | What's new notifications | `title`, `body`, `published`, `is_notification`, `published_at`, `created_by` (FK auth.users) |
| `admin_activity_log` | Admin audit trail | `admin_id` (FK auth.users), `action`, `entity_type`, `entity_id`, `details` (JSONB) |
| `parallel_rarity_config` | Parallel card rarity | `parallel_name` (UNIQUE), `rarity`, `sort_order`, `updated_by` (FK users) |

#### RPC Functions

| Function | Purpose |
|----------|---------|
| `find_similar_hash(query_hash, max_distance, p_game_id)` | Hamming distance fuzzy hash lookup (Tier 1 matching, game-scoped) |
| `upsert_hash_cache()` | Atomic hash cache insert/update with scan_count increment |
| `award_badge_if_new()` | Idempotent badge awarding |
| `lookup_correction()` | Community OCR corrections (requires 3+ confirmations) |
| `submit_correction()` | Submit a community OCR correction |
| `increment_tournament_usage()` | Atomic tournament usage counter |
| `increment_shared_deck_views()` | Atomic shared deck view counter |
| `activate_pro(p_user_id, p_tier_key, p_tier_amount, p_payment_method, p_days)` | Pro activation with cooldown and day-based blocks |
| `submit_reference_image(card_id, image_path, confidence, user_id, user_name, blur_variance)` | Atomic reference image submission with champion comparison |
| `get_harvest_candidates(run_id, limit)` | SQL-based card selection for eBay price harvesting (priority 1-4) |
| `get_play_harvest_candidates()` | Play card selection for eBay price harvesting |
| `get_harvest_summary()` | Harvest run summary statistics |
| `get_price_status_summary()` | Returns pricing coverage stats by card type |
| `get_weekly_listing_count(p_user_id)` | Free-tier listing gate (3/week, Sunday reset) |
| `get_card_price_details()` | Admin: detailed price analysis for a card |
| `get_card_price_details_count()` | Admin: price details record count |
| `get_daily_trends()` | Admin: daily trend aggregation |
| `cleanup_old_records()` | Retention cleanup: purges old scan_metrics (90d), api_call_logs (90d), price_history (365d) |
| `protect_privilege_columns()` | TRIGGER preventing non-service-role modification of is_admin, is_pro, pro_until |

#### RLS Summary

- **All tables** have RLS enabled
- **Anon**: read-only access to public data (cards, prices, feature_flags, tournaments, deck_snapshots, pack_configurations)
- **Authenticated**: read/write own data (collections, decks, scans, badges, submissions), read public data
- **Service role**: full access — used for ebay_seller_tokens, error_logs, price_harvest_log, admin tables, and the `activate_pro` / `protect_privilege_columns` functions

#### Key Constraints

- `users`: valid email format, card_limit 0-10000, api_calls limits
- `collections`: quantity > 0, condition enum (mint/near_mint/excellent/good/fair/poor), variant CHECK (paper/cf/ff/ocm/sf)
- `cards`: power 0-500, set_code non-empty, name non-empty, game_id defaults to 'boba'
- `hash_cache`: confidence 0-1, scan_count >= 0, variant CHECK
- `price_cache`: prices non-negative, low <= mid <= high, PK is (card_id, source, variant)
- `scans`: confidence 0-1, processing_ms >= 0, scan_method enum (hash/ocr/ai/manual), variant CHECK
- `tournaments`: deck sizes positive, usage_count >= 0, deck_type CHECK (constructed/sealed)
- `listing_templates`: status CHECK (draft/pending/published/sold/ended/error)
- `user_decks`: deck sizes positive, dbs_cap/hot_dog_count >= 0
- `dragon_points_config`: config_type CHECK (base_table/class_multiplier/year_bonus/bonus_card)

## Environment Variables

### Public (exposed to browser)

- `PUBLIC_SUPABASE_URL` — Supabase project URL
- `PUBLIC_SUPABASE_ANON_KEY` — Supabase anonymous key
- `PUBLIC_GOOGLE_CLIENT_ID` — Google OAuth client ID

### Private (server-side only)

- `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` — Anthropic API key for Claude
- `UPSTASH_REDIS_REST_URL` — Upstash Redis URL for rate limiting
- `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis token
- `EBAY_CLIENT_ID` — eBay API client ID
- `EBAY_CLIENT_SECRET` — eBay API client secret

## CI/CD

GitHub Actions CI (`.github/workflows/ci.yml`) runs on PRs and pushes to `main`:

1. `npm ci` — Install dependencies
1. `npm run check` — TypeScript + Svelte type checking
1. `npm test` — Run vitest test suite
1. `npm run build` — Production build
1. Bundle size check — Two-tier limits:
- **App JS** (excluding card database): must be under 600KB
- **Total JS** (including ~2.7MB card database): must be under 4MB

## BoBA Game Domain Knowledge

Bo Jackson Battle Arena (BoBA) is a collectible trading card game where professional athletes become radioactive superheroes. Key terminology and rules for development:

### Card Types

- **Hero Cards**: Battle cards with a Power value and weapon type. Standard deck = 60 Heroes.
- **Hot Dog Cards**: Resource cards that fuel Plays. Standard = 10 per deck. Duplicates allowed.
- **Play Cards**: Strategic action cards. Standard = 30 unique Plays per deck. No duplicates. 25 Bonus Plays (ultra-rares) may be added beyond the 30.

### Power Systems

- **SPEC Power**: Cap on the maximum Power of any INDIVIDUAL Hero card (e.g., SPEC 160 = no card above 160 Power).
- **Combined Power (CP)**: Cap on the SUM of all Hero Power values in the deck (e.g., 8,250 CP across 60 cards).
- **DBS (Deck Balancing Score)**: Point budget for the Playbook. Each Play has a DBS value. Total must not exceed 1,000. DBS values are maintained in `boba-dbs-scores.ts` (used by the deck validator) and `play-cards.json` (used by the playbook architect for card metadata alongside DBS values).

### Weapon Types (rarity order, most rare first)

Super (1/1) → Gum (secret) → Hex (/10) → Glow (/25) → Fire (/50) → Ice (/50) → Steel (common) → Brawl (common, 2026+)

### Deck Building Rules (apply to ALL formats)

- Max 6 Hero cards at the same Power level
- Max 1 copy of each unique variation (hero + weapon + parallel combination)
- All 30 Plays must be unique
- No limit on copies of the same hero character across different variations

Deck validation logic is implemented in `src/lib/services/deck-validator.ts`.

### Tournament Formats

Format rules are defined in `src/lib/data/tournament-formats.ts` (21 format variants). Key formats:

- **Apex Playmaker**: No power cap, premier solo format
- **SPEC Playmaker**: Individual cards capped at 160 Power (standard competitive)
- **SPEC+**: Graduated power slots, NO combined power cap
- **Elite Playmaker**: Total deck power capped at 8,250 CP, 1,000 DBS cap
- **AlphaTrilogy**: Cards released before Nov 1, 2025 ($100K division)
- **Apex Madness**: Team Rookie Mode, Core Deck at SPEC 160, expanded via insert unlocks
- **Tecmo Bowl**: Tecmo set only, SPEC+ rules
- **Blast**: Blast set only, Substitution mode
- **Brawl**: Brawl weapon heroes only
- **Granny's Gum**: Grandma's/Great Grandma's Linoleum + Bubblegum only
- **Power Glove**: Power Glove inserts only, Set Builder mode

### Important Terminology

- **Coach** = player (BoBA uses "Coach" officially, never "player")
- **Registered Play Pool** = up to 45 standard plays + unlimited bonus plays registered before an event; Coaches swap between matches but deck is locked within a match. This is NOT a traditional sideboard.
- **ELP** (Event Legal Proxy) = rental proxy for graded cards ($1,500+), completely separate from deck construction.

### Card Parallels/Treatments

Parallel types are defined in `src/lib/data/boba-parallels.ts`. Key types include Battlefoils (Silver, Blue, Orange, etc.), named inserts (Blizzard, 80s Rad, Headlines, etc.), and Inspired Ink (autographs). In Apex Madness, having 10+ of a single insert type in the Core Deck unlocks 1 Apex card (165+ Power) of that type.

### Data Files

- `src/lib/data/boba-weapons.ts` — Weapon hierarchy with rarity and tier rankings
- `src/lib/data/boba-parallels.ts` — All parallel/treatment types with Madness unlock eligibility
- `src/lib/data/tournament-formats.ts` — Machine-readable rules for all 21 competitive format variants
- `src/lib/data/boba-dbs-scores.ts` — DBS point values for Play cards (409 entries across Alpha, Griffey, Alpha Update, and Alpha Blast releases)
- `src/lib/data/play-cards.json` — Play card database (409 cards across 4 releases, with DBS values and hot dog costs; ability text fields exist but are not yet fully populated)
- `src/lib/data/boba-config.ts` — OCR regions, scan config, rate limits
- `src/lib/data/combo-engines.ts` — Combo detection logic for playbook analysis
- `src/lib/data/pack-defaults.ts` — Default pack configurations for simulator
- `src/lib/data/play-categories.ts` — Play card category taxonomy
- `src/lib/data/playbook-archetypes.ts` — Playbook archetype definitions
- `src/lib/data/category-tabs.ts` — Category tab configuration
- `src/lib/data/parallel-prefixes.ts` — Parallel name prefix mappings
- `src/lib/data/variants.ts` — Wonders variant system (Paper, Classic Foil, Formless Foil, Orbital Color Match, Stone Foil)

## Wonders Domain Knowledge

Wonders of The First (WoTF) is a fantasy trading card game with dragons, magic, and mythology. Key concepts:

### Card Structure

Wonders cards have different attributes than BoBA: `type_line`, `subtype`, `card_class`, `hierarchy`, `lineage`, `faction`, `orbital_cost`, `orbitals`, `cost`, `power`, `rules_text`, `traits`. These live in the `metadata` JSONB column on the unified `cards` table and as dedicated columns on `wotf_cards`.

### Collector Numbers

Known formats: `78/402` (NUM/TOTAL), `P-001` (promos), `AVA-T1` (story tokens), `A1-028/401` (OCM variant), `T-016` (tokens), `CLA-1` (set artifacts). Set prefixes: A1, AVA, BAA, CLA, EEA, KSA, P, T, TFA, XCA.

### Variants

Physical card treatments (distinct from BoBA's parallel prefix system): Paper, Classic Foil (CF), Formless Foil (FF), Orbital Color Match (OCM), Stone Foil (SF — 1/1 rarity).

### Dragon Points

A collection scoring system for Wonders. Configuration stored in `dragon_points_config` table with base tables, class multipliers, year bonuses, and bonus card definitions.

### eBay Integration

Wonders cards use a separate query builder (`ebay-query-wonders.ts`) that quotes card names and set names for exact-phrase matching. Title includes game name ("Wonders of The First" / "WoTF"), set display name, and variant full name. Contamination filtering rejects BoBA keywords from Wonders results.

## Key Conventions

### Documentation

- **CLAUDE.md is the single source of truth** for all project documentation, architecture, schema, conventions, and reference material
- **Separate docs are allowed** for multi-game architecture guides: `docs/adding-a-new-game.md` and `docs/game-audit.md` are maintained alongside CLAUDE.md
- **Only other exceptions**: root `README.md` (GitHub landing page — keep minimal, point to CLAUDE.md), `.env.example`, and `.claude/CONTEXT.md` (locked decisions for Claude Code)
- When making changes that affect architecture, database schema, conventions, or project structure, update CLAUDE.md as part of the same change

### Code Style

- **Svelte 5 runes**: Use `$state()`, `$derived()`, `$props()`, `$effect()` — not legacy `let`/`$:` reactive syntax
- **TypeScript strict mode**: All new code must be type-safe
- **Path aliases**: Use `$lib/`, `$components/`, `$services/`, `$stores/`, `$workers/`, `$types/`, `$server/`, `$games/` (defined in `svelte.config.js`)
- **Server-only code**: Files in `src/lib/server/` — never import these from client code
- **Web Workers**: `src/lib/workers/` contains TypeScript workers bundled as ES modules (`worker: { format: 'es' }` in vite.config.ts)
- **Store files**: Use `.svelte.ts` extension for all stores (Svelte 5 runes-based stores)

### Multi-Game Conventions

- **Default game_id = 'boba'** for all new code paths that don't explicitly specify a game
- **NEVER** move BoBA columns (`hero_name`, `weapon_type`, etc.) into `metadata` JSONB
- **ALWAYS** use backward-compatible re-exports when moving code so existing imports don't break
- **Game-specific code** lives in `src/lib/games/{gameId}/` modules, NOT in shared services
- **GameConfig.cardIdTool** must be named `identify_card` — the scan endpoint hardcodes this

### API Route Patterns

- All API routes are in `src/routes/api/`
- Auth check pattern: `const { user } = await locals.safeGetSession(); if (!user) throw error(401, ...)`
- Rate limiting via `checkScanRateLimit()` or `checkCollectionRateLimit()` from `$lib/server/rate-limit`
- Return JSON with `json()` from `@sveltejs/kit`
- Include rate limit headers on 429 responses

### Services Architecture

- **Supabase is optional**: The `supabase` export uses a Proxy that throws if not configured. New code should use `getSupabase()` which returns `null` when unconfigured.
- **Graceful degradation**: All services handle the case where external dependencies (Supabase, Redis, eBay) are unavailable
- **Web Workers via Comlink**: Image processing and OCR run in dedicated workers, exposed as typed async interfaces via Comlink

### Security

- Image uploads sanitized via sharp CDR (Content Disarm & Reconstruction): EXIF stripping, pixel bomb protection, re-encoding
- Bot/scraper protection via Vercel Edge Middleware (`middleware.ts`) — blocks bots, missing User-Agent, suspicious headers, and AI training crawlers (GPTBot, ClaudeBot, etc.). Allows `/api/health`, `/api/auth/`, `/api/cron/`, `/.well-known/`
- CSP headers configured in `svelte.config.js` (not `vercel.json`) via SvelteKit's built-in CSP config
- RLS enabled on all tables via Supabase Auth (see Database Schema section)
- Rate limiting on all mutation endpoints
- Server hooks add defense-in-depth headers: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy

## Common Tasks

### Adding a new API route

1. Create `src/routes/api/<n>/+server.ts`
1. Add auth check via `locals.safeGetSession()`
1. Add rate limiting if it's a mutation/expensive operation
1. Return responses with `json()` from `@sveltejs/kit`

### Adding a new page route

1. Create `src/routes/<n>/+page.svelte`
1. If protected, ensure path is listed in `authGuard` in `hooks.server.ts`
1. Add navigation link in `+layout.svelte` (bottom nav or "More" menu)

### Adding a new component

1. Create in `src/lib/components/`
1. Use Svelte 5 runes (`$props()`, `$state()`, etc.)
1. Import via `$components/ComponentName.svelte`

### Adding a new game

Follow the 6-step checklist in `docs/adding-a-new-game.md`:
1. Implement the `GameConfig` interface in `src/lib/games/<newGameId>/`
2. Register in `resolver.ts` and `all-games.ts`
3. Add game ID to `VALID_GAMES` in `src/params/game.ts`
4. Add game-scoped routes under `src/routes/[game=game]/`
5. Add `game_id` column scoping to relevant database queries
6. Add eBay query builder in `src/lib/server/ebay-query-<game>.ts`

### Modifying the card database

1. Add/update cards directly in Supabase (the `cards` table)
1. Optionally, update a local `card-database.json` and run `npm run generate:card-seed` to regenerate the SQL seed

### Working with the recognition pipeline

- Game configs in `src/lib/games/{gameId}/` (OCR regions, extractors, prompts)
- Pipeline orchestrator in `src/lib/services/recognition.ts`
- Tier functions in `src/lib/services/recognition-tiers.ts`
- Cross-validation in `src/lib/services/recognition-validation.ts`
- Worker management in `src/lib/services/recognition-workers.ts`
- Card matching in `src/lib/services/card-db.ts`
- Fuzzy matching in `src/lib/utils/fuzzy-match.ts`
- Image worker in `src/lib/workers/image-processor.ts`

### Adding tests

1. Create test file in `tests/` directory
1. Name convention: `<module>.test.ts` (unit), `<module>.integration.test.ts` (integration), `<module>.e2e.test.ts` (E2E)
1. Mock external dependencies (sharp, Anthropic, Supabase, Redis) using `vi.mock()`
1. Run with `npm test` or `npm run test:watch`
