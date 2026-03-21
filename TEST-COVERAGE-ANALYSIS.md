# Test Coverage Analysis — BOBA Scanner

**Date:** 2026-03-21
**Tests:** ~101 cases across 9 test files
**Estimated module coverage:** ~30% (9 of ~30+ significant modules)

---

## Current Test Coverage

| Test File | Module Under Test | Cases | Type |
|---|---|---|---|
| `ocr-extract.test.ts` | `extract-card-number.ts` | 12 | Unit |
| `rate-limit.test.ts` | `rate-limit.ts` | 7 | Unit |
| `card-db.test.ts` | `card-db.ts` | 15 | Unit |
| `api-config.integration.test.ts` | `GET /api/config` | 3 | Integration |
| `api-price.integration.test.ts` | `GET /api/price/[cardId]` | 8 | Integration |
| `api-scan.integration.test.ts` | `POST /api/scan` | 15 | Integration |
| `api-grade.integration.test.ts` | `POST /api/grade` | 12 | Integration |
| `auth-guard.e2e.test.ts` | `hooks.server.ts` | 13 | E2E |
| `recognition-pipeline.e2e.test.ts` | `recognition.ts` | 16 | E2E |

### What's Well Covered

- **API endpoints**: 4 of 6 main routes have integration tests (scan, grade, price, config)
- **Core pipeline**: The 3-tier recognition pipeline has end-to-end tests including tier progression callbacks
- **Auth**: 8 protected routes verified, graceful degradation when Supabase is unconfigured
- **Input validation & security**: File size limits, MIME type checks, path traversal rejection, private key leakage prevention
- **Rate limiting**: In-memory fallback, per-user isolation, remaining count tracking

### What's Not Covered

- **No coverage tooling** — no `--coverage` flag, no coverage packages installed, no CI coverage gates
- **No store tests** — all 9 Svelte stores are untested
- **No utility tests** — `escapeHtml`, `formatPrice`, `debounce`, `truncate` in `utils/index.ts`
- **No data integrity tests** — sync, IDB, and collection-service are all untested
- **No business logic tests** — deck-validator (383 LOC of tournament rules) has zero tests
- **No edge middleware tests** — bot-blocking regex logic untested

---

## Coverage Gaps — Prioritized Recommendations

### Priority 1: Critical Business Logic (Data Integrity / Correctness Risk)

#### 1. `deck-validator.ts` (~383 LOC) — Tournament rule engine

The most complex pure-logic module in the codebase, enforcing legality across 6 tournament formats. A validation bug could allow illegal decks or reject valid ones.

**Recommended tests (~20 cases):**
- Hero count enforcement (exactly 60)
- SPEC Power cap (no card > 160 in SPEC format)
- Combined Power cap (sum ≤ 8,250 in Elite format)
- Max 6 heroes at same power level
- Unique variation enforcement (hero + weapon + parallel)
- All 30 Plays must be unique; no duplicate Plays
- Hot Dog cards: 10 allowed, duplicates OK
- DBS budget (total ≤ 1,000)
- Apex Madness insert-unlock logic (10+ of a type → 1 Apex card)
- Edge cases: exactly at limit, one over, empty deck, no-cap format (Apex Playmaker)

**Testability:** Excellent — pure functions, no external dependencies.

#### 2. `sync.ts` (~162 LOC) — Bidirectional IDB ↔ Supabase sync

Race conditions here cause data loss. Uses promise-based locking and debounced push.

**Recommended tests (~10 cases):**
- Sync lock prevents concurrent syncs
- Debounced push batches rapid writes
- Tombstone-based deletions propagate correctly
- Offline queue drains when connectivity returns
- Error during sync doesn't corrupt local state
- Graceful handling when Supabase is unavailable

**Testability:** Good — mock IDB and Supabase client.

#### 3. `idb.ts` (~239 LOC) — IndexedDB offline storage layer

All offline caching depends on this. Silent transaction failures could corrupt cached data.

**Recommended tests (~12 cases, use `fake-indexeddb`):**
- CRUD for each object store (cards, hashes, collections, prices)
- Bulk operations (putMany, getAll)
- TTL-aware reads (expired entries excluded)
- Schema upgrade/versioning
- Error handling (doesn't corrupt store on failure)

**Testability:** Good with `fake-indexeddb` package.

#### 4. `collection-service.ts` (~130 LOC) — Collection data layer

Every collection mutation flows through this. Handles Supabase + IDB fallback.

**Recommended tests (~8 cases):**
- Add card (Supabase path and IDB fallback path)
- Update quantity
- Delete with tombstone recording
- Fetch with card join
- Graceful fallback when Supabase is unavailable

**Testability:** Good — mock Supabase and IDB.

### Priority 2: Security & Core Utilities

#### 5. `src/lib/utils/index.ts` (~50 LOC) — Shared utilities

Contains `escapeHtml` (XSS prevention — security critical), `formatPrice`, `debounce`, `truncate`.

**Recommended tests (~12 cases):**
- `escapeHtml`: `<script>`, event handlers, nested entities, null/undefined
- `formatPrice`: zero, negative, large numbers, null → "N/A"
- `debounce`: rapid calls invoke once, trailing execution (`vi.useFakeTimers()`)
- `truncate`: at/below/above limit, ellipsis behavior

**Testability:** Excellent — pure functions.

#### 6. `middleware.js` (~118 LOC) — Bot/scraper blocking

A regex bug could block real users or let bots through. Runs at the edge on every request.

**Recommended tests (~8 cases):**
- Known bot User-Agents blocked (Googlebot, curl, etc.)
- Normal browser User-Agents pass through
- Missing User-Agent handling
- Header-based detection (X-Forwarded-For anomalies, etc.)

**Testability:** Good — export the handler function and test with mock Request objects.

#### 7. `POST /api/upload` (~88 LOC) — Image upload with CDR

Untested upload endpoint is a security concern (EXIF data leakage, pixel bombs).

**Recommended tests (~6 cases):**
- EXIF stripping verified
- Pixel bomb rejection (oversized dimensions)
- Valid image re-encoding
- File size limits enforced
- Invalid file type rejected

**Testability:** Medium — requires sharp mocking (same pattern as scan tests).

### Priority 3: Feature Quality

#### 8. `scan-learning.ts` (~130 LOC) — OCR correction tracking

LRU-pruned correction map. Bad corrections degrade scan accuracy over time.

**Recommended tests (~8 cases):**
- Store and retrieve corrections
- LRU pruning at 500 entries (oldest evicted)
- Validation against card DB (rejects invalid corrections)
- Key normalization

**Testability:** Good — mock localStorage and card-db.

#### 9. `export-templates.ts` (~220 LOC) — CSV export

Export bugs corrupt user data exports.

**Recommended tests (~8 cases):**
- CSV escaping (commas, quotes, newlines in field values)
- Template CRUD (localStorage)
- Admin template merging
- Empty collection export

**Testability:** Good — pure CSV logic + mock localStorage.

#### 10. `ebay.ts` (~157 LOC) — Client-side eBay utilities

URL building, listing match scoring, price calculation.

**Recommended tests (~6 cases):**
- Search URL generation with affiliate params
- Listing match scoring (exact, partial, no match)
- Price calculation from listings

**Testability:** Excellent — pure functions.

#### 11. `ebay/browse/+server.ts` (~162 LOC) — eBay Browse API proxy

Price aggregation and filtering logic.

**Recommended tests (~6 cases):**
- Price stats calculation (low, mid, high)
- Empty results handling
- Auth token refresh on 401

**Testability:** Medium — mock eBay auth and fetch.

### Priority 4: Nice to Have

- **Stores** — Test the pure logic inside `collection.ts` (per-card locking), `feature-flags.ts` (flag evaluation), `scan-history.ts` (stats calculation)
- **`error-tracking.ts`** — Event batching, sendBeacon flushing
- **`version.ts`** — Version comparison, polling interval
- **`parallel-config.ts`** — Cache invalidation, fallback logic
- **`listing-generator.ts`** — Title/description formatting

---

## Infrastructure Recommendations

### 1. Enable Coverage Reporting

```bash
npm i -D @vitest/coverage-v8
```

Add to `package.json`:
```json
{
  "scripts": {
    "test:coverage": "vitest run --coverage"
  }
}
```

### 2. Add Coverage Gate to CI

In `.github/workflows/ci.yml`:
```yaml
- run: npx vitest run --coverage --coverage.thresholds.lines=30
```

Start at 30% and ratchet up as tests are added.

### 3. Coverage Targets

| Metric | Current (est.) | 3-Month Target | 6-Month Target |
|--------|---------------|----------------|----------------|
| Lines | ~15% | 40% | 60% |
| Branches | ~10% | 35% | 50% |
| Functions | ~20% | 45% | 65% |

---

## Implementation Roadmap

| Phase | Modules | Est. New Tests | Cumulative Coverage |
|---|---|---|---|
| **Phase 1** | deck-validator, utils | ~32 | ~25% |
| **Phase 2** | sync, idb, collection-service | ~30 | ~40% |
| **Phase 3** | middleware, upload API, scan-learning | ~22 | ~50% |
| **Phase 4** | export-templates, ebay client, ebay browse API | ~20 | ~55% |
| **Phase 5** | stores (pure logic), remaining services | ~15 | ~60% |

**Total estimated effort:** ~119 new test cases across 5 phases.

---

## What NOT to Test (Low ROI)

- **Svelte components** — UI tests are brittle for a mobile-first PWA; manual QA and E2E (Playwright) are more effective
- **Web Workers** (`image-processor.js`, `ocr-worker.js`) — require Canvas/ImageBitmap browser APIs; better tested via the recognition pipeline E2E tests that already exist
- **Static data files** (`boba-config.ts`, `boba-heroes.ts`, `card-database.json`) — configuration, not logic
- **`static-cards.ts`** — simple JSON mapping, indirectly tested via `card-db.test.ts`
- **`supabase.ts`** — thin client initialization; tested implicitly by all integration tests
