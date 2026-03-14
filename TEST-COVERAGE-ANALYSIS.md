# Test Coverage Analysis — BOBA Scanner

**Date:** 2026-03-14
**Tests:** 35 passing across 3 test files
**Estimated module coverage:** ~8% (3 of ~39 library modules)

---

## Current Test Coverage

| Test File | Module Under Test | Tests | What's Covered |
|---|---|---|---|
| `tests/ocr-extract.test.ts` | `src/lib/utils/extract-card-number.ts` | 11 | Card number parsing, OCR confusable correction, dash normalization |
| `tests/rate-limit.test.ts` | `src/lib/server/rate-limit.ts` | 6 | In-memory fallback rate limiter (per-user buckets, limits, reset times) |
| `tests/card-db.test.ts` | `src/lib/services/card-db.ts` | 18 | Card loading, exact/fuzzy match, search, case-insensitive lookups |

**No coverage configuration** — no `--coverage` flag, no coverage packages installed, no CI coverage gates.

---

## Recommended Improvements (Priority Order)

### 1. Utility Functions (`src/lib/utils/index.ts`) — Easy Win

**Why:** Pure functions, zero dependencies, trivial to test. Currently 0% tested despite being used across the app.

**What to test:**
- `escapeHtml()` — XSS-relevant: verify all 5 characters are escaped, empty/null input handling
- `formatPrice()` — null/undefined returns "N/A", numbers formatted with 2 decimals, negative values
- `truncate()` — strings at/below/above max length, ellipsis character used correctly
- `debounce()` — calls delayed, last call wins, timer reset behavior (use `vi.useFakeTimers()`)

**Effort:** ~30 min, ~12 tests

---

### 2. API Route: `/api/scan` (`src/routes/api/scan/+server.ts`) — High Value

**Why:** This is the most expensive endpoint (Claude API calls cost money). Testing guards against regressions in auth checks, rate limiting, image validation, and response parsing — all of which directly impact cost and security.

**What to test:**
- Returns 401 when unauthenticated
- Returns 429 when rate limited (with correct headers)
- Returns 400 for missing image, oversized image, invalid image type
- Pixel bomb protection triggers for oversized dimensions
- Claude response JSON extraction (valid JSON, no JSON, malformed JSON)
- Handles Claude API errors (529 → 503, generic → 502)
- Happy path: valid image → success response with card data

**Mocking strategy:** Mock `@anthropic-ai/sdk`, `sharp`, `$lib/server/rate-limit`, and `locals` (Supabase session/user). Use `vi.mock()`.

**Effort:** ~2 hours, ~12-15 tests

---

### 3. Recognition Pipeline Logic (`src/lib/services/recognition.ts`) — Core Business Logic

**Why:** This is the heart of the app — the three-tier waterfall. A bug here means wrong cards identified or unnecessary API costs.

**What to test (unit-testable pieces, mocking workers/fetch):**
- Blurry image returns early with `failReason`
- Tier 1 hit: IDB hash match returns immediately without calling Tier 2/3
- Tier 1 hit: Supabase hash match returns and writes back to IDB
- Tier 1 miss falls through to Tier 3 (Tier 2 is currently disabled)
- Unauthenticated user skips Tier 3 with "Sign in" message
- Tier 3 network error returns null with appropriate `failReason`
- Tier 3 HTTP errors (401, 429, 503) set correct `failReason`
- Tier 3 success: card matched in local DB, hash written to cache
- Tier 3 success with hero mismatch: confidence reduced
- Tier 3 success but card not in local DB: returns null
- `onTierChange` callback fires at correct transitions
- `finalize()` records scan history and auto-tags parallel cards

**Mocking strategy:** Mock `comlink` worker, `idb`, `card-db`, `supabase`, and `fetch`.

**Effort:** ~3 hours, ~15-20 tests

---

### 4. API Route: `/api/grade` (`src/routes/api/grade/+server.ts`) — Medium Value

**Why:** Another Claude API-consuming endpoint. Same auth/rate-limit/validation pattern as scan, but with grading-specific logic.

**What to test:**
- Auth and rate limit enforcement
- Image validation and CDR processing
- Grading prompt construction
- Response parsing (grade extraction, condition mapping)
- Error handling for Claude API failures

**Effort:** ~1.5 hours, ~10 tests

---

### 5. IndexedDB Service (`src/lib/services/idb.ts`) — Data Integrity

**Why:** This is the offline data layer. Bugs here mean lost collections or broken hash cache.

**What to test:**
- `getHash()` / `setHash()` — round-trip storage and retrieval
- `getCards()` / `setCards()` — bulk card storage
- `getCollection()` / `setCollection()` — collection CRUD
- Error handling when IndexedDB is unavailable
- Data migration between schema versions

**Mocking strategy:** Use `fake-indexeddb` package for a pure JS IDB implementation.

**Effort:** ~1.5 hours, ~12 tests

---

### 6. Collection Sync (`src/lib/services/sync.ts`) — Data Consistency

**Why:** Syncs between IDB and Supabase. Bugs cause duplicate cards or data loss.

**What to test:**
- Sync from IDB to Supabase (upload)
- Sync from Supabase to IDB (download)
- Conflict resolution (which copy wins)
- Graceful handling when Supabase is unavailable
- Partial sync failure recovery

**Effort:** ~2 hours, ~10 tests

---

### 7. Scan Learning (`src/lib/services/scan-learning.ts`) — Accuracy Over Time

**Why:** Correction tracking improves scan accuracy. If broken, the system never learns from mistakes.

**What to test:**
- `recordCorrection()` stores OCR→correct mappings
- `checkCorrection()` returns learned corrections
- Corrections persist across sessions (IDB storage)
- Edge cases: same OCR text corrected to different cards

**Effort:** ~45 min, ~6-8 tests

---

### 8. eBay Auth (`src/lib/server/ebay-auth.ts`) — Token Management

**Why:** Token refresh bugs silently break all pricing features.

**What to test:**
- Token acquisition with valid credentials
- Token caching (doesn't re-fetch within TTL)
- Token refresh on expiry
- Error handling when eBay API is down
- Missing credentials handling

**Effort:** ~1 hour, ~6-8 tests

---

## Infrastructure Recommendations

### Enable Coverage Reporting

Add coverage to `vitest` so the team can track progress:

```bash
# Install coverage provider
npm i -D @vitest/coverage-v8

# Run with coverage
npx vitest run --coverage
```

Add to `package.json`:
```json
{
  "scripts": {
    "test:coverage": "vitest run --coverage"
  }
}
```

### Add Coverage Gate to CI

In `.github/workflows/ci.yml`, replace `npm test` with a coverage threshold:

```yaml
- run: npm run test:coverage
  env:
    COVERAGE_THRESHOLD: 30
```

Start with a low threshold (30%) and ratchet it up as coverage improves.

### Prioritized Roadmap

| Phase | Target | Tests to Add | Cumulative Coverage |
|---|---|---|---|
| **Now** | Utilities + scan API route | ~25 tests | ~15% |
| **Next** | Recognition pipeline + grade API | ~25 tests | ~30% |
| **Later** | IDB, sync, scan-learning, eBay auth | ~35 tests | ~50% |

---

## What NOT to Test (Low ROI)

- **Svelte components** — UI tests are brittle and the app is mobile-first (manual QA is more effective)
- **Web Workers** (`image-processor.ts`, `ocr-worker.js`) — require browser APIs (Canvas, ImageBitmap), better tested via integration/E2E
- **Stores** — thin wrappers around Svelte 5 runes; test the services they call instead
- **`boba-config.ts` / `boba-heroes.ts`** — static data files, not logic
- **`static-cards.ts`** — simple mapping, already indirectly tested via `card-db.test.ts`
