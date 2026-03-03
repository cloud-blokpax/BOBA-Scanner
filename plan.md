# Implementation Plan: Admin Limits, Tournament Exemptions, Card Movement

## Feature 1: Admin-Configurable Default Limits
**Goal**: Replace hardcoded DEFAULT_LIMITS with values stored in Supabase that admins can update from the dashboard.

### Steps:
1. Create a `system_settings` Supabase table (key-value store) for global config
2. Add a "System Settings" tab/section to the admin dashboard with 6 number inputs:
   - Guest: Card Limit (0-9999), AI Lookup Limit (0-9999)
   - Logged-in: Card Limit (0-9999), AI Lookup Limit (0-9999)
   - Member: Card Limit (0-9999), AI Lookup Limit (0-9999)
3. Modify `user-management.js` to load these settings from Supabase on init (with hardcoded fallbacks)
4. Use the loaded values wherever `DEFAULT_LIMITS` is currently referenced

### Files to modify:
- `js/user-management.js` — replace hardcoded `DEFAULT_LIMITS`, add fetch from Supabase
- `js/admin-dashboard.js` — add System Settings tab with save/load

## Feature 2: Tournament Scans Don't Count Against User
**Goal**: Cards scanned via tournament code bypass AI lookup and card count limits.

### Steps:
1. In `scanner.js`, check if `window._activeTournament` is set before incrementing API call count
2. In `scanner.js`, skip card limit check when in tournament mode
3. Store tournament state flag that the counting functions can check

### Files to modify:
- `js/scanner.js` — skip API count increment when `_activeTournament` is set
- `js/user-management.js` — skip card limit check when `_activeTournament` is set

## Feature 3: Post-Tournament "Add to My Collection"
**Goal**: After finishing a tournament deck, prompt user to optionally copy cards to My Collection (bypassing card limit).

### Steps:
1. After `finalizeDeck` completes in tournament mode, show a modal asking "Add these cards to My Collection?"
2. If yes, copy all tournament cards to the default collection, bypassing card limit
3. UI shows actual count vs limit (e.g., "60 cards (out of 5 available)")

### Files to modify:
- `js/deck-builder.js` — add post-tournament prompt + copy logic in finalizeDeck
- `js/ui.js` — update card count display to show over-limit state

## Feature 4: Cross-Collection Card Movement
**Goal**: Cards can be moved/tagged between My Collection, Price Lookup, and My Deck.

### Steps:
1. Add "Move to..." button/menu in card detail modal (openCardDetail in ui.js)
2. Options: "My Collection", "Price Check", "Deck Building" (toggle each)
3. Moving = adding the card to the target collection (copy, not remove from source)
4. Removing = removing the card from the current collection view
5. Each collection view only shows cards that belong to it
6. Collections act like tags — a card can exist in multiple collections

### Files to modify:
- `js/ui.js` — add move-to controls in card detail modal
- `js/collections.js` — add moveCard / copyCard helper functions
