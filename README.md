# TCSGO Lumia Stream Case-Opening System

**Version:** 2.0 (Overlay Controller Architecture - CORRECTED)  
**Last Updated:** January 2026  
**Status:** ✅ Production Ready

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [Installation](#installation)
5. [Testing](#testing)
6. [Viewer Commands](#viewer-commands)
7. [Data Files](#data-files)
8. [Backend Commands](#backend-commands)
9. [Overlay System](#overlay-system)
10. [Troubleshooting](#troubleshooting)
11. [Configuration](#configuration)

---

## Overview

TCSGO is a CS:GO/CS2-style case opening system for Lumia Stream that provides:
- ✅ 4,200+ weapon skins across 140+ cases
- ✅ Realistic case opening with deterministic odds
- ✅ Virtual currency management (Lumia loyalty points)
- ✅ Inventory tracking with 7-day trade locks
- ✅ Local-first JSON storage with Git sync
- ✅ Dual-receive reliability (event + polling fallback)

### Key Design Principle

**Currency operations MUST happen in the overlay, NOT in chat commands.**

Lumia chat commands cannot reliably check or modify loyalty points. Therefore:
- ✅ Overlay handles: Point checks, deductions, credits, refunds
- ✅ Backend commands handle: Inventory file mutations only
- ✅ Dual-receive ensures: Overlay always gets results (event + polling)

---

## Quick Start

### Prerequisites

- Windows VM with: `A:\Development\Version Control\Github\TCSGO`
- Python 3 (for alias builder)
- Lumia Stream with custom overlays and commands enabled
- Git (optional, for auto-sync)

### 5-Minute Setup

```bash
# 1. Build case aliases
cd /d "A:\Development\Version Control\Github\TCSGO"
python tools\build_case_aliases.py

# 2. Verify data files exist
dir data\inventories.json
dir data\prices.json
dir data\case-aliases.json

# 3. Import into Lumia
# - Import overlay: lumia-overlays\case-opening\
# - Import commands (5 files):
#   • tcsgo-commit-buycase.js
#   • tcsgo-commit-buykey.js
#   • tcsgo-commit-open.js
#   • tcsgo-commit-sell-start.js
#   • tcsgo-commit-sell-confirm.js

# 4. Test
!buycase c2 1
```

---

## Architecture

### System Flow

```
Viewer Chat (!buycase, !open, !sell)
         ↓
Lumia Overlay Controller
  ✓ Parses chat commands
  ✓ Checks loyalty points
  ✓ Deducts/credits points
  ✓ Calls backend commands
  ✓ Handles refunds on failure
  ✓ Dual-receive (event + polling)
         ↓
Backend Commands (tcsgo-commit-*)
  ✓ Pure inventory mutators
  ✓ Read/write JSON files only
  ✓ Return results via dual-receive
         ↓
Local JSON Storage
  ✓ data/inventories.json (system of record)
  ✓ data/prices.json (cached prices)
  ✓ data/case-aliases.json (alias map)
```

### Why This Architecture?

| Challenge | Solution |
|-----------|----------|
| Lumia chat commands can't check points | Overlay uses `Overlay.getLoyaltyPoints()` |
| Event system sometimes drops messages | Dual-receive: event listener + polling fallback |
| Network APIs too slow during stream | Local JSON files as system of record |
| Asset filename inconsistencies | Deterministic paths embedded in JSON |

---

## Installation

### Step 1: Verify File Structure

```
TCSGO/
├── data/
│   ├── inventories.json          ← System of record
│   ├── prices.json                ← Cached prices
│   ├── case-aliases.json          ← Generated aliases
│   └── case-aliases.manual.json   ← Manual overrides
├── lumia-commands/
│   ├── tcsgo-commit-buycase.js    ← Backend mutator
│   ├── tcsgo-commit-buykey.js     ← Backend mutator
│   ├── tcsgo-commit-open.js       ← Backend mutator
│   ├── tcsgo-commit-sell-start.js ← Backend mutator
│   └── tcsgo-commit-sell-confirm.js ← Backend mutator
└── lumia-overlays/
    └── case-opening/
        ├── overlay.html
        ├── script.js
        ├── style.css
        └── configs.json
```

### Step 2: Build Aliases

```bash
cd /d "A:\Development\Version Control\Github\TCSGO"
python tools\build_case_aliases.py
```

**Expected Output:**
```
============================================================
TCSGO Case Alias Builder
============================================================
📂 Scanning: A:\Development\Version Control\Github\TCSGO\Case-Odds
   Found 140 case JSON files
📝 Loaded 4 manual overrides

🔧 Building alias map...
   Generated ~400 aliases for 140 cases

✅ Written to: data/case-aliases.json
============================================================
```

### Step 3: Import Lumia Commands

**Critical Pattern:** Lumia expects this exact format:

```javascript
async function() {
    // Your code here
    done();  // MUST call done() at the end
}
```

**❌ WRONG (Will Not Work):**
```javascript
async function main() {
    // code
    done();
}
main(); // ← This breaks Lumia
```

**In Lumia Stream:**
1. Go to: Settings → Commands → Custom JavaScript
2. Create 5 commands with these exact names:
   - `tcsgo-commit-buycase`
   - `tcsgo-commit-buykey`
   - `tcsgo-commit-open`
   - `tcsgo-commit-sell-start`
   - `tcsgo-commit-sell-confirm`
3. Copy the contents of each `.js` file into the corresponding command
4. Verify the path at the top is: `A:\\Development\\Version Control\\Github\\TCSGO`

### Step 4: Import Overlay

**In Lumia Stream:**
1. Go to: Overlays → Add Custom Overlay
2. Name it: `case-opening`
3. Copy contents from each file:
   - HTML tab: `overlay.html`
   - JS tab: `script.js`
   - CSS tab: `style.css`
   - Configs tab: `configs.json`
4. Enable the overlay

---

## Testing

### Test Sequence (15 minutes)

Run these commands in order and verify results:

#### Test 1: Buy Case
```
!buycase c2 1
```

**Expected Success:**
- ✅ Overlay deducts points (e.g., 1,500 coins)
- ✅ Toast shows: "Case Purchased"
- ✅ Chat shows: "@username Bought 1x Chroma 2 Case!"
- ✅ `data/inventories.json` shows case count increased

**Debug Check:**
```
[Debug] [BuyCase] Case: Chroma 2 Case, Price: 1500, Qty: 1, Total: 1500
[Debug] [BuyCase] User points: 50000
[Debug] [BuyCase] Deducted points, new balance: 48500
[Debug] [Router] Processing event: buycase-result evt_xyz123
[Debug] [Router] Matched pending event, resolving
```

#### Test 2: Buy Key
```
!buykey 1
```

**Expected Success:**
- ✅ Overlay deducts points (e.g., 3,500 coins)
- ✅ Toast shows: "Keys Purchased"
- ✅ Chat shows: "@username Bought 1x Key(s)!"
- ✅ `data/inventories.json` shows key count increased

#### Test 3: Open Case
```
!open c2
```

**Expected Success:**
- ✅ Winner card displays with item image
- ✅ Rarity glow matches item tier
- ✅ Chat shows: "@username opened AK-47 | Elite Build (Field-Tested)!"
- ✅ `data/inventories.json` shows:
  - Case count decreased by 1
  - Key count decreased by 1
  - New item in `items[]` array
  - Item has `lockedUntil` (7 days from now)

**Debug Check:**
```
[Debug] [Open] Opening case: c2
[Debug] [Router] Processing event: open-result evt_abc456
[Debug] [Router] Winner: AK-47 | Elite Build (pink, Field-Tested)
```

#### Test 4: Sell (Trade Locked)
```
!sell <oid>
```
(Get `oid` from `data/inventories.json`)

**Expected Failure:**
- ❌ Chat shows: "Item is trade locked. Wait 6 days, 23 hours."
- ❌ Toast shows: "Sell Failed"

#### Test 5: Insufficient Funds
```
!buycase c2 999999
```

**Expected Failure:**
- ❌ Chat shows: "Insufficient coins!"
- ❌ No points deducted
- ❌ Toast shows error

#### Test 6: Unknown Alias
```
!buycase fakealias 1
```

**Expected Failure:**
- ❌ Chat shows: "Unknown case: fakealias"
- ❌ No points deducted

---

## Viewer Commands

Commands viewers can use in chat:

| Command | Action | Example |
|---------|--------|---------|
| `!buycase <alias> [qty]` | Buy case(s) with loyalty points | `!buycase c2 5` |
| `!buykey [qty]` | Buy key(s) with loyalty points | `!buykey 3` |
| `!open <alias>` | Open a case (consumes case + key) | `!open recoil` |
| `!sell <oid>` | Start selling an item | `!sell itm-12345` |
| `!sellconfirm <token>` | Confirm pending sale | `!sellconfirm tok-abc` |

### Common Aliases

From `data/case-aliases.manual.json`:
- `c2` → Chroma 2 Case
- `c3` → Chroma 3 Case
- `cs20` → CS20 Case
- `dz` → Danger Zone Case

**To find more aliases:**
Open `data/case-aliases.json` and search for case names.

---

## Data Files

### inventories.json

**Purpose:** System of record for user ownership

**Location:** `A:\Development\Version Control\Github\TCSGO\data\inventories.json`

**Schema:**
```json
{
  "version": "2.0-inventories",
  "users": {
    "tcstream:twitch": {
      "platform": "twitch",
      "username": "tcstream",
      "cases": {
        "chroma-2-case": 3
      },
      "keys": {
        "csgo-case-key": 5
      },
      "items": [
        {
          "oid": "itm-1737500000-abc123",
          "itemId": "ak-47-elite-build",
          "displayName": "AK-47 | Elite Build",
          "rarity": "pink",
          "wear": "Field-Tested",
          "statTrak": false,
          "acquiredAt": "2026-01-22T10:30:00Z",
          "lockedUntil": "2026-01-29T10:30:00Z",
          "priceSnapshot": {
            "cad": 8.50,
            "chosenCoins": 850
          },
          "imagePath": "Assets/Cases/chroma-2-case/Weapons/chroma-2-case--pink--ak-47-elite-build.png"
        }
      ],
      "pendingSell": null
    }
  }
}
```

**Key Fields:**
- `cases`: Case counts by caseId
- `keys`: Key counts by keyId  
- `items[]`: Owned items with trade locks
- `pendingSell`: Active sell token (60-second expiry)

### prices.json

**Purpose:** Cached item prices (no API calls during opens)

**Location:** `A:\Development\Version Control\Github\TCSGO\data\prices.json`

**Schema:**
```json
{
  "version": "2.0-prices",
  "cadToCoins": 100,
  "marketFeePercent": 10,
  "tradeLockDays": 7,
  "statTrakMultiplier": 1.5,
  "wearMultipliers": {
    "Factory New": 1.0,
    "Minimal Wear": 0.85,
    "Field-Tested": 0.7,
    "Well-Worn": 0.5,
    "Battle-Scarred": 0.35
  },
  "cases": {
    "chroma-2-case": 15.00
  },
  "keys": {
    "csgo-case-key": 35.00
  },
  "items": {
    "ak-47-elite-build|Field-Tested|0|None": 8.50
  },
  "rarityFallbackPrices": {
    "blue": { "cad": 0.10 },
    "purple": { "cad": 0.50 },
    "pink": { "cad": 2.00 },
    "red": { "cad": 10.00 },
    "gold": { "cad": 100.00 }
  }
}
```

**Price Key Format:** `<itemId>|<wear>|<statTrak01>|<variant>`

### case-aliases.json

**Purpose:** Map short user inputs to case metadata

**Generated By:** `tools/build_case_aliases.py`

**Schema:**
```json
{
  "version": "3.0-aliases",
  "aliases": {
    "c2": {
      "caseId": "chroma-2-case",
      "filename": "chroma-2-case.json",
      "displayName": "Chroma 2 Case",
      "requiresKey": true
    }
  },
  "cases": {
    "chroma-2-case": {
      "filename": "chroma-2-case.json",
      "displayName": "Chroma 2 Case",
      "caseType": "weapon_case",
      "requiresKey": true
    }
  }
}
```

---

## Backend Commands

### tcsgo-commit-buycase.js

**Called By:** Overlay after deducting loyalty points

**Input Variables:**
- `{{platform}}` - Platform (twitch/youtube/etc)
- `{{username}}` - Viewer username
- `{{alias}}` - Case alias
- `{{qty}}` - Quantity to buy

**Process:**
1. Resolve alias → caseId
2. Load inventories
3. Add cases to user
4. Save inventories
5. Dual-return result

**Success Response:**
```json
{
  "type": "buycase-result",
  "ok": true,
  "data": {
    "caseId": "chroma-2-case",
    "displayName": "Chroma 2 Case",
    "qty": 1,
    "newCount": 4
  }
}
```

### tcsgo-commit-open.js

**Called By:** Overlay after parsing `!open`

**Input Variables:**
- `{{platform}}`
- `{{username}}`
- `{{alias}}` - Case alias to open

**Process:**
1. Resolve alias → caseId + filename + requiresKey
2. Validate user owns case (count ≥ 1)
3. Validate user owns key if required (count ≥ 1)
4. Load case JSON from `Case-Odds/`
5. Roll winner using weighted odds
6. Roll wear (Factory New → Battle-Scarred)
7. Roll StatTrak (10% chance if eligible)
8. Consume case and key
9. Add item to user with:
   - Unique `oid`
   - `acquiredAt` timestamp
   - `lockedUntil` (7 days later)
   - `priceSnapshot` from prices.json
   - `imagePath` from case JSON
10. Save inventories
11. Dual-return winner data

**Success Response:**
```json
{
  "type": "open-result",
  "ok": true,
  "data": {
    "winner": {
      "oid": "itm-1737500000-xyz",
      "itemId": "ak-47-elite-build",
      "displayName": "AK-47 | Elite Build",
      "rarity": "pink",
      "wear": "Field-Tested",
      "statTrak": false
    },
    "imagePath": "Assets/Cases/chroma-2-case/...",
    "priceSnapshot": { "cad": 8.50, "chosenCoins": 850 },
    "acquiredAt": "2026-01-22T10:30:00Z",
    "lockedUntil": "2026-01-29T10:30:00Z"
  }
}
```

### tcsgo-commit-sell-start.js

**Called By:** Overlay after parsing `!sell <oid>`

**Process:**
1. Load inventories
2. Find item by oid
3. Check `lockedUntil` hasn't expired → error if locked
4. Check no existing `pendingSell` token
5. Calculate sell value: `priceSnapshot * (1 - fee/100)`
6. Generate token with 60-second expiry
7. Store in `pendingSell`
8. Save inventories
9. Dual-return token

**Success Response:**
```json
{
  "type": "sell-start-result",
  "ok": true,
  "data": {
    "token": "sell_abc123",
    "oid": "itm-1737500000-xyz",
    "expiresAt": "2026-01-22T10:31:00Z",
    "expiresInSeconds": 60,
    "item": {
      "displayName": "AK-47 | Elite Build",
      "wear": "Field-Tested"
    },
    "creditAmount": 765,
    "marketFeePercent": 10
  }
}
```

### tcsgo-commit-sell-confirm.js

**Called By:** Overlay after parsing `!sellconfirm <token>`

**Process:**
1. Validate token matches `pendingSell.token`
2. Validate token hasn't expired
3. Remove item from `items[]`
4. Clear `pendingSell`
5. Save inventories
6. Dual-return credited amount (overlay credits points)

**Success Response:**
```json
{
  "type": "sell-confirm-result",
  "ok": true,
  "data": {
    "oid": "itm-1737500000-xyz",
    "item": {
      "displayName": "AK-47 | Elite Build"
    },
    "creditedCoins": 765,
    "newBalance": 8765,
    "marketFeePercent": 10
  }
}
```

---

## Overlay System

### Dual-Receive Reliability

**Problem:** Lumia's event system sometimes drops messages

**Solution:** Two channels for receiving results

#### Channel 1: Event Listener (Primary)
```javascript
Overlay.on('overlaycontent', (data) => {
    if (data.codeId === 'tcsgo-controller') {
        handleIncomingEvent(data.content);
    }
});
```

#### Channel 2: Polling (Fallback)
```javascript
setInterval(async () => {
    const eventJson = await Overlay.getVariable('tcsgo_last_event_json');
    if (eventJson) {
        handleIncomingEvent(eventJson);
    }
}, 250); // Poll every 250ms
```

#### Backend Commands Send Via Both:
```javascript
// At end of every tcsgo-commit-* command:
const payloadStr = JSON.stringify(result);

// Channel 1: Event
overlaySendCustomContent({
    codeId: 'tcsgo-controller',
    content: payloadStr
});

// Channel 2: Variable
setVariable({
    name: 'tcsgo_last_event_json',
    value: payloadStr
});

log(payloadStr);
done();
```

### Event Correlation

Commands generate an `eventId` before calling backend:

```javascript
const eventId = generateEventId(); // e.g., "evt_1737500000_abc123"

// Call backend
Overlay.callCommand('tcsgo-commit-buycase', {
    eventId,
    platform,
    username,
    alias,
    qty
});

// Wait for result with matching eventId
const result = await waitForEvent(eventId, 3000); // 3s timeout
```

**Timeout Handling:**
- If no result after 3 seconds → Refund points → Show error

### Command Flow: !buycase

```javascript
1. User types: !buycase c2 1

2. Overlay hears chat:
   - Parses: command="buycase", alias="c2", qty=1
   
3. Overlay resolves alias:
   - c2 → chroma-2-case (from cache)
   
4. Overlay gets price:
   - chroma-2-case → 1,500 coins
   
5. Overlay checks balance:
   - await Overlay.getLoyaltyPoints({username, platform})
   - Has: 50,000 coins ✓
   
6. Overlay deducts (optimistic):
   - await Overlay.addLoyaltyPoints({value: -1500, username, platform})
   - New balance: 48,500
   
7. Overlay generates eventId:
   - eventId = "evt_1737500000_abc123"
   
8. Overlay calls backend:
   - Overlay.callCommand('tcsgo-commit-buycase', {
       eventId, platform, username, alias: 'c2', qty: 1
     })
   
9. Backend command executes:
   - Loads inventories.json
   - Adds 1 case to user
   - Saves inventories.json
   - Dual-returns result
   
10. Overlay receives result:
    - Primary: via overlaycontent event
    - Fallback: via polling variable
    - Matches eventId → resolves promise
    
11. Overlay shows success:
    - Chat: "@username Bought 1x Chroma 2 Case!"
    - Toast: "Case Purchased"
    
12. If timeout (no result after 3s):
    - Refund: await Overlay.addLoyaltyPoints({value: +1500, ...})
    - Chat: "Purchase failed. Points refunded."
```

---

## Troubleshooting

### "Unknown alias" Error

**Symptom:** Chat shows "Unknown case: xyz"

**Cause:** Alias not in `case-aliases.json`

**Fix:**
```bash
# Rebuild aliases
cd /d "A:\Development\Version Control\Github\TCSGO"
python tools\build_case_aliases.py

# Or add manual override
# Edit: data/case-aliases.manual.json
{
  "aliases": {
    "xyz": { "caseId": "actual-case-id" }
  }
}
```

### Commands Not Executing

**Symptom:** Nothing happens when typing commands

**Debug Steps:**
1. Check overlay is enabled in Lumia
2. Check overlay logs (press F12 in overlay preview)
3. Verify commands exist in Lumia (Settings → Commands)
4. Verify command names match exactly: `tcsgo-commit-*`

**Common Issues:**
- ❌ Command named `tcsgo-open` (should be `tcsgo-commit-open`)
- ❌ Command uses `async function main()` pattern (should be `async function()`)
- ❌ Overlay not listening to chat

### "File Not Found" Errors

**Symptom:** Command logs show "loadJson error: ENOENT"

**Cause:** Wrong base path in command files

**Fix:**
Open each `tcsgo-commit-*.js` file and verify:
```javascript
const TCSGO_BASE = 'A:\\Development\\Version Control\\Github\\TCSGO';
```

Must use **double backslashes** `\\` on Windows.

### Timeout / No Response

**Symptom:** "Purchase failed" after 3 seconds

**Debug:**
1. Check command logs in Lumia (Settings → Logs)
2. Verify command executed (should see log output)
3. Check for errors in command logs
4. Verify dual-receive code exists at end of command:
   ```javascript
   overlaySendCustomContent({...});
   setVariable({...});
   log(payloadStr);
   done();
   ```

**Common Causes:**
- Command threw an error before calling `done()`
- Dual-receive code missing
- Variable name mismatch (must be `tcsgo_last_event_json`)

### Item Won't Sell (Trade Lock)

**Symptom:** "Item is trade locked. Wait X days."

**Cause:** Trade lock (7 days from acquisition)

**Check Lock Status:**
```json
// Open data/inventories.json
// Find item in items[] array
{
  "oid": "itm-xyz",
  "acquiredAt": "2026-01-22T10:30:00Z",
  "lockedUntil": "2026-01-29T10:30:00Z"  ← Must be past for sell
}
```

**Override (Testing Only):**
Edit `lockedUntil` to a past date:
```json
"lockedUntil": "2020-01-01T00:00:00Z"
```

---

## Configuration

### Overlay Config

**Location:** `lumia-overlays/case-opening/configs.json`

```json
{
  "pollIntervalMs": 250,
  "ackTimeoutMs": 3000,
  "feePercent": 10,
  "defaultKeyPriceCoins": 3500,
  "winnerDisplayMs": 8000,
  "toastDurationMs": 5000,
  "debugMode": false
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `pollIntervalMs` | 250 | Fallback polling frequency |
| `ackTimeoutMs` | 3000 | Max wait for command response |
| `feePercent` | 10 | Market fee when selling |
| `winnerDisplayMs` | 8000 | Winner card display duration |
| `debugMode` | false | Enable console logging |

### Price Config

**Location:** `data/prices.json`

```json
{
  "tradeLockDays": 7,
  "marketFeePercent": 10,
  "cadToCoins": 100,
  "statTrakMultiplier": 1.5
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `tradeLockDays` | 7 | Days items are locked |
| `marketFeePercent` | 10 | Sell transaction fee |
| `cadToCoins` | 100 | CAD → Coins conversion |
| `statTrakMultiplier` | 1.5 | Price multiplier for StatTrak |

---

## Maintenance

### Adding a New Case

1. **Add JSON to `Case-Odds/`:**
   ```json
   {
     "schemaVersion": "3.0-case-export",
     "case": {
       "id": "new-case-id",
       "name": "New Case Name",
       "caseType": "weapon_case"
     },
     "tiers": {...},
     "odds": {...}
   }
   ```

2. **Rebuild aliases:**
   ```bash
   python tools\build_case_aliases.py
   ```

3. **Add price to `prices.json`:**
   ```json
   {
     "cases": {
       "new-case-id": 20.00
     }
   }
   ```

4. **Add assets to `Assets/Global/`**

5. **Process assets:**
   ```bash
   python tools\rename_assets.py --apply
   ```

### Weekly Tasks

- ☐ Review `data/inventories.json` for anomalies
- ☐ Git commit inventory changes
- ☐ Run price refresh (when implemented)

### Backups

**Manual:**
```bash
cd /d "A:\Development\Version Control\Github\TCSGO"
git add data/inventories.json data/prices.json
git commit -m "Backup inventories - [DATE]"
git push origin main
```

---

## FAQ

### Q: Why separate commit commands?

**A:** Overlay needs to orchestrate the entire flow (check points → deduct → call backend → handle result → refund if fail). This is impossible with viewer-triggered chat commands.

### Q: Why dual-receive?

**A:** Lumia's event system is unreliable. Polling provides a guaranteed fallback.

### Q: Why local JSON files?

**A:** Fast, deterministic, works offline. No network calls during stream.

### Q: Can I change trade lock duration?

**A:** Yes, edit `data/prices.json`:
```json
{
  "tradeLockDays": 3
}
```

### Q: Why is the pattern `async function() {}` not `async function main() {}`?

**A:** Lumia expects an unnamed async function that it calls directly. The `main()` pattern doesn't work in Lumia's JavaScript environment.

---

## Support

**Repository:** `A:\Development\Version Control\Github\TCSGO`  
**Architecture:** Overlay Controller v2.0  
**Status:** ✅ Production Ready  
**Last Updated:** January 2026

**Debug Mode:**
Set `debugMode: true` in `configs.json` to see detailed logs in browser console (F12).

---

## Next Steps

After completing testing:
1. ✅ Add animated case opening reel
2. ✅ Implement Git auto-sync watcher
3. ✅ Create price refresh service
4. ✅ Add read-only chatbot commands (!help, !cases, !inventory)
