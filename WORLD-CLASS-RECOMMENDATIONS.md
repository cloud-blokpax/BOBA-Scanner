# BOBA-Scanner: World-Class App Recommendations

**Date:** 2026-03-10
**Scope:** Architecture, Performance, Security, UX, Testing, and Product Strategy
**Baseline:** Production app with hybrid OCR+AI card scanning, 17,644-card database, cloud sync, PWA support

---

## Table of Contents

1. [Architecture & Code Modernization](#1-architecture--code-modernization)
2. [Performance & Loading Speed](#2-performance--loading-speed)
3. [Security Hardening](#3-security-hardening)
4. [Testing & Quality Gates](#4-testing--quality-gates)
5. [UX & Accessibility](#5-ux--accessibility)
6. [Scanning Intelligence](#6-scanning-intelligence)
7. [Offline-First & PWA](#7-offline-first--pwa)
8. [Data & Analytics](#8-data--analytics)
9. [Product Features](#9-product-features)
10. [Infrastructure & DevOps](#10-infrastructure--devops)

---

## 1. Architecture & Code Modernization

### 1.1 Migrate to ES Modules (High Impact)

**Current state:** 41 JS files loaded via `<script>` tags into the global `window` scope with 111+ `typeof x === 'function'` guards as dependency checks.

**Recommendation:** Convert to native ES modules with explicit `import`/`export` statements.

```js
// Before (global scope pollution)
function scanCard(image) { ... }
// Every other file: if (typeof scanCard === 'function') scanCard(img);

// After (explicit dependency graph)
// scanner.js
export async function scanCard(image) { ... }

// app.js
import { scanCard } from './scanner.js';
```

**Why this matters:**
- Tree-shaking eliminates dead code (deck-builder.js is 122 KB but loaded for non-tournament users)
- Explicit dependencies replace fragile runtime guards
- Enables bundler tooling (Vite, esbuild) for production builds
- IDE autocomplete and refactoring become reliable

**Migration path:** Start with leaf modules (utilities, constants) and work inward. Use `<script type="module">` for the entry point — it's natively supported in all modern browsers.

### 1.2 State Management Layer

**Current state:** State is scattered across localStorage (20+ keys), IndexedDB, Supabase, and in-memory variables across multiple files.

**Recommendation:** Introduce a lightweight reactive store pattern:

```js
// store.js — single source of truth
const state = {
  user: null,
  collections: [],
  activeCollection: null,
  scanHistory: [],
  syncStatus: 'idle'
};

const listeners = new Map();

export function getState(key) { return state[key]; }

export function setState(key, value) {
  state[key] = value;
  // Notify subscribers
  (listeners.get(key) || []).forEach(fn => fn(value));
  // Auto-persist where appropriate
  if (['collections', 'preferences'].includes(key)) {
    persistToStorage(key, value);
  }
}

export function subscribe(key, callback) {
  if (!listeners.has(key)) listeners.set(key, []);
  listeners.get(key).push(callback);
  return () => listeners.get(key).splice(listeners.get(key).indexOf(callback), 1);
}
```

**Benefits:** Single place to debug state changes, automatic UI re-renders on state change, cleaner sync logic.

### 1.3 Component-Based UI Rendering

**Current state:** `ui.js` is 104 KB with hundreds of imperative DOM manipulations. HTML is constructed via string concatenation.

**Recommendation:** Adopt a lightweight component pattern (no framework needed):

```js
// components/card-grid.js
export function CardGrid(cards, options = {}) {
  const container = document.createElement('div');
  container.className = 'card-grid';

  cards.forEach(card => {
    container.appendChild(CardItem(card, options));
  });

  return container;
}

function CardItem(card, { onSelect, onGrade }) {
  const el = document.createElement('div');
  el.className = 'card-item';
  el.innerHTML = `
    <img src="${escapeAttr(card.imageUrl)}" alt="${escapeAttr(card.name)}" loading="lazy">
    <div class="card-info">
      <span class="card-number">${escapeHtml(card.cardNumber)}</span>
      <span class="card-name">${escapeHtml(card.name)}</span>
    </div>
  `;
  el.querySelector('img').addEventListener('click', () => onSelect?.(card));
  return el;
}
```

**Why:** Encapsulated, testable UI components. Each component owns its DOM and event listeners. No more hunting through a 3000-line file to find where a button is wired up.

---

## 2. Performance & Loading Speed

### 2.1 Compress & Chunk the Card Database (Quick Win)

**Current state:** `card-database.json` is 3.6 MB pretty-printed, loaded in full on first visit.

**Recommendations:**
1. **Minify JSON** — Remove whitespace. This alone drops it to ~1.8 MB.
2. **Enable Brotli/Gzip** — Vercel serves Brotli by default; compressed size should be ~400-600 KB.
3. **Lazy-load by set/year** — Split into chunks (`cards-2024-BF.json`, `cards-2023-RC.json`) and load on demand when a user searches or filters.
4. **Use a binary format** — For the ultimate optimization, consider MessagePack or a custom binary format with a fixed schema. The card schema is uniform, so columnar storage could reduce size to ~200 KB.

### 2.2 Code Splitting & Lazy Loading

**Current state:** All 41 JS files (9,700+ lines) are loaded on every page visit, even for features the user may never use.

**Recommendation:** Defer non-critical modules:

```html
<!-- Critical path: only load what's needed for first paint -->
<script type="module" src="js/app.js"></script>

<!-- app.js dynamically imports features -->
// Only load deck builder when user navigates to it
document.getElementById('deckBuilderTab').addEventListener('click', async () => {
  const { initDeckBuilder } = await import('./deck-builder.js');
  initDeckBuilder();
});
```

**Impact:** Reduce initial JS payload from ~350 KB to ~80 KB. The deck-builder alone (122 KB), admin-dashboard (67 KB), and tournaments (30 KB) account for 62% of the JS and are used by <5% of sessions.

### 2.3 Image Pipeline Optimization

**Current state:** Images compressed to 1000px max, 70% JPEG quality. Good baseline.

**Recommendations:**
1. **Use WebP/AVIF** — `canvas.toBlob('image/webp', 0.75)` produces 25-35% smaller files than JPEG at equivalent quality. All modern browsers support it.
2. **Progressive loading** — Generate a 20px blurred thumbnail for instant display, then load full resolution.
3. **Revoke blob URLs** — The OCR success path leaks blob URLs (`URL.createObjectURL` without `revokeObjectURL`). Over a session of 50+ scans this accumulates significant memory.

### 2.4 Fix the Double Fetch

**Current state:** `database.js` fetches `version.json` twice (at load-check and then again at fetch-time).

**Fix:** Cache the version result from the first fetch and reuse it.

### 2.5 Service Worker Precaching

Add a service worker that precaches the Tesseract.js WASM binary (~6 MB) and trained data after first load. This makes subsequent visits near-instant instead of re-downloading OCR assets.

---

## 3. Security Hardening

### 3.1 Fix Critical Issues from CODE-REVIEW.md (Urgent)

These 4 issues should be addressed before any feature work:

| # | Issue | Fix |
|---|-------|-----|
| 1 | Client-controlled prompts sent to Claude API | Hardcode prompts server-side. Client sends only images. |
| 2 | No auth on `/api/anthropic` | Add `X-Api-Token` check (same pattern as `/api/ebay-browse`) |
| 3 | Rate limit fails open | On Supabase error, deny the request instead of allowing it |
| 4 | CSP only on `/` path | Move CSP to the catch-all `/(.*)`  header block in `vercel.json` |

### 3.2 Add Request Signing

**Current state:** API endpoints are protected by a static `BOBA_API_SECRET` token. If this token leaks (browser DevTools network tab), all endpoints are compromised.

**Recommendation:** Implement HMAC request signing:

```js
// Client-side
const timestamp = Date.now();
const payload = `${timestamp}:${imageHash}`;
const signature = await hmacSHA256(payload, sessionKey);
// Send: X-Timestamp, X-Signature headers

// Server-side
// Verify timestamp is within 60s window
// Recompute HMAC and compare
```

**Why:** Even if someone inspects network traffic, they can't replay requests after the 60-second window. The session key rotates per login.

### 3.3 Server-Side Authentication Verification

**Current state:** Admin checks are client-side only (`isAdmin()` reads from the user object). Supabase RLS policies may or may not enforce this.

**Recommendation:** Every admin-level API call must verify the user's role server-side via Supabase:

```js
// api/admin-action.js
const { data: profile } = await supabase
  .from('profiles')
  .select('role')
  .eq('id', userId)
  .single();

if (profile?.role !== 'admin') {
  return res.status(403).json({ error: 'Forbidden' });
}
```

### 3.4 Implement Content Security Policy Nonces

Replace `'unsafe-inline'` in the CSP with nonce-based script/style execution. This prevents XSS even if an attacker can inject HTML:

```
Content-Security-Policy: script-src 'nonce-{random}' cdn.jsdelivr.net;
```

Generate the nonce per-request in the Vercel edge middleware and inject it into the HTML template.

---

## 4. Testing & Quality Gates

### 4.1 Introduce a Test Framework

**Current state:** Zero automated tests across 15,670 lines of code.

**Recommendation:** Start with Vitest (fast, ESM-native, zero-config):

```
npm install -D vitest @testing-library/dom jsdom
```

**Priority test targets:**
1. **Card database lookup** (`database.js`) — Pure logic, easy to test, high-value
2. **OCR text parsing** (`ocr.js`) — Regex extraction of card numbers from OCR output
3. **Collection CRUD** (`collections.js`) — Add/remove/update cards
4. **Sync conflict resolution** (`sync.js`) — Tombstone-based merge logic
5. **Export formatting** (`export.js`) — CSV generation with configurable fields
6. **API endpoints** — Request/response contracts for all 6 serverless functions

**Example test:**

```js
// database.test.js
import { describe, it, expect } from 'vitest';
import { findCardByNumber, fuzzyMatch } from './database.js';

describe('findCardByNumber', () => {
  it('finds exact match for BF-127', () => {
    const card = findCardByNumber('BF-127');
    expect(card).toBeDefined();
    expect(card.Name).toBe('ACTION');
  });

  it('returns null for non-existent card', () => {
    expect(findCardByNumber('ZZ-999')).toBeNull();
  });
});

describe('fuzzyMatch', () => {
  it('handles OCR misread "8F-127" → "BF-127"', () => {
    const results = fuzzyMatch('8F-127');
    expect(results[0].cardNumber).toBe('BF-127');
  });
});
```

### 4.2 Add CI Pipeline with GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx vitest run --coverage
      - run: npx eslint js/ api/
      - run: npx prettier --check "**/*.{js,css,json}"
```

### 4.3 Add ESLint + Prettier

No linter or formatter is currently configured. Add:

```json
// .eslintrc.json
{
  "env": { "browser": true, "es2022": true },
  "parserOptions": { "sourceType": "module" },
  "rules": {
    "no-unused-vars": "warn",
    "no-undef": "error",
    "eqeqeq": "error"
  }
}
```

This catches bugs like undefined variables (currently hidden by global scope) and loose equality comparisons.

### 4.4 Visual Regression Testing

For a UI-heavy app, consider Playwright for screenshot comparisons:

```js
test('card grid renders correctly', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.card-grid');
  await expect(page).toHaveScreenshot('card-grid.png');
});
```

This prevents unintended visual changes when modifying the 78 KB `styles.css`.

---

## 5. UX & Accessibility

### 5.1 Remove `user-scalable=no` (WCAG Violation)

**Current state:** `<meta name="viewport" content="... user-scalable=no ...">` prevents low-vision users from zooming.

**Fix:** Remove `user-scalable=no` and `maximum-scale=1.0`. Use CSS `touch-action: manipulation` on interactive elements to prevent double-tap zoom without blocking pinch-to-zoom:

```css
button, a, input, select {
  touch-action: manipulation;
}
```

### 5.2 Focus Trapping in Modals

**Current state:** Modals don't trap keyboard focus. Tab key can reach elements behind the modal overlay.

**Fix:** Implement a focus trap:

```js
function trapFocus(modalElement) {
  const focusable = modalElement.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  modalElement.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  first?.focus();
}
```

### 5.3 Skeleton Loading States

**Current state:** During the 5-15 second initial load, users see a blank or partially rendered page.

**Recommendation:** Add CSS-only skeleton placeholders that render instantly:

```css
.skeleton {
  background: linear-gradient(90deg, #1a1f35 25%, #252b45 50%, #1a1f35 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

Place skeleton cards in the HTML that get replaced when real data loads. This gives an instant "the app is working" signal.

### 5.4 Haptic Feedback on Mobile

Add subtle vibration feedback for key actions on mobile:

```js
function haptic(style = 'light') {
  if (!navigator.vibrate) return;
  const patterns = { light: 10, medium: 20, success: [10, 50, 10] };
  navigator.vibrate(patterns[style] || 10);
}

// Usage: haptic('success') after a card is scanned
```

### 5.5 Animated Scan Success State

After a successful scan, animate the card result into view with a satisfying transition:

```css
.scan-result-enter {
  animation: cardReveal 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes cardReveal {
  0% { opacity: 0; transform: scale(0.8) translateY(20px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}
```

### 5.6 Keyboard Shortcuts

Add keyboard shortcuts for power users:

| Shortcut | Action |
|----------|--------|
| `S` | Open scanner |
| `C` | Switch to collection view |
| `E` | Export collection |
| `/` | Focus search |
| `?` | Show shortcuts help |
| `Esc` | Close modal/overlay |

---

## 6. Scanning Intelligence

### 6.1 Continuous Camera Scanning

**Current state:** User takes a photo, waits for result, then takes another photo.

**Recommendation:** Implement real-time camera preview with automatic card detection:

```js
async function startContinuousScan(videoElement) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1920 } }
  });
  videoElement.srcObject = stream;

  // Check every 500ms for a card in frame
  const interval = setInterval(async () => {
    const frame = captureFrame(videoElement);
    if (detectCardEdges(frame)) {
      // Card detected — auto-capture and scan
      clearInterval(interval);
      const result = await scanCard(frame);
      showResult(result);
    }
  }, 500);
}
```

**UX:** Show a green border overlay when a card is detected in the viewfinder. Auto-capture when the card is steady for 1 second. This eliminates the "take photo" step entirely.

### 6.2 Multi-Card Detection

Detect and scan multiple cards in a single photo (e.g., a binder page with 9 cards):

1. Use edge detection to find card boundaries
2. Crop each card individually
3. Run OCR/AI on each crop in parallel
4. Present results as a batch

### 6.3 OCR Confidence Scoring

**Current state:** OCR returns text, and the app does a database lookup. There's no granular confidence scoring.

**Recommendation:** Score OCR results on multiple signals:

```js
function scoreOCRResult(ocrText, matchedCard) {
  let confidence = 0;

  // Exact card number match
  if (extractCardNumber(ocrText) === matchedCard.cardNumber) confidence += 40;

  // Hero name found in OCR text
  if (ocrText.toLowerCase().includes(matchedCard.name.toLowerCase())) confidence += 25;

  // Year found
  if (ocrText.includes(String(matchedCard.year))) confidence += 15;

  // Set abbreviation found
  if (ocrText.includes(matchedCard.set)) confidence += 10;

  // Tesseract word confidence average
  confidence += (avgWordConfidence / 100) * 10;

  return confidence; // 0-100
}
```

Display this as a confidence meter: green (80+), yellow (50-79), red (<50 = suggest AI fallback).

### 6.4 Scan Learning & Personal Model

Track which cards are frequently misidentified by OCR and build a local correction map:

```js
// After user confirms/corrects a scan result
const corrections = JSON.parse(localStorage.getItem('ocrCorrections') || '{}');
corrections[ocrText] = confirmedCardNumber;
localStorage.setItem('ocrCorrections', JSON.stringify(corrections));

// Before AI fallback, check corrections first (free!)
const cached = corrections[ocrText];
if (cached) return lookupCard(cached); // Skip AI entirely
```

Over time, this makes the app smarter for each user's specific card conditions and camera quality.

---

## 7. Offline-First & PWA

### 7.1 Full Service Worker Implementation

**Current state:** The app has PWA meta tags but no service worker.

**Recommendation:** Add a service worker for true offline capability:

```js
// sw.js
const CACHE_NAME = 'boba-v1';
const PRECACHE = [
  '/', '/index.html', '/styles.css',
  '/js/app.js', '/js/scanner.js', '/js/ocr.js',
  '/js/database.js', '/js/collections.js', '/js/ui.js',
  '/card-database.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
```

**Impact:** After first visit, the entire app (including 17,644-card database) works without internet. Users can scan cards offline (OCR path only), manage collections, and sync when reconnected.

### 7.2 Background Sync for Offline Changes

When the user adds/edits cards while offline, queue changes and sync when connectivity returns:

```js
// Register background sync
navigator.serviceWorker.ready.then(reg => {
  reg.sync.register('sync-collections');
});

// In service worker
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-collections') {
    e.waitUntil(pushPendingChanges());
  }
});
```

### 7.3 Web App Manifest Enhancements

Add `share_target` so users can share images directly to the app from their phone's gallery:

```json
{
  "share_target": {
    "action": "/scan",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "files": [{ "name": "card", "accept": ["image/*"] }]
    }
  }
}
```

---

## 8. Data & Analytics

### 8.1 Structured Error Tracking

**Current state:** All errors go to `console.error()`. No server-side aggregation.

**Recommendation:** Add lightweight error tracking (without a heavy SDK):

```js
window.addEventListener('error', (event) => {
  navigator.sendBeacon('/api/log', JSON.stringify({
    type: 'error',
    message: event.message,
    file: event.filename,
    line: event.lineno,
    stack: event.error?.stack?.slice(0, 500),
    userAgent: navigator.userAgent,
    timestamp: Date.now()
  }));
});

window.addEventListener('unhandledrejection', (event) => {
  navigator.sendBeacon('/api/log', JSON.stringify({
    type: 'unhandled_rejection',
    reason: String(event.reason).slice(0, 500),
    timestamp: Date.now()
  }));
});
```

Store in Supabase and build a simple admin dashboard view. This is how you discover that "20% of users on Samsung Galaxy S21 fail OCR on foil cards" — data you can't get from console logs.

### 8.2 Scan Analytics Pipeline

Track scan metrics to optimize the OCR-vs-AI ratio:

```js
// After each scan
trackScan({
  method: 'ocr' | 'ai',
  success: true | false,
  confidence: 0-100,
  cardNumber: 'BF-127',
  duration_ms: 1250,
  imageSize_kb: 180,
  deviceType: 'mobile' | 'desktop',
  ocrEngine: 'tesseract-5',
  corrections: 0 | 1 // Did user correct the result?
});
```

**Goals:**
- Track OCR success rate by card set (some sets may have harder-to-read fonts)
- Identify the optimal image compression level per device
- Measure AI cost savings over time
- A/B test OCR preprocessing techniques

### 8.3 User Engagement Metrics

Track (privacy-respecting, no PII):
- Session duration and frequency
- Most-used features (scan, collection, export, deck builder)
- Scan-to-collection conversion rate
- Drop-off points in the scan flow
- Feature flag adoption rates

---

## 9. Product Features

### 9.1 Card Price Trends & Alerts

**Current state:** One-time eBay price lookup via scraping.

**Recommendation:** Build a price history system:

1. Cache every eBay price lookup in Supabase with timestamp
2. Display a price chart (last 30/90/180 days) using a lightweight chart library (Chart.js or uPlot)
3. Allow users to set price alerts: "Notify me when BF-127 First Edition drops below $5"
4. Weekly price digest email (opt-in)

### 9.2 Social Collection Sharing

Allow users to share their collection publicly:

```
https://boba.cards/collection/abc123
```

- Public collection view with stats, total value, completion percentage
- Shareable as a link or embedded card
- Open Graph meta tags for rich social media previews
- Privacy controls: public / link-only / private

### 9.3 Trade Finder

Connect collectors who have cards others want:

```
You have: BF-127 (duplicate)
User @CardKing needs: BF-127
User @CardKing has: RC-045 (you need this!)
→ Suggest trade
```

### 9.4 Wantlist & Set Completion

**Current state:** Basic set-completion tracking exists.

**Enhancements:**
- Visual set completion grid (filled/empty slots)
- "I need" list that can be shared or used for trade matching
- Alerts when a wanted card appears at a good price on eBay
- Rarity indicators (how many users in the community own each card)

### 9.5 Scan History Feed

A social-media-style feed showing recently scanned cards:

```
[Card Image]  BF-127 ACTION (First Edition)
Scanned 2 minutes ago • OCR match • Confidence: 95%
[Add to Collection] [Grade] [eBay Lookup]
```

This gives users a satisfying activity feed and makes it easy to batch-add recent scans to collections.

---

## 10. Infrastructure & DevOps

### 10.1 Build Pipeline with Vite

**Current state:** No build step. Raw JS/CSS deployed as-is.

**Recommendation:** Add Vite (2-minute setup):

```bash
npm install -D vite
```

```js
// vite.config.js
export default {
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html'
    }
  }
};
```

**Benefits:**
- Minified JS/CSS (30-50% size reduction)
- Tree-shaking (remove unused code)
- Content-hashed filenames (perfect cache invalidation, no more `version.json` workaround)
- Hot Module Replacement in development
- Source maps for production debugging

### 10.2 Environment-Specific Builds

```js
// vite.config.js
export default {
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production')
  }
};

// In code
if (__DEV__) {
  console.log('Debug info:', scanResult);
}
// Stripped entirely from production builds
```

### 10.3 Database Migration System

**Current state:** No schema versioning for Supabase tables.

**Recommendation:** Use Supabase CLI migrations:

```bash
supabase migration new add_price_history_table
```

This creates versioned SQL files that can be code-reviewed and rolled back. Essential for team collaboration and preventing "it works on my database" issues.

### 10.4 Monitoring & Alerting

Set up alerts for:
- API error rate > 5% (Anthropic endpoint failures)
- Rate limit exhaustion (users hitting limits frequently = limits too low)
- Supabase connection failures
- eBay scraping blocked (ScraperAPI detection)
- Vercel function timeout rate
- Edge middleware blocking legitimate users

Use Vercel's built-in analytics or a lightweight service like BetterStack.

### 10.5 Staging Environment

**Current state:** Changes deploy directly to production.

**Recommendation:** Create a staging branch that auto-deploys to a preview URL:

```
main → boba.cards (production)
staging → staging.boba.cards (preview)
```

All PRs deploy to Vercel preview URLs automatically. QA on preview before merging to main.

---

## Implementation Priority Matrix

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| **P0 - Now** | Fix 4 critical security issues (3.1) | 2-4 hrs | Prevents API abuse |
| **P0 - Now** | Remove `user-scalable=no` (5.1) | 5 min | WCAG compliance |
| **P0 - Now** | Add auth to `/api/anthropic` (3.1) | 30 min | Prevents cost abuse |
| **P1 - Soon** | Minify card-database.json (2.1) | 30 min | 50% smaller payload |
| **P1 - Soon** | Add service worker (7.1) | 4-6 hrs | Offline capability |
| **P1 - Soon** | Error tracking (8.1) | 2-3 hrs | Production visibility |
| **P1 - Soon** | Fix blob URL leak (2.3) | 30 min | Memory stability |
| **P1 - Soon** | Add Vitest + initial tests (4.1) | 1-2 days | Regression prevention |
| **P2 - Next** | ES Module migration (1.1) | 3-5 days | Architecture foundation |
| **P2 - Next** | Vite build pipeline (10.1) | 1 day | Performance + DX |
| **P2 - Next** | Code splitting (2.2) | 1-2 days | 75% smaller initial JS |
| **P2 - Next** | Skeleton loading (5.3) | 3-4 hrs | Perceived performance |
| **P2 - Next** | Focus trapping (5.2) | 2-3 hrs | Accessibility |
| **P3 - Later** | Continuous camera scanning (6.1) | 3-5 days | Premium UX |
| **P3 - Later** | Price trends & alerts (9.1) | 1-2 weeks | User retention |
| **P3 - Later** | Social collection sharing (9.2) | 1-2 weeks | Growth |
| **P3 - Later** | Trade finder (9.3) | 2-3 weeks | Community |
| **P3 - Later** | State management layer (1.2) | 3-5 days | Maintainability |
| **P3 - Later** | Background sync (7.2) | 2-3 days | Reliability |

---

## Final Thoughts

BOBA-Scanner is already a well-conceived app with a genuinely smart hybrid OCR+AI architecture that most competitors lack. The card database, cloud sync, and mobile-first design are strong foundations.

To reach world-class status, the highest-leverage investments are:

1. **Security first** — Fix the 4 critical issues. An API abuse incident can be existential for a bootstrapped app.
2. **Testing foundation** — Even 20 tests covering the scan pipeline and database lookup provide 80% of the safety net.
3. **Performance perception** — Skeleton loading + service worker makes the app *feel* instant, even before the heavy optimizations.
4. **Modularization** — ES modules + Vite unlocks everything else: code splitting, tree-shaking, proper testing, and team scalability.
5. **Continuous scanning** — This is the "wow factor" feature that separates a utility from a premium product.

The app is closer to world-class than it might seem. The core product insight (free OCR first, AI fallback) is genuinely novel and cost-effective. Most of the work ahead is engineering polish, not product rethinking.
