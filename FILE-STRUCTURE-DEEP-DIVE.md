# File Structure Deep Dive: Is This Best-in-Class?

## TL;DR Verdict

**Your structure is 70% of the way to world-class.** The bones are excellent — adapter pattern, event bus, lazy loading, clear separation of concerns. But there are **critical gaps** that will block you when you try to integrate with Bazooka Vault or add new collections. This document covers exactly what those gaps are and what "best in class" looks like for an app like this.

---

## 1. What You Have Today

```
BOBA-Scanner/
├── api/                          # Vercel serverless functions
│   ├── anthropic.js              # Claude AI endpoint
│   ├── config.js                 # Env var delivery
│   ├── ebay-browse.js            # eBay search
│   ├── ebay-sold.js              # eBay sold data
│   ├── grade.js                  # PSA grading
│   ├── log.js                    # Event logging
│   └── upload-image.js           # Image storage
├── src/
│   ├── main.js                   # Entry point (eager + lazy loading)
│   ├── app.js                    # Orchestration
│   ├── collections/              # ✅ Adapter pattern (great!)
│   │   ├── adapter.js            # Base class
│   │   ├── registry.js           # Adapter registry
│   │   └── boba/                 # BOBA-specific
│   │       ├── boba-adapter.js
│   │       └── heroes.js
│   ├── core/                     # Core engine
│   │   ├── config.js
│   │   ├── state.js
│   │   ├── event-bus.js
│   │   ├── event-handler.js
│   │   ├── api/api-utils.js
│   │   ├── auth/
│   │   ├── collection/
│   │   ├── database/
│   │   ├── infra/
│   │   ├── ocr/
│   │   ├── scanner/
│   │   └── sync/
│   ├── embed/                    # Widget for external apps
│   │   ├── widget.js
│   │   └── widget.css
│   ├── features/                 # Feature modules (lazy-loaded)
│   │   ├── admin/
│   │   ├── deck-builder/
│   │   ├── ebay/
│   │   ├── export/
│   │   ├── grader/
│   │   ├── set-completion/
│   │   ├── tags/
│   │   └── tournaments/
│   └── ui/                       # UI components
├── styles/                       # CSS (tokenized, modular)
├── tests/                        # Vitest tests
└── [config files]
```

### What's Good

| Aspect | Grade | Why |
|--------|-------|-----|
| **Adapter pattern** | A | `CollectionAdapter` base class + registry = textbook Strategy pattern |
| **Event bus** | A | Prevents circular deps, enables loose coupling |
| **Lazy loading** | A | Heavy features code-split, loaded on first use |
| **CSS architecture** | A- | Design tokens, logical module split, responsive last |
| **API layer** | B+ | Clean serverless functions with proper secret isolation |
| **Test structure** | B | Tests mirror src structure (good), but coverage is thin |
| **Embed widget** | B | Exists and works, but too thin for real integration |

---

## 2. The Critical Problem: The Adapter Pattern Is Bypassed

This is the single biggest issue. You built a beautiful adapter system (`CollectionAdapter` → `BobaAdapter` → `registry.js`), but **the core scanner doesn't use it**:

```js
// scanner.js — line 15
import { getAthleteForHero } from '../../collections/boba/heroes.js';

// scanner.js — line 610
athlete: getAthleteForHero(match.Name) || '',
```

```js
// collections.js — line 12
import { getAthleteForHero } from '../../collections/boba/heroes.js';
```

```js
// ebay.js — line 45
parts.push('bo jackson battle arena');  // hardcoded
```

```js
// database.js — line 15
const IDB_NAME = 'boba-scanner';  // hardcoded
```

**The adapter exists, but the app still reaches around it.** If you added a Pokemon adapter tomorrow, the scanner would still call `getAthleteForHero()` on Pokemon cards.

---

## 3. What World-Class Looks Like

Here's what best-in-class apps like TCGplayer, Pokellector, or Collectr use — mapped to your architecture:

### 3A. Package/SDK Structure (for Integration)

World-class apps that want to be embedded in other apps (like Bazooka Vault) ship a **proper SDK package**, not just a widget file:

```
BOBA-Scanner/
├── packages/                          # ← NEW: Monorepo packages
│   ├── scanner-core/                  # Pure scanning engine (no UI)
│   │   ├── src/
│   │   │   ├── index.ts              # Public API
│   │   │   ├── pipeline.ts           # Scan pipeline
│   │   │   ├── ocr.ts               # OCR engine
│   │   │   ├── ai-client.ts         # AI identification
│   │   │   └── types.ts             # Shared types/interfaces
│   │   ├── package.json              # "@boba/scanner-core"
│   │   └── tsconfig.json
│   ├── scanner-ui/                    # UI components (optional)
│   │   ├── src/
│   │   │   ├── widget.ts
│   │   │   ├── scan-button.ts
│   │   │   └── result-card.ts
│   │   └── package.json              # "@boba/scanner-ui"
│   └── collection-adapters/           # Collection definitions
│       ├── src/
│       │   ├── boba/
│       │   ├── pokemon/               # Future collections
│       │   └── index.ts
│       └── package.json              # "@boba/adapters"
├── apps/
│   └── web/                           # The current BOBA Scanner app
│       ├── src/
│       ├── api/
│       └── package.json
```

**Why this matters for Bazooka Vault**: Right now, Bazooka Vault would have to either:
1. Use the thin `widget.js` (which duplicates image compression logic and doesn't share the OCR/database pipeline)
2. Or iframe the whole BOBA Scanner app

With a proper SDK, Bazooka Vault does:
```js
import { createScanner } from '@boba/scanner-core';
import { BobaAdapter } from '@boba/adapters/boba';

const scanner = createScanner({ adapter: new BobaAdapter() });
const card = await scanner.identify(imageFile);
// card = { cardNumber: "BLBF-84", hero: "Action", ... }
```

### 3B. Adapter-First Architecture

Every piece of collection-specific logic should flow through the adapter:

```
Current (broken flow):
  scanner.js → getAthleteForHero() → boba/heroes.js  ❌ (bypasses adapter)
  ebay.js → "bo jackson battle arena"                  ❌ (hardcoded)
  database.js → IDB_NAME = 'boba-scanner'             ❌ (hardcoded)

World-class (adapter-first):
  scanner.js → getActiveAdapter().resolveMetadata()    ✅
  ebay.js → getActiveAdapter().buildEbayQuery()        ✅ (already defined!)
  database.js → getActiveAdapter().databaseUrl         ✅ (already defined!)
```

### 3C. Collection-Scoped Data

Right now, all collections share one card database and one IndexedDB:

```js
const IDB_NAME = 'boba-scanner';  // Everything goes here
```

World-class would scope data per collection type:

```
IndexedDB:
  boba-scanner-boba/        # BOBA cards
  boba-scanner-pokemon/     # Pokemon cards (future)
  boba-scanner-magic/       # Magic cards (future)

Or:
  boba-scanner/
    ├── store: boba
    ├── store: pokemon
    └── store: magic
```

### 3D. Type Safety (Optional but High-Impact)

World-class scanning apps use TypeScript for the core engine. Not necessarily the whole app, but at least:
- `CollectionAdapter` interface
- Card data types per collection
- Scanner pipeline types
- Public SDK API types

This makes integration dramatically easier because Bazooka Vault gets autocomplete and type checking.

---

## 4. Will This Structure Support Bazooka Vault Integration?

### Current State: Partially

**What works today:**
- `widget.js` exists and provides a `createScanner()` API
- It accepts `collectionType` and `apiEndpoint` options
- It has a clean `scan()` / `destroy()` lifecycle

**What's missing for real integration:**

| Gap | Impact |
|-----|--------|
| Widget doesn't use the adapter system | Bazooka Vault can't leverage BOBA-specific logic |
| Widget duplicates image compression | Bug fixes need to be applied in two places |
| No typed event contract | Bazooka Vault doesn't know what fields come back in `onCardScanned` |
| No headless mode | Widget always renders UI; Vault may want its own UI |
| No authentication pass-through | Widget can't share Vault's auth session |
| No offline/cached database | Widget fetches database every time |
| Widget CSS uses `.boba-scanner-*` prefixes | Hardcoded to BOBA brand |

### What Bazooka Vault Actually Needs

```js
// Headless scanning (no UI)
import { Scanner } from '@boba/scanner-core';

const scanner = new Scanner({
  adapter: 'boba',
  apiKey: vaultUser.scannerApiKey,  // auth pass-through
  database: cachedDatabase,          // pre-loaded
});

scanner.on('card:identified', (card) => {
  vault.collection.add(card);
});

scanner.on('card:uncertain', (candidates) => {
  vault.ui.showPicker(candidates);
});

const result = await scanner.scan(file);
```

---

## 5. Will This Structure Support New Collections?

### Current State: Almost

**The adapter pattern gets you 80% there.** Here's what happens when you try to add a new collection:

#### Step 1: Create the adapter (Easy)
```
src/collections/pokemon/
├── pokemon-adapter.js     # extends CollectionAdapter ✅
├── pokemon-types.js       # metadata lookup (like heroes.js) ✅
└── pokemon-database.json  # card database ✅
```

#### Step 2: Wire it up (Breaks)

You'd register the adapter, but then hit these blockers:

| File | Problem | Fix Needed |
|------|---------|------------|
| `scanner.js:15` | `import { getAthleteForHero }` — hardcoded BOBA import | Use `getActiveAdapter().resolveMetadata()` |
| `scanner.js:610` | `getAthleteForHero(match.Name)` — hardcoded call | Use adapter method |
| `collections.js:12` | `import { getAthleteForHero }` — hardcoded BOBA import | Use adapter method |
| `collections.js:85` | Athlete backfill assumes BOBA | Make backfill adapter-aware |
| `ebay.js:45` | `"bo jackson battle arena"` hardcoded | Use `getActiveAdapter().buildEbayQuery()` |
| `database.js:15` | `IDB_NAME = 'boba-scanner'` | Scope per collection type |
| `ocr.js:50` | "bottom-left" card number location assumed | Move to adapter config |
| `config.js` | All scan settings BOBA-specific | Make settings per-adapter |
| `sync.js:481` | "Scan your first Bo Jackson card" | Use adapter `displayName` |

#### Step 3: Multi-collection UI (Not Built)

No UI exists to:
- Switch between collection types
- Show which adapter is active
- Load different databases per collection type
- Display adapter-specific field definitions in cards-grid

---

## 6. Recommended World-Class File Structure

Here's the target architecture that solves all three requirements (best-in-class, integrable, growable):

```
BOBA-Scanner/
│
├── src/
│   ├── main.js                        # App entry point
│   ├── app.js                         # App orchestration
│   │
│   ├── core/                          # ═══ GENERIC ENGINE ═══
│   │   ├── scanner/
│   │   │   ├── pipeline.js            # Scan pipeline (adapter-driven)
│   │   │   ├── image-processing.js    # Crop, compress (generic)
│   │   │   ├── batch-scanner.js
│   │   │   ├── binder-scanner.js
│   │   │   └── continuous-scanner.js
│   │   ├── ocr/
│   │   │   ├── ocr-manager.js         # OCR orchestration
│   │   │   ├── ocr-worker.js          # Web worker
│   │   │   └── ocr.js                 # Tesseract wrapper
│   │   ├── ai/
│   │   │   └── identifier.js          # AI card ID (uses adapter.getAIPrompt())
│   │   ├── database/
│   │   │   ├── database.js            # Generic DB (scoped per adapter)
│   │   │   └── scan-learning.js       # OCR correction learning
│   │   ├── collection/
│   │   │   ├── collection-manager.js  # CRUD (adapter-aware)
│   │   │   ├── scan-history.js
│   │   │   └── statistics.js
│   │   ├── auth/
│   │   │   ├── auth-provider.js       # Generic auth interface
│   │   │   └── google-auth.js         # Google implementation
│   │   ├── sync/
│   │   │   ├── sync-engine.js         # Generic sync
│   │   │   └── image-storage.js
│   │   ├── state.js                   # Global state
│   │   ├── event-bus.js               # Pub/sub
│   │   └── config.js                  # Settings (per-adapter sections)
│   │
│   ├── collections/                   # ═══ COLLECTION ADAPTERS ═══
│   │   ├── adapter.js                 # Base class (keep as-is)
│   │   ├── registry.js                # Registry (keep as-is)
│   │   ├── boba/
│   │   │   ├── boba-adapter.js        # BOBA implementation
│   │   │   ├── heroes.js              # Hero → Athlete lookup
│   │   │   └── boba-database.json     # Card data (moved from root)
│   │   └── [future-collection]/       # Drop-in new collections
│   │       ├── [name]-adapter.js
│   │       ├── [name]-metadata.js
│   │       └── [name]-database.json
│   │
│   ├── sdk/                           # ═══ INTEGRATION SDK ═══
│   │   ├── index.js                   # Public API surface
│   │   ├── scanner-client.js          # Headless scanner for embedding
│   │   ├── widget.js                  # UI widget (uses scanner-client)
│   │   ├── widget.css
│   │   └── types.js                   # JSDoc type definitions
│   │
│   ├── features/                      # ═══ APP FEATURES ═══
│   │   ├── marketplace/               # Renamed from "ebay" (could support more)
│   │   │   ├── marketplace.js         # Generic marketplace (adapter-driven queries)
│   │   │   ├── ebay-provider.js       # eBay-specific implementation
│   │   │   ├── price-trends.js
│   │   │   └── seller-monitor.js
│   │   ├── grader/
│   │   ├── deck-builder/
│   │   ├── export/
│   │   ├── set-completion/
│   │   ├── tags/
│   │   ├── tournaments/
│   │   └── admin/
│   │
│   └── ui/                            # ═══ UI LAYER ═══
│       ├── components/                # Reusable components
│       │   ├── card-grid.js
│       │   ├── card-detail.js
│       │   ├── scan-result-sheet.js
│       │   └── ...
│       ├── layouts/                   # Page layouts
│       │   ├── bottom-nav.js
│       │   └── stats-strip.js
│       ├── shared/                    # Utilities
│       │   ├── toast.js
│       │   ├── utils.js
│       │   └── themes.js
│       └── onboarding/
│           ├── onboarding.js
│           └── ios-install-prompt.js
│
├── api/                               # Serverless functions (unchanged)
├── styles/                            # CSS modules (unchanged)
├── tests/                             # Tests (mirror src/)
│   ├── core/
│   ├── collections/
│   ├── sdk/
│   └── features/
└── [config files]
```

---

## 7. Priority Refactors (Ordered by Impact)

These are the changes that would move you from 70% to 95%, ranked by what unlocks the most value:

### P0 — Must Do (Blocks Everything Else)

**1. Make scanner.js adapter-aware** (~30 min)
Remove the direct `getAthleteForHero` import. Replace with:
```js
import { getActiveAdapter } from '../../collections/registry.js';

// Instead of: getAthleteForHero(match.Name)
// Use: getActiveAdapter().resolveMetadata(match)
```

**2. Make collections.js adapter-aware** (~15 min)
Same fix — remove BOBA import, use adapter.

**3. Make ebay.js adapter-aware** (~15 min)
Replace hardcoded "bo jackson battle arena" with:
```js
const query = getActiveAdapter().buildEbayQuery(card);
```

### P1 — High Value (Enables Growth)

**4. Scope database per adapter** (~30 min)
Use `getActiveAdapter().id` to namespace IndexedDB stores.

**5. Add collection-type picker UI** (~1 hour)
Dropdown in settings or onboarding to select active collection type.

**6. Move card-database.json into collection folder** (~10 min)
`src/collections/boba/boba-database.json` — each collection brings its own data.

### P2 — Integration Quality (Enables Bazooka Vault)

**7. Build headless scanner-client** (~2 hours)
Extract the scan pipeline into a standalone module that doesn't need the DOM, event bus, or global state. This is what Bazooka Vault imports.

**8. Define typed card interface** (~30 min)
JSDoc types for the card object so integrators know exactly what they get back.

**9. Add scanner events contract** (~30 min)
Documented events: `scan:start`, `scan:ocr`, `scan:ai`, `scan:match`, `scan:fail`, `scan:complete` with typed payloads.

### P3 — Polish (World-Class)

**10. Rename `features/ebay/` → `features/marketplace/`** (~15 min)
Could support StockX, COMC, or other marketplaces in the future.

**11. Reorganize UI into components/layouts/shared** (~1 hour)
Currently flat — 15 files at the same level. Grouping improves discoverability.

**12. Add adapter-level config sections** (~30 min)
Each adapter can define its own scan settings (region, threshold, quality).

---

## 8. Comparison: You vs. Best-in-Class

| Dimension | You Today | Best-in-Class | Gap |
|-----------|-----------|---------------|-----|
| **Separation of concerns** | Strong | Strong | Minimal |
| **Adapter/plugin system** | Built, not wired | Fully wired, all logic flows through adapters | **Medium** |
| **Embeddable SDK** | Thin widget | Headless core + UI widget + typed API | **Large** |
| **Multi-collection support** | Architecture ready, implementation isn't | Drop-in adapters, scoped databases, collection picker | **Medium** |
| **Type safety** | None | TypeScript or comprehensive JSDoc | **Medium** |
| **Test coverage** | 7 test files | Core pipeline + adapters + integration tests | **Medium** |
| **CSS architecture** | Excellent (tokens + modules) | Same approach | None |
| **Build/deploy** | Vite + Vercel (solid) | Same + package publishing for SDK | **Small** |
| **Event-driven architecture** | Good event bus | Same + typed event contracts | **Small** |
| **Code splitting** | Lazy features (good) | Same + per-adapter code splitting | **Small** |

---

## 9. Bottom Line

### Is this the best setup?
**No, but it's close.** The architecture is right — you just need to finish wiring the adapter pattern through the entire codebase. The three hardcoded BOBA imports in core files (`scanner.js`, `collections.js`, `ebay.js`) are the main thing holding you back.

### Will it integrate with Bazooka Vault?
**Not well yet.** The `widget.js` is a good start but it's a toy compared to what Vault would need. You need a headless scanner-client that shares the full pipeline (OCR → AI → database) without requiring the DOM or global state.

### Will it support new collections?
**Almost.** The adapter pattern is 90% of the solution. Fix the three bypassed files, scope the database per adapter, and you can add a new collection by dropping a folder into `src/collections/`. That's world-class.

### What's the single most impactful change?
**Make `scanner.js` use `getActiveAdapter()` instead of importing BOBA directly.** This one change unlocks multi-collection support across the entire scan pipeline.
