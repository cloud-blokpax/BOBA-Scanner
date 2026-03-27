# CLAUDE.md — BOBA Scanner

## Project Overview

BOBA Scanner is an AI-powered trading card scanner for **Bo Jackson Battle Arena (BoBA)** collectible cards. It uses a three-tier recognition pipeline (hash cache, OCR, Claude AI) to identify cards from photos, with most scans completing for free via client-side processing. The app is a mobile-first PWA built with SvelteKit and deployed on Vercel.

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
```

## Project Structure

```
BOBA-Scanner/
├── src/
│   ├── app.html                    # HTML shell (PWA meta, CSP via Vercel headers)
│   ├── app.d.ts                    # Global type declarations (App.Locals, App.PageData)
│   ├── hooks.server.ts             # Server hooks: Supabase client init + auth guard
│   ├── styles/index.css            # Global CSS (dark theme, CSS custom properties)
│   ├── routes/
│   │   ├── +layout.svelte          # Root layout: header, bottom nav, auth state
│   │   ├── +layout.server.ts       # Root server load: session/user from Supabase
│   │   ├── +page.svelte            # Homepage / dashboard
│   │   ├── scan/+page.svelte       # Card scanning interface
│   │   ├── batch/+page.svelte      # Batch scanning interface
│   │   ├── binder/+page.svelte     # Binder page scanning
│   │   ├── collection/+page.svelte # Card collection management
│   │   ├── deck/                   # Deck builder
│   │   │   ├── +page.svelte        # Deck list / management
│   │   │   ├── +page.server.ts     # Deck list server load
│   │   │   ├── new/+page.svelte    # Create new deck
│   │   │   ├── [id]/+page.svelte   # Edit deck by ID
│   │   │   ├── [id]/view/+page.svelte # View deck (read-only)
│   │   │   ├── architect/+page.svelte # Playbook architect (AI-assisted deck building)
│   │   │   ├── shop/+page.svelte   # Deck shop (find missing cards)
│   │   │   └── verify/[code]/+page.svelte # Deck verification by share code
│   │   ├── grader/+page.svelte     # AI card condition grading
│   │   ├── export/+page.svelte     # Collection export (CSV, etc.)
│   │   ├── sell/+page.svelte       # Sell cards (eBay listing generation)
│   │   ├── settings/+page.svelte   # User settings page
│   │   ├── set-completion/+page.svelte # Set completion tracker
│   │   ├── speed/+page.svelte      # Speed game challenge
│   │   ├── packs/+page.svelte      # Pack simulator
│   │   ├── leaderboard/+page.svelte # Reference image leaderboard
│   │   ├── organize/               # Tournament organizer
│   │   │   ├── +page.svelte        # Organizer dashboard
│   │   │   └── [code]/+page.svelte # Manage specific tournament
│   │   ├── tournaments/            # Tournament participation
│   │   │   ├── +page.svelte        # Tournament list
│   │   │   ├── detail/+page.svelte # Tournament detail view
│   │   │   └── enter/+page.svelte  # Tournament entry form
│   │   ├── marketplace/monitor/+page.svelte # eBay seller monitoring
│   │   ├── admin/                  # Admin dashboard
│   │   │   ├── +page.svelte        # Admin page: responsive mobile/desktop layout, tab routing
│   │   │   ├── +page.server.ts     # Admin server load
│   │   │   ├── Sparkline.svelte    # Reusable SVG sparkline with area fill
│   │   │   ├── AdminSidebar.svelte # Desktop persistent sidebar (metrics, health, eBay quota)
│   │   │   ├── AdminPulseTab.svelte # Overview: metric cards, alerts, trends, quick actions
│   │   │   ├── AdminUsersTab.svelte # User management: search, filters, bulk actions
│   │   │   ├── AdminCardsTab.svelte # Card health: pricing stats, misidentification queue
│   │   │   ├── AdminScansTab.svelte # Scan analytics: metrics, sparkline, hourly heatmap
│   │   │   ├── AdminEbayTab.svelte  # eBay quota gauge, price freshness, harvest trigger
│   │   │   ├── AdminFeaturesTab.svelte # Feature flag management
│   │   │   ├── AdminChangelogTab.svelte # CRUD for changelog entries
│   │   │   ├── AdminSystemTab.svelte # System health, data export, DB links
│   │   │   ├── AdminParallelsTab.svelte # Parallel type management (legacy)
│   │   │   ├── AdminConfigTab.svelte    # Configuration management (legacy)
│   │   │   ├── AdminPacksTab.svelte     # Pack configuration (legacy)
│   │   │   ├── AdminLogsTab.svelte      # Log viewer (legacy)
│   │   │   └── AdminStatsTab.svelte     # Statistics overview (legacy)
│   │   ├── privacy/+page.svelte    # Privacy policy
│   │   ├── terms/+page.svelte      # Terms of service
│   │   ├── auth/
│   │   │   ├── login/+page.svelte  # Login page
│   │   │   ├── callback/+server.ts # OAuth callback handler
│   │   │   ├── ebay/+server.ts     # eBay OAuth entry point
│   │   │   └── ebay/callback/+server.ts # eBay OAuth callback
│   │   └── api/
│   │       ├── scan/+server.ts     # POST: Claude AI card identification (Tier 3)
│   │       ├── grade/+server.ts    # POST: AI condition grading (Claude Sonnet)
│   │       ├── health/+server.ts   # GET: Health check endpoint
│   │       ├── badges/+server.ts   # POST: Badge award endpoint
│   │       ├── go-pro/+server.ts   # POST: Pro subscription upgrade
│   │       ├── log/+server.ts      # POST: Client-side error logging
│   │       ├── upload/+server.ts   # POST: Image upload
│   │       ├── price/[cardId]/
│   │       │   ├── +server.ts      # GET: eBay price lookup with caching
│   │       │   └── history/+server.ts # GET: Price history
│   │       ├── deck/
│   │       │   ├── validate/+server.ts    # POST: Deck validation
│   │       │   ├── refresh-prices/+server.ts # POST: Deck price refresh
│   │       │   └── lock/+server.ts        # POST: Lock deck for tournament
│   │       ├── reference-image/
│   │       │   ├── +server.ts             # POST: Reference image upload/submission
│   │       │   └── leaderboard/+server.ts # GET: Reference image leaderboard
│   │       ├── tournament/
│   │       │   ├── [code]/+server.ts    # GET: Tournament info by code
│   │       │   ├── register/+server.ts  # POST: Register for tournament
│   │       │   ├── results/+server.ts   # POST: Submit tournament results
│   │       │   └── submit-deck/+server.ts # POST: Submit deck for tournament
│   │       ├── organize/
│   │       │   ├── create/+server.ts          # POST: Create new tournament
│   │       │   └── close-registration/+server.ts # POST: Close tournament registration
│   │       ├── admin/
│   │       │   ├── stats/+server.ts          # GET: Aggregated dashboard metrics, trends, alerts
│   │       │   ├── changelog/+server.ts      # CRUD: Changelog entry management
│   │       │   ├── scan-flags/+server.ts     # GET/PUT: Misidentification flag review
│   │       │   ├── export/+server.ts         # POST: CSV/JSON data export
│   │       │   ├── users/+server.ts          # PUT/POST: User management and bulk operations
│   │       │   ├── feature-flags/+server.ts  # Admin: manage feature flags
│   │       │   ├── pack-config/+server.ts    # Admin: manage pack configurations
│   │       │   ├── parallels/+server.ts      # Admin: manage parallel types
│   │       │   └── set-organizer/+server.ts  # Admin: set tournament organizer role
│   │       └── ebay/
│   │           ├── browse/+server.ts    # eBay Browse API proxy
│   │           ├── listing/+server.ts   # POST: Generate/post eBay listings
│   │           ├── status/+server.ts    # GET: eBay seller auth status
│   │           └── disconnect/+server.ts # POST: Disconnect eBay seller auth
│   ├── lib/
│   │   ├── actions/tilt.ts         # Svelte action: 3D tilt effect for cards
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
│   │   │   ├── CardConditionCompare.svelte # Side-by-side condition comparison
│   │   │   ├── AuthenticityCheck.svelte # Card authenticity verification UI
│   │   │   ├── OptimizedCardImage.svelte # Optimized image display with lazy loading
│   │   │   ├── PriceDisplay.svelte # Price information display
│   │   │   ├── PriceTrends.svelte  # Price trend charts (premium)
│   │   │   ├── ProfilePrompt.svelte# User profile setup prompt
│   │   │   ├── GoProModal.svelte   # Pro subscription upgrade modal
│   │   │   ├── AffiliateNotice.svelte # Affiliate disclosure notice
│   │   │   ├── CloseButton.svelte  # Reusable close/dismiss button
│   │   │   ├── Toast.svelte        # Toast notification component
│   │   │   ├── UpdateBanner.svelte # App version update banner
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
│   │   │   │   └── ScannerViewfinder.svelte
│   │   │   ├── deck/               # Deck builder sub-components
│   │   │   │   ├── DeckHeader.svelte
│   │   │   │   ├── DeckHeroesTab.svelte
│   │   │   │   ├── DeckPlaysTab.svelte
│   │   │   │   ├── DeckSettingsModal.svelte
│   │   │   │   ├── DeckShopTab.svelte
│   │   │   │   └── DeckStatsTab.svelte
│   │   │   └── architect/          # Playbook architect sub-components
│   │   │       ├── ArchetypeSelector.svelte
│   │   │       ├── ComboStatusCard.svelte
│   │   │       ├── DBSBudgetCard.svelte
│   │   │       ├── DrawConsistencyCard.svelte
│   │   │       ├── HDFlowCard.svelte
│   │   │       └── PlayBrowser.svelte
│   │   ├── data/
│   │   │   ├── play-cards.json     # Play card database (409 cards across 4 releases: Alpha, Griffey, Alpha Update, Alpha Blast — with DBS values and hot dog costs)
│   │   │   ├── boba-config.ts      # OCR regions, scan config
│   │   │   ├── boba-weapons.ts     # Weapon hierarchy with rarity and tier rankings
│   │   │   ├── boba-parallels.ts   # All parallel/treatment types with Madness unlock eligibility
│   │   │   ├── boba-dbs-scores.ts  # DBS point values for all Play cards (409 entries, maintained manually)
│   │   │   ├── tournament-formats.ts # Machine-readable rules for all 21 competitive format variants
│   │   │   ├── combo-engines.ts    # Combo detection engines for playbook analysis
│   │   │   ├── pack-defaults.ts    # Default pack configurations for pack simulator
│   │   │   ├── play-categories.ts  # Play card category/tag taxonomy
│   │   │   └── playbook-archetypes.ts # Playbook archetype definitions for AI-assisted deck building
│   │   ├── server/
│   │   │   ├── admin-guard.ts      # Admin authorization guard for API endpoints
│   │   │   ├── anthropic.ts        # Anthropic Claude client singleton
│   │   │   ├── api-response.ts     # Standardized API response helpers
│   │   │   ├── rate-limit.ts       # Upstash Redis rate limiting + in-memory fallback
│   │   │   ├── redis.ts            # Redis client singleton
│   │   │   ├── rpc.ts              # Supabase RPC helper utilities
│   │   │   ├── ebay-auth.ts        # eBay OAuth token management (Browse API)
│   │   │   ├── ebay-seller-auth.ts # eBay Seller OAuth Authorization Code Grant (per-user)
│   │   │   ├── grading-prompts.ts  # Card grading prompt construction for Claude Vision
│   │   │   ├── supabase-admin.ts   # Supabase admin/service-role client
│   │   │   └── validate.ts         # Request validation helpers
│   │   ├── services/
│   │   │   ├── recognition.ts      # Three-tier recognition pipeline (core logic)
│   │   │   ├── card-db.ts          # Card database: load, index, search, fuzzy match
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
│   │   │   ├── authenticity-check.ts # Card authenticity verification via OpenCV + SSIM
│   │   │   ├── card-condition-compare.ts # Side-by-side card condition comparison
│   │   │   ├── card-cropper.ts     # Card region cropping for analysis
│   │   │   ├── opencv-loader.ts    # OpenCV.js lazy loader
│   │   │   ├── pack-simulator.ts   # Deterministic pack opening simulation
│   │   │   ├── badges.ts           # Client-side badge award helper with toast notifications
│   │   │   ├── community-corrections.ts # Community-verified OCR correction mappings
│   │   │   ├── reference-images.ts # Reference image handling and leaderboard
│   │   │   ├── ebay.ts             # eBay client-side price fetching
│   │   │   ├── listing-generator.ts# eBay listing template generation (titles, descriptions)
│   │   │   ├── parallel-config.ts  # Parallel/treatment configuration
│   │   │   ├── scan-learning.ts    # Correction tracking for scan improvement
│   │   │   ├── share-card.ts       # Card sharing (social, QR codes)
│   │   │   ├── export-templates.ts # Export format definitions
│   │   │   ├── error-tracking.ts   # Client error reporting
│   │   │   └── version.ts          # Version checking
│   │   ├── stores/                 # All stores use .svelte.ts extension (Svelte 5 runes)
│   │   │   ├── collection.svelte.ts    # Collection state store
│   │   │   ├── scanner.svelte.ts       # Scanner state store
│   │   │   ├── scan-history.svelte.ts  # Scan history store
│   │   │   ├── prices.svelte.ts        # Price data store
│   │   │   ├── auth.svelte.ts          # Auth state store
│   │   │   ├── tags.svelte.ts          # User tags store
│   │   │   ├── toast.svelte.ts         # Toast notification store
│   │   │   ├── speed-game.svelte.ts    # Speed game challenge state
│   │   │   ├── feature-flags.svelte.ts # Feature flag store
│   │   │   ├── pro.svelte.ts           # Pro subscription state store
│   │   │   └── playbook-architect.svelte.ts # Playbook architect state store
│   │   ├── types/
│   │   │   ├── index.ts            # App types (Card, ScanResult, PriceData, etc.)
│   │   │   ├── database.ts         # Supabase database types
│   │   │   └── pack-simulator.ts   # Pack simulator types
│   │   ├── utils/
│   │   │   ├── index.ts            # Shared utilities (escapeHtml, formatPrice, debounce)
│   │   │   ├── extract-card-number.ts # OCR card number extraction logic
│   │   │   ├── fuzzy-match.ts      # Fuzzy string matching (Levenshtein distance)
│   │   │   ├── haptics.ts          # Vibration/haptics patterns for mobile
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
│   ├── auth-guard.e2e.test.ts          # E2E: auth guard routes
│   └── recognition-pipeline.e2e.test.ts # E2E: full recognition pipeline
├── src/service-worker.ts            # SvelteKit service worker (differentiated caching)
├── static/
│   ├── manifest.json               # PWA manifest
│   ├── version.json                # App version metadata
│   └── robots.txt                  # Disallow all crawlers
├── supabase/migrations/
│   ├── 001-full-schema.sql         # Canonical schema (all tables, indexes, RLS)
│   ├── 002-enable-rls.sql          # RLS policy definitions
│   ├── 003-check-constraints.sql   # Check constraints
│   ├── 004-go-pro.sql              # Pro subscription tables
│   ├── 005-tournament-deck-submissions.sql # Tournament deck submission tables
│   ├── 20260324000000_add_deck_snapshots.sql # Deck snapshot support
│   ├── 20260324000000_add_pack_configurations.sql # Pack config tables
│   ├── 20260327000000_admin_dashboard_tables.sql # Admin tables: scan_flags, changelog_entries, admin_activity_log, ebay_api_log
│   └── README.md                   # Migration documentation
├── scripts/
│   └── generate-card-seed.js       # Generate SQL seed from card-database.json
├── middleware.ts                    # Vercel Edge Middleware: bot/scraper/AI-crawler blocking
├── svelte.config.js                # SvelteKit config (Vercel adapter, path aliases)
├── vite.config.ts                  # Vite config (sourcemaps, ES2020, Web Workers as ES modules)
├── tsconfig.json                   # TypeScript config (strict, bundler resolution, excludes tests/)
├── vercel.json                     # Vercel headers (CSP, security, caching)
└── .github/workflows/ci.yml        # CI: type check → test → build → bundle size check
```

## Architecture

### Three-Tier Recognition Pipeline

The core scanning feature uses a waterfall approach to minimize API costs:

1. **Tier 1 — Hash Cache (Free, instant)**: Computes a perceptual hash (dHash) of the card image using a Web Worker, then checks IndexedDB and Supabase `hash_cache` for a match. Previously scanned cards are recognized in <50ms.
1. **Tier 2 — OCR + Fuzzy Match (Free, ~1-3s)**: Tesseract.js extracts text from configurable card regions (defined in `boba-config.ts`). The extracted card number is fuzzy-matched against the local card database using Levenshtein distance. OCR extraction logic lives in `utils/extract-card-number.ts`, fuzzy matching in `utils/fuzzy-match.ts`.
1. **Tier 3 — Claude AI (~$0.002/scan)**: If Tiers 1-2 fail, the card image is sent to `POST /api/scan` where it’s sanitized via sharp (EXIF stripping, pixel bomb protection, re-encoding) and sent to Claude Haiku for identification.

### Card Database Loading

The card database has a layered loading strategy (see `card-db.ts`):

1. IndexedDB cache (may have fresher Supabase data from a previous session)
1. Paginated Supabase fetch (first-time load or corrupt IDB), then background refresh

### Authentication

- Google OAuth via Supabase Auth
- eBay Seller OAuth via Authorization Code Grant (per-user, managed by `ebay-seller-auth.ts`)
- Server-side auth via `hooks.server.ts` using `getUser()` (JWT validation, not just session cookies)
- Protected routes (via `authGuard` in `hooks.server.ts`): `/collection`, `/sell`, `/admin`, `/grader`, `/export`, `/marketplace`, `/set-completion`, `/tournaments`, `/settings`, `/organize`
- Public routes (no auth required): `/scan`, `/batch`, `/binder` (anonymous users get stricter rate limits on Tier 3), `/speed`, `/packs`, `/leaderboard`, `/privacy`, `/terms`
- API routes handle their own auth checks

### Data Flow

- **Client state**: Svelte stores (`src/lib/stores/`) backed by IndexedDB for offline persistence
- **Server state**: Supabase PostgreSQL (collections synced via `sync.ts`)
- **Offline support**: SvelteKit service worker (`src/service-worker.ts`) caches app shell, card database served stale-while-revalidate, API calls always go to network

## Testing

The test suite (12 files) uses Vitest with three tiers:

- **Unit tests**: `card-db.test.ts`, `ocr-extract.test.ts`, `rate-limit.test.ts`, `deck-validator.test.ts`, `pricing.test.ts`, `fuzzy-match.test.ts`, `playbook-engine.test.ts`
- **Integration tests**: `api-price`, `api-scan`, `api-grade` — test API routes with mocked dependencies
- **E2E tests**: `auth-guard.e2e.test.ts`, `recognition-pipeline.e2e.test.ts`

Testing patterns:

- Mocking via `vi.mock()`, `vi.hoisted()`, `vi.fn()`
- External dependencies mocked: sharp, Anthropic SDK, Supabase, Redis, IndexedDB
- Tests live in `/tests/` directory (excluded from `tsconfig.json`)
- Run with `npm test` (single run) or `npm run test:watch` (watch mode)

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
- **Granny’s Gum**: Grandma’s/Great Grandma’s Linoleum + Bubblegum only
- **Power Glove**: Power Glove inserts only, Set Builder mode

### Important Terminology

- **Coach** = player (BoBA uses “Coach” officially, never “player”)
- **Registered Play Pool** = up to 45 standard plays + unlimited bonus plays registered before an event; Coaches swap between matches but deck is locked within a match. This is NOT a traditional sideboard.
- **ELP** (Event Legal Proxy) = rental proxy for graded cards ($1,500+), completely separate from deck construction.

### Card Parallels/Treatments

Parallel types are defined in `src/lib/data/boba-parallels.ts`. Key types include Battlefoils (Silver, Blue, Orange, etc.), named inserts (Blizzard, 80s Rad, Headlines, etc.), and Inspired Ink (autographs). In Apex Madness, having 10+ of a single insert type in the Core Deck unlocks 1 Apex card (165+ Power) of that type.

### Data Files

- `src/lib/data/boba-weapons.ts` — Weapon hierarchy with rarity and tier rankings
- `src/lib/data/boba-parallels.ts` — All parallel/treatment types with Madness unlock eligibility
- `src/lib/data/tournament-formats.ts` — Machine-readable rules for all 21 competitive format variants
- `src/lib/data/boba-dbs-scores.ts` — DBS point values for Play cards (409 entries across Alpha, Griffey, Alpha Update, and Alpha Blast releases)
- `src/lib/data/play-cards.json` — Play card database (409 cards across 4 releases, with DBS values and hot dog costs; ability text fields exist but are not yet populated)
- `src/lib/data/boba-config.ts` — OCR regions, scan config
- `src/lib/data/combo-engines.ts` — Combo detection logic for playbook analysis
- `src/lib/data/pack-defaults.ts` — Default pack configurations for simulator
- `src/lib/data/play-categories.ts` — Play card category taxonomy
- `src/lib/data/playbook-archetypes.ts` — Playbook archetype definitions

## Key Conventions

### Code Style

- **Svelte 5 runes**: Use `$state()`, `$derived()`, `$props()`, `$effect()` — not legacy `let`/`$:` reactive syntax
- **TypeScript strict mode**: All new code must be type-safe
- **Path aliases**: Use `$lib/`, `$components/`, `$services/`, `$stores/`, `$workers/`, `$types/`, `$server/` (defined in `svelte.config.js`)
- **Server-only code**: Files in `src/lib/server/` — never import these from client code
- **Web Workers**: `src/lib/workers/` contains TypeScript workers bundled as ES modules (`worker: { format: 'es' }` in vite.config.ts)
- **Store files**: Use `.svelte.ts` extension for all stores (Svelte 5 runes-based stores)

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
- Bot/scraper protection via Vercel Edge Middleware (`middleware.ts`) — blocks bots, missing User-Agent, suspicious headers, and AI training crawlers (GPTBot, ClaudeBot, etc.)
- CSP headers configured in `vercel.json`
- RLS enabled on all tables via Supabase Auth — policies in migrations `001-full-schema.sql` and `002-enable-rls.sql`
- Rate limiting on all mutation endpoints

### Database

- Schema defined across numbered migrations in `supabase/migrations/` (canonical schema in `001-full-schema.sql`)
- Key tables: `users`, `collections` (JSONB), `cards`, `tournaments`, `feature_flags`, `api_call_logs`, `price_cache`, `scan_flags`, `changelog_entries`, `admin_activity_log`, `ebay_api_log`
- RLS is enabled on all tables. The anon key has read-only access to public data (cards, prices, feature flags, tournaments). User-scoped data (collections, decks, badges) is restricted to the owning user via auth.uid(). Server-only tables (ebay_seller_tokens, error_logs) have no client-accessible policies — they are accessed exclusively via the service role key.
- Card seed data generated via `scripts/generate-card-seed.js` (requires a local `card-database.json` file, not checked into the repo)

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

## Common Tasks

### Adding a new API route

1. Create `src/routes/api/<n>/+server.ts`
1. Add auth check via `locals.safeGetSession()`
1. Add rate limiting if it’s a mutation/expensive operation
1. Return responses with `json()` from `@sveltejs/kit`

### Adding a new page route

1. Create `src/routes/<n>/+page.svelte`
1. If protected, ensure path is listed in `authGuard` in `hooks.server.ts`
1. Add navigation link in `+layout.svelte` (bottom nav or “More” menu)

### Adding a new component

1. Create in `src/lib/components/`
1. Use Svelte 5 runes (`$props()`, `$state()`, etc.)
1. Import via `$components/ComponentName.svelte`

### Modifying the card database

1. Add/update cards directly in Supabase (the `cards` table)
1. Optionally, update a local `card-database.json` and run `npm run generate:card-seed` to regenerate the SQL seed

### Working with the recognition pipeline

- Configuration in `src/lib/data/boba-config.ts` (OCR regions, thresholds)
- Core pipeline logic in `src/lib/services/recognition.ts`
- Card matching in `src/lib/services/card-db.ts`
- OCR extraction in `src/lib/utils/extract-card-number.ts`
- Fuzzy matching in `src/lib/utils/fuzzy-match.ts`
- Image worker in `src/lib/workers/image-processor.ts`

### Adding tests

1. Create test file in `tests/` directory
1. Name convention: `<module>.test.ts` (unit), `<module>.integration.test.ts` (integration), `<module>.e2e.test.ts` (E2E)
1. Mock external dependencies (sharp, Anthropic, Supabase, Redis) using `vi.mock()`
1. Run with `npm test` or `npm run test:watch`