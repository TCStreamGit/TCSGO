# TCSGO Lumia Commands - v2 Foundation

## Overview

This directory contains Lumia Custom JavaScript commands for the TCSGO case opening simulation system. These commands mutate local JSON files and return structured payloads for overlay consumption.

**Important:** File names must match Lumia command names exactly.

## Architecture

```
┌─────────────────────────┐
│  Overlay (HTML/JS)      │ ─── Uses Lumia Overlay API
└───────────┬─────────────┘
            │ Overlay.callCommand()
            ▼
┌─────────────────────────┐
│  Lumia Commands         │ ─── This directory
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

## Commands

| File | Lumia Command Name | Description |
|------|-------------------|-------------|
| `tcsgo-open.js` | `tcsgo-open` | Open a case and roll winner |
| `tcsgo-buycase.js` | `tcsgo-buycase` | Add cases to inventory |
| `tcsgo-buykey.js` | `tcsgo-buykey` | Add keys to inventory |
| `tcsgo-sell-start.js` | `tcsgo-sell-start` | Initiate sell with 60s token |
| `tcsgo-sell-confirm.js` | `tcsgo-sell-confirm` | Confirm sell and remove item |
| `tcsgo-checkprice.js` | `tcsgo-checkprice` | Look up item price |
| `tcsgo-core.js` | N/A | Reference module (not a command) |

## Data Files

### `data/inventories.json`
User inventory storage:
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
      "items": [ { "oid", "itemId", "priceKey", ... } ],
      "pendingSell": { "token", "oid", "expiresAt" } | null
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

### `data/prices.json` (v2.0)
Pricing data with priceKey-based lookups:
```json
{
  "schemaVersion": "2.0-prices",
  "cadToCoins": 1000,
  "marketFeePercent": 10,
  "tradeLockDays": 7,
  "lastBootRefreshAt": "ISO-timestamp",
  "lastFullRefreshAt": "ISO-timestamp",
  "cases": { "case-id": cad-price },
  "keys": { "default": 3.50 },
  "rarityFallbackPrices": { "mil-spec": { "cad": 0.10, "coins": 100 } },
  "wearMultipliers": { "Factory New": 1.5, ... },
  "statTrakMultiplier": 2.0,
  "items": {
    "<priceKey>": {
      "cad": 15.00,
      "chosenCoins": 15000,
      "updatedAt": "ISO-timestamp",
      "source": "steam-market"
    }
  }
}
```

**Price Key Format:** `"<itemId>|<wear>|<statTrak01>|<variant>"`  
Example: `"ak-47-elite-build|Factory New|1|None"`

### Case JSON Formats

**Standard Cases** (`schemaVersion: "3.0-case-export"`):
- Tier keys: `blue`, `purple`, `pink`, `red`, `gold`
- Gold items from `case.goldPool.items`
- Supports StatTrak via `case.supportsStatTrak`

**Souvenir Packages** (`schemaVersion: "3.1-container-export"`):
- Tier keys: `consumer`, `industrial`, `milspec`, `restricted`, `classified`, `covert`
- No gold tier, no StatTrak

## Command Details

### `tcsgo-open`
Opens a case and rolls a winner.

**Input:**
- `platform`: string (e.g., "twitch")
- `username`: string
- `alias`: string (case alias like "chroma")

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
      "wear": "Minimal Wear",
      "variant": "None"
    },
    "imagePath": "Assets/Cases/...",
    "priceKey": "awp-man-o-war|Minimal Wear|0|None",
    "priceSnapshot": {
      "cad": 18.00,
      "chosenCoins": 18000,
      "isEstimated": true
    },
    "acquiredAt": "2026-01-21T...",
    "lockedUntil": "2026-01-28T...",
    "newCounts": {
      "cases": { "chroma-case": 0 },
      "keys": { "default": 4 }
    }
  }
}
```

### `tcsgo-buycase`
Adds cases to user inventory.

**Input:**
- `platform`, `username`, `alias`, `qty` (default 1)

**Output:**
```json
{
  "type": "buycase-result",
  "ok": true,
  "data": { "caseId": "chroma-case", "qty": 1, "newCount": 5 }
}
```

### `tcsgo-buykey`
Adds keys to user inventory.

**Input:**
- `platform`, `username`, `keyId` (default "default"), `qty`

**Output:**
```json
{
  "type": "buykey-result",
  "ok": true,
  "data": { "keyId": "default", "qty": 5, "newCount": 10 }
}
```

### `tcsgo-sell-start`
Initiates a sell with 60-second confirmation token.

**Input:**
- `platform`, `username`, `oid`

**Output:**
```json
{
  "type": "sell-start-result",
  "ok": true,
  "data": {
    "token": "sell_abc123_xyz",
    "oid": "oid_...",
    "expiresAt": "2026-01-21T...",
    "item": { ... },
    "creditAmount": 16200,
    "marketFeePercent": 10
  }
}
```

**Error Codes:**
- `ITEM_LOCKED`: Item still trade locked (returns remaining time)
- `PENDING_SELL_EXISTS`: Already have an active sell token

### `tcsgo-sell-confirm`
Confirms a sell and removes the item.

**Input:**
- `platform`, `username`, `token`

**Output:**
```json
{
  "type": "sell-confirm-result",
  "ok": true,
  "data": {
    "oid": "...",
    "creditedCoins": 16200,
    "feeAmount": 1800
  }
}
```

**Note:** The overlay must call `Overlay.addLoyaltyPoints()` with the returned `creditedCoins` value!

### `tcsgo-checkprice`
Looks up price for an item.

**Input (by OID):**
- `platform`, `username`, `oid`

**Input (by itemId):**
- `platform`, `username`, `itemId`, `wear`, `statTrak`, `variant`, `rarity`

**Output:**
```json
{
  "type": "checkprice-result",
  "ok": true,
  "data": {
    "oid": "oid_...",
    "itemId": "awp-man-o-war",
    "displayName": "AWP | Man-o'-war",
    "wear": "Minimal Wear",
    "statTrak": false,
    "variant": "None",
    "lockedUntil": "2026-01-28T...",
    "priceKey": "awp-man-o-war|Minimal Wear|0|None",
    "price": {
      "cad": 18.00,
      "chosenCoins": 18000,
      "isEstimated": true,
      "updatedAt": null
    }
  }
}
```

## Pricing System

### How It Works

1. **Price Key Format:** `"<itemId>|<wear>|<statTrak01>|<variant>"`
2. **Lookup Order:**
   - First: Check `prices.items[priceKey]` for exact match
   - Fallback: Compute from `rarityFallbackPrices + wearMultipliers + statTrakMultiplier`
3. **isEstimated Flag:** `true` when using fallback pricing

### Refresh Strategy

Prices are refreshed by an **external script** (not Lumia commands):
- **Boot Refresh:** On VM startup, refresh high-value items
- **Full Refresh:** Weekly, refresh all items
- Lumia commands only consume the cached `prices.json`

### Next Steps (Pricing)

1. Create external price refresh script (Python/Node)
2. Script fetches prices from Steam Market API or third-party
3. Updates `prices.items` with actual values
4. Sets `lastBootRefreshAt` / `lastFullRefreshAt` timestamps
5. Schedule VM reboot for boot refresh, cron for weekly refresh

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
   
   For each `.js` file (except `tcsgo-core.js`):
   1. Open Lumia Stream → Commands → Custom JavaScript
   2. Create new command with **exact name** matching file (e.g., `tcsgo-open`)
   3. Paste entire file contents into JavaScript tab
   4. Configure trigger (chat command, etc.)

3. **Verify Data Files**
   
   Ensure these files exist:
   - `data/inventories.json` (initialized with `{"schemaVersion":"1.0-inventories","lastModified":null,"users":{}}`)
   - `data/case-aliases.json` (populated)
   - `data/prices.json` (populated, v2.0 schema)

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
    "details": { ... }
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

## File Structure

```
lumia-commands/
├── README.md                 # This file
├── tcsgo-core.js             # Shared utilities (reference only)
├── tcsgo-open.js             # Command: tcsgo-open
├── tcsgo-buycase.js          # Command: tcsgo-buycase
├── tcsgo-buykey.js           # Command: tcsgo-buykey
├── tcsgo-sell-start.js       # Command: tcsgo-sell-start
├── tcsgo-sell-confirm.js     # Command: tcsgo-sell-confirm
└── tcsgo-checkprice.js       # Command: tcsgo-checkprice

data/
├── inventories.json          # User inventories
├── case-aliases.json         # Alias mappings
└── prices.json               # Pricing data (v2.0)

Case-Odds/
└── *.json                    # Case definitions with odds
```

## Integration Notes

### Overlay Integration
The overlay should:
1. Call commands via `Overlay.callCommand('tcsgo-open', { platform, username, alias })`
2. Parse the JSON response from the command log
3. Display animations/UI based on response
4. For sell-confirm, call `Overlay.addLoyaltyPoints({ value: creditedCoins, username, platform })`

### Trade Lock
Items are locked for 7 days after acquisition. The `lockedUntil` timestamp is stored on each item. Sell attempts before this time return `ITEM_LOCKED` with remaining time.

### priceKey Usage
- Stored on each owned item for fast lookup
- Used by `tcsgo-checkprice` for price queries
- Populated by external price refresh script

## Changelog

### v2.0 (2026-01-21)
- Renamed command files to match Lumia command names (removed `commit-` prefix)
- Fixed `newCounts` in open response to only include relevant caseId/keyId
- Added `priceKey` field to items and responses
- Updated prices.json to v2.0 schema with `items` dict for priceKey lookups
- Added `tcsgo-checkprice` command
- Support for both `3.0-case-export` and `3.1-container-export` schemas
- Added `isEstimated` flag to price snapshots
- Added refresh timestamps to prices.json
