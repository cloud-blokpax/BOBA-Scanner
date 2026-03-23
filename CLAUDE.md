# CLAUDE.md — BOBA Scanner

## Project Overview

BOBA Scanner is an AI-powered trading card scanner for **Bo Jackson Battle Arena (BoBA)** collectible cards. It uses a three-tier recognition pipeline (hash cache, OCR, Claude AI) to identify cards from photos, with most scans completing for free via client-side processing. The app is a mobile-first PWA built with SvelteKit and deployed on Vercel.

## Tech Stack

- **Framework**: SvelteKit 2 (`@sveltejs/kit ^2.54.0`) with Svelte 5 (`^5.53.10`, runes mode: `$state`, `$derived`, `$props`)
- **Language**: TypeScript ^5.9.3 (strict mode)
- **Deployment**: Vercel (adapter-vercel, Node.js 22.x runtime)
- **Database**: Supabase (PostgreSQL + auth + realtime) — `@supabase/supabase-js ^2.99.1`, `@supabase/ssr ^0.9.0`
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk ^0.78.0`) — Haiku for scanning, Sonnet for grading
- **OCR**: Tesseract.js 7 (client-side, runs in Web Worker)
- **Image Processing**: sharp ^0.34.5 (server-side CDR), Web Workers with Comlink ^4.4.2 (client-side)
- **Virtualization**: `@tanstack/svelte-virtual ^3.13.22` for long lists
- **Rate Limiting**: Upstash Redis (`@upstash/redis ^1.36.4`, `@upstash/ratelimit ^2.0.8`) with in-memory fallback
- **Pricing**: eBay Browse API + Seller API integration
- **Caching**: IndexedDB (client), Supabase price_cache (server), Vercel edge (CDN)
- **PWA**: Service Worker with differentiated caching strategies
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
│   │   │   ├── new/+page.svelte    # Create new deck
│   │   │   ├── [id]/+page.svelte   # Edit deck by ID
│   │   │   ├── [id]/view/+page.svelte # View deck (read-only)
│   │   │   └── shop/+page.svelte   # Deck shop (find missing cards)
│   │   ├── decks/+page.svelte      # Decks overview page
│   │   ├── dbs/                    # DBS (Deck Balancing Score) calculator
│   │   │   ├── +page.svelte        # DBS calculator UI
│   │   │   └── +page.server.ts     # Serves DBS scores map
│   │   ├── grader/+page.svelte     # AI card condition grading
│   │   ├── export/+page.svelte     # Collection export (CSV, etc.)
│   │   ├── settings/+page.svelte   # User settings page
│   │   ├── set-completion/         # Set completion tracker
│   │   ├── speed/+page.svelte      # Speed game challenge
│   │   ├── leaderboard/+page.svelte # Reference image leaderboard
│   │   ├── tournaments/            # Tournament management
│   │   │   ├── +page.svelte        # Tournament list
│   │   │   ├── detail/+page.svelte # Tournament detail view
│   │   │   ├── enter/+page.svelte  # Tournament entry form
│   │   │   └── timer/+page.svelte  # Tournament timer
│   │   ├── marketplace/monitor/    # eBay seller monitoring
│   │   ├── admin/+page.svelte      # Admin dashboard
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
│   │       ├── price/[cardId]/
│   │       │   ├── +server.ts      # GET: eBay price lookup with caching
│   │       │   └── history/+server.ts # GET: Price history
│   │       ├── upload/+server.ts   # POST: Image upload
│   │       ├── log/+server.ts      # POST: Client-side error logging
│   │       ├── deck/
│   │       │   ├── validate/+server.ts    # POST: Deck validation
│   │       │   └── refresh-prices/+server.ts # POST: Deck price refresh
│   │       ├── reference-image/
│   │       │   ├── +server.ts             # POST: Reference image upload/submission
│   │       │   └── leaderboard/+server.ts # GET: Reference image leaderboard
│   │       ├── tournament/
│   │       │   ├── [code]/+server.ts    # GET: Tournament info by code
│   │       │   └── register/+server.ts  # POST: Register for tournament
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
│   │   │   ├── ScanConfirmation.svelte # Scan result confirmation UI
│   │   │   ├── ScanEffects.svelte  # Visual effects for scanning
│   │   │   ├── ScannerErrorBoundary.svelte # Error boundary for scanner components
│   │   │   ├── CardDetail.svelte   # Card detail view
│   │   │   ├── CardGrid.svelte     # Grid display for card collections
│   │   │   ├── CardCorrection.svelte # Manual correction UI
│   │   │   ├── CardFlipReveal.svelte # Card flip/reveal animation
│   │   │   ├── OptimizedCardImage.svelte # Optimized image display with lazy loading
│   │   │   ├── PriceDisplay.svelte # Price information display
│   │   │   ├── PriceTrends.svelte  # Price trend charts (premium)
│   │   │   ├── ProfilePrompt.svelte# User profile setup prompt
│   │   │   ├── Toast.svelte        # Toast notification component
│   │   │   ├── InstallPrompt.svelte# PWA install prompt
│   │   │   └── UpdateBanner.svelte # App version update banner
│   │   ├── data/
│   │   │   ├── card-database.json  # Bundled card DB (~17,600+ cards)
│   │   │   ├── play-cards.json     # Play card database (409 cards across 4 releases, with DBS values and hot dog costs)
│   │   │   ├── static-cards.ts     # Maps raw JSON to Card type
│   │   │   ├── boba-config.ts      # OCR regions, scan config, rarities, weapons
│   │   │   ├── boba-heroes.ts      # Hero name → athlete name mappings
│   │   │   ├── boba-weapons.ts     # Weapon hierarchy with rarity and tier rankings
│   │   │   ├── boba-parallels.ts   # All parallel/treatment types with Madness unlock eligibility
│   │   │   ├── boba-dbs-scores.ts  # DBS point values for all Play cards (409 entries, maintained manually)
│   │   │   └── tournament-formats.ts # Machine-readable rules for all 6 competitive formats
│   │   ├── server/
│   │   │   ├── admin-guard.ts      # Admin authorization guard for API endpoints
│   │   │   ├── rate-limit.ts       # Upstash Redis rate limiting + in-memory fallback
│   │   │   ├── redis.ts            # Redis client singleton
│   │   │   ├── ebay-auth.ts        # eBay OAuth token management (Browse API)
│   │   │   ├── ebay-seller-auth.ts # eBay Seller OAuth Authorization Code Grant (per-user)
│   │   │   └── grading-prompts.ts  # Card grading prompt construction for Claude Vision
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
│   │   │   ├── badges.ts           # Client-side badge award helper with toast notifications
│   │   │   ├── community-corrections.ts # Community-verified OCR correction mappings
│   │   │   ├── reference-images.ts # Reference image handling and leaderboard
│   │   │   ├── ebay.ts             # eBay client-side price fetching
│   │   │   ├── listing-generator.ts# eBay listing template generation (titles, descriptions)
│   │   │   ├── parallel-config.ts  # Parallel/treatment configuration
│   │   │   ├── scan-learning.ts    # Correction tracking for scan improvement
│   │   │   ├── export-templates.ts # Export format definitions
│   │   │   ├── error-tracking.ts   # Client error reporting
│   │   │   └── version.ts          # Version checking
│   │   ├── stores/
│   │   │   ├── collection.ts       # Collection state store
│   │   │   ├── scanner.ts          # Scanner state store
│   │   │   ├── scan-history.ts     # Scan history store
│   │   │   ├── prices.ts           # Price data store
│   │   │   ├── auth.ts             # Auth state store
│   │   │   ├── tags.ts             # User tags store
│   │   │   ├── theme.ts            # Theme preference store
│   │   │   ├── toast.ts            # Toast notification store
│   │   │   ├── speed-game.ts       # Speed game challenge state
│   │   │   └── feature-flags.ts    # Feature flag store
│   │   ├── types/
│   │   │   ├── index.ts            # App types (Card, ScanResult, PriceData, etc.)
│   │   │   └── database.ts         # Supabase database types
│   │   ├── utils/
│   │   │   ├── index.ts            # Shared utilities (escapeHtml, formatPrice, debounce)
│   │   │   ├── extract-card-number.ts # OCR card number extraction logic
│   │   │   ├── haptics.ts          # Vibration/haptics patterns for mobile
│   │   │   ├── image-url.ts        # Image URL generation and caching
│   │   │   └── pricing.ts          # Price calculation and formatting
│   │   └── workers/
│   │       └── image-processor.ts  # Web Worker: dHash, resize, blur detection, OCR preprocess
├── tests/
│   ├── card-db.test.ts             # Unit: card database operations
│   ├── ocr-extract.test.ts         # Unit: OCR card number extraction
│   ├── rate-limit.test.ts          # Unit: rate limiting logic
│   ├── deck-validator.test.ts      # Unit: deck building rules validation
│   ├── pricing.test.ts             # Unit: price calculation and formatting
│   ├── api-price.integration.test.ts   # Integration: price API
│   ├── api-scan.integration.test.ts    # Integration: scan API
│   ├── api-grade.integration.test.ts   # Integration: grade API
│   ├── auth-guard.e2e.test.ts          # E2E: auth guard routes
│   └── recognition-pipeline.e2e.test.ts # E2E: full recognition pipeline
├── src/service-worker.ts            # SvelteKit service worker (differentiated caching)
├── static/
│   ├── manifest.json               # PWA manifest
│   ├── sw.js                       # Legacy service worker (self-destructs, replaced by src/service-worker.ts)
│   ├── version.json                # App version metadata
│   └── robots.txt                  # Disallow all crawlers
├── supabase/migrations/
│   ├── supabase-full-setup.sql     # Canonical schema (all tables, indexes, RLS)
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

2. **Tier 2 — OCR + Fuzzy Match (Free, ~1-3s)**: Tesseract.js extracts text from configurable card regions (defined in `boba-config.ts`). The extracted card number is fuzzy-matched against the local card database using Levenshtein distance. OCR extraction logic lives in `utils/extract-card-number.ts`.

3. **Tier 3 — Claude AI (~$0.002/scan)**: If Tiers 1-2 fail, the card image is sent to `POST /api/scan` where it's sanitized via sharp (EXIF stripping, pixel bomb protection, re-encoding) and sent to Claude Haiku for identification.

### Card Database Loading

The card database has a layered loading strategy (see `card-db.ts`):
1. IndexedDB cache (may have fresher Supabase data from a previous session)
2. Static bundled JSON (always available, even offline)
3. Background Supabase refresh (non-blocking, picks up newly added cards)

### Authentication

- Google OAuth via Supabase Auth
- eBay Seller OAuth via Authorization Code Grant (per-user, managed by `ebay-seller-auth.ts`)
- Server-side auth via `hooks.server.ts` using `getUser()` (JWT validation, not just session cookies)
- Protected routes: `/collection`, `/deck`, `/decks`, `/admin`, `/grader`, `/export`, `/marketplace`, `/set-completion`, `/tournaments`, `/settings`
- Public routes (no auth required): `/scan`, `/batch`, `/binder` (anonymous users get stricter rate limits on Tier 3), `/dbs` (public calculator), `/speed`, `/leaderboard`, `/privacy`, `/terms`
- API routes handle their own auth checks

### Data Flow

- **Client state**: Svelte stores (`src/lib/stores/`) backed by IndexedDB for offline persistence
- **Server state**: Supabase PostgreSQL (collections synced via `sync.ts`)
- **Offline support**: SvelteKit service worker (`src/service-worker.ts`) caches app shell, card database served stale-while-revalidate, API calls always go to network

## Testing

The test suite (10 files) uses Vitest with three tiers:

- **Unit tests**: `card-db.test.ts`, `ocr-extract.test.ts`, `rate-limit.test.ts`, `deck-validator.test.ts`, `pricing.test.ts`
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
- **DBS (Deck Balancing Score)**: Point budget for the Playbook. Each Play has a DBS value. Total must not exceed 1,000. DBS values are maintained in `boba-dbs-scores.ts` (used by the deck validator) and `play-cards.json` (used by the DBS calculator page for card metadata alongside DBS values).

### Weapon Types (rarity order, most rare first)
Super (1/1) → Gum (secret) → Hex (/10) → Glow (/25) → Fire (/50) → Ice (/50) → Steel (common) → Brawl (common, 2026+)

### Deck Building Rules (apply to ALL formats)
- Max 6 Hero cards at the same Power level
- Max 1 copy of each unique variation (hero + weapon + parallel combination)
- All 30 Plays must be unique
- No limit on copies of the same hero character across different variations

Deck validation logic is implemented in `src/lib/services/deck-validator.ts`.

### Tournament Formats
Format rules are defined in `src/lib/data/tournament-formats.ts`. Key formats:
- **Apex Playmaker**: No power cap, premier solo format
- **SPEC Playmaker**: Individual cards capped at 160 Power (standard competitive)
- **Elite Playmaker**: Total deck power capped at 8,250 CP
- **Apex Madness**: Team Rookie Mode, Core Deck at SPEC 160, expanded via insert unlocks

### Card Parallels/Treatments
Parallel types are defined in `src/lib/data/boba-parallels.ts`. Key types include Battlefoils (Silver, Blue, Orange, etc.), named inserts (Blizzard, 80s Rad, Headlines, etc.), and Inspired Ink (autographs). In Apex Madness, having 10+ of a single insert type in the Core Deck unlocks 1 Apex card (165+ Power) of that type.

### Data Files
- `src/lib/data/boba-weapons.ts` — Weapon hierarchy with rarity and tier rankings
- `src/lib/data/boba-parallels.ts` — All parallel/treatment types with Madness unlock eligibility
- `src/lib/data/tournament-formats.ts` — Machine-readable rules for all 6 competitive formats
- `src/lib/data/boba-dbs-scores.ts` — DBS point values for Play cards (409 entries across Alpha, Griffey, Alpha Update, and Alpha Blast releases)
- `src/lib/data/play-cards.json` — Play card database (409 cards across 4 releases, with DBS values and hot dog costs; ability text fields exist but are not yet populated)
- `src/lib/data/boba-heroes.ts` — Hero name → athlete name mappings
- `src/lib/data/boba-config.ts` — OCR regions, scan config, field definitions

## Key Conventions

### Code Style

- **Svelte 5 runes**: Use `$state()`, `$derived()`, `$props()`, `$effect()` — not legacy `let`/`$:` reactive syntax
- **TypeScript strict mode**: All new code must be type-safe
- **Path aliases**: Use `$lib/`, `$components/`, `$services/`, `$stores/`, `$workers/`, `$types/` (defined in `svelte.config.js`)
- **Server-only code**: Files in `src/lib/server/` — never import these from client code
- **Web Workers**: `src/lib/workers/` contains TypeScript workers bundled as ES modules (`worker: { format: 'es' }` in vite.config.ts)

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
- RLS enabled on all tables via Supabase Auth — policies in `enable-rls-legacy-tables.sql` and `supabase-full-setup.sql`
- Rate limiting on all mutation endpoints

### Database

- All tables defined in `supabase/migrations/supabase-full-setup.sql` (canonical schema)
- Key tables: `users`, `collections` (JSONB), `cards`, `tournaments`, `feature_flags`, `api_call_logs`, `price_cache`
- RLS is disabled; access control is application-level via the anon key + server-side auth checks
- Card seed data generated via `scripts/generate-card-seed.js` from `src/lib/data/card-database.json`

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
2. `npm run check` — TypeScript + Svelte type checking
3. `npm test` — Run vitest test suite
4. `npm run build` — Production build
5. Bundle size check — Two-tier limits:
   - **App JS** (excluding card database): must be under 600KB
   - **Total JS** (including ~2.7MB card database): must be under 4MB

## Common Tasks

### Adding a new API route
1. Create `src/routes/api/<name>/+server.ts`
2. Add auth check via `locals.safeGetSession()`
3. Add rate limiting if it's a mutation/expensive operation
4. Return responses with `json()` from `@sveltejs/kit`

### Adding a new page route
1. Create `src/routes/<name>/+page.svelte`
2. If protected, ensure path is listed in `authGuard` in `hooks.server.ts`
3. Add navigation link in `+layout.svelte` (bottom nav or "More" menu)

### Adding a new component
1. Create in `src/lib/components/`
2. Use Svelte 5 runes (`$props()`, `$state()`, etc.)
3. Import via `$components/ComponentName.svelte`

### Modifying the card database
1. Update `src/lib/data/card-database.json`
2. Run `npm run generate:card-seed` to regenerate the SQL seed migration
3. Update Supabase if needed via the SQL editor

### Working with the recognition pipeline
- Configuration in `src/lib/data/boba-config.ts` (OCR regions, thresholds)
- Core pipeline logic in `src/lib/services/recognition.ts`
- Card matching in `src/lib/services/card-db.ts`
- OCR extraction in `src/lib/utils/extract-card-number.ts`
- Image worker in `src/lib/workers/image-processor.ts`

### Adding tests
1. Create test file in `tests/` directory
2. Name convention: `<module>.test.ts` (unit), `<module>.integration.test.ts` (integration), `<module>.e2e.test.ts` (E2E)
3. Mock external dependencies (sharp, Anthropic, Supabase, Redis) using `vi.mock()`
4. Run with `npm test` or `npm run test:watch`
