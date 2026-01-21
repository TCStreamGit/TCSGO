# TCSGO Lumia Commands - Phase 1 Foundation

## Overview

This directory contains Lumia Custom JavaScript commit commands for the TCSGO case opening simulation system. These commands mutate local JSON files and return structured payloads for overlay consumption.

## Architecture

```
┌─────────────────────────┐
│  Overlay (HTML/JS)      │ ─── Uses Lumia Overlay API
└───────────┬─────────────┘
            │ Overlay.callCommand()
            ▼
┌─────────────────────────┐
│  Lumia Commit Commands  │ ─── This directory
│  (Custom JavaScript)    │
└───────────┬─────────────┘
            │ readFile() / writeFile()
            ▼
┌─────────────────────────┐
│  Local JSON Data Files  │
│  - data/inventories.json│
│  - data/case-aliases.json│
│  - data/prices.json     │
│  - Case-Odds/*.json     │
└─────────────────────────┘
```

## Data Files

### `data/inventories.json`
User inventory storage with schema:
```json
{
  "schemaVersion": "1.0-inventories",
  "lastModified": "ISO-timestamp",
  "users": {
    "platform:username": {
      "userKey": "platform:username",
      "createdAt": "ISO-timestamp",
      "chosenCoins": 0,
      "cases": { "case-id": count },
      "keys": { "key-id": count },
      "items": [
        {
          "oid": "unique-id",
          "itemId": "item-id",
          "displayName": "...",
          "rarity": "...",
          "statTrak": true/false,
          "wear": "Factory New",
          "acquiredAt": "ISO-timestamp",
          "lockedUntil": "ISO-timestamp",
          "priceSnapshot": { "cad": 1.50, "chosenCoins": 1500 }
        }
      ],
      "pendingSell": { "token": "...", "oid": "...", "expiresAt": "..." } | null
    }
  }
}
```

### `data/case-aliases.json`
Maps user-friendly aliases to case definitions:
```json
{
  "schemaVersion": "1.0-aliases",
  "aliases": {
    "chroma": {
      "caseId": "chroma-case",
      "filename": "Chroma_Case.json",
      "displayName": "Chroma Case",
      "requiresKey": true
    }
  }
}
```

### `data/prices.json`
Pricing data with rarity fallbacks:
```json
{
  "schemaVersion": "1.1-prices",
  "cadToCoins": 1000,
  "marketFeePercent": 10,
  "tradeLockDays": 7,
  "cases": { "case-id": cad-price },
  "keys": { "default": 3.50 },
  "rarityFallbackPrices": { "mil-spec": { "cad": 0.10, "coins": 100 } },
  "wearMultipliers": { "Factory New": 1.5, ... },
  "statTrakMultiplier": 2.0
}
```

## Commands

### `tcsgo-commit-buycase.js`
Adds cases to user inventory.

**Input:**
- `platform`: string (e.g., "twitch")
- `username`: string
- `alias`: string (case alias like "chroma")
- `qty`: number (default 1)

**Output:**
```json
{
  "type": "buycase-result",
  "ok": true,
  "data": {
    "userKey": "twitch:testuser",
    "caseId": "chroma-case",
    "displayName": "Chroma Case",
    "qty": 1,
    "newCount": 5
  }
}
```

### `tcsgo-commit-buykey.js`
Adds keys to user inventory.

**Input:**
- `platform`: string
- `username`: string
- `keyId`: string (default "default")
- `qty`: number (default 1)

**Output:**
```json
{
  "type": "buykey-result",
  "ok": true,
  "data": {
    "userKey": "twitch:testuser",
    "keyId": "default",
    "qty": 5,
    "newCount": 10
  }
}
```

### `tcsgo-commit-open.js`
Opens a case and rolls a winner.

**Input:**
- `platform`: string
- `username`: string
- `alias`: string (case alias)

**Behavior:**
1. Validates user owns case + key (if required)
2. Loads case JSON from Case-Odds folder
3. Rolls winner using true odds from JSON
4. Consumes case + key
5. Creates item with 7-day trade lock
6. Attaches image path and price snapshot

**Output:**
```json
{
  "type": "open-result",
  "ok": true,
  "data": {
    "winner": {
      "oid": "oid_abc123_xyz",
      "itemId": "awp-man-o-war",
      "displayName": "AWP | Man-o'-war",
      "rarity": "covert",
      "tier": "red",
      "category": "weapon",
      "statTrak": false,
      "wear": "Minimal Wear"
    },
    "imagePath": "Assets/Cases/Chroma-Case/Weapons/...",
    "priceSnapshot": { "cad": 18.00, "chosenCoins": 18000 },
    "acquiredAt": "2026-01-21T...",
    "lockedUntil": "2026-01-28T...",
    "newCounts": { "cases": {}, "keys": {} }
  }
}
```

### `tcsgo-commit-sell-start.js`
Initiates a sell with a 60-second confirmation token.

**Input:**
- `platform`: string
- `username`: string
- `oid`: string (owned item ID)

**Output:**
```json
{
  "type": "sell-start-result",
  "ok": true,
  "data": {
    "token": "sell_abc123_xyz",
    "oid": "oid_...",
    "expiresAt": "2026-01-21T...",
    "expiresInSeconds": 60,
    "item": { ... },
    "creditAmount": 16200,
    "marketFeePercent": 10
  }
}
```

**Error Codes:**
- `ITEM_LOCKED`: Item still trade locked (returns remaining time)
- `PENDING_SELL_EXISTS`: Already have an active sell token

### `tcsgo-commit-sell-confirm.js`
Confirms a sell and removes the item.

**Input:**
- `platform`: string
- `username`: string
- `token`: string (from sell-start)

**Output:**
```json
{
  "type": "sell-confirm-result",
  "ok": true,
  "data": {
    "oid": "...",
    "item": { ... },
    "creditedCoins": 16200,
    "feeAmount": 1800,
    "marketFeePercent": 10
  }
}
```

**Note:** The overlay must call `Overlay.addLoyaltyPoints()` with the returned `creditedCoins` value!

## Setup Instructions

1. **Update Configuration**
   
   In each command file, update the `basePath` in the CONFIG object:
   ```javascript
   const CONFIG = {
       basePath: '/YOUR/PATH/TO/TCSGO',  // <-- UPDATE THIS
       ...
   };
   ```

2. **Create Lumia Commands**
   
   For each `.js` file:
   1. Open Lumia Stream → Commands → Custom JavaScript
   2. Create new command (e.g., name: `tcsgo-open`)
   3. Paste entire file contents into JavaScript tab
   4. Configure trigger (chat command, etc.)

3. **Verify Data Files**
   
   Ensure these files exist:
   - `data/inventories.json` (created empty)
   - `data/case-aliases.json` (populated)
   - `data/prices.json` (populated)

## Manual Testing

### Test Buy Case
```javascript
// In Lumia: Set variables then run tcsgo-commit-buycase
// platform = "twitch"
// username = "testuser"  
// alias = "chroma"
// qty = 1

// Expected: inventories.json updated with user having 1 chroma-case
```

### Test Buy Key
```javascript
// platform = "twitch"
// username = "testuser"
// keyId = "default"
// qty = 5

// Expected: inventories.json updated with user having 5 default keys
```

### Test Open Case
```javascript
// Pre-condition: testuser has >= 1 chroma-case AND >= 1 default key
// platform = "twitch"
// username = "testuser"
// alias = "chroma"

// Expected: 
// - Case and key consumed
// - New item added to items[] with oid, lockedUntil, priceSnapshot
// - Response contains winner data and imagePath
```

### Test Sell Flow
```javascript
// Step 1: Start sell (item must be unlocked - 7 days old)
// platform = "twitch"
// username = "testuser"
// oid = "oid_xxx_yyy" (from items[])

// Step 2: Confirm sell (within 60 seconds)
// platform = "twitch"
// username = "testuser"
// token = "sell_xxx_yyy" (from step 1)

// Expected:
// - Item removed from inventory
// - creditedCoins returned for overlay to add via Lumia loyalty
```

## Error Response Format

All commands return consistent error format:
```json
{
  "type": "command-result",
  "ok": false,
  "timestamp": "ISO-timestamp",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": { ... } // optional
  }
}
```

Common error codes:
- `MISSING_USERNAME` / `MISSING_ALIAS` / `MISSING_OID` / `MISSING_TOKEN`
- `LOAD_ERROR` / `SAVE_ERROR`
- `UNKNOWN_ALIAS`
- `USER_NOT_FOUND` / `ITEM_NOT_FOUND`
- `NO_CASE` / `NO_KEY`
- `ITEM_LOCKED`
- `PENDING_SELL_EXISTS` / `NO_PENDING_SELL`
- `INVALID_TOKEN` / `TOKEN_EXPIRED`

## Integration Notes

### Overlay Integration
The overlay should:
1. Call commands via `Overlay.callCommand('tcsgo-open', { platform, username, alias })`
2. Parse the JSON response from the command log
3. Display animations/UI based on response
4. For sell-confirm, call `Overlay.addLoyaltyPoints({ value: creditedCoins, username, platform })`

### Trade Lock
Items are locked for 7 days after acquisition. The `lockedUntil` timestamp is stored on each item. Sell attempts before this time return `ITEM_LOCKED` with remaining time.

### Prices
- Item prices come from `priceSnapshot` stored at acquisition time
- Fallback pricing uses rarity + wear multipliers + StatTrak multiplier
- Market fee (default 10%) is deducted on sell

## File Dependencies

```
lumia-commands/
├── tcsgo-core.js           # Shared utilities (reference only)
├── tcsgo-commit-buycase.js # Buy case command
├── tcsgo-commit-buykey.js  # Buy key command
├── tcsgo-commit-open.js    # Open case command
├── tcsgo-commit-sell-start.js   # Start sell command
└── tcsgo-commit-sell-confirm.js # Confirm sell command

data/
├── inventories.json        # User inventories
├── case-aliases.json       # Alias mappings
└── prices.json             # Pricing data

Case-Odds/
└── *.json                  # Case definitions with odds
```
