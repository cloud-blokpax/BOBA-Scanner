# Game 3 — Skeleton Module

This directory is a **placeholder** for the future third game. When the real
Game 3 is announced:

1. Rename this folder to the actual game ID (e.g., `magic`, `lorcana`).
2. Replace each placeholder file with a real implementation.
3. Register the game in `src/lib/games/resolver.ts` and `src/lib/games/all-games.ts`.
4. Add the game ID to `src/params/game.ts` param matcher.
5. Seed card data with `game_id = '<new-id>'`.
6. Follow the full checklist in `docs/adding-a-new-game.md`.

## What's here

Minimal stub files implementing the `GameConfig` interface:

- `config.ts` — exports a default `GameConfig` with placeholder values.
  **Not registered** in `resolver.ts` — calling `resolveGameConfig('game3')`
  throws `Unknown game`.
- `extract.ts` — `extractGame3CardNumber` returns `null` (no pattern matches).
- `prompt.ts` — placeholder system prompt; tool schema matches other games'
  shape but with no game-specific fields.
- `theme.ts` — neutral dark theme (placeholder colors).
- `nav.ts` — empty nav items; no protected routes yet.

## Copy-as-starting-point

The easiest way to build Game 3 is to copy one of the working game modules:

- `src/lib/games/boba/` — baked-in variant via `card_number` prefixes, no
  metadata column usage
- `src/lib/games/wonders/` — JSONB metadata for game-specific fields,
  variant as a separate column, foil decision tree

Pick whichever pattern better fits the real Game 3's economics.

## Architecture validation

Before shipping Game 3, run:

```bash
npm test -- architecture
```

This catches regressions where adding a new game breaks the resolver,
param matcher, or OCR region invariants.
