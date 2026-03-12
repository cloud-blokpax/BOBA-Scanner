# BOBA-Scanner: File Structure Deep Dive

**Date:** 2026-03-10
**Focus:** Is this the best structure? How does it compare to world-class? Can it integrate into Bazooka Vault and other apps? Can it grow to support future collections beyond BOBA?

---

## Current Structure at a Glance

```
BOBA-Scanner/
├── index.html                          # Single-page entry
├── styles.css                          # Monolithic compiled CSS (89KB)
├── card-database.json                  # 17,644 BOBA cards (2.7MB, root level)
├── vite.config.js                      # Custom concat plugin
├── vercel.json                         # Deployment + API config
├── package.json                        # Minimal (Vite + Vitest only)
├── middleware.js                       # Vercel edge middleware
├── sw.js                              # Service worker
├── supabase-schema.sql                # DB schema
├── version.json
│
├── api/                               # Vercel serverless functions
│   ├── config.js
│   ├── anthropic.js
│   ├── grade.js
│   ├── ebay-browse.js
│   ├── ebay-sold.js
│   ├── upload-image.js
│   └── log.js
│
├── styles/                            # CSS source tokens
│   ├── index.css, tokens.css, base.css
│   ├── layout.css, cards.css, forms.css
│   ├── modals.css, scanner.css, themes.css
│   ├── collection.css, admin.css
│   ├── deck-builder.css, responsive.css
│
├── src/
│   ├── main.js                        # Vite entry + lazy-load wiring
│   ├── app.js                         # Init orchestration
│   │
│   ├── core/
│   │   ├── state.js                   # Global state + config loader
│   │   ├── config.js                  # Local settings (localStorage)
│   │   ├── event-bus.js               # Pub/sub
│   │   ├── event-handler.js           # Event delegation
│   │   ├── api/api-utils.js           # fetchWithRetry
│   │   ├── auth/                      # google-auth.js, user-management.js
│   │   ├── database/                  # database.js, scan-learning.js
│   │   ├── scanner/                   # scanner.js, image-processing.js, opencv.js, batch/binder/continuous
│   │   ├── ocr/                       # ocr.js, ocr-manager.js, ocr-worker.js
│   │   ├── collection/                # collections.js, statistics.js, scan-history.js
│   │   ├── sync/                      # sync.js, image-storage.js
│   │   └── infra/                     # error-tracking, source-protection, feature-flags, version
│   │
│   ├── collections/
│   │   ├── adapter.js                 # Base CollectionAdapter class
│   │   ├── registry.js                # Adapter registry
│   │   └── boba/
│   │       ├── boba-adapter.js        # BOBA-specific implementation
│   │       └── heroes.js              # Hero-to-athlete mapping
│   │
│   ├── ui/
│   │   ├── cards-grid.js, card-detail.js, card-actions.js, card-corrections.js
│   │   ├── upload-area.js, toast.js, stats-strip.js
│   │   ├── themes.js, bottom-nav.js, events.js
│   │   ├── utils.js, ui-enhancements.js
│   │
│   ├── features/
│   │   ├── grader/grader.js
│   │   ├── ebay/                      # ebay.js, ebay-lister.js, price-trends.js, seller-monitor.js
│   │   ├── export/                    # export.js, templates.js
│   │   ├── tags/tags.js
│   │   ├── deck-builder/deck-builder.js
│   │   ├── set-completion/set-completion.js
│   │   ├── tournaments/tournaments.js
│   │   └── admin/admin-dashboard.js
│   │
│   └── embed/
│       ├── widget.js
│       └── widget.css
│
└── tests/
    ├── core/                          # database, collections, sync, scan-learning
    └── features/                      # export, ocr, price-trends
```

---

## Part 1: Honest Assessment — What's Working Well

Before talking about gaps, credit where it's due. This structure already has several strong patterns:

### Good decisions already made

| Pattern | Where | Why it's good |
|---------|-------|---------------|
| **Adapter pattern** | `src/collections/adapter.js` + `registry.js` | This is the RIGHT abstraction for multi-collection support. You can add Pokemon, Magic, etc. without touching core scanner code |
| **Feature isolation** | `src/features/*/` | Each feature (eBay, grading, tournaments) lives in its own folder. Clean boundaries |
| **Lazy loading** | `main.js` lazy-wires heavy features | Keeps initial bundle small. Users don't download tournament code until they need it |
| **Core/UI/Features separation** | Three clear layers in `src/` | Business logic, presentation, and features are separated — this is the right instinct |
| **Serverless API layer** | `api/` folder | Keeps secrets server-side, rate-limits expensive calls. Smart architecture |
| **CSS tokenization** | `styles/tokens.css` | Design tokens are the foundation of scalable styling |
| **Event bus** | `src/core/event-bus.js` | Decouples modules. Components react to events instead of calling each other directly |

**Bottom line:** The bones are good. The adapter pattern alone puts you ahead of 90% of hobby/side-project apps. The problems are in execution details, not fundamental architecture.

---

## Part 2: What World-Class Looks Like (and Where You Diverge)

### Gap 1: Global Scope Dependency (`window.*` everywhere)

**What you have:** 37+ scripts concatenated into one mega-module via a custom Vite plugin. Everything talks through `window.*` globals.

**What world-class looks like:** Proper ES module imports/exports. Each file declares what it needs and what it provides.

**Why this matters for integration:**
- Bazooka Vault (or any host app) can't import a single function from BOBA-Scanner. It's all-or-nothing because everything is tangled through `window.*`
- Two apps on the same page would collide (both set `window.database`, `window.currentUser`, etc.)
- No tree-shaking — bundlers can't eliminate unused code because they can't trace dependencies through globals

**What to do:**
```
# Instead of:
window.findCard = function(cardNumber) { ... }

# World-class:
export function findCard(cardNumber) { ... }
```

**Priority: HIGH** — This is the single biggest blocker to integration and growth.

---

### Gap 2: No Package/Library Boundary

**What you have:** A deployable website. The scanning engine, card database, collection manager, and UI are all fused together.

**What world-class looks like:** A monorepo with separate packages:

```
packages/
├── @boba/scanner-core        # OCR + AI + database matching (zero UI)
├── @boba/collection-manager  # CRUD, sync, storage (zero UI)
├── @boba/card-database       # Database loader, search, fuzzy match
├── @boba/ui-components       # Reusable UI (card grid, detail modal, upload)
├── @boba/adapters            # Collection adapters (BOBA, future ones)
├── apps/
│   ├── web                   # The current BOBA-Scanner website
│   └── embed                 # The embeddable widget
```

**Why this matters for Bazooka Vault:**
- Bazooka Vault could `npm install @boba/scanner-core` and get scanning without any of the UI
- Bazooka Vault could use `@boba/collection-manager` for sync without the scanner
- Each package has its own tests, its own versioning, its own API surface
- You could publish `@boba/ui-components` as a design system other apps consume

**What to do (pragmatic path):**
You don't need to go full monorepo today. Start by defining clear import boundaries:
1. Make `src/core/scanner/` importable independently (no UI dependencies)
2. Make `src/core/collection/` importable independently (no scanner dependencies)
3. Make `src/collections/` importable independently (no app dependencies)

These three steps set you up for extraction later without a massive rewrite now.

---

### Gap 3: Card Database at Root as a Single JSON Blob

**What you have:** `card-database.json` (2.7MB) sitting at the project root. One file for all 17,644 cards. Loaded entirely into memory.

**What world-class looks like:**
```
data/
├── boba/
│   ├── manifest.json           # Collection metadata + version
│   ├── sets/
│   │   ├── battle-arena.json   # Cards for one set
│   │   ├── legends.json
│   │   └── ...
│   └── heroes.json             # Moved here from src/collections/boba/
├── pokemon/                    # Future: same pattern
│   ├── manifest.json
│   └── sets/...
```

**Why this matters for growth:**
- Adding a new collection (Pokemon, Magic) currently means either bloating one giant JSON or creating a second giant JSON with no convention
- Per-set files allow lazy loading — don't load "Legends" set if user only collects "Battle Arena"
- `manifest.json` per collection provides metadata (set count, total cards, version, update URL) that the adapter registry can use
- Bazooka Vault could pull `data/boba/manifest.json` to check what's available without downloading 2.7MB

---

### Gap 4: Styles Architecture

**What you have:** Both `styles.css` (89KB monolithic) AND `styles/` folder with modular CSS. Two systems.

**What world-class looks like:**
- One system. The `styles/` folder with tokens + component CSS imported through a build pipeline
- CSS Modules or CSS-in-JS if you want scoped styles (important for embedding)
- The monolithic `styles.css` should be the build OUTPUT, not a source file

**Why this matters for integration:**
- If you embed BOBA-Scanner inside Bazooka Vault, your CSS will collide with theirs (`.btn`, `.modal`, `.card` are common class names)
- Scoped styles (CSS Modules, Shadow DOM, or at minimum BEM naming with a `boba-` prefix) prevent this

---

### Gap 5: Tests Are Thin

**What you have:** 7 test files covering core (database, collections, sync, scan-learning) and features (export, ocr, price-trends).

**What world-class looks like:**
```
tests/
├── unit/
│   ├── core/           # Test every core module
│   ├── collections/    # Test adapters, registry
│   ├── features/       # Test each feature
│   └── ui/             # Test UI logic (not rendering)
├── integration/
│   ├── scan-pipeline.test.js    # OCR → DB → AI → card object
│   ├── sync-flow.test.js        # Local → cloud → merge
│   └── collection-crud.test.js  # Full CRUD lifecycle
├── e2e/                         # Playwright or Cypress
│   ├── scan-card.spec.js
│   └── manage-collection.spec.js
```

**Why this matters for growth:**
- Adding a new collection type (Pokemon adapter) with no integration tests means you can't be confident you didn't break BOBA scanning
- Refactoring from `window.*` to ES modules without tests is terrifying — tests are the safety net that makes modernization possible

---

### Gap 6: No TypeScript or Type Definitions

**What you have:** Pure JavaScript with no type annotations.

**What world-class looks like:** TypeScript or at minimum JSDoc type annotations with `// @ts-check`.

**Why this matters:**
- The `CollectionAdapter` interface is defined by convention (override these methods). With TypeScript, the compiler enforces it
- Card objects have ~20 properties but no formal type — easy to pass wrong data shapes between modules
- For integration: consumers (Bazooka Vault) get auto-complete and compile-time checks if you publish typed packages

**Pragmatic path:** Add JSDoc types to the adapter interface and card objects first. You don't need a full TypeScript migration.

---

## Part 3: Integration Into Bazooka Vault / Other Apps

### Current integration options (honestly)

| Method | Feasibility | Limitations |
|--------|------------|-------------|
| **iframe embed** | Works today | No shared state, clunky UX, can't style it to match host |
| **`src/embed/widget.js`** | Partially works | Still loads ALL of BOBA-Scanner, CSS collisions, `window.*` conflicts |
| **API only** | Works today | Bazooka Vault hits your `/api/anthropic` etc. directly. No UI reuse |
| **npm package import** | NOT possible today | Nothing is exported as a module. No `package.json` main/exports field |

### What Bazooka Vault integration actually needs

1. **Scanner as a service** — "Here's a card image, give me back a card object"
   - Needs: `@boba/scanner-core` package with a clean `scanCard(image): Promise<Card>` API
   - Currently blocked by: globals, no exports, UI tangled into scanning logic

2. **Collection viewer component** — "Show this user's collection inside our UI"
   - Needs: `@boba/ui-components` package with `<CardGrid cards={...} />` or similar
   - Currently blocked by: vanilla JS DOM manipulation, no component model, CSS collisions

3. **Collection data access** — "Get this user's BOBA collection for display in Vault"
   - Needs: Direct Supabase query or a shared API endpoint
   - This one actually works today if both apps share the Supabase instance

4. **Shared auth** — "User is logged into Vault, don't make them log in again for BOBA"
   - Needs: Shared auth provider (Supabase Auth works here if both apps use it)
   - Currently feasible if Vault uses the same Supabase project

### Recommended integration architecture

```
┌──────────────────────────────────────────┐
│            Bazooka Vault                  │
│                                           │
│   ┌─────────────┐  ┌──────────────────┐  │
│   │ Vault UI    │  │ BOBA Scanner     │  │
│   │             │  │ (embedded)       │  │
│   │             │  │                  │  │
│   │  Uses:      │  │  Uses:           │  │
│   │  @boba/     │  │  @boba/          │  │
│   │  ui-comps   │  │  scanner-core    │  │
│   └─────────────┘  └──────────────────┘  │
│           │                │              │
│           └────────┬───────┘              │
│                    ▼                      │
│          @boba/collection-manager         │
│                    │                      │
│                    ▼                      │
│             Supabase (shared)             │
└──────────────────────────────────────────┘
```

---

## Part 4: Future Collections (Pokemon, Magic, etc.)

### What the adapter pattern already gives you

Your `CollectionAdapter` base class is well-designed. Adding a new collection means:

1. Create `src/collections/pokemon/pokemon-adapter.js` extending `CollectionAdapter`
2. Implement: `getFieldDefinitions()`, `normalizeDbRecord()`, `buildCardFromMatch()`, `getAIPrompt()`, `buildEbayQuery()`, `resolveMetadata()`
3. Add `data/pokemon/` database files
4. Register the adapter in the registry

**This pattern is correct and scales well.**

### What's missing for multi-collection to work smoothly

| Gap | Impact | Fix |
|-----|--------|-----|
| **Database is hardcoded** to one JSON file path | New collections need their own database files | Make `databaseUrl` per-adapter (already has the getter, but `database.js` doesn't use it) |
| **`window.database`** is a single global array | Can't hold two collections' databases simultaneously | Use a map: `databases[adapterId] = [...]` |
| **Card number formats** assumed to be BOBA-style | Pokemon cards use different numbering (e.g., `001/165`) | Already handled by adapter's `ocrWhitelist` + `normalizeDbRecord`, but `findCard()` Levenshtein logic may need adapter-specific tuning |
| **AI prompts** are BOBA-specific | Each game needs its own identification prompt | Already handled by `getAIPrompt()` — good |
| **eBay queries** assume BOBA naming | Pokemon eBay queries look different | Already handled by `buildEbayQuery()` — good |
| **Hero/athlete mapping** is BOBA-specific | Other games won't have this | Already handled by `resolveMetadata()` — good |
| **UI assumes BOBA fields** | Card detail modal hardcodes "Hero", "Athlete", "Power", "Weapon" | Need to drive the UI from `getFieldDefinitions()` instead of hardcoding field names |
| **Grading prompts** are sports-card specific | Pokemon/Magic grading criteria differ | Need `getGradingPrompt()` on the adapter |
| **Collection picker** doesn't exist | No UI to switch between "My BOBA cards" and "My Pokemon cards" | Need a collection-type selector in the UI |
| **No per-collection settings** | OCR thresholds, detection params may differ per card type | Add `getDefaultSettings()` to adapter |

### Difficulty rating for adding Pokemon support

| Task | Effort |
|------|--------|
| Create `PokemonAdapter` | Small (1-2 hours) |
| Build Pokemon card database JSON | Medium (depends on data source) |
| Make `database.js` adapter-aware | Medium (half day) |
| Make card detail UI field-driven | Medium (half day) |
| Add collection-type picker UI | Small (couple hours) |
| Test end-to-end with Pokemon cards | Medium (half day) |
| **Total with current architecture** | **~2-3 days** |
| **Total if you do ES modules first** | **~1-2 days** (cleaner, fewer surprises) |

---

## Part 5: The World-Class Target Structure

If you were building this from scratch as a world-class, multi-collection card scanning platform designed for integration:

```
boba-platform/
├── packages/
│   ├── scanner-core/              # Pure scanning engine
│   │   ├── src/
│   │   │   ├── ocr/               # Tesseract wrapper
│   │   │   ├── ai/                # Claude API client
│   │   │   ├── detection/         # OpenCV card detection
│   │   │   ├── matching/          # Database search + fuzzy match
│   │   │   ├── pipeline.ts        # scanCard() orchestration
│   │   │   └── index.ts           # Public API
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── collection-manager/        # Collection CRUD + sync
│   │   ├── src/
│   │   │   ├── storage/           # localStorage, IndexedDB, Supabase
│   │   │   ├── sync/              # Cloud sync engine
│   │   │   ├── models/            # Card, Collection types
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── adapters/                  # Collection type definitions
│   │   ├── src/
│   │   │   ├── base.ts            # CollectionAdapter interface
│   │   │   ├── registry.ts
│   │   │   ├── boba/
│   │   │   │   ├── adapter.ts
│   │   │   │   ├── heroes.ts
│   │   │   │   └── prompts.ts
│   │   │   └── pokemon/           # Future
│   │   │       ├── adapter.ts
│   │   │       └── prompts.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── ui-components/             # Framework-agnostic components
│   │   ├── src/
│   │   │   ├── card-grid/
│   │   │   ├── card-detail/
│   │   │   ├── scanner-ui/
│   │   │   ├── upload-area/
│   │   │   └── themes/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared/                    # Cross-cutting utilities
│       ├── src/
│       │   ├── event-bus.ts
│       │   ├── api-client.ts
│       │   ├── auth.ts
│       │   └── types.ts           # Shared type definitions
│       ├── package.json
│       └── tsconfig.json
│
├── apps/
│   ├── web/                       # BOBA-Scanner website
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── layouts/
│   │   │   └── app.ts
│   │   ├── index.html
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── embed/                     # Embeddable widget
│       ├── src/
│       │   └── widget.ts
│       ├── package.json
│       └── vite.config.ts
│
├── data/                          # Card databases (versioned)
│   ├── boba/
│   │   ├── manifest.json
│   │   ├── sets/
│   │   │   ├── battle-arena.json
│   │   │   └── ...
│   │   └── heroes.json
│   └── pokemon/
│       ├── manifest.json
│       └── sets/...
│
├── api/                           # Serverless functions (unchanged)
│   ├── config.js
│   ├── anthropic.js
│   ├── grade.js
│   └── ...
│
├── styles/                        # Design system tokens
│   ├── tokens.css
│   └── base.css
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── turbo.json / nx.json           # Monorepo orchestration
├── package.json                   # Workspace root
└── tsconfig.base.json
```

---

## Part 6: Pragmatic Roadmap (Don't Boil the Ocean)

You don't need to get to the world-class structure in one shot. Here's a phased approach that preserves what works while unlocking integration and growth:

### Phase 1: Module Boundaries (1 week)
**Goal:** Make code importable without breaking anything.

- [ ] Convert `window.*` assignments to ES module exports (keep `window.*` as backwards-compat shims temporarily)
- [ ] Remove the `classicScriptsPlugin` concatenation hack
- [ ] Add `import`/`export` to every file in `src/`
- [ ] Verify lazy loading still works

**Unlocks:** Tree-shaking, proper IDE support, ability to import individual modules.

### Phase 2: Data Separation (3 days)
**Goal:** Decouple card data from code.

- [ ] Move `card-database.json` to `data/boba/`
- [ ] Split into per-set files with a `manifest.json`
- [ ] Make `database.js` load databases via adapter's `databaseUrl`
- [ ] Support multiple databases loaded simultaneously (keyed by adapter ID)

**Unlocks:** Multiple collection types, lazy-loaded set data, smaller initial payload.

### Phase 3: UI Field-Driven Rendering (3 days)
**Goal:** Card detail and grid driven by adapter field definitions, not hardcoded BOBA fields.

- [ ] Make `card-detail.js` render fields from `getFieldDefinitions()`
- [ ] Make `cards-grid.js` show adapter-defined columns
- [ ] Add `getGradingPrompt()` to adapter interface
- [ ] Add collection-type picker to UI

**Unlocks:** Adding a new card game without touching UI code.

### Phase 4: Package Extraction (1 week)
**Goal:** Make scanner and collection manager consumable by Bazooka Vault.

- [ ] Extract `src/core/scanner/` + `src/core/ocr/` + `src/core/database/` into `packages/scanner-core`
- [ ] Extract `src/core/collection/` + `src/core/sync/` into `packages/collection-manager`
- [ ] Extract `src/collections/` into `packages/adapters`
- [ ] Create clean public APIs (`scanCard()`, `createCollection()`, `addCard()`, etc.)
- [ ] Publish to npm or use workspace references

**Unlocks:** `npm install @boba/scanner-core` from Bazooka Vault.

### Phase 5: CSS Scoping (3 days)
**Goal:** Prevent style collisions when embedded.

- [ ] Delete the monolithic `styles.css`, build from `styles/` source only
- [ ] Add `boba-` prefix to all class names (or use CSS Modules)
- [ ] Scope embed widget styles in Shadow DOM

**Unlocks:** Clean embedding in Bazooka Vault without style conflicts.

### Phase 6: Type Safety (ongoing)
**Goal:** Catch bugs at dev time, provide better DX for consumers.

- [ ] Add JSDoc types to adapter interface and card models
- [ ] Add `// @ts-check` to critical files
- [ ] Optionally migrate to `.ts` over time

---

## Part 7: Direct Answers to Your Questions

### "Is this the best setup?"

**No, but it's better than most.** The adapter pattern, feature isolation, and lazy loading are genuinely good architectural choices. The main weaknesses are:

1. **Global scope (`window.*`)** — the single biggest issue
2. **No package boundaries** — everything is one deployable blob
3. **Monolithic database** — one huge JSON for all cards
4. **No type safety** — easy to pass wrong data shapes

You're maybe at 65-70% of world-class. The foundation is right; the execution needs modernization.

### "Will this structure allow ideal integration into other apps like Bazooka Vault?"

**Not today.** The `window.*` globals and lack of package boundaries mean Bazooka Vault can't cleanly import your scanning engine or UI components. The only integration paths today are iframes (clunky) or direct API calls (no UI reuse).

After Phase 1 (ES modules) and Phase 4 (package extraction), Bazooka Vault could do:
```js
import { scanCard } from '@boba/scanner-core';
import { CollectionManager } from '@boba/collection-manager';

const card = await scanCard(imageBlob, { adapter: 'boba' });
```

### "Will this structure allow me to grow the app and add future collections?"

**Mostly yes, with caveats.** The adapter pattern is the right abstraction and it's already implemented. You could add a Pokemon adapter today and it would mostly work. The blockers are:

1. `database.js` only loads one database — needs to be adapter-aware
2. Card detail UI hardcodes BOBA field names — needs to be field-driven
3. No collection-type picker in the UI — users can't switch between games

These are fixable in ~3-5 days of focused work (Phases 2-3 above). The adapter pattern you already built is doing the heavy lifting — you just need to finish connecting it through the rest of the app.

---

## Summary

| Dimension | Current Score | After Phase 1-3 | After Phase 1-6 |
|-----------|:---:|:---:|:---:|
| Code organization | 7/10 | 8/10 | 9/10 |
| Integration-ready | 3/10 | 5/10 | 9/10 |
| Multi-collection | 6/10 | 9/10 | 10/10 |
| Testability | 4/10 | 7/10 | 9/10 |
| Developer experience | 5/10 | 7/10 | 9/10 |
| Production readiness | 7/10 | 8/10 | 9/10 |

The biggest bang-for-buck investment is **Phase 1 (ES modules)**. It unlocks everything else. Without it, Phases 2-6 are harder and messier. With it, every subsequent phase becomes a straightforward refactor.
