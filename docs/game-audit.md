# Multi-Game Architecture Audit — Phase 4.1

Exhaustive sweep of remaining single-game assumptions in the codebase as of
Phase 4.1. Every finding is categorized as **ACCEPT**, **REFACTOR**, or **FIX**:

- **ACCEPT** — legitimately game-specific logic. BoBA-specific code that
  runs only on BoBA cards is fine; the architecture explicitly delegates
  game-specific details to game modules. Do not refactor unless a concrete
  new game needs different behavior.
- **REFACTOR** — the logic is game-agnostic but has a hardcoded switch that
  should route through the game registry instead. Safe to generalize at
  leisure; no blocker.
- **FIX** — a single-game assumption that breaks when a new game is added.
  Must be addressed before Game 3 ships.

Findings are grouped by area. File paths and either line numbers or function
names are included so each item can be tracked through fix PRs.

---

## Recognition pipeline (game-agnostic core)

### ACCEPT — `src/lib/services/recognition-tiers.ts` — BoBA fallbacks

- `import { extractCardNumber } from '$lib/utils/extract-card-number'` — this
  is now a re-export from `$lib/games/boba/extract` (Phase 1). Kept as the
  fallback for edge cases where `resolveGameConfig` fails. Acceptable because
  it's a defensive fallback, not a hardcoded branch.
- `import { BOBA_OCR_REGIONS, BOBA_SCAN_CONFIG } from '$lib/data/boba-config'` —
  used as fallbacks when the resolver can't load any game config. Acceptable.

### ACCEPT — `src/lib/services/recognition.ts` — `'boba'` default game id

- `gameHint = isAutoDetect ? '' : (gameHintRaw as string)` — defaults to empty
  string for auto-detect, `'boba'` only when fallback logic kicks in. The
  `'boba'` default is explicit in the ScanResult finalize step and in the
  hash cache writeback. This is **ACCEPT** because it reflects the real
  data (every existing hash_cache row has `game_id = 'boba'`).

### REFACTOR — auto-detect fall-through order

- `recognition-tiers.ts runTier2`: when `gameHint` is empty, the code loops
  over `getAllGameConfigs()` for OCR regions and extractors. Order is
  currently BoBA → Wonders by registration order in `all-games.ts`. The
  order is load-bearing (BoBA extractor runs first because BoBA is more
  common) but it is implicit. If Game 3 is added, it will be tried last.
  **Recommendation:** document the ordering rule in `all-games.ts` so
  future editors understand that `ALL_GAMES[0]` is tried first.

---

## Card database

### ACCEPT — `src/lib/services/card-db.ts` — play card merging

- `loadPlayCards()` is BoBA-specific (play_cards table has no FK to `cards`
  and uses TEXT IDs). The merge is gated on `_activeGameIds.includes('boba')`.
  Correct: play cards are a BoBA concept and shouldn't be merged for other
  games.

### REFACTOR — `findCard` signature

- `findCard(cardNumber, heroName, gameId)` — the `heroName` parameter is a
  BoBA artifact (Wonders doesn't have hero names in the BoBA sense — the
  `card_name` is the closest equivalent and the scan endpoint normalizes
  aliases before validation). Consider renaming to `nameHint` for generality.
  Not urgent.

---

## Claude scan prompts

### ACCEPT — BoBA system prompt (`src/lib/games/boba/prompt.ts`)

- Deep BoBA-specific knowledge (weapon types, parallel names, card layout
  positions). Correctly lives in the game module.

### ACCEPT — Wonders system prompt (`src/lib/games/wonders/prompt.ts`)

- Variant decision tree, 1st edition stamp handling, Wonders-specific
  layout notes. Correctly lives in the game module.

### REFACTOR — multi-game prompt hardcodes game names

- `src/lib/games/multi-game-prompt.ts` enumerates "BoBA" and "Wonders" in
  the system prompt. Adding Game 3 requires editing this file. Consider
  generating the multi-game prompt dynamically from `getAllGameConfigs()`
  so new games auto-appear. **Deferred** because prompt tuning typically
  needs hand-written context that a generator can't produce. Plan: when
  Game 3 is added, hand-edit multi-game-prompt to include it AND add an
  architecture test to catch regressions.

---

## Scan endpoint (`src/routes/api/scan/+server.ts`)

### ACCEPT — BoBA power-as-card-number guard

- `if (detectedGameId === 'boba') { /* guard against Claude copying power into card_number */ }` —
  BoBA-specific quirk. Wonders is exempt because Existence cards legitimately
  have numeric collector numbers that can collide with power values.

### REFACTOR — BoBA variant flattening

- `if (detectedGameId === 'boba') { cardData.variant = 'paper'; }` — preserves
  BoBA's existing semantics (variant is baked into card_number, parallel name
  goes into `cardData.parallel`). When Game 3 is added, it inherits the
  default behavior (its `cardData.variant` passes through unchanged). No fix
  needed unless Game 3 has BoBA-style variant-in-card-number semantics.

---

## eBay integration

### REFACTOR — `src/lib/utils/ebay-title.ts`

- `buildEbayListingTitle` dispatches on `game_id`: `'wonders'` → `buildWondersListingTitle`,
  else → `buildBobaListingTitle`. Adding Game 3 requires adding another
  `else if` branch. **Recommendation:** refactor to a registry:
  `Map<string, (card: EbayCardInfo) => string>` so games can register their
  own builders. Not urgent — the current two-game dispatch is readable.

### REFACTOR — `src/lib/server/ebay-query.ts` + `ebay-query-wonders.ts`

- Same pattern as title builders. Each game has its own search-query
  function. The harvester (`refreshCardPrice`) dispatches via
  `if (isWonders) { ... } else { ... }`. Same refactor recommendation as above.

### FIX — `src/lib/services/whatnot-export.ts`

- `CONDITION_MAP` comment says "Maps BOBA Scanner conditions to Whatnot's
  allowed values" — this is documentation, no change needed (BoBA is a
  proper noun game name). Category/SubCategory in `WhatnotExportOptions`
  defaults to `'Trading Card Games'` which works for all games. No fix.

---

## Admin & dashboard

### REFACTOR — admin dashboard game filter (Phase 3.7)

- `src/routes/admin/+page.svelte` currently does not filter by game_id.
  Each query needs `.eq('game_id', filter)` when filter is set. **Deferred**
  to Phase 3.7 proper — lower priority than shipping Wonders features.

---

## UI components

### ACCEPT — `src/lib/components/CardDetail.svelte`

- Conditional rendering on `card.game_id === 'wonders'` for the Dragon
  Points card, variant price panel, and Wonders metadata fields. BoBA-
  specific rendering (hero_name, weapon_type, parallel) is in the shared
  section. This matches the "game as filter, not silo" architecture.

### REFACTOR — `src/lib/components/CardGrid.svelte`

- Variant badge overlay renders only for Wonders (`item.card?.game_id !== 'wonders'`).
  BoBA's parallel is already shown elsewhere. Acceptable single-game code path
  because Wonders is the only game with variant-as-attribute.

### REFACTOR — `src/routes/collection/+page.svelte`

- Hardcoded set code keys `['G', 'A', 'U']` in `setCounts` derived. BoBA-
  specific set codes. If Wonders users view this view with the filter set
  to "All" or "Wonders", the BoBA set breakdown is meaningless. Not a
  correctness issue because the derived map is only rendered in the BoBA
  overview tab. **Recommendation:** gate the set breakdown render on
  `gameFilter() !== 'wonders'` so Wonders users see a relevant breakdown
  (or nothing) instead of the empty BoBA set keys.

---

## Stores

### REFACTOR — `src/lib/stores/collection.svelte.ts` — play card filter

- `parallelCount = items.filter(i => p !== 'base' && p !== 'paper')` — BoBA-
  specific. Wonders cards all have `parallel = null` so the count is zero
  for Wonders collections. Harmless but semantically weird. Consider
  renaming to `foilParallelCount` with a game-aware implementation.

### ACCEPT — `src/lib/stores/collection.svelte.ts` — Dragon Points derived

- `_dragonPointsEntries` filters by `(item.card?.game_id || 'boba') !== 'wonders'`.
  Dragon Points is intentionally Wonders-only. Correctly-scoped single-
  game logic.

---

## Routing

### ACCEPT — `src/routes/[game=game]/` dynamic routes

- `collection/+page.svelte` redirects to `/collection` with a game filter
  applied. Works for any game in `VALID_GAMES`. Good.

### FIX when Game 3 arrives — static `/wonders/dragon-points` route

- `src/routes/wonders/dragon-points/+page.svelte` is Wonders-specific. When
  Game 3 ships, evaluate whether Game 3 needs its own static routes (like
  a "Masters Points" equivalent). Not a blocker because static routes don't
  break other games — they just add game-specific surface.

### ACCEPT — `src/hooks.server.ts` protected routes list

- Hardcoded `/boba/*` and `/wonders/*` paths. Adding Game 3 means adding
  `/game3/*` entries. Documented in `adding-a-new-game.md`.

---

## Tests

### FIX — test coverage gap

- Current test suite covers extractors and the Dragon Points calculator.
  There is **no** test that validates the architecture invariants (every
  registered game returns a valid config, param matcher accepts all
  registered games, etc.). Phase 4.1d adds these under `tests/architecture/`.

---

## Summary

| Category | Count | Blocker for Game 3 |
| -------- | ----- | ------------------- |
| ACCEPT   | ~10   | No                  |
| REFACTOR | ~8    | No                  |
| FIX      | ~2    | Yes                 |

The only items that must be resolved before Game 3 ships are:
1. Architecture tests (Phase 4.1d — addressed in this same phase).
2. Multi-game prompt needs a Game 3 entry (straightforward edit when the
   real Game 3 is known).

Everything else is REFACTOR-at-leisure: the architecture holds up, but a
few hardcoded `'boba' | 'wonders'` switches should become registry-driven
when the refactor is cheap.

**Estimate:** adding Game 3 after the real game is defined is a
**2–3 day engineering task** following `docs/adding-a-new-game.md`. Without
this audit and the Phase 4.1 scaffolding, it would be a multi-week project
of rediscovering the architecture.
