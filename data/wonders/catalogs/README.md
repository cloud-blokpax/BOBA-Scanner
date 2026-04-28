# Wonders set catalogs

One JSON file per set. Drop a new catalog into this directory and run:

```bash
npm run wonders:import-set -- data/wonders/catalogs/<set_code>.json
```

The import script materializes one row per `(card_number, parallel)`
tuple in the `cards` table. It is idempotent — re-running with the same
catalog file is safe. Inserts are gated by the
`(game_id, card_number, parallel)` uniqueness constraint added in
migration 33; rows that already exist are left alone.

After import, the price harvester picks up the new rows on its next run
(no extra config — `get_harvest_candidates` selects from `cards`
directly post-migration 31).

## File format

```json
{
  "set_code": "WOTF2",
  "set_name_display": "Wonders of The First — Set 2",
  "year": 2026,
  "default_parallels": [
    "Paper",
    "Classic Foil",
    "Formless Foil",
    "Orbital Color Match",
    "Stonefoil"
  ],
  "cards": [
    {
      "card_number": "1",
      "name": "Aria Voidsinger",
      "hero_name": "Aria Voidsinger",
      "rarity": "rare",
      "type_line": "Primary Spell",
      "card_class": "Mystic",
      "metadata": {
        "orbitals": ["red", "blue"],
        "dragon_points": 3
      }
    },
    {
      "card_number": "T-001",
      "name": "Ember Token",
      "hero_name": "Ember Token",
      "rarity": "token",
      "parallels": ["Paper"],
      "type_line": "Token"
    }
  ]
}
```

### Field reference

Top-level:

- `set_code` *(required)* — short code stored in `cards.set_code`.
- `set_name_display` *(optional)* — human-readable name; copied into
  each card's `metadata.set_name_display` for use by the eBay query
  builder.
- `year` *(optional)* — set release year, written to `cards.year`.
- `default_parallels` *(required, non-empty)* — applied to every card
  unless that card has its own `parallels` field. Use the full
  five-parallel list for standard sets:
  `["Paper", "Classic Foil", "Formless Foil", "Orbital Color Match", "Stonefoil"]`.
- `cards` *(required)* — one entry per logical card. Each entry expands
  into one row per parallel.

Per-card:

- `card_number` *(required)* — the collector number, identical across
  parallels (e.g. `"316/401"`, `"P-014"`, `"T-001"`).
- `name` *(required)* — card name, identical across parallels.
- `hero_name` *(optional)* — defaults to `name` if omitted.
- `athlete_name` *(optional)* — Wonders normally leaves this null.
- `rarity` *(optional)* — `"common"`, `"uncommon"`, `"rare"`,
  `"mythic"`, `"token"`, etc.
- `type_line` *(optional)* — folded into `metadata.type_line`.
- `card_class` *(optional)* — folded into `metadata.card_class`.
- `parallels` *(optional)* — overrides the catalog default. Use for:
  - Paper-only tokens / story artifacts (`["Paper"]`)
  - Cards that don't ship in every foil treatment
- `metadata` *(optional)* — free-form JSONB blob merged into
  `cards.metadata`. Anything game-specific lands here (orbitals, dragon
  points, rules text, etc.).

## Closed vocabulary for parallels

The script accepts only these five values (case-sensitive):

| Stored value | Short code | Description |
|---|---|---|
| `Paper` | `paper` | Solid black border, matte |
| `Classic Foil` | `cf` | Lined border, foil treatment |
| `Formless Foil` | `ff` | Borderless bleed, foil |
| `Orbital Color Match` | `ocm` | Lined border + serial number |
| `Stonefoil` | `sf` | Like OCM but 1/1 rarity |

Short codes are emitted by the parallel classifier and mapped to full
names before any DB write — they are never persisted. See
`src/lib/data/wonders-parallels.ts`.
