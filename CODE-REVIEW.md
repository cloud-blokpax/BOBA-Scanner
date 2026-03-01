# BOBA-Scanner Code Review & Recommendations

**Date:** 2026-03-01
**Reviewer:** Claude (AI Code Review)
**Scope:** Full codebase — security, architecture, performance, reliability

---

## Executive Summary

BOBA-Scanner is a well-architected card scanning application with a smart hybrid OCR + AI approach that minimizes API costs. The codebase shows strong defensive patterns: `escapeHtml()` is used consistently, API secrets are kept server-side, and the sync layer handles conflicts gracefully. That said, there are several areas where targeted improvements would significantly improve security, maintainability, and production reliability.

**Overall Assessment:** Production-ready with caveats. The issues below range from quick wins to longer-term architectural improvements.

---

## CRITICAL — Fix These First

### 1. Client-Controlled Prompt Sent Directly to Claude API

**File:** `api/anthropic.js:80-83`
**Severity:** Critical
**Issue:** The `prompt` field is accepted directly from the client request body and forwarded verbatim to the Claude API. An attacker can inject arbitrary prompts, use the API key as an unrestricted Claude proxy, or extract system-level information.

```js
// Current — client controls the full prompt
const { imageData, image, prompt } = req.body;
// ...
if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
const cardPrompt = prompt;
```

**Recommendation:** Hardcode the prompt on the server or use a whitelist of allowed prompt templates. The client should only send the image.

```js
// Fixed — server-controlled prompt
const cardPrompt = `Identify this Bo Jackson trading card. Return JSON with:
  cardNumber, hero, set, year, parallel, confidence (0-100).
  If not a Bo Jackson card, return {"error": "not_a_card"}.`;
```

---

### 2. No Authentication on the Anthropic API Proxy

**File:** `api/anthropic.js:44-61`
**Severity:** Critical
**Issue:** The `/api/anthropic` endpoint has no authentication — anyone who discovers the URL can use it to make Claude API calls at the project's expense. The `BOBA_API_SECRET` token check exists on `/api/ebay-browse` but is absent from the Anthropic endpoint.

**Recommendation:** Add the same `X-Api-Token` check used in `ebay-browse.js`:

```js
const expectedToken = process.env.BOBA_API_SECRET;
if (expectedToken && req.headers['x-api-token'] !== expectedToken) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

---

### 3. Rate Limiting Fails Open by Design

**File:** `api/anthropic.js:8-42`
**Severity:** High
**Issue:** The `checkRateLimit()` function returns `true` (allow) on every error path — if Supabase is down, misconfigured, or rate_limits table doesn't exist, all requests pass through with zero throttling. Combined with issue #2, this means an unauthenticated attacker can burn through the API key if Supabase has an outage.

**Recommendation:**
- Add the API token authentication (issue #2) as the primary gate
- Consider an in-memory fallback counter when Supabase is unreachable
- Log when rate limiting is bypassed so you can detect abuse

---

### 4. CSP Only Applies to the Root Path

**File:** `vercel.json:33-40`
**Severity:** High
**Issue:** The Content-Security-Policy header only matches `"source": "/"` — it does NOT apply to `/index.html`, sub-paths, or deep links. If a user navigates directly to a sub-route, they get no CSP protection.

**Recommendation:** Change the source to `"/(.*)"` to cover all routes, or add CSP to both `/` and `/index.html`:

```json
{
  "source": "/(.*)",
  "headers": [
    { "key": "Content-Security-Policy", "value": "..." },
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "X-Frame-Options", "value": "DENY" }
  ]
}
```

---

## HIGH — Address Soon

### 5. All 29 JS Files Share a Single Global Scope

**Files:** `index.html:389-417`, all `js/*.js`
**Severity:** High (maintainability)
**Issue:** Every file is loaded via `<script src>` tags with no module isolation. All 29 files dump functions and variables into the global `window` scope. This creates:
- **Name collision risk** — any file can accidentally overwrite another's function
- **Implicit dependency chains** — 111 `typeof x === 'function'` guards used as a substitute for proper imports
- **No tree-shaking** — the browser loads all 9,700+ lines even for pages that only need a subset

**Recommendation (incremental migration):**
1. Add `type="module"` to script tags one file at a time
2. Convert globals to explicit `export`/`import`
3. Start with leaf modules (config.js, state.js, heroes.js) that have no downstream dependents

---

### 6. Inline Styles in index.html

**File:** `index.html:124-226`
**Severity:** Medium
**Issue:** The collection slider and deck builder button use extensive inline `style=""` attributes (~100 lines of CSS-in-HTML). This:
- Bypasses the CSP `style-src` policy (since `'unsafe-inline'` is already allowed)
- Makes styling inconsistent — some components are in `styles.css`, others inline
- Makes theming harder since inline styles override CSS custom properties

**Recommendation:** Move these styles to `styles.css` using class names.

---

### 7. `user_scalable=no` Disables Accessibility Zoom

**File:** `index.html:5`
**Severity:** Medium (accessibility)

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
```

**Issue:** This prevents users with low vision from zooming in. This is an accessibility violation (WCAG 1.4.4 Resize Text). Some mobile browsers ignore it, but Safari still enforces it.

**Recommendation:** Remove `maximum-scale=1.0, user-scalable=no`. If you need to prevent zoom on form inputs (the common reason), use `font-size: 16px` on inputs instead.

---

### 8. Duplicate ID in HTML

**File:** `index.html:279`
**Severity:** Low
**Issue:** The `<span>` element has two `id` attributes:

```html
<span id="collectionModalTitle" id="collectionModalTitleText">
```

The second `id` is silently ignored. The `aria-labelledby` references `collectionModalTitleText` which never becomes the element's actual ID.

**Recommendation:** Remove the duplicate and keep the one referenced by `aria-labelledby`.

---

## PERFORMANCE

### 9. Double Fetch of version.json During Database Load

**File:** `js/database.js:52-58, 82-85`
**Severity:** Low
**Issue:** `loadDatabase()` fetches `version.json` twice — once to check the cache, and again after a network fetch of the database to store the version. The second fetch is unnecessary since the result from the first is still in scope.

```js
// First fetch (line 53)
const vRes = await fetch('./version.json', { cache: 'no-store' });
// ... 30 lines later, same fetch again (line 83)
const vRes = await fetch('./version.json', { cache: 'no-store' });
```

**Recommendation:** Save `remoteVersion` from the first fetch and reuse it.

---

### 10. card-database.json is 176K Lines (~3.6 MB)

**File:** `card-database.json`
**Severity:** Medium
**Issue:** The entire 17,644-card database is loaded on every first visit (3.6 MB JSON). While IndexedDB caching helps on return visits, first-load and mobile users on slow connections will wait several seconds.

**Recommendations:**
- **Minify the JSON** — remove pretty-printing (newlines/indentation). This alone could cut size by 40-50%.
- **Enable gzip/brotli compression** on the Vercel deployment (likely already enabled, but verify).
- **Consider splitting** into smaller chunks loaded on demand (e.g., by year or set).

---

### 11. Blob URLs Not Revoked on OCR Success Path

**File:** `js/scanner.js:70, 100-112`
**Severity:** Low
**Issue:** When OCR successfully identifies a card (the free path), `displayUrl` created via `URL.createObjectURL()` is never revoked. The AI fallback paths correctly call `URL.revokeObjectURL(displayUrl)` on failure, but the success path leaks memory. Over a session with many scans, this accumulates.

**Recommendation:** Add `URL.revokeObjectURL(displayUrl)` in the card display/detail component when the image is replaced by a Supabase URL.

---

### 12. Levenshtein Runs on Every Prefix Within Edit Distance 1

**File:** `js/database.js:160-164`
**Severity:** Low
**Issue:** `findSimilarCardNumbers()` iterates all prefix index keys and runs `levenshteinDistance()` against each. With ~500+ unique 2-char prefixes, this is 500 Levenshtein calls per search. For 2-char strings this is fast, but it could be made O(1) by pre-computing adjacent prefixes.

**Recommendation:** This is a micro-optimization and fine as-is, but if you want to go further, pre-compute a `Map<prefix, Set<adjacentPrefixes>>` at index build time.

---

## RELIABILITY

### 13. Silent Swallowing of Errors in Empty Catch Blocks

**Files:** `database.js:47`, `database.js:58`, `api.js:38`, `scanner.js:75`
**Severity:** Medium
**Issue:** Several `catch {}` blocks (no variable, no logging) silently discard errors. While the intent is graceful degradation, it makes debugging production issues nearly impossible.

```js
try { idb = await openIDB(); } catch { /* IDB not available */ }
```

**Recommendation:** At minimum, log at `console.debug` level:

```js
try { idb = await openIDB(); } catch (e) { console.debug('IDB unavailable:', e.message); }
```

---

### 14. `processImage` Has an Empty `finally` Block

**File:** `js/scanner.js:75`
**Severity:** Low

```js
try {
    return await _doProcessImage(...);
} finally {}
```

This is a no-op. Remove it for clarity.

---

### 15. No Request Timeout on Anthropic API Call

**File:** `api/anthropic.js:85-106`
**Severity:** Medium
**Issue:** The `fetch()` call to `api.anthropic.com` has no timeout. If the Anthropic API hangs, the Vercel function will run for the full 30-second `maxDuration`, costing function execution time and blocking the user.

**Recommendation:** Add an AbortController with a 15-second timeout:

```js
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15000);
const response = await fetch('https://api.anthropic.com/v1/messages', {
  signal: controller.signal,
  // ...
});
clearTimeout(timeout);
```

---

### 16. eBay Token Cached in Module-Level Variable

**File:** `api/ebay-browse.js:7-8`
**Severity:** Low
**Issue:** `_ebayToken` and `_ebayTokenExp` are module-level variables. On Vercel serverless, each cold start creates a new instance (cache miss), and warm instances may share the cached token across different user requests — which is fine for client-credentials tokens but worth noting. If you move to user-level tokens, this pattern will break.

**Recommendation:** Fine as-is for client-credentials flow. Add a comment documenting this.

---

## CODE QUALITY

### 17. `window.` Namespace Pollution

**Files:** Multiple (tags.js, themes.js, statistics.js, etc.)
**Severity:** Medium (maintainability)
**Issue:** At least 30+ functions are explicitly assigned to `window.` for cross-file access (`window.openThemeEditor`, `window.bulkAddNewTag`, `window.renderCollectionModal`, etc.). This is a symptom of issue #5 (no module system) and creates a fragile implicit API surface.

**Recommendation:** Track these as your migration targets when moving to ES modules. Each `window.x = function()` should become an `export`.

---

### 18. `scanMode` Stored on `window`

**File:** `js/scanner.js:15`

```js
window.scanMode = window.scanMode || 'collection';
```

**Issue:** Using `window.` as a communication channel between modules is fragile. Any script can accidentally overwrite `scanMode`.

**Recommendation:** Move to the `state.js` module alongside other shared state.

---

### 19. Hardcoded Cost Values Scattered Across Files

**Files:** `scanner.js:156`, `sync.js:149`, `config.js:16`
**Severity:** Low
**Issue:** The AI scan cost (`0.002`, `0.01`, `0.002`) appears in multiple files with inconsistent values. `scanner.js:156` uses `0.01`, while `sync.js:149` uses `0.002`, and `config.js:16` defines `aiCost: 0.002`.

**Recommendation:** Use `config.aiCost` everywhere instead of hardcoded literals.

---

### 20. Admin Check is Client-Side Only

**File:** `js/user-management.js:119`
**Severity:** Medium (security design)
**Issue:** The `isAdmin()` check is a client-side function reading from the user object. While the comment says "admin DB actions are protected by Supabase RLS policies," this should be verified. If any admin-only Supabase queries don't have corresponding RLS policies, a user could modify `currentUser.is_admin` in the console and gain access.

**Recommendation:**
- Audit all Supabase queries in `admin-dashboard.js` to confirm RLS policies exist
- Consider adding a server-side admin verification endpoint

---

## NICE-TO-HAVES

### 21. No Automated Tests

**Severity:** Medium (long-term)
**Issue:** There are no test files, no testing framework, and no CI pipeline. For a production app processing financial data (eBay prices, API costs), this is risky.

**Recommendation (start small):**
- Add unit tests for pure functions: `levenshteinDistance()`, `normalizeCardNum()`, `extractCardNumber()`, `mergeCardArrays()`, `escapeHtml()`
- Use a lightweight runner like Vitest (works with ES modules, no config needed)
- Add a GitHub Actions workflow that runs tests on PRs

### 22. No `.eslintrc` or Code Formatting Config

**Severity:** Low
**Issue:** No linting or formatting configuration. The code is manually kept consistent but has minor style variations (semicolons, spacing, quote types).

**Recommendation:** Add ESLint + Prettier with a minimal config. This prevents style drift as the codebase grows.

### 23. Consider a Service Worker for Offline Support

**Severity:** Low (enhancement)
**Issue:** The app has PWA meta tags (`apple-mobile-web-app-capable`) but no service worker. Since most scans are free (OCR) and the card database is cached in IndexedDB, offline scanning is feasible.

**Recommendation:** Add a basic service worker that caches static assets and serves the app shell offline.

---

## Summary of Recommendations by Priority

| Priority | Issue | Effort |
|----------|-------|--------|
| **Critical** | #1 Server-controlled prompts | 30 min |
| **Critical** | #2 Add API auth to /api/anthropic | 15 min |
| **Critical** | #3 Rate limit fail-open fallback | 1 hr |
| **High** | #4 CSP applies to all routes | 10 min |
| **High** | #5 Migrate to ES modules (incremental) | Days |
| **Medium** | #7 Remove user-scalable=no | 5 min |
| **Medium** | #8 Fix duplicate HTML ID | 5 min |
| **Medium** | #9 Deduplicate version.json fetch | 15 min |
| **Medium** | #13 Log silent catch blocks | 30 min |
| **Medium** | #15 Add fetch timeout | 15 min |
| **Medium** | #19 Centralize cost constants | 15 min |
| **Medium** | #20 Verify admin RLS policies | 1 hr |
| **Low** | #6 Move inline styles to CSS | 1 hr |
| **Low** | #10 Minify card-database.json | 30 min |
| **Low** | #11 Revoke blob URLs on success | 15 min |
| **Low** | #14 Remove empty finally block | 1 min |
| **Low** | #21 Add unit tests | 1-2 days |
| **Low** | #22 Add ESLint + Prettier | 1 hr |
| **Low** | #23 Service worker for offline | 1 day |

---

*Generated by automated code review. Verify findings in context before applying changes.*
