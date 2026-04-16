# Card Scanner — Claude Code Context

> Read this every session. These are locked project constraints.

## Architecture

- **Multi-game card scanner** supporting BoBA (`boba.cards`), Wonders of The First, and a future Game 3.
- **Game-specific code** lives in `src/lib/games/{gameId}/` — each game implements the `GameConfig` interface defined in `src/lib/games/types.ts`.
- **Path-based routing, NOT subdomains.** Game context comes from URL path prefix (`/boba/...`, `/wonders/...`) or user preference. Never from hostname.
- **Single Supabase project** with `game_id` column scoping on game-aware tables: `cards`, `collections`, `scans`, `hash_cache`, `price_cache`, `price_history`, `listing_templates`, `price_harvest_log`.
- **Default `game_id = 'boba'`** for all existing data and all new code paths that don't explicitly specify a game.

## Locked Decisions (Do Not Revisit)

1. Unified single-domain app with path-based routing. Subdomains are a Phase 3+ consideration.
2. Auto-detect scanning with manual game picker fallback.
3. Game as filter, not silo — collections and sell views show all games by default.
4. Single Supabase project with `game_id` column scoping.
5. `GameConfig` interface — all game-specific behavior behind one contract.
6. Keep BoBA's existing columns (`hero_name`, `weapon_type`, `battle_zone`, `athlete_name`) as first-class columns. Use `metadata` JSONB only for Wonders-specific fields.
7. Zero regression — every existing BoBA feature must work identically after migration.

## Critical Constraints

- **NEVER** break existing BoBA functionality. Every change must default to `'boba'`.
- **NEVER** create subdomains or hostname-based routing in `hooks.server.ts`.
- **NEVER** move BoBA columns (`hero_name`, `weapon_type`, etc.) into `metadata` JSONB.
- **ALWAYS** use backward-compatible re-exports when moving code so existing imports don't break.
- **ALWAYS** `await` async operations in server endpoints. No fire-and-forget on Vercel.
- **Play cards have TEXT IDs** (e.g., `A---PL-1`), NOT UUID — do not attempt UUID joins for play cards.

## Key File Locations

- GameConfig interface: `src/lib/games/types.ts`
- Game resolver: `src/lib/games/resolver.ts`
- BoBA module: `src/lib/games/boba/{config,extract,prompt,theme,nav}.ts`
- Recognition pipeline: `src/lib/services/recognition.ts`, `recognition-tiers.ts`
- Card DB service: `src/lib/services/card-db.ts`
- Collection service: `src/lib/services/collection-service.ts`
- Scan API: `src/routes/api/scan/+server.ts`
- Auth/middleware: `src/hooks.server.ts`

## Path Aliases (svelte.config.js)

```
$lib        → src/lib
$components → src/lib/components
$services   → src/lib/services
$stores     → src/lib/stores
$workers    → src/lib/workers
$types      → src/lib/types
$server     → src/lib/server
$games      → src/lib/games
```

## Tech Stack

- SvelteKit 2 + Svelte 5 (runes mode)
- TypeScript strict mode
- Supabase (PostgreSQL + Auth + Realtime)
- Anthropic Claude API (Haiku for scanning, Sonnet for grading)
- Tesseract.js for OCR (client-side Web Worker)
- Upstash Redis for rate limiting (in-memory fallback)
- Vercel adapter (Node.js 22.x runtime)

## Project Documentation

See `CLAUDE.md` at the project root for the canonical source of truth — architecture, database schema, conventions, and reference material. Never create separate documentation files (root `README.md` and `.env.example` are the only exceptions).
