// ============================================================
// js/seller-monitor.js — eBay Seller Monitoring Phase 1
//
// Resolve escapeHtml from window (defined in ui.js core bundle)
const escapeHtml = (...args) => window.escapeHtml(...args);

// Polls your eBay seller listings via /api/ebay-browse and
// matches them against your collection cards.
//
// Requires in Vercel env vars:
//   EBAY_CLIENT_ID     — from developer.ebay.com app
//   EBAY_CLIENT_SECRET — from developer.ebay.com app
//
// Setup: Go to developer.ebay.com → Create Application →
//        set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in Vercel.
// ============================================================

const MONITOR_KEY          = 'ebayMonitorSettings';
const LAST_CHECK_KEY       = 'ebayMonitorLastCheck';
const POLL_INTERVAL_MS     = 4 * 60 * 60 * 1000;  // 4 hours
let   _monitorTimer        = null;
let   _isChecking          = false;

// ── Settings ──────────────────────────────────────────────────────────────────

function getMonitorSettings() {
  try { return JSON.parse(localStorage.getItem(MONITOR_KEY) || '{}'); }
  catch { return {}; }
}

function saveMonitorSettings(settings) {
  localStorage.setItem(MONITOR_KEY, JSON.stringify(settings));
}

window.getMonitorSettings = getMonitorSettings;

// ── Fetch listings from eBay (via Vercel proxy) ───────────────────────────────

async function fetchSellerListings(sellerUsername) {
  const headers = { 'Content-Type': 'application/json' };
  if (appConfig.apiToken) headers['X-Api-Token'] = appConfig.apiToken;

  const res = await fetch('/api/ebay-browse', {
    method:  'POST',
    headers,
    body:    JSON.stringify({ seller: sellerUsername })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `eBay API error: ${res.status}`);
  }

  return await res.json(); // { listings: [{title, price, url, itemId}] }
}

// ── Match listings to cards ───────────────────────────────────────────────────

function scoreListingAgainstCard(title, card) {
  const t = title.toUpperCase();
  const s = v => String(v ?? '').trim().toUpperCase();
  let score = 0;

  // ── CARD NUMBER (high confidence bonus, not required) ────────────────────
  // If present in title, very strong signal — boosts score significantly
  const cardNum = s(card.cardNumber);
  if (cardNum && t.includes(cardNum)) score += 50;

  // ── HERO NAME ─────────────────────────────────────────────────────────────
  if (card.hero) {
    const heroWords = s(card.hero).split(/\s+/).filter(w => w.length > 1);
    if (heroWords.every(w => t.includes(w))) score += 30;
  }

  // ── PARALLEL — extract first meaningful keyword only ─────────────────────
  // "Blizzard Battlefoil Glow" → check for "BLIZZARD"
  // "RAD Steel" → check for "RAD"
  // This prevents "Blizzard" card matching "RAD Steel" listing
  if (card.pose) {
    const pose = s(card.pose);
    if (pose && pose !== 'BASE' && pose !== 'NONE' && pose !== 'UNKNOWN') {
      const firstKeyword = pose.split(/\s+/)[0]; // "BLIZZARD", "RAD", "FOIL", etc.
      if (firstKeyword && firstKeyword.length > 2 && t.includes(firstKeyword)) {
        score += 20;
      }
    }
  }

  // ── WEAPON ────────────────────────────────────────────────────────────────
  if (card.weapon) {
    const weapon = s(card.weapon);
    if (weapon && weapon !== 'NONE' && weapon !== 'N/A' && t.includes(weapon)) score += 10;
  }

  // ── YEAR (bonus, not critical since card number already unique) ───────────
  if (card.year && t.includes(String(card.year))) score += 5;

  return score;
}

const MATCH_THRESHOLD = 55; // Without card number: hero(30) + parallel(20) + weapon(10) + year(5) = 65 max
                              // Requires at minimum hero + parallel to match
                              // With card number: 50 + 30 + 20 = 100 — very high confidence

function matchListingsToCollection(listings, collections) {
  const matches = {}; // cardKey → {listing, score}

  for (const col of collections) {
    for (let i = 0; i < col.cards.length; i++) {
      const card    = col.cards[i];
      const cardKey = `${col.id}:${i}`;
      let   best    = null;

      for (const listing of listings) {
        const score = scoreListingAgainstCard(listing.title, card);
        if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
          best = { listing, score };
        }
      }

      if (best) {
        matches[cardKey] = best;
      }
    }
  }

  return matches;
}

// ── Apply listing status to cards ─────────────────────────────────────────────

function applyListingStatuses(matches, activeItemIds) {
  const collections = getCollections();
  let updated = 0;
  const LISTED_TAG = 'Listed on eBay';

  for (const col of collections) {
    for (let i = 0; i < col.cards.length; i++) {
      const card    = col.cards[i];
      const cardKey = `${col.id}:${i}`;

      if (matches[cardKey]) {
        // Card has an active listing
        const wasListed = card.listingStatus === 'listed';
        const listing   = matches[cardKey].listing;

        // Auto-add "Listed on eBay" tag if not already present
        const tags = Array.isArray(card.tags) ? [...card.tags] : [];
        if (!tags.includes(LISTED_TAG)) tags.push(LISTED_TAG);

        col.cards[i] = {
          ...card,
          tags,
          listingStatus:   'listed',
          listingUrl:      listing.url,
          listingPrice:    listing.price,
          listingItemId:   listing.itemId,
          listingTitle:    listing.title,
          listingLastSeen: new Date().toISOString()
        };
        if (!wasListed) updated++;

      } else if (card.listingStatus === 'listed') {
        // Was listed but no longer active — infer sold
        // Keep the "Listed on eBay" tag but also add "Sold"
        const tags = Array.isArray(card.tags) ? [...card.tags] : [];
        if (!tags.includes('Sold')) tags.push('Sold');

        col.cards[i] = {
          ...card,
          tags,
          listingStatus: 'sold',
          soldAt:        new Date().toISOString()
        };
        updated++;
      }
    }
  }

  if (updated > 0) {
    saveCollections(collections);
    if (typeof renderCards === 'function') renderCards();
  }

  return updated;
}

// ── Main poll function ────────────────────────────────────────────────────────

async function checkSellerListings(manual = false) {
  if (_isChecking) {
    if (manual) showToast('Already checking listings...', '⏳');
    return;
  }

  const settings = getMonitorSettings();
  if (!settings.sellerUsername) {
    if (manual) showToast('Set your eBay seller username in Settings → eBay Monitoring', '⚙️');
    return;
  }

  _isChecking = true;
  if (manual) showToast('Checking your eBay listings...', '🔍');

  try {
    const { listings } = await fetchSellerListings(settings.sellerUsername);
    const activeIds     = new Set(listings.map(l => l.itemId));
    const collections   = getCollections();
    const matches       = matchListingsToCollection(listings, collections);
    const updated       = applyListingStatuses(matches, activeIds);

    localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());

    const listedCount = Object.keys(matches).length;

    if (manual && listedCount > 0) {
      // Show toast with "View" button that scrolls to first matched card
      showMonitorResultsToast(listedCount, updated, matches);
    } else if (manual) {
      showToast('No active listings matched your collection', 'ℹ️');
    }

    console.log(`📦 eBay Monitor: ${listedCount} active listings, ${updated} status updates`);

  } catch (err) {
    console.warn('⚠️ eBay Monitor error:', err.message);
    if (manual) {
      if (err.message.includes('credentials') || err.message.includes('401') || err.message.includes('config')) {
        showToast('eBay API not configured — add credentials in Vercel', '⚙️');
      } else {
        showToast('eBay check failed — try again later', '❌');
      }
    }
  } finally {
    _isChecking = false;
  }
}

function showMonitorResultsToast(listedCount, updated, matches) {
  // Remove any existing monitor toast
  document.getElementById('monitorResultsToast')?.remove();

  // Get first matched card's index in the current collection for "View" link
  const currentId = getCurrentCollectionId();
  const firstMatchKey = Object.keys(matches).find(k => k.startsWith(currentId + ':'));
  const firstCardIndex = firstMatchKey ? parseInt(firstMatchKey.split(':')[1]) : null;

  const toast = document.createElement('div');
  toast.id = 'monitorResultsToast';
  toast.style.cssText = `
    position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
    background:#065f46; color:white; border-radius:12px;
    padding:12px 16px; display:flex; align-items:center; gap:12px;
    box-shadow:0 4px 20px rgba(0,0,0,.25); z-index:9999;
    font-size:13px; font-weight:600; max-width:320px;
    animation: slideUp .25s ease;
  `;

  const updateNote = updated > 0 ? ` · ${updated} new` : '';
  toast.innerHTML = `
    <span>🟢 ${listedCount} card${listedCount !== 1 ? 's' : ''} listed on eBay${updateNote}</span>
    <div style="display:flex;gap:8px;flex-shrink:0;">
      ${firstCardIndex !== null ? `
        <button onclick="scrollToCard(${firstCardIndex});document.getElementById('monitorResultsToast')?.remove();"
                style="background:rgba(255,255,255,.2);border:none;color:white;padding:4px 10px;
                       border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;">
          View
        </button>` : ''}
      <button onclick="document.getElementById('monitorResultsToast')?.remove();"
              style="background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:16px;padding:0 2px;">
        ✕
      </button>
    </div>
  `;

  document.body.appendChild(toast);
  // Auto-dismiss after 8 seconds
  setTimeout(() => document.getElementById('monitorResultsToast')?.remove(), 8000);
}

// ── Auto-poll setup ───────────────────────────────────────────────────────────

function setupSellerMonitor() {
  const settings = getMonitorSettings();
  if (!settings.sellerUsername || !settings.enabled) return;

  // Check if enough time has passed since last check
  const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
  if (lastCheck) {
    const elapsed = Date.now() - new Date(lastCheck).getTime();
    if (elapsed < POLL_INTERVAL_MS) {
      // Schedule next check for remaining time
      const remaining = POLL_INTERVAL_MS - elapsed;
      _monitorTimer = setTimeout(() => {
        checkSellerListings();
        _monitorTimer = setInterval(checkSellerListings, POLL_INTERVAL_MS);
      }, remaining);
      console.log(`📦 eBay Monitor: next check in ${Math.round(remaining / 60000)} minutes`);
      return;
    }
  }

  // Check now, then schedule regular checks
  checkSellerListings();
  _monitorTimer = setInterval(checkSellerListings, POLL_INTERVAL_MS);
}

// ── Settings UI (injected into Settings modal) ────────────────────────────────

function renderMonitorSettingsHtml() {
  const settings  = getMonitorSettings();
  const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
  const lastCheckStr = lastCheck
    ? new Date(lastCheck).toLocaleString()
    : 'Never';

  return `
    <div class="setting-group" id="ebayMonitorSettings">
      <h3>🛒 eBay Seller Monitoring</h3>
      <p style="font-size:12px;color:#6b7280;margin:0 0 12px;">
        Enter your eBay seller username to automatically track which cards
        from your collection are currently listed or sold.
      </p>
      <label class="setting-item">
        <input type="checkbox" id="monitorEnabled" ${settings.enabled ? 'checked' : ''}
               onchange="saveMonitorEnabled(this.checked)">
        <span>Enable automatic monitoring</span>
      </label>
      <div style="margin-top:12px;">
        <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px;">
          eBay Seller Username
        </label>
        <div style="display:flex;gap:8px;">
          <input type="text" id="monitorUsername"
                 value="${escapeHtml(settings.sellerUsername || '')}"
                 placeholder="your-ebay-username"
                 style="flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
          <button onclick="saveMonitorUsername()" class="btn-tag-add">Save</button>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button onclick="checkSellerListings(true)"
                class="btn-secondary" style="font-size:13px;padding:8px 16px;width:auto;">
          🔄 Check Now
        </button>
        <span style="font-size:12px;color:#9ca3af;">Last checked: ${lastCheckStr}</span>
      </div>
      <p style="font-size:11px;color:#9ca3af;margin:8px 0 0;">
        Requires EBAY_CLIENT_ID + EBAY_CLIENT_SECRET in Vercel environment variables.
        <a href="https://developer.ebay.com" target="_blank" rel="noopener"
           style="color:#2563eb;text-decoration:none;">Get credentials →</a>
      </p>
    </div>`;
}

window.saveMonitorEnabled = function(enabled) {
  const settings = getMonitorSettings();
  saveMonitorSettings({ ...settings, enabled });
  if (enabled) setupSellerMonitor();
  else {
    clearTimeout(_monitorTimer);
    clearInterval(_monitorTimer);
  }
};

window.saveMonitorUsername = function() {
  const input = document.getElementById('monitorUsername');
  const username = input?.value.trim();
  if (!username) { showToast('Enter a seller username', '⚠️'); return; }
  const settings = getMonitorSettings();
  saveMonitorSettings({ ...settings, sellerUsername: username });
  showToast(`Seller username saved: ${username}`, '✅');
};

// Inject eBay monitoring section into Settings modal when opened
const _settingsOpenOrig = window.openSettings;
window.openSettings = function() {
  if (typeof _settingsOpenOrig === 'function') _settingsOpenOrig();
  setTimeout(() => {
    if (!document.getElementById('ebayMonitorSettings')) {
      const body = document.querySelector('#settingsModal .modal-body');
      if (body) body.insertAdjacentHTML('beforeend', renderMonitorSettingsHtml());
    }
  }, 60);
};

// ── Init ──────────────────────────────────────────────────────────────────────
// Called from app.js after user signs in
window.setupSellerMonitor = setupSellerMonitor;
window.checkSellerListings = checkSellerListings;

console.log('✅ Seller monitor module loaded');
