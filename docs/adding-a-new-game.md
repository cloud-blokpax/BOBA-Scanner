# Adding a New Game

Canonical guide for integrating a third (or later) game into Card Scanner.
Follow these six steps in order. Every step includes the files you'll touch
and a brief description of the change — full examples live in the working
game modules (`src/lib/games/boba/`, `src/lib/games/wonders/`).

At the bottom of this doc is a completeness checklist you can copy into a
PR description.

---

## Step 1 — Implement the `GameConfig` interface

Create a module directory at `src/lib/games/<newGameId>/`. Copy the
`game3/` skeleton as a starting point or model it after whichever existing
game better fits the new game's economics:

- `boba/` — variant baked into `card_number` via prefixes (BF-, SBF-, RAD-).
  No separate variant column is needed for Tier 1–3 routing.
- `wonders/` — variant as a separate attribute detected via Claude's
  decision tree. Uses the `cards.metadata` JSONB for game-specific fields
  (cost, hierarchy, card_class, orbitals, etc.).

Files to create in the new module:

| File         | Role                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| `config.ts`  | Exports the default `GameConfig` object implementing the contract.          |
| `extract.ts` | Exports `extract<Game>CardNumber(text)` — Tier 2 OCR parser.                |
| `prompt.ts`  | Exports `<GAME>_SYSTEM_PROMPT`, `<GAME>_USER_PROMPT`, `<GAME>_CARD_ID_TOOL`. |
| `theme.ts`   | Exports `<game>Theme` matching the `GameTheme` shape.                       |
| `nav.ts`     | Exports `<game>NavItems` and `<game>ProtectedRoutes`.                       |

The `cardIdTool` must be named `identify_card` — the scan endpoint hardcodes
`tool_choice: { name: 'identify_card' }`.

## Step 2 — Register in the resolver and registry

Edit **`src/lib/games/resolver.ts`**:

- Add `'newGameId'` to the `VALID_GAME_IDS` set.
- Add a `case 'newGameId':` branch in `resolveGameConfig`'s switch, loading
  the new config module via dynamic import.

Edit **`src/lib/games/all-games.ts`**:

- Add an entry to `ALL_GAMES` with `{ id, name, shortName, icon }`. The
  order of this array drives display order in hub cards, filter pills, and
  settings checkboxes.

## Step 3 — Add the param matcher

Edit **`src/params/game.ts`**:

- Add `'newGameId'` to the `VALID_GAMES` set.

This unlocks `/[game=game]/…` dynamic routes. After this, `/<newGameId>/collection`
will match the existing `[game=game]/collection/+page.svelte` template. If
the new game needs game-exclusive routes (the way Wonders has `/wonders/dragon-points`),
add static routes under `src/routes/<newGameId>/`.

## Step 4 — Seed card data

Load the new game's cards into the unified `cards` table with `game_id = 'newGameId'`.
Pull game-specific fields into `cards.metadata` JSONB. Don't create a
game-specific table — the architecture deliberately routes all card data
through `cards` so the recognition pipeline, collection service, and sync
layer don't fork.

Relevant schema columns already present:

- `cards.game_id TEXT NOT NULL DEFAULT 'boba'`
- `cards.metadata JSONB` — free-form per game
- `cards.year INT` — drives freshness bonuses, sort order
- `cards.variant` is **not** on `cards` — variant lives on the records
  representing physical ownership (scans, collections, listing_templates).

After seeding, verify in the Supabase SQL Editor:

```sql
SELECT game_id, COUNT(*) FROM cards GROUP BY game_id;
```

## Step 5 — eBay integration

If the new game should be priced via eBay, do three things:

1. In `src/lib/games/<newGameId>/config.ts`, set `ebaySearchKeywords` to
   the keywords that appear in listings for this game (e.g., the official
   game name plus common abbreviations).

2. In **`src/lib/utils/ebay-title.ts`**, add a `buildNewGameTitle(card)`
   helper and dispatch on `card.game_id` inside `buildEbayListingTitle`.
   Also add description logic in `src/lib/services/listing-generator.ts`
   (`generateListingTemplate` dispatches on `gameId`).

3. If the new game has meaningfully different search patterns (the way
   Wonders uses quoted phrases instead of BoBA's loose keyword list),
   create `src/lib/server/ebay-query-<newGameId>.ts` modeled on
   `ebay-query-wonders.ts` and dispatch in the harvester's `refreshCardPrice`.

## Step 6 — Admin dashboard game filter

Edit **`src/routes/admin/+page.svelte`** (or the Admin sidebar component)
to include the new game in the game-filter segmented control. The filter
drives every query on the admin dashboard, so adding the option gives
admins instant per-game visibility.

Similarly, update the **Game Split** card on the admin overview to
surface the new game's percentage alongside BoBA and Wonders.

---

## Completeness Checklist

Copy this into your PR description and tick off each item.

- [ ] `src/lib/games/<newGameId>/config.ts` exports a valid `GameConfig`
- [ ] `src/lib/games/<newGameId>/extract.ts` parses collector numbers
      without false-matching other games' prefixes
- [ ] `src/lib/games/<newGameId>/prompt.ts` exports `<GAME>_SYSTEM_PROMPT`,
      `<GAME>_USER_PROMPT`, `<GAME>_CARD_ID_TOOL` (tool named `identify_card`)
- [ ] `src/lib/games/<newGameId>/theme.ts` exports `<game>Theme` with
      `accentPrimary`, `accentSecondary`, `cardBg`, `textAccent`
- [ ] `src/lib/games/<newGameId>/nav.ts` exports `<game>NavItems` and
      `<game>ProtectedRoutes`
- [ ] `src/lib/games/resolver.ts` has the new case + added to `VALID_GAME_IDS`
- [ ] `src/lib/games/all-games.ts` has the new entry in `ALL_GAMES`
- [ ] `src/params/game.ts` has the new ID in `VALID_GAMES`
- [ ] `src/hooks.server.ts` `protectedRoutes` list includes `/<newGameId>/...`
      paths that require auth
- [ ] `cards` table has rows with `game_id = 'newGameId'`
- [ ] `src/lib/utils/ebay-title.ts` dispatches on the new game id
- [ ] `src/lib/services/listing-generator.ts` dispatches on the new game id
- [ ] `src/lib/services/whatnot-export.ts` handles the new game id
- [ ] `src/routes/admin/+page.svelte` (or AdminSidebar) game filter
      includes the new game
- [ ] Architecture tests pass: `npm test -- architecture`
- [ ] Multi-game scanner prompt (`src/lib/games/multi-game-prompt.ts`)
      mentions the new game so auto-detect works
- [ ] Settings page enabled-games list renders the new game option
- [ ] Feature flag `multi_game_ui` is respected — new game UI stays
      gated until the flag is flipped

---

## Common pitfalls

- **Tool name mismatch**: the scan endpoint hardcodes
  `tool_choice: { name: 'identify_card' }`. If you name the new game's tool
  differently, auto-detect scans will fail silently with a 502 response.
- **Card number collision**: BoBA's plain-numeric cards (130, 76, 200)
  collide with Wonders' Existence set. The Wonders extractor intentionally
  doesn't match plain numerics to avoid false positives. Do the same when
  designing the new game's extractor.
- **Variant identity**: collection identity is
  `(user_id, card_id, variant)`. If the new game has no variant concept,
  use `variant = 'paper'` everywhere. Don't invent a new identity.
- **Legacy BoBA columns**: `cards.hero_name`, `cards.weapon_type`,
  `cards.athlete_name`, `cards.battle_zone` are BoBA-specific. Leave them
  `null` for other games and store game-specific fields in `metadata`.
- **Forgetting the param matcher**: if you add routes under
  `/<newGameId>/…` without updating `src/params/game.ts`, SvelteKit will
  404 the dynamic `[game=game]` routes for that game.

---

## Reference implementations

- **`src/lib/games/boba/`** — original single-game module. BoBA encodes
  variant in `card_number` (BF-, SBF-, RAD-) rather than as a separate
  attribute. The simplest pattern.

- **`src/lib/games/wonders/`** — variant-as-attribute model. Uses
  `metadata` JSONB for game-specific fields. Has Dragon Points integration
  (`src/lib/games/wonders/dragon-points.ts`). Complete example of the
  multi-game architecture at full depth.

- **`src/lib/games/game3/`** — placeholder skeleton. Copy this as a
  starting point.
