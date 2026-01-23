# TCSGO Lumia Commands - v2.1 Commit Commands

## Overview

This directory contains Lumia Custom JavaScript commit commands for the TCSGO case opening simulation system. These commands mutate local JSON files and return structured payloads for overlay consumption (overlaycontent + polling variable).

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
| `tcsgo-commit-open.js` | `tcsgo-commit-open` | Open a case and roll winner |
| `tcsgo-commit-buycase.js` | `tcsgo-commit-buycase` | Add cases to inventory |
| `tcsgo-commit-buykey.js` | `tcsgo-commit-buykey` | Add keys to inventory |
| `tcsgo-commit-sell-start.js` | `tcsgo-commit-sell-start` | Initiate sell with 60s token |
| `tcsgo-commit-sell-confirm.js` | `tcsgo-commit-sell-confirm` | Confirm sell and remove item |
| `tcsgo-checkprice.js` | `tcsgo-checkprice` | Look up item price |
| `tcsgo-core.js` | N/A | Reference module (not a command) |

## Data Files

### `data/inventories.json`
User inventory storage (keyed by `username:platform`, lowercased):
```json
{
  "schemaVersion": "1.0-inventories",
  "lastModified": "ISO-timestamp",
  "users": {
    "username:platform": {
      "platform": "twitch",
      "username": "viewer",
      "chosenCoins": 0,
      "cases": { "case-id": count },
      "keys": { "key-id": count },
      "items": [ { "oid", "itemId", "displayName", "priceSnapshot", ... } ],
      "pendingSell": { "token", "oid", "expiresAt" } | null
    }
  }
}
```

### `data/case-aliases.json`
Maps user-friendly aliases to case definitions:
```json
{
  "schemaVersion": "1.0-case-aliases",
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

### `tcsgo-commit-open`
Opens a case and rolls a winner.

**Input:**
- `eventId` (required)
- `platform`: string (e.g., "twitch")
- `username`: string
- `alias`: string (case alias like "chroma")

**Output:**
```json
{
  "type": "open-result",
  "ok": true,
  "eventId": "evt_abc123_xyz",
  "platform": "twitch",
  "username": "viewer123",
  "data": {
    "eventId": "evt_abc123_xyz",
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
    "priceSnapshot": {
      "cad": 18.00,
      "chosenCoins": 18000
    },
    "acquiredAt": "2026-01-21T...",
    "lockedUntil": "2026-01-28T...",
    "newCounts": {
      "cases": { "chroma-case": 0 },
      "keys": { "csgo-case-key": 4 }
    },
    "timings": { "msTotal": 5 }
  }
}
```

### `tcsgo-commit-buycase`
Adds cases to user inventory.

**Input:**
- `eventId` (required)
- `platform`, `username`, `alias`, `qty` (default 1)

**Output:**
```json
{
  "type": "buycase-result",
  "ok": true,
  "eventId": "evt_abc123_xyz",
  "platform": "twitch",
  "username": "viewer123",
  "data": {
    "eventId": "evt_abc123_xyz",
    "caseId": "chroma-case",
    "displayName": "Chroma Case",
    "qty": 1,
    "newCount": 5,
    "timings": { "msTotal": 5 }
  }
}
```

### `tcsgo-commit-buykey`
Adds keys to user inventory.

**Input:**
- `eventId` (required)
- `platform`, `username`, `keyId` (default "csgo-case-key"), `qty`

**Output:**
```json
{
  "type": "buykey-result",
  "ok": true,
  "eventId": "evt_abc123_xyz",
  "platform": "twitch",
  "username": "viewer123",
  "data": {
    "eventId": "evt_abc123_xyz",
    "keyId": "csgo-case-key",
    "qty": 1,
    "newCount": 10,
    "timings": { "msTotal": 5 }
  }
}
```

### `tcsgo-commit-sell-start`
Initiates a sell with 60-second confirmation token.

**Input:**
- `eventId` (required)
- `platform`, `username`, `oid`

**Output:**
```json
{
  "type": "sell-start-result",
  "ok": true,
  "eventId": "evt_abc123_xyz",
  "platform": "twitch",
  "username": "viewer123",
  "data": {
    "eventId": "evt_abc123_xyz",
    "token": "sell_abc123_xyz",
    "oid": "oid_...",
    "expiresAt": "2026-01-21T...",
    "expiresInSeconds": 60,
    "item": { ... },
    "creditAmount": 16200,
    "marketFeePercent": 10,
    "timings": { "msTotal": 5 }
  }
}
```

**Error Codes:**
- `ITEM_LOCKED`: Item still trade locked (returns remaining time)
- `PENDING_SELL_EXISTS`: Already have an active sell token

### `tcsgo-commit-sell-confirm`
Confirms a sell and removes the item.

**Input:**
- `eventId` (required)
- `platform`, `username`, `token`

**Output:**
```json
{
  "type": "sell-confirm-result",
  "ok": true,
  "eventId": "evt_abc123_xyz",
  "platform": "twitch",
  "username": "viewer123",
  "data": {
    "oid": "...",
    "item": { ... },
    "creditedCoins": 16200,
    "newBalance": 48200,
    "marketFeePercent": 10,
    "timings": { "msTotal": 5 }
  }
}
```

**Note:** The overlay must call `Overlay.addLoyaltyPoints()` with the returned `creditedCoins` value!

### `tcsgo-checkprice`
Looks up price for an item.

**Optional Input (for correlation):**
- `eventId`

**Input (by OID):**
- `platform`, `username`, `oid`

**Input (by itemId):**
- `platform`, `username`, `itemId`, `wear`, `statTrak`, `variant`, `rarity`

**Output:**
```json
{
  "type": "checkprice-result",
  "ok": true,
  "eventId": "evt_abc123_xyz",
  "platform": "twitch",
  "username": "viewer123",
  "data": {
    "eventId": "evt_abc123_xyz",
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
   
   In each command file, update `TCSGO_BASE` to the full path of your repo:
   ```javascript
   const TCSGO_BASE = "A:\\Development\\Version Control\\Github\\TCSGO"; // <-- UPDATE THIS
   ```

2. **Create Lumia Commands**
   
   For each `.js` file (except `tcsgo-core.js`):
   1. Open Lumia Stream → Commands → Custom JavaScript
   2. Create new command with **exact name** matching file (e.g., `tcsgo-commit-open`)
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
  "type": "buycase-result",
  "ok": false,
  "eventId": "evt_abc123_xyz",
  "platform": "twitch",
  "username": "viewer123",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": { ... }
  },
  "data": { "timings": { "msTotal": 5 } }
}
```

Common error codes:
- `MISSING_EVENT_ID` / `MISSING_USERNAME` / `MISSING_ALIAS` / `MISSING_KEY_ID` / `MISSING_OID` / `MISSING_TOKEN`
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
├── tcsgo-commit-open.js      # Command: tcsgo-commit-open
├── tcsgo-commit-buycase.js   # Command: tcsgo-commit-buycase
├── tcsgo-commit-buykey.js    # Command: tcsgo-commit-buykey
├── tcsgo-commit-sell-start.js  # Command: tcsgo-commit-sell-start
├── tcsgo-commit-sell-confirm.js # Command: tcsgo-commit-sell-confirm
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
1. Generate an `eventId`, then call `Overlay.callCommand('tcsgo-commit-open', { eventId, platform, username, alias })`
2. Listen for results via `Overlay.on("overlaycontent")` or poll `tcsgo_last_event_json`
3. Match responses by `eventId` to resolve pending commands
4. Handle loyalty points in the overlay (deduct on buycase/buykey, credit on sell-confirm)
5. For sell-confirm, call `Overlay.addLoyaltyPoints({ value: creditedCoins, username, platform })`

### Event Acknowledgement (Commit Commands)
Each commit command emits a JSON payload in two ways:
- `overlaySendCustomContent(...)` → `overlaycontent` event
- `setVariable("tcsgo_last_event_json", payload)` → polling fallback

### Trade Lock
Items are locked for 7 days after acquisition. The `lockedUntil` timestamp is stored on each item. Sell attempts before this time return `ITEM_LOCKED` with remaining time.

### priceKey Usage
- Derived from item fields (`itemId`, `wear`, `statTrak`, `variant`)
- Used by `tcsgo-checkprice` for price queries
- `prices.items[priceKey]` is populated by the external price refresh script

## Changelog

### v2.1 (2026-01-23)
- Switched to commit command names (`tcsgo-commit-*`) with `eventId` correlation and dual-ack delivery
- Standardized safe file writes + verification across commit commands
- Normalized inventory user keys to `username:platform`
- Updated README to match current inputs/outputs

### v2.0 (2026-01-21)
- Updated prices.json to support priceKey lookups
- Added `tcsgo-checkprice` command
- Support for both `3.0-case-export` and `3.1-container-export` schemas
- Added refresh timestamps to prices.json
