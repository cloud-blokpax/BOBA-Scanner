# CLAUDE.md — Card Scanner

## Project Overview

Card Scanner (boba.cards) is an AI-powered **multi-game** trading card scanner and pricing platform. It uses a two-tier recognition pipeline — local PaddleOCR in four capture modes (Tier 1) with Claude Haiku as a confidence-gated fallback (Tier 3) — to identify cards at near-zero per-scan cost. The app is a mobile-first PWA built with SvelteKit and deployed on Vercel.

**Supported games:**

| Game | ID | Icon | Card DB Table | Cards |
|------|-----|------|---------------|-------|
| Bo Jackson Battle Arena | `boba` | 🏈 | `cards` (game_id='boba') | ~17,000+ |
| Wonders of The First | `wonders` | 🐉 | `cards` (game_id='wonders') + `wotf_cards` | ~1,000+ |
| Game 3 (placeholder) | `game3` | 🎴 | — | Skeleton only, not registered |

Game-specific behavior lives behind a `GameConfig` interface (`src/lib/games/types.ts`). Each game implements its own OCR regions, Claude prompts, eBay query builders, themes, and navigation. The resolver (`src/lib/games/resolver.ts`) lazy-loads and caches game modules.

**App name:** Currently "Card Scanner" (formerly "BOBA Scanner" — rebrand preceded the Wonders integration). Name is hardcoded in `app.html` and component strings; the old `system_settings.app_name` row was deleted in Session 2.6 along with the `app-name.ts` service. If the name needs to change again, it's a find/replace across the codebase, not a config update.

## Tech Stack

Direct dependencies (from `package.json`). Versions pinned at minor ranges via `^`; update via `npm update` or explicit bumps.

**Framework & build:**
- SvelteKit 2 (`@sveltejs/kit ^2.54.0`) with Svelte 5 (`^5.53.10`) — runes mode exclusively (`$state`, `$derived`, `$props`, `$effect`).
- TypeScript `^5.9.3` (strict mode).
- Vite `^7.3.1`.
- Deployed on Vercel via `@sveltejs/adapter-vercel ^6.3.3`, Node.js 22.x runtime.

**Database & auth:**
- Supabase (PostgreSQL + auth + realtime) — `@supabase/supabase-js ^2.99.1`, `@supabase/ssr ^0.9.0`.
- Google OAuth via Supabase Auth.
- eBay Seller OAuth (Authorization Code Grant, per-user).

**AI & recognition:**
- Anthropic Claude API (`@anthropic-ai/sdk ^0.78.0`) — Haiku for Tier 3 card scanning, Sonnet for condition grading.
- PaddleOCR via `@gutenye/ocr-browser ^1.4.8` — Tier 1 local OCR. Runs in browser via ONNX Runtime Web. Models (`ch_PP-OCRv4_det_infer.onnx` ~5MB, `ch_PP-OCRv4_rec_infer.onnx` ~10MB, `ppocr_keys_v1.txt` ~26KB) shipped in `static/models/`.
- OpenCV (`@techstark/opencv-js`) is a transitive dependency of `@gutenye/ocr-browser` — NOT a direct dep. Don't import directly; go through the OCR browser wrapper.
- Image embeddings use DINOv2-base (stored in Supabase `card_embeddings` as pgvector); seeded offline via `scripts/seed-card-embeddings.ts`.

**Image processing:**
- `sharp ^0.34.5` — server-side CDR (Content Disarm & Reconstruction: EXIF strip, pixel bomb protection, re-encode).
- Web Workers via `comlink ^4.4.2` — client-side image preprocessing + OCR dispatch.
- `exifreader ^4.38.1` — client-side EXIF inspection.
- `ssim.js ^3.5.0` — structural similarity for condition comparison.
- `idb ^8.0.3` — IndexedDB wrapper for cards/hashes/collections/prices.

**Infrastructure:**
- Upstash Redis (`@upstash/redis ^1.36.4`, `@upstash/ratelimit ^2.0.8`) — rate limiting + eBay API quota counter; in-memory fallback when Redis unavailable.
- Upstash QStash (`@upstash/qstash ^2.10.1`) — scheduled webhook triggers for the price harvest cron. POSTs `/api/cron/qstash-harvest` every 5 minutes (QStash is the SINGLE trigger — `vercel.json` has no `crons` entry).
- `@vercel/analytics ^2.0.1`, `@vercel/speed-insights ^2.0.0` — Vercel-hosted telemetry.

**Pricing & commerce:**
- eBay Browse API — public price discovery (via `ebay-auth.ts` app-token flow).
- eBay Seller API — per-user listing creation, end-listing, sync (via `ebay-seller-auth.ts` Authorization Code Grant).

**UI & UX:**
- `@tanstack/svelte-virtual ^3.13.22` — virtualized lists (long collections, card grids).
- `qrcode ^1.5.4` — deck-share QR generation + verification.
- `seedrandom ^3.0.5` — deterministic pack-opening simulation.

**Testing:**
- `vitest ^4.0.18`, `svelte-check ^4.4.5`.

**Removed in the Phase 2 arc (do not re-add without discussion):**
- `tesseract.js` — replaced by PaddleOCR via `@gutenye/ocr-browser` in Session 2.5.
- `@techstark/opencv-js` as direct dep — retained only as transitive through ocr-browser.

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
│   │   │   ├── Scanner.svelte      # Single-card scanner (entry point for scan page)
│   │   │   ├── BatchScanner.svelte # Multi-card batch scanning
│   │   │   ├── BinderLiveScanner.svelte   # Phase 2 binder grid live scanner (2x2/3x3/4x4 cells)
│   │   │   ├── BinderViewfinder.svelte    # Camera viewfinder for binder capture
│   │   │   ├── BinderReview.svelte        # Post-capture binder review + per-cell correction
│   │   │   ├── CameraRollImport.svelte    # Import cards from camera roll (upload pipeline)
│   │   │   ├── ScanConfirmation.svelte    # Scan result confirmation UI
│   │   │   ├── ScanEffects.svelte         # Visual effects during scanning
│   │   │   ├── ScannerErrorBoundary.svelte # Error boundary wrapping scanner
│   │   │   ├── CardDetail.svelte   # Card detail view
│   │   │   ├── CardGrid.svelte     # Grid display for card collections
│   │   │   ├── CardCorrection.svelte # Manual correction UI (post-scan override)
│   │   │   ├── CardFlipReveal.svelte # Card flip/reveal animation (pack simulator)
│   │   │   ├── CategoryTabs.svelte  # Reusable category tab navigation
│   │   │   ├── OptimizedCardImage.svelte # Optimized image display with lazy loading
│   │   │   ├── PriceDisplay.svelte # Price information display
│   │   │   ├── PriceTrends.svelte  # Price trend charts (Pro feature)
│   │   │   ├── SkeletonCardGrid.svelte # Loading skeleton for card grids
│   │   │   ├── GoProModal.svelte   # Pro subscription upgrade modal
│   │   │   ├── AffiliateNotice.svelte # Affiliate disclosure notice
│   │   │   ├── BoBAOnlyBanner.svelte  # "This is BoBA-only" banner on Wonders-incompatible pages
│   │   │   ├── CloseButton.svelte  # Reusable close/dismiss button
│   │   │   ├── Toast.svelte        # Toast notification component
│   │   │   ├── UpdateBanner.svelte # App version update banner
│   │   │   ├── DragonPointsCard.svelte # Wonders dragon points display card
│   │   │   ├── ParallelBadge.svelte # Parallel badge (replaces VariantBadge — Phase 2 rename)
│   │   │   ├── ParallelSelector.svelte # Parallel picker (replaces VariantSelector — Phase 2 rename)
│   │   │   ├── WondersParallelPricePanel.svelte # Wonders parallel-specific pricing (replaces WondersVariantPricePanel)
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
│   │   │   ├── play-cards.json     # Play card database raw data (409 cards across 4 releases: Alpha, Griffey, Alpha Update, Alpha Blast)
│   │   │   ├── play-cards.ts       # Typed loader for play-cards.json (derives type/number from card_number, strips " - htd" suffix)
│   │   │   ├── boba-config.ts      # OCR regions, scan config, rate limits (BoBA-specific)
│   │   │   ├── boba-weapons.ts     # Weapon hierarchy with rarity and tier rankings
│   │   │   ├── boba-parallels.ts   # BoBA parallel types + Madness unlock eligibility (49 entries)
│   │   │   ├── boba-dbs-scores.ts  # DBS point values for Play cards (409 entries, maintained manually)
│   │   │   ├── parallels.ts        # Shared parallel utilities — short codes, full names, colors, grouping (used by ScanConfirmation, CardDetail, listing pipelines)
│   │   │   ├── wonders-parallels.ts # Wonders-specific short-code↔full-name mappings (paper/cf/ff/ocm/sf → Paper/Classic Foil/Formless Foil/Orbital Color Match/Stonefoil)
│   │   │   ├── parallel-prefixes.ts # Parallel-prefix → parallel-name map (e.g. BF- → Battlefoil, SBF- → Silver Battlefoil) — BoBA-specific
│   │   │   ├── tournament-formats.ts # Machine-readable rules for all 21 competitive format variants
│   │   │   ├── combo-engines.ts    # Combo detection engines for playbook analysis
│   │   │   ├── pack-defaults.ts    # Default pack configurations for pack simulator
│   │   │   ├── play-categories.ts  # Play card category/tag taxonomy
│   │   │   ├── playbook-archetypes.ts # Playbook archetype definitions for AI-assisted deck building
│   │   │   └── category-tabs.ts    # Category tab configuration
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
│   │   │   │
│   │   │   # Recognition pipeline — orchestrator + validation + workers
│   │   │   ├── recognition.ts              # Two-tier pipeline orchestrator (entry: recognizeCard())
│   │   │   ├── recognition-tiers.ts        # Tier 3 Claude Haiku dispatcher (Tier 1 modes dispatch independently)
│   │   │   ├── recognition-validation.ts   # Cross-validation logic between tier outputs
│   │   │   ├── recognition-workers.ts      # Web Worker lifecycle management
│   │   │   │
│   │   │   # Tier 1 local OCR — PaddleOCR engine + 4 capture modes + consensus
│   │   │   ├── paddle-ocr.ts               # PaddleOCR engine wrapper (@gutenye/ocr-browser, lazy-loaded)
│   │   │   ├── ocr-regions.ts              # Per-game OCR region configuration (card_number, name, variant zones)
│   │   │   ├── ocr-worker-pool.ts          # Pool of OCR web workers (powers binder parallelism)
│   │   │   ├── live-ocr-coordinator.ts     # Live camera Tier 1 coordinator (2fps during alignment-ready)
│   │   │   ├── tier1-canonical.ts          # Canonical single-frame Tier 1 pass (used by live shutter + upload)
│   │   │   ├── upload-pipeline.ts          # Upload Tier 1 (canonical first, TTA fallback if below floor)
│   │   │   ├── upload-frame-generator.ts   # Synthetic frame augmentation for upload TTA voting
│   │   │   ├── binder-coordinator.ts       # Binder grid Tier 1 coordinator (per-cell independent sessions)
│   │   │   ├── cell-extractor.ts           # Extract individual card cells from binder grid image
│   │   │   ├── blank-cell-detector.ts      # Detect empty cells in binder grid (skip OCR)
│   │   │   ├── binder-capture-finalize.ts  # Finalize binder capture into per-cell scan rows
│   │   │   ├── binder-persistence.ts       # Persist binder session state across navigation
│   │   │   ├── consensus-builder.ts        # Aggregate OCR reads into single (card_number, name) tuple
│   │   │   ├── parallel-classifier.ts      # Wonders parallel classifier (paper/cf/ff/ocm/sf from visual signals)
│   │   │   ├── pixel-stability.ts          # Pixel-correlation check (~0.85 threshold — wire-crossing defense)
│   │   │   ├── constrained-crop.ts         # Card-aspect-preserving crop helper
│   │   │   │
│   │   │   # Scan telemetry + writes (single owner of scan row lifecycle)
│   │   │   ├── scan-writer.ts              # Single owner of scans table row writes (OpenScanRow → UpdateOutcome)
│   │   │   ├── scan-telemetry.ts           # Scan telemetry capture (device, battery, quality signals)
│   │   │   ├── scan-checkpoint.ts          # Per-stage trace writes to scan_pipeline_checkpoint
│   │   │   ├── pipeline-version.ts         # Pipeline version pin (stamps scans.pipeline_version)
│   │   │   ├── catalog-mirror.ts           # Client-side catalog mirror for (card_number, name) → card_id lookup
│   │   │   ├── image-harvester.ts          # Opportunistic image harvesting from eBay listings (populates card_reference_images)
│   │   │   │
│   │   │   # Card data + search
│   │   │   ├── card-db.ts                  # Card database: load, index, search, fuzzy match
│   │   │   ├── card-db-search.ts           # Card database search utilities
│   │   │   ├── card-cropper.ts             # Card region cropping for analysis
│   │   │   │
│   │   │   # Collections + decks + playbooks
│   │   │   ├── collection-service.ts       # Collection business logic
│   │   │   ├── deck-validator.ts           # Deck building rules validation
│   │   │   ├── deck-service.ts             # Deck business logic (format defaults, deck stats)
│   │   │   ├── deck-gap-finder.ts          # Analyzes deck gaps + selects cards for price refresh
│   │   │   ├── playbook-engine.ts          # Playbook analysis engine (combos, draw consistency, HD flow)
│   │   │   ├── dead-card-detector.ts       # Dead card detection in playbooks
│   │   │   ├── pack-simulator.ts           # Deterministic pack opening simulation
│   │   │   │
│   │   │   # User + commerce
│   │   │   ├── persona.ts                  # Persona weight update client (post-scan signal)
│   │   │   ├── badges.ts                   # Client-side badge award helper with toast notifications
│   │   │   ├── ebay.ts                     # eBay client-side price fetching
│   │   │   ├── listing-generator.ts        # eBay listing template generation (game-aware titles/descriptions)
│   │   │   ├── whatnot-export.ts           # Whatnot CSV export service
│   │   │   ├── reference-images.ts         # Reference image handling + leaderboard
│   │   │   ├── community-corrections.ts    # Community-verified OCR correction mappings
│   │   │   │
│   │   │   # Infrastructure + utilities
│   │   │   ├── supabase.ts                 # Browser Supabase client (optional, null-safe via Proxy)
│   │   │   ├── camera.ts                   # Camera access + capture
│   │   │   ├── idb.ts                      # IndexedDB wrapper (cards, hashes, collections, prices)
│   │   │   ├── sync.ts                     # Collection sync (IDB ↔ Supabase)
│   │   │   ├── parallel-config.ts          # Parallel/treatment configuration
│   │   │   ├── scan-image-utils.ts         # Scan image utility functions (thumbnail + listing image)
│   │   │   ├── export-templates.ts         # Export format definitions (CSV, JSON)
│   │   │   ├── error-tracking.ts           # Client error reporting
│   │   │   └── version.svelte.ts           # Version checking (runes store)
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
│   │   │   ├── fuzzy-match.ts      # Fuzzy string matching (Levenshtein distance)
│   │   │   ├── normalize-ocr-name.ts # Phase 2 OCR name normalization (strip diacritics, collapse whitespace, apply hand-curated typo map)
│   │   │   ├── exif.ts             # EXIF parsing helper (used by scan-telemetry for make/model/GPS-stripped)
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

### Recognition Pipeline

A two-tier waterfall designed for near-zero per-scan cost. Tier 1 runs entirely client-side via PaddleOCR (no API cost); Tier 3 Claude Haiku is reached only when Tier 1 can't clear the confidence floor.

#### Tier 1 — Local OCR (free, ~1–3 seconds)

PaddleOCR via `@gutenye/ocr-browser`, bundled into a separate chunk that lazy-loads on scan page entry. Model assets (~15MB total: detection + recognition + dictionary) served from `static/models/` and cached at the edge. Multiple OCR reads are aggregated via `consensus-builder.ts` into a single `(card_number, name)` tuple, which is then matched against the card database.

Four capture modes feed the same consensus builder:

- **Live camera stream** — `live-ocr-coordinator.ts`. 2fps OCR passes during alignment-ready camera phase. 2-frame voting with 4-layer wire-crossing defense (alignment gating, monotonic session IDs, pixel correlation ~0.85, canonical captured frame wins). The shutter capture runs through the canonical path as verification.
- **Canonical single frame** — `tier1-canonical.ts`. Single high-resolution PaddleOCR pass against a captured frame. Used by uploads and by live camera shutter.
- **Upload TTA** — `upload-pipeline.ts` via `upload-frame-generator.ts`. Synthetic-frame voting: 5 augmented variants of a single uploaded image run through PaddleOCR, consensus builder aggregates. Fires only when canonical confidence is below the floor. Gated by `upload_tta_v1`.
- **Binder grid** — `binder-coordinator.ts` via `cell-extractor.ts` + `blank-cell-detector.ts` + `ocr-worker-pool.ts`. Full-page scan of a 2×2 / 3×3 / 4×4 grid; each non-blank cell is its own independent live-OCR session sharing a worker pool. Gated by `binder_mode_v1`.

All four modes produce the same telemetry shape and are matched against the catalog mirror (`catalog-mirror.ts`) via `(card_number, name)` lookup. Wonders cards additionally run through `parallel-classifier.ts` to resolve the foil variant (Paper / Classic Foil / Formless Foil / Orbital Color Match / Stonefoil) — BoBA parallels are encoded in the card number prefix, Wonders aren't.

Tier 1 is gated by the `live_ocr_tier1_v1` feature flag. When off, scans fall straight through to Tier 3.

#### Tier 3 — Claude Haiku fallback (~$0.002/scan, ~2–4 seconds)

Reached when Tier 1 consensus confidence is below the floor, or when the flag is off. The card image is POSTed to `/api/scan`, sanitized via sharp (EXIF stripping, pixel bomb protection, re-encoding), and sent to Claude Haiku with the per-game prompt and tool definition. The `identify_card` tool name is hardcoded — every game's `GameConfig.cardIdTool` must use it. Currently <5% of scans reach Haiku in flag-on production.

#### What's no longer in the pipeline

Retired in Session 2.5:
- **Hash cache Tier 1** (pHash lookup against IndexedDB + Supabase `hash_cache`). Not used for recognition anymore. The `hash_cache` table still exists — image-harvester and AR overlay still write/read it — but the recognition orchestrator never queries it.
- **Tesseract Tier 2**. `tesseract.js` was removed from dependencies entirely. OCR is now exclusively PaddleOCR.

Any CLAUDE.md or docs references to "Tier 2" or to the `hash/ocr/ai/manual` scan_method enum refer to pre-2.5 architecture and are inaccurate.

#### Telemetry

Every scan writes a row to `public.scans` with `winning_tier` ∈ `{tier1_local_ocr, tier3_claude, manual}` and `fallback_tier_used` ∈ `{NULL, 'none', 'haiku', 'sonnet', 'manual'}`. Detailed per-tier timing and confidence go into `scan_tier_results` (one row per tier attempted). Live-trace checkpoints go into `scan_pipeline_checkpoint` (per-stage elapsed_ms + extras jsonb). The admin Phase 2 tab surfaces aggregate trends; see `docs/phase-2-telemetry.md` for canonical SQL drilldowns.

Pipeline code lives in five service files: `recognition.ts` (orchestrator), `recognition-tiers.ts` (two-tier dispatcher), `recognition-validation.ts` (cross-validation), `recognition-workers.ts` (worker lifecycle), plus the Tier 1 mode implementations named above.

### Card Database Loading

The card database has a layered loading strategy (see `card-db.ts`):

1. IndexedDB cache (may have fresher Supabase data from a previous session)
1. Paginated Supabase fetch (first-time load or corrupt IDB), then background refresh

Cards are loaded with `game_id` awareness. Play card merging is gated on `_activeGameIds.includes('boba')` — play cards are a BoBA concept.

### Wonders Parallel System

Wonders cards have five physical parallels. Unlike BoBA where parallel is encoded in the card number prefix (e.g. `BF-` for Battlefoil), Wonders uses the same card number across parallels and distinguishes them as a separate column value.

| Short code | Stored value (DB) | Description |
|-----------|-------------------|-------------|
| `paper` | `'Paper'` | Solid black border, matte |
| `cf` | `'Classic Foil'` | Lined border, foil treatment |
| `ff` | `'Formless Foil'` | Borderless bleed, foil |
| `ocm` | `'Orbital Color Match'` | Lined border + serial number |
| `sf` | `'Stonefoil'` | Like OCM but 1/1 rarity |

The parallel classifier (`src/lib/services/parallel-classifier.ts`) emits the short codes from OCR/image signals; these are mapped to the full stored names before DB write. Short codes are never persisted — always use the full name when querying or inserting. Free-text column, no CHECK constraint — BoBA's 49 parallel names and Wonders' 5 names coexist in the same `parallel` column across tables.

**Column name.** `parallel TEXT` (default `'paper'` on most tables; default is literally the lowercase `'paper'` for historical reasons, even though Wonders rows store `'Paper'` title-cased). Present on 11 tables — see the Database Schema section for the full list.

**Catalog state.** All 1,007 current Wonders card rows in `cards` have `parallel='Paper'`. The 5x catalog expansion (one row per parallel) is planned but not yet executed. When that lands, the `(card_number, name, parallel) → card_id` tuple becomes unique across the catalog; today, `(card_number, name)` is already unique because only Paper exists.

**Why Wonders needs classification but BoBA doesn't.** BoBA encodes parallel in the card number (`BF-001-foo` is Battlefoil, `SBF-001-foo` is Silver Battlefoil) — reading the card number tells you the parallel directly. Wonders uses the same card number across parallels, so the scan pipeline must infer parallel from visual signals (border style, foil treatment, serial-number presence). `parallel-classifier.ts` handles this as part of the Tier 1 consensus; the result is written to `scans.final_parallel` and flows through to `collections.parallel` / `listing_templates.parallel`.

**`wonders_cards_full` view.** A JOIN of `cards` (game_id='wonders') with `wotf_cards` on `id`. Query this instead of joining manually when you need both the shared card fields (name, parallel, set_code) and the Wonders-specific data (orbitals, dragon points, card class).

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

Schema changes are applied via Supabase MCP (`apply_migration` for DDL, `execute_sql` for one-off data ops). Committed migration files in `/migrations/` are the canonical history — prod and the migrations folder are kept in sync; fresh Supabase branches must converge to the same state when all migrations run in order. Card seed data is generated via `scripts/generate-card-seed.js` (requires a local `card-database.json` file, not checked into the repo).

**Multi-game scoping.** `game_id TEXT DEFAULT 'boba'` is present on: `cards`, `collections`, `scans`, `hash_cache`, `price_cache`, `price_history`, `listing_templates`, `price_harvest_log`, `scan_sessions`, `scraping_test`. All queries that span multiple games must filter on `game_id` explicitly — defaulting to `'boba'` keeps pre-Phase-3 code working without changes.

**Parallel column is the source of truth, not `variant`.** During the Phase 2 arc the `variant` column was renamed to `parallel` across every table that had it. `parallel TEXT` is present on 11 tables: `cards`, `card_embeddings`, `collections`, `hash_cache`, `listing_templates`, `price_cache`, `price_harvest_log`, `price_history`, `scan_resolutions`, `variant_harvest_seed`, `wonders_cards_full` (view). Default value is `'paper'` on most; `cards.parallel` has no default (must be specified at insert). There are no CHECK constraints on parallel values — it's a free-text column so that BoBA's 49 parallel types and Wonders' 5 variants can coexist without a shared enum.

**Wonders parallel names.** Stored as full human-readable strings: `'Paper'`, `'Classic Foil'`, `'Formless Foil'`, `'Orbital Color Match'`, `'Stonefoil'`. The parallel classifier emits short codes (`paper/cf/ff/ocm/sf`) which are mapped to these full names before DB write. All 1,007 current Wonders card rows have `parallel='Paper'` — the future 5x catalog expansion (one row per parallel) is tracked separately.

**BoBA typos are canonical.** The card catalog preserves source-of-truth typos that OCR must match exactly: `'Stongboy'`, `'Crosbow'`, `'Cameleon'`, `'Laviathan'`, and both `'Cruze Control'` and `'Cruze-Control'` (Levenshtein 1 — fuzzy match hazard). Don't auto-correct these in code.

#### Extensions

- `uuid-ossp` — UUID generation
- `pg_trgm` — Trigram search (used by card name lookup)
- `vector` (pgvector) — DINOv2-base embeddings for `card_embeddings` with HNSW indexes

#### Tables — Users & Auth

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | Auth + profile | `id` (UUID PK), `auth_user_id` (UNIQUE, FK `auth.users`), `email` (UNIQUE), `google_id` (UNIQUE), `name`, `picture`, `discord_id`, `is_admin`, `is_pro`, `pro_until`, `is_member`, `member_until`, `is_organizer`, `persona` (JSONB default `{seller:0, collector:0.5, tournament:0, deck_builder:0}`), `nav_config` (JSONB), `active_theme_id`, `custom_theme` (JSONB), `can_invite`, `card_limit` (default 100), `api_calls_limit/used`, `cards_in_collection`, `last_reset_date` |
| `pro_payments` | Pro tier payments (replaced `donations`) | `user_id` (FK users), `tier_key`, `tier_amount`, `payment_method`, recorded timestamps |
| `subscribers` | Newsletter/update subscribers | `id` (PK), `user_id` (UNIQUE), subscription fields |
| `user_badges` | Achievement badges | `user_id` (FK `auth.users`), `badge_key`, `badge_name`, `badge_description`, `badge_icon`, `earned_at` |
| `user_feature_overrides` | Per-user feature toggles | PK `(user_id, feature_key)`, `enabled` |
| `user_game_prefs` | Multi-game preferences (table retained; service deleted in 2.6) | `user_id` (UNIQUE, FK `auth.users`), `default_game`, `enabled_games` (TEXT[] default `{boba}`) |
| `ebay_seller_tokens` | eBay OAuth creds (service_role only) | `user_id` (PK, FK `auth.users`), `access_token`, `refresh_token`, `ebay_username`, `scopes`, expiry timestamps |
| `error_logs` | Client error reporting (service_role only) | `type`, `message`, `stack`, `url`, `user_agent`, `session_id` |
| `_admin_shared_secrets` | Internal secret storage (service_role only) | Opaque — not used by app code directly |

#### Tables — Cards & Catalog

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `cards` | Unified card database (all games) | `id` (UUID PK), `card_id_legacy` (INT UNIQUE), `name`, `hero_name`, `athlete_name`, `set_code`, `card_number`, `year`, `parallel`, `power`, `rarity`, `weapon_type`, `battle_zone`, `image_url`, `search_vector` (tsvector), `game_id` (default `'boba'`), `metadata` (JSONB default `{}`), `created_at`, `updated_at` |
| `wotf_cards` | Wonders reference data (1:1 join with `cards` on `id` via `wonders_cards_full` view) | `id` (UUID PK, matches `cards.id`), `name`, `display_name`, `type_line`, `subtype`, `set_name/code`, `collector_number`, `normalized_name`, `image_path`, `artist`, `flavor_text`, `rules_text`, `rarity`, `reprint`, `card_copies_limit` (default 3), `is_landscape`, `orbital_cost` (JSONB), `orbitals` (JSONB), `hierarchy`, `dbs`, `power`, `cost`, `card_class`, `lineage`, `faction`, `is_core`, `traits`, `activate_on_1/2`, `ability_text_1/2`, `source_created/updated_at` |
| `play_cards` | BoBA Play + Hot Dog cards | `id` (TEXT PK — e.g. `'A---PL-2'`), `card_number`, `name`, `release`, `type`, `number`, `hot_dog_cost`, `dbs`, `ability` |
| `card_reference_images` | Reference image competition | `card_id` (TEXT PK), `image_path`, `phash`, `confidence`, `contributed_by`, `contributor_name`, `blur_variance`, `times_challenged`, `previous_confidence` |
| `card_embeddings` | DINOv2-base image embeddings for visual search | PK `(card_id, parallel, source, model_version)`, `embedding` (pgvector), `model_version` (default `'dinov2-base-v1'`), `confidence`, `created_at`, `created_by` |
| `pack_configurations` | Pack simulator config | `box_type`, `set_code`, `display_name`, `slots` (JSONB), `packs_per_box`, `msrp_cents`, `is_active` |

#### Tables — User Collections

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `collections` | Current collection table | `id` (UUID PK), `user_id`, `card_id` (FK `cards`), `quantity` (default 1), `condition` (default `'near_mint'`), `notes`, `scan_image_url`, `game_id` (default `'boba'`), `parallel` (default `'paper'`) |
| `collections_v2` | Next-gen collection table (scaffolded, not used in app code) | `id` (UUID PK), `user_id`, `card_id` (FK `cards`), `quantity`, `condition`, `notes` |

#### Tables — Scan Pipeline (Phase 1 + 2)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `scan_sessions` | Device + browser + network context, one row per app session | `id` (UUID PK), `user_id`, `game_id`, `device_model`, `os_name/version`, `browser_name/version`, `app_version`, `viewport_width/height`, `device_memory_gb`, `network_type` + `net_effective_type/downlink_mbps/rtt_ms`, `capabilities` (JSONB), `battery_level/charging`, `is_pwa_standalone`, `page_session_age_ms`, `release_git_sha`, `started_at`, `ended_at`, `extras` (JSONB), `schema_version`, `created_at` |
| `scans` | One row per scan attempt — the primary recognition result table | 63 columns covering: `id` (UUID PK), `session_id` (FK `scan_sessions`), `user_id`, `game_id`, photo metadata (`photo_storage_path`, `photo_thumbnail_path`, `photo_bytes/width/height/mime_type/sha256/aspect_ratio`), `parent_scan_id` (self-FK for binder children), `retake_chain_idx`, capture context (`capture_context` JSONB, `capture_source`, `camera_facing`, `torch_on`, `focus_mode`), device sensors (`device_orientation_beta/gamma`, `accel_magnitude`, `thermal_state`, `battery_level`), quality signals (`quality_signals` JSONB, `composite_quality`, `blur_laplacian_variance`, `luminance_mean/std`, `overexposed_pct`, `underexposed_pct`, `edge_density_canny`, `card_area_pct`, `perspective_skew_deg`, `quality_gate_passed`, `quality_gate_fail_reason`), EXIF (`exif_make/model/orientation/capture_at/software/gps_stripped`), resolution (`winning_tier` TEXT — `tier1_local_ocr`/`tier3_claude`/`manual`, `final_card_id`, `final_confidence`, `final_parallel`, `live_consensus_reached`, `live_vs_canonical_agreed`, `fallback_tier_used` CHECK `none\|haiku\|sonnet\|manual\|NULL`), timing/cost (`total_latency_ms`, `total_cost_usd`, `capture_latency_ms`), user action (`user_overrode`, `corrected_card_id`, `user_action`, `ms_to_user_action`), lifecycle (`outcome` enum `scan_outcome`, `pipeline_version`, `decision_context` JSONB, `photo_retention_until`, `extras`, `schema_version`, `captured_at`, `created_at`) |
| `scan_tier_results` | One row per tier invocation within a scan (max 2: Tier 1 + optional Tier 3) | `id` (UUID PK), `scan_id` (FK `scans`), `user_id`, `tier` (enum `scan_tier`), `engine` (enum `scan_engine`), `engine_version`, `raw_output` (JSONB), `parsed_card_id/parallel/confidence`, `latency_ms`, `cost_usd`, `errored`, `error_message/code`, OCR fields (`ocr_text_raw`, `ocr_mean_confidence`, `ocr_word_count`, `ocr_detected_card_number`, `ocr_orientation_deg`), LLM fields (`llm_model_requested/responded`, `llm_input/output/cache_creation/cache_read_tokens`, `llm_finish_reason`, `prompt_template_sha/version`, `pricing_table_version`, `claude_returned_name_in_catalog`), hash-match legacy fields from pre-2.5 (`query_dhash`, `query_phash_256`, `match_distance`, `winner_dhash/phash_distance`, `runner_up_margin_dhash`, `hash_match_count`, `idb_cache_hit`, `sb_exact/fuzzy_hit`), `topn_candidates` (JSONB), `outcome`, `skip_reason`, `extras`, `schema_version`, `ran_at`, `created_at` |
| `scan_claude_responses` | Raw Claude Haiku responses for Tier 3 scans | PK `tier_result_id` (FK `scan_tier_results`) |
| `scan_pipeline_checkpoint` | Per-stage trace (elapsed_ms + extras) for live pipeline debugging | `id` (BIGINT PK), `trace_id`, `user_id`, `stage`, `elapsed_ms`, `extras` (JSONB), `created_at` |
| `scan_resolutions` | Consensus snapshot for confirmed scan outcomes | `id` (UUID PK), `scan_id` (FK `scans`), `user_id`, `card_id`, `parallel` (default `'paper'`), `consensus_score`, `tier_agreement_bits`, `confirmed_at`, `confirmed_by`, `superseded_at`, `superseded_by`, `extras`, `schema_version` |
| `scan_disputes` | User-reported incorrect scans | `id` (UUID PK), scan + card refs, dispute metadata |
| `alignment_signal_telemetry` | Pre-capture alignment signal data (live camera) | `id` (PK) |
| `hash_cache` | Perceptual hash cache — NO LONGER part of recognition pipeline; used only by image-harvester and AR overlay | `phash` (TEXT PK), `card_id` (FK `cards`), `confidence`, `scan_count`, `phash_256`, `game_id` (default `'boba'`), `parallel` (default `'paper'`), `source` (enum `hash_source`, default `'admin'`), `consensus_count`, `dispute_count`, `last_confirmed_at`, `superseded_at`, `extras` (JSONB), `schema_version`, `last_seen`, `created_at` |

#### Tables — Pricing & Commerce

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `price_cache` | Current eBay prices for hero cards | **PK: `(card_id, source, parallel)`**. `price_low/mid/high`, `buy_now_low/mid/count`, `listings_count`, `filtered_count`, `confidence_score`, `confidence_cold_start`, `fetched_at`, `game_id` (default `'boba'`), `parallel` (default `'paper'`) |
| `play_price_cache` | Current prices for play cards — separate table because `play_cards.id` is TEXT not UUID | **PK: `(card_id TEXT, source)`**. Same price columns as `price_cache`, minus parallel (plays have no parallels) |
| `price_history` | Historical hero price tracking | `id` (UUID PK), `card_id` (UUID), `source`, `price_low/mid/high`, `listings_count`, `recorded_at`, `game_id`, `parallel` |
| `play_price_history` | Historical play price tracking | `id` (UUID PK), `card_id` (TEXT), `source`, `price_low/mid/high`, `listings_count`, `recorded_at` |
| `price_harvest_log` | Per-card harvest attempt log (heroes only — play harvests log to `play_price_cache.fetched_at`) | `id` (UUID PK), `run_id`, `chain_depth`, `priority` (1-4), `card_id`, `hero_name`, `card_name`, `card_number`, `search_query`, eBay result stats, pricing (`price_low/mid/high/mean`, `buy_now_*`, `confidence_score`, `buy_now_confidence`), deltas (`previous_mid`, `price_changed`, `price_delta/_pct`, `is_new_price`), `success`, `zero_results`, `threshold_rejected`, `error_message`, `duration_ms`, `game_id`, `parallel`, `confidence_cold_start`, `processed_at` |
| `listing_templates` | eBay listing drafts (one per scan→listing) | `id` (UUID PK), `user_id`, `card_id` (FK `cards`), `scan_id` (UUID FK `scans`, added 2.1a), `title`, `description`, `suggested_price`, `price`, `condition` (default `'near_mint'`), `status` (CHECK `draft\|pending\|published\|sold\|ended\|error`), eBay fields (`ebay_listing_id`, `ebay_offer_id`, `ebay_listing_url`, `sku`), card denorm (`hero_name`, `card_number`, `set_code`, `parallel`, `weapon_type`), images (`scan_image_url`, `image_url`), sale tracking (`sold_at`, `sold_price`), `game_id` (default `'boba'`), `error_message`, timestamps |
| `variant_harvest_seed` | Queue for cards that need parallel-specific price harvesting | PK `(card_id, parallel)`, `reason`, `created_at` |
| `scraping_test` | External pricing intelligence (third-party lookup results) | `id` (UUID PK), `card_id` (UUID UNIQUE, FK `cards`), `st_price/low/high`, `st_source_id`, `st_card_name`, `st_set_name`, `st_variant`, `st_rarity`, `st_image_url`, `st_raw_data` (JSONB), `st_updated`, `game_id` |
| `ebay_api_log` | eBay quota tracking (per harvest run) | `calls_used/remaining/limit`, `chain_depth`, `cards_processed/updated/errored`, `status` (`running`/`quota_exhausted`/`no_cards_remaining`/`triggered_manual`) |

#### Tables — Tournaments

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `tournaments` | Tournament definitions | `creator_id` (FK users), `code` (UNIQUE), `name`, `format_id`, `description`, `venue`, `event_date`, `entry_fee`, `prize_pool`, `deck_type` CHECK (`constructed`/`sealed`), `max_players`, `submission_deadline`, `registration_closed`, `deadline_mode` (default `'manual'`), `results_entered`, `results_entered_at`, `results_entered_by`, `max_heroes`, `max_plays`, `max_bonus`, `usage_count` |
| `tournament_registrations` | Player registrations | `tournament_id`, `user_id`, `email`, `name`, `discord_id`, `deck_csv` |
| `deck_submissions` | Tournament deck submissions | `tournament_id`, `user_id`, `player_name`, `player_email`, `player_discord`, `hero_cards` (JSONB), `play_entries` (JSONB), `hot_dog_count`, `foil_hot_dog_count`, `format_id`, `format_name`, `is_valid`, `validation_violations` (JSONB), `validation_warnings` (JSONB), `validation_stats` (JSONB), `dbs_total`, `hero_count`, `total_power`, `avg_power`, `source_deck_id` (FK `user_decks`), `status` (`submitted`/`locked`/`withdrawn`), `verification_code` (UNIQUE), `locked_at` |
| `tournament_results` | Organizer-entered results | `tournament_id`, `submission_id` (FK `deck_submissions`), `player_name`, `player_user_id`, `final_standing`, `placement_label`, `match_wins/losses/draws`, `entered_by` |

#### Tables — Decks

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `user_decks` | Saved deck lists | `id` (UUID PK), `user_id` (FK `auth.users`), `name`, `format_id`, `hero_card_ids` (TEXT[]), `play_entries` (JSONB), `hot_dog_count`, `hero_deck_min/max`, `play_deck_size`, `bonus_plays_max`, `hot_dog_deck_size`, `dbs_cap`, `spec_power_cap`, `combined_power_cap`, `is_shared`, `is_custom_format`, `notes`, `last_edited_at` |
| `deck_snapshots` | QR verification snapshots | `code` (UNIQUE), `user_id`, `deck_id`, `deck_name`, `format_id`, `format_name`, `is_valid`, `violations` (JSONB), `stats` (JSONB), `hero_cards` (JSONB), `play_cards` (JSONB), `player_name`, `locked_at` |
| `deck_shop_refresh_log` | Deck shop refresh events | `user_id`, `card_count` |

#### Tables — Wonders-Specific

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `dragon_points_config` | Wonders collection scoring config | **PK: `(config_type, key)`**. `config_type` CHECK (`base_table`/`class_multiplier`/`year_bonus`/`bonus_card`), `value` (JSONB), `description`, `updated_by` (FK `auth.users`) |

#### Tables — System & Admin

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `system_settings` | Global app config | `key` (TEXT PK), `value` — seeds: `maintenance_mode`, `max_daily_scans`, `app_version`. The pre-2.6 `app_name` row was deleted — app name is now hardcoded in `app.html` and component strings. |
| `app_config` | Application config | `key` (TEXT PK), `value` (JSONB), `description` |
| `feature_flags` | Feature gating | `feature_key` (PK), `display_name`, `description`, `icon`, `enabled_globally`, `enabled_for_guest/authenticated/member/pro/admin`, `updated_at` |
| `api_call_logs` | API usage tracking | `user_id` (FK users), `call_type`, `success`, `error_message`, `cost`, `cards_processed` |
| `changelog_entries` | What's new notifications | `title`, `body`, `published`, `is_notification`, `published_at`, `created_by` (FK `auth.users`) |
| `admin_activity_log` | Admin audit trail | `admin_id` (FK `auth.users`), `action`, `entity_type`, `entity_id`, `details` (JSONB) |
| `parallel_rarity_config` | Parallel card rarity | `parallel_name` (UNIQUE), `rarity`, `sort_order`, `updated_by` (FK users) |

#### RPC Functions

Recognition & catalog:
- `find_similar_hash(query_hash, max_distance, p_game_id)` — Hamming-distance fuzzy pHash lookup (used only by AR overlay post-2.5; recognition pipeline no longer calls it)
- `find_similar_phash_256(query_phash_256, max_distance, p_game_id, p_limit)` — same as above for 256-bit pHash variant
- `upsert_hash_cache(p_phash, p_card_id, ...)` — legacy entrypoint, kept for backward compatibility
- `upsert_hash_cache_v2(p_phash, p_card_id, p_phash_256, p_game_id, p_parallel, p_source, p_confidence)` — current entrypoint used by image-harvester
- `match_card_embedding(query_embedding, target_game_id, top_k, min_similarity)` — pgvector similarity search against `card_embeddings`
- `get_wonders_cards_to_seed(p_limit)` — feeds the DINOv2 embedding seeder script
- `lookup_correction(p_ocr_reading)` — community OCR corrections (requires 3+ confirmations)
- `submit_correction(p_ocr_reading, p_correct_card_number)` — submit a community correction

User & collection:
- `activate_pro(p_user_id, p_tier_key, p_tier_amount, p_payment_method, p_days)` — Pro activation with cooldown
- `award_badge_if_new(p_user_id, p_badge_key, ...)` — idempotent badge awarding
- `increment_persona(p_dimension)` — persona weight update (post-scan signal)
- `check_monthly_reset()` — TRIGGER for api_calls_used monthly reset
- `handle_new_user()` — TRIGGER seeding users row when auth.users row is inserted
- `submit_reference_image(p_card_id, p_image_path, p_confidence, p_user_id, p_user_name, p_blur_variance)` — atomic reference image submission with champion comparison

Tournaments & decks:
- `increment_tournament_usage(tid)` — atomic tournament usage counter
- `increment_shared_deck_views(deck_id)` — atomic shared deck view counter
- `get_weekly_listing_count(p_user_id)` — free-tier listing gate (3/week, Sunday reset)

Pricing & harvest:
- `get_harvest_candidates(p_run_id, p_limit, p_game_id)` — per-game prioritized candidate selection (priority 1-4)
- `get_play_harvest_candidates(p_limit)` — play card candidate selection (TEXT card_id)
- `get_harvest_summary(p_run_id)` — harvest run summary statistics
- `get_price_status_summary()` — pricing coverage stats by card type
- `get_latest_harvest_per_card(p_card_ids)` — most recent harvest result per card

Admin & maintenance:
- `get_daily_trends(p_days)` — daily trend aggregation (default 14 days)
- `refresh_scan_history_mvs()` — refresh scan history materialized views
- `set_photo_retention_until()` — TRIGGER setting photo retention window on scan insert
- `scan_pipeline_trace_set_user_id()` — TRIGGER (legacy — scan_pipeline_trace table was dropped in 2.6; trigger body is harmless)
- `update_updated_at_column()` — generic TRIGGER for `updated_at`

Phase 2 telemetry:
- `phase_2_telemetry(window_interval)` — aggregate read-only dashboard RPC returning all ten Phase 2 telemetry sections as one JSONB payload. Powers the admin Phase 2 tab. Window parameter is allowlist-guarded inside the function.

(Extensions like `pgvector` contribute many more functions — `cosine_distance`, `l2_distance`, vector arithmetic — not listed individually.)

#### RLS Summary

- **All tables** have RLS enabled.
- **Anon**: read-only access to public data (`cards`, `price_cache`, `feature_flags`, `tournaments`, `deck_snapshots`, `pack_configurations`, `card_reference_images`).
- **Authenticated**: read/write own data (`collections`, `user_decks`, `scans`, `scan_sessions`, `scan_tier_results`, `scan_resolutions`, `user_badges`, `deck_submissions`, `listing_templates`), read public data.
- **Service role**: full access — used for `ebay_seller_tokens`, `error_logs`, `_admin_shared_secrets`, `price_harvest_log`, `play_price_cache`, admin tables, the `activate_pro` / `handle_new_user` / `check_monthly_reset` functions, and all cron/QStash writes.

#### Key Constraints & Enums

- `users`: email UNIQUE, `google_id` UNIQUE, `auth_user_id` UNIQUE.
- `cards`: `set_code` non-empty, `name` non-empty, `game_id` defaults to `'boba'`.
- `collections`: `quantity` default 1, `condition` default `'near_mint'`, `parallel` default `'paper'`. No CHECK on parallel (free-text — see Wonders note at top of section).
- `price_cache`: PK `(card_id, source, parallel)`. Numeric prices; no monotonicity constraint (low may exceed mid in sparse-listing edge cases; consumers filter on `confidence_score`).
- `play_price_cache`: PK `(card_id, source)`. No `parallel` — plays don't vary by parallel.
- `hash_cache`: PK `phash`. `source` is enum `hash_source`. `confidence_count`/`dispute_count` default 0.
- `scans`: `outcome` is enum `scan_outcome`. `fallback_tier_used` CHECK `'none'\|'haiku'\|'sonnet'\|'manual'\|NULL`. `capture_source` CHECK includes `'camera_live'`, `'upload_library'`, `'camera_roll_import'`, `'binder_live_cell'`, `'manual'`.
- `scan_tier_results`: `tier` is enum `scan_tier`. `engine` is enum `scan_engine`.
- `listing_templates`: `status` CHECK `'draft'\|'pending'\|'published'\|'sold'\|'ended'\|'error'`. `scan_id` FK `scans(id)` ON DELETE SET NULL.
- `tournaments`: `deck_type` CHECK `'constructed'\|'sealed'`.
- `dragon_points_config`: `config_type` CHECK `'base_table'\|'class_multiplier'\|'year_bonus'\|'bonus_card'`.

#### What the pre-2.5 schema docs got wrong (for anyone reading old code/commits)

- **`scans.scan_method` enum (`hash/ocr/ai/manual`)** — the column was removed during Phase 1. `scans.winning_tier` is the current equivalent and takes different values (`tier1_local_ocr`/`tier3_claude`/`manual`).
- **`scans.variant` CHECK** — column was renamed to `final_parallel`, CHECK was dropped during Phase 2 (parallel is now free-text).
- **`collections.variant`** — column was renamed to `parallel`. Old `CHECK (paper/cf/ff/ocm/sf)` was dropped — Wonders variants are stored as full names, BoBA parallels are stored as named strings like `'Battlefoil'`.
- **`donations` table** — replaced by `pro_payments`. Column semantics are similar; naming updated to reflect the product shift.
- **`scan_pipeline_trace`** — dropped in Session 2.6. `scan_pipeline_checkpoint` is the current equivalent.

Drift check query (should return `0/0` post-deploy):

```sql
SELECT 'pc_drift', COUNT(*) FROM price_cache pc
  JOIN cards c ON c.id = pc.card_id
  WHERE c.game_id <> pc.game_id
UNION ALL
SELECT 'lt_drift', COUNT(*) FROM listing_templates lt
  JOIN cards c ON c.id = lt.card_id
  WHERE c.game_id <> lt.game_id;
```

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

Pipeline entry point: `recognizeCard()` in `src/lib/services/recognition.ts`. All scanning-surface code (Scanner component, Binder component, upload path, camera-roll import) calls through it.

Orchestrator and support:
- Orchestrator: `src/lib/services/recognition.ts`
- Tier dispatcher: `src/lib/services/recognition-tiers.ts` (Tier 3 Haiku only — Tier 1 modes dispatch independently)
- Cross-validation: `src/lib/services/recognition-validation.ts`
- Worker lifecycle: `src/lib/services/recognition-workers.ts`
- Scan writer: `src/lib/services/scan-writer.ts` (single owner of the `scans` table row)
- Checkpoint trace: `src/lib/services/scan-checkpoint.ts` (writes to `scan_pipeline_checkpoint`)

Tier 1 local OCR (by mode):
- Engine + init: `src/lib/services/paddle-ocr.ts`
- Region configuration: `src/lib/services/ocr-regions.ts`
- Live camera: `src/lib/services/live-ocr-coordinator.ts`
- Canonical single frame: `src/lib/services/tier1-canonical.ts`
- Upload TTA: `src/lib/services/upload-pipeline.ts` + `upload-frame-generator.ts`
- Binder grid: `src/lib/services/binder-coordinator.ts` + `cell-extractor.ts` + `blank-cell-detector.ts` + `ocr-worker-pool.ts`
- Consensus aggregation: `src/lib/services/consensus-builder.ts`
- Parallel classification (Wonders only): `src/lib/services/parallel-classifier.ts`
- Wire-crossing defense: `src/lib/services/pixel-stability.ts`

Catalog and matching:
- Catalog mirror (client-side): `src/lib/services/catalog-mirror.ts`
- Card database: `src/lib/services/card-db.ts`, `src/lib/services/card-db-search.ts`
- Fuzzy matching: `src/lib/utils/fuzzy-match.ts`
- OCR name normalization: `src/lib/utils/normalize-ocr-name.ts`

Game-specific config:
- Per-game modules: `src/lib/games/{gameId}/` (OCR regions, extractors, prompts, theme, nav)
- Extractors: `src/lib/games/{gameId}/extract.ts` — called by Tier 1 to parse card-number strings after OCR

Image pre-processing:
- Web worker: `src/lib/workers/image-processor.ts` (resize, blur detection, OCR preprocess)
- Cropping: `src/lib/services/card-cropper.ts`, `src/lib/services/constrained-crop.ts`

Feature flags gating the pipeline:
- `live_ocr_tier1_v1` — master switch for Tier 1. When off, all scans go to Haiku.
- `upload_tta_v1` — enables synthetic-frame voting for uploads. Requires `live_ocr_tier1_v1` on.
- `binder_mode_v1` — enables the binder grid capture mode. Requires `live_ocr_tier1_v1` on.

All three default to `enabled_for_admin: true` in `FEATURE_DEFINITIONS` (`src/lib/stores/feature-flags.svelte.ts`). Production settings live in the `feature_flags` table and can be changed via `/admin → Features`.

### Adding tests

1. Create test file in `tests/` directory
1. Name convention: `<module>.test.ts` (unit), `<module>.integration.test.ts` (integration), `<module>.e2e.test.ts` (E2E)
1. Mock external dependencies (sharp, Anthropic, Supabase, Redis) using `vi.mock()`
1. Run with `npm test` or `npm run test:watch`
