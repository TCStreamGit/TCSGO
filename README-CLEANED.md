# TCSGO Lumia Stream Case-Opening System

**Version:** 2.0 (Overlay Controller Architecture)  
**Last Updated:** January 2026

---

## Overview

TCSGO is a CS:GO/CS2-style case opening system for Lumia Stream that provides:
- Realistic case opening with deterministic odds
- Virtual currency management through Lumia loyalty points
- Inventory tracking with trade locks
- Local-first JSON storage with optional Git sync
- 4,200+ weapon skins across 140+ cases

### Architecture at a Glance

```
Viewer Chat (!open, !buycase, !sell)
         ↓
Lumia Overlay Controller (case-opening)
  • Parses chat commands
  • Validates loyalty points
  • Deducts/credits points
  • Calls backend commands
  • Plays animations
         ↓
Backend Commands (tcsgo-commit-*)
  • Pure inventory mutators
  • Read/write local JSON files
  • Return results via dual-receive
         ↓
Local JSON Storage
  • data/inventories.json (user items)
  • data/prices.json (cached prices)
  • data/case-aliases.json (alias map)
```

**Critical Design Principle:** Lumia chat commands CANNOT reliably check or modify viewer loyalty points. Therefore, ALL currency operations happen in the overlay controller, while backend commands only mutate inventory files.

---

## Quick Start

### Prerequisites

- **Windows VM** with access to `A:\Development\Version Control\Github\TCSGO`
- **Python 3** (for alias builder and asset tools)
- **Lumia Stream** with custom overlays and commands enabled
- **Git** (optional, for auto-sync)

### Initial Setup

1. **Set the repository root:**
   ```
   A:\Development\Version Control\Github\TCSGO
   ```

2. **Build case aliases:**
   ```bash
   cd /d "A:\Development\Version Control\Github\TCSGO"
   python tools\build_case_aliases.py
   ```

3. **Verify data files exist:**
   - `data\inventories.json`
   - `data\prices.json`
   - `data\case-aliases.json`
   - `data\case-aliases.manual.json`

4. **Import into Lumia:**
   - **Overlay:** Import `lumia-overlays\case-opening\` folder
   - **Commands:** Import these JS files as custom commands:
     - `tcsgo-commit-open.js`
     - `tcsgo-commit-buycase.js`
     - `tcsgo-commit-buykey.js`
     - `tcsgo-commit-sell-start.js`
     - `tcsgo-commit-sell-confirm.js`
     - `tcsgo-core.js` (shared utilities)

5. **Test the system:**
   - Enable the case-opening overlay
   - Test with: `!open dreams` (Dreams & Nightmares case)
   - Verify inventory updates in `data\inventories.json`

---

## Folder Structure

```
TCSGO/
├── Assets/
│   ├── Global/                    # Source-of-truth asset library
│   │   ├── Weapons/
│   │   ├── Knives/
│   │   ├── Gloves/
│   │   └── Icons/
│   └── Cases/                     # Generated per-case copies
│       └── <case-folder>/
│           ├── Icons/
│           ├── Weapons/
│           └── Knives/
│
├── Case-Odds/                     # Case definitions with odds
│   ├── index.json
│   └── *.json (140+ case files)
│
├── data/
│   ├── inventories.json           # User inventory (SYSTEM OF RECORD)
│   ├── prices.json                # Cached item prices
│   ├── case-aliases.json          # Generated alias map
│   └── case-aliases.manual.json   # Manual alias overrides
│
├── lumia-commands/
│   ├── tcsgo-commit-open.js       # Backend: open case
│   ├── tcsgo-commit-buycase.js    # Backend: buy case
│   ├── tcsgo-commit-buykey.js     # Backend: buy key
│   ├── tcsgo-commit-sell-start.js # Backend: start sell
│   ├── tcsgo-commit-sell-confirm.js # Backend: confirm sell
│   └── tcsgo-core.js              # Shared utilities
│
├── lumia-overlays/
│   └── case-opening/              # Overlay controller
│       ├── overlay.html
│       ├── script.js
│       ├── style.css
│       └── configs.json
│
└── tools/
    ├── build_case_aliases.py      # Alias map generator
    └── rename_assets.py           # Asset organization tool
```

---

## How It Works

### Viewer Commands (Handled by Overlay)

| Command | Action | Example |
|---------|--------|---------|
| `!buycase <alias> [qty]` | Buy case(s) with loyalty points | `!buycase c2 5` |
| `!buykey [qty]` | Buy key(s) with loyalty points | `!buykey 3` |
| `!open <alias>` | Open a case (consumes case + key) | `!open recoil` |
| `!sell <oid>` | Start selling an item | `!sell itm-12345` |
| `!sellconfirm <token>` | Confirm pending sale | `!sellconfirm tok-abc` |

### Command Flow Example: !buycase

1. **Viewer types:** `!buycase c2 5`
2. **Overlay receives chat:**
   - Resolves alias: `c2` → `chroma-2-case`
   - Checks price: 1,500 coins × 5 = 7,500 coins
   - Checks balance: `Overlay.getLoyaltyPoints(username)`
   - If insufficient → error message, stop
3. **Overlay deducts points:**
   - `Overlay.addLoyaltyPoints(username, -7500)`
4. **Overlay calls backend:**
   - Generates `eventId: "evt-1737500000-abc123"`
   - Calls: `Overlay.callCommand('tcsgo-commit-buycase', {eventId, username, platform, alias: 'c2', qty: 5})`
5. **Backend command executes:**
   - `tcsgo-commit-buycase.js` runs
   - Loads `data/inventories.json`
   - Adds 5 cases to user's inventory
   - Saves `data/inventories.json`
   - Returns result via dual-receive:
     - `overlaySendCustomContent({codeId: 'tcsgo-controller', content: JSON})`
     - `setVariable({name: 'tcsgo_last_event_json', value: JSON})`
6. **Overlay receives result:**
   - Primary: Event listener catches `overlaycontent` event
   - Fallback: Polls `getVariable('tcsgo_last_event_json')` every 250ms
   - Matches `eventId` to correlate request/response
7. **Overlay handles result:**
   - ✅ Success → Shows confirmation message
   - ❌ Failure/Timeout → Refunds 7,500 points, shows error

### Dual-Receive Reliability

Backend commands send results through TWO channels to ensure the overlay receives them:

1. **Primary (Event System):**
   ```javascript
   overlaySendCustomContent({
     codeId: 'tcsgo-controller',
     content: JSON.stringify(result)
   });
   ```

2. **Fallback (Polling):**
   ```javascript
   setVariable({
     name: 'tcsgo_last_event_json',
     value: JSON.stringify(result)
   });
   ```

The overlay polls `getVariable()` every 250ms as a backup if events fail to fire.

---

## Data Files

### inventories.json

**Purpose:** System of record for user ownership  
**Schema:**

```json
{
  "version": "2.0-inventories",
  "users": {
    "tcstream:twitch": {
      "platform": "twitch",
      "username": "tcstream",
      "cases": {
        "chroma-2-case": 3,
        "dreams-nightmares-case": 1
      },
      "keys": {
        "csgo-case-key": 5
      },
      "items": [
        {
          "oid": "itm-1737500000-abc123",
          "caseId": "chroma-2-case",
          "itemId": "ak-47-elite-build",
          "displayName": "AK-47 | Elite Build",
          "rarity": "pink",
          "wear": "Field-Tested",
          "statTrak": false,
          "acquiredAt": "2026-01-22T10:30:00Z",
          "lockedUntil": "2026-01-29T10:30:00Z",
          "priceSnapshot": 850
        }
      ],
      "pendingSell": {
        "token": "tok-xyz789",
        "oid": "itm-1737500000-abc123",
        "expiresAt": "2026-01-22T10:31:00Z"
      }
    }
  }
}
```

**Key Fields:**
- `cases`: Case counts by caseId
- `keys`: Key counts by keyId
- `items[]`: Owned items with trade lock (`lockedUntil`)
- `pendingSell`: Active sell token (60-second expiry)

### prices.json

**Purpose:** Cached item prices to avoid API calls during opens  
**Schema:**

```json
{
  "version": "2.0-prices",
  "config": {
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
    }
  },
  "cases": {
    "chroma-2-case": {
      "priceCAD": 15.00,
      "priceCoins": 1500
    }
  },
  "keys": {
    "csgo-case-key": {
      "priceCAD": 35.00,
      "priceCoins": 3500
    }
  },
  "items": {
    "ak-47-elite-build|Field-Tested|0|None": {
      "priceCAD": 8.50,
      "priceCoins": 850,
      "lastUpdated": "2026-01-22T00:00:00Z"
    }
  },
  "raritySellFallback": {
    "blue": 50,
    "purple": 150,
    "pink": 500,
    "red": 2000,
    "gold": 15000
  }
}
```

**Price Key Format:** `<itemId>|<wear>|<statTrak01>|<variant>`

**Refresh Strategy:**
- **Boot Refresh:** Update prices for items currently in inventories
- **Weekly Refresh:** Full refresh of all known items (Sunday)
- **During Opens:** Use cached prices (no network calls)

### case-aliases.json

**Purpose:** Map short user inputs to case metadata  
**Generated by:** `tools/build_case_aliases.py`  
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
    },
    "dreams": {
      "caseId": "dreams-nightmares-case",
      "filename": "dreams_nightmares_case.json",
      "displayName": "Dreams & Nightmares Case",
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

**Alias Types:**
- **Manual overrides** (from `case-aliases.manual.json`): Always win
- **Full caseId:** `chroma-2-case`
- **Short base:** `chroma2` (remove `-case` suffix)
- **Compact:** `chroma2` (remove all dashes/underscores)
- **Filename-based:** From actual JSON filename

**Collision Handling:** If derived aliases collide, they're dropped. Full `caseId` always exists.

---

## Backend Commands (Lumia Custom JS)

### tcsgo-commit-open.js

**Called by:** Overlay after parsing `!open <alias>`  
**Input:**
```json
{
  "eventId": "evt-1737500000-abc",
  "platform": "twitch",
  "username": "tcstream",
  "alias": "c2"
}
```

**Process:**
1. Load `case-aliases.json`, resolve alias → caseId + filename + keyId
2. Load `inventories.json`, validate user owns case (count ≥ 1)
3. If `requiresKey: true`, validate user owns key (count ≥ 1)
4. Load case definition from `Case-Odds/<filename>`
5. Roll winner using weighted odds
6. Roll wear (Factory New → Battle-Scarred)
7. Roll StatTrak (10% chance)
8. Decrement case count (and key count if required)
9. Add item to user's `items[]` array with:
   - Unique `oid`
   - `acquiredAt` timestamp
   - `lockedUntil` (7 days later)
   - `priceSnapshot` from `prices.json` or fallback
10. Save `inventories.json`
11. Dual-return result

**Success Response:**
```json
{
  "eventId": "evt-1737500000-abc",
  "type": "open-result",
  "ok": true,
  "username": "tcstream",
  "platform": "twitch",
  "error": null,
  "data": {
    "winner": {
      "oid": "itm-1737500000-xyz",
      "caseId": "chroma-2-case",
      "itemId": "ak-47-elite-build",
      "displayName": "AK-47 | Elite Build",
      "rarity": "pink",
      "wear": "Field-Tested",
      "statTrak": false,
      "imageUrl": "Assets/Cases/chroma-2-case/Weapons/chroma-2-case--pink--ak-47-elite-build.png",
      "priceSnapshot": 850
    },
    "consumedCase": "chroma-2-case",
    "consumedKey": "csgo-case-key"
  }
}
```

### tcsgo-commit-buycase.js

**Called by:** Overlay AFTER deducting loyalty points  
**Input:**
```json
{
  "eventId": "evt-1737500000-def",
  "platform": "twitch",
  "username": "tcstream",
  "alias": "c2",
  "qty": 5
}
```

**Process:**
1. Load `case-aliases.json`, resolve alias → caseId
2. Load `inventories.json`
3. Increment user's case count by qty
4. Save `inventories.json`
5. Dual-return result

**Success Response:**
```json
{
  "eventId": "evt-1737500000-def",
  "type": "buycase-result",
  "ok": true,
  "username": "tcstream",
  "platform": "twitch",
  "error": null,
  "data": {
    "caseId": "chroma-2-case",
    "displayName": "Chroma 2 Case",
    "qty": 5,
    "newCaseCount": 8
  }
}
```

### tcsgo-commit-sell-start.js

**Called by:** Overlay after parsing `!sell <oid>`  
**Input:**
```json
{
  "eventId": "evt-1737500000-ghi",
  "platform": "twitch",
  "username": "tcstream",
  "oid": "itm-1737500000-xyz"
}
```

**Process:**
1. Load `inventories.json`
2. Find item by oid in user's items array
3. Check `lockedUntil` hasn't expired → error if still locked
4. Check no existing `pendingSell` token → error if duplicate
5. Calculate sell value: `priceSnapshot * (1 - feePercent/100)`
6. Generate sell token with 60-second expiry
7. Store token in `pendingSell` object
8. Save `inventories.json`
9. Dual-return result

**Success Response:**
```json
{
  "eventId": "evt-1737500000-ghi",
  "type": "sell-start-result",
  "ok": true,
  "username": "tcstream",
  "platform": "twitch",
  "error": null,
  "data": {
    "token": "tok-abc123",
    "item": {
      "oid": "itm-1737500000-xyz",
      "displayName": "AK-47 | Elite Build",
      "wear": "Field-Tested"
    },
    "originalPrice": 850,
    "marketFeePercent": 10,
    "creditAmount": 765,
    "expiresInSeconds": 60
  }
}
```

### tcsgo-commit-sell-confirm.js

**Called by:** Overlay after parsing `!sellconfirm <token>`  
**Input:**
```json
{
  "eventId": "evt-1737500000-jkl",
  "platform": "twitch",
  "username": "tcstream",
  "token": "tok-abc123"
}
```

**Process:**
1. Load `inventories.json`
2. Validate `pendingSell.token` matches input
3. Validate `pendingSell.expiresAt` > now
4. Remove item from `items[]` array
5. Clear `pendingSell` object
6. Save `inventories.json`
7. Dual-return result (overlay will credit points)

**Success Response:**
```json
{
  "eventId": "evt-1737500000-jkl",
  "type": "sell-confirm-result",
  "ok": true,
  "username": "tcstream",
  "platform": "twitch",
  "error": null,
  "data": {
    "item": {
      "oid": "itm-1737500000-xyz",
      "displayName": "AK-47 | Elite Build"
    },
    "creditedCoins": 765,
    "newBalance": 8765
  }
}
```

---

## Case Aliases System

### Manual Overrides (Always Win)

Edit `data/case-aliases.manual.json`:

```json
{
  "description": "Manual alias overrides - these always win",
  "aliases": {
    "c2": { "caseId": "chroma-2-case" },
    "c3": { "caseId": "chroma-3-case" },
    "cs20": { "caseId": "cs20-case" },
    "dz": { "caseId": "danger-zone-case" }
  }
}
```

### Auto-Generated Aliases

Run after adding new cases:

```bash
cd /d "A:\Development\Version Control\Github\TCSGO"
python tools\build_case_aliases.py
```

**Output:**
- Scans all `Case-Odds/*.json` files
- Generates ~400 aliases for 140+ cases
- Merges manual overrides (manual always wins)
- Writes to `data/case-aliases.json`

**Example aliases for "Dreams & Nightmares Case":**
- `dreams-nightmares-case` (full caseId)
- `dreams` (short base)
- `dreamsnightmares` (compact)
- Manual override: `dreams` → `dreams-nightmares-case`

---

## Asset Organization

### Global Assets (Source of Truth)

```
Assets/Global/
├── Weapons/
│   ├── AK-47/
│   │   ├── AK-47 Elite Build.png
│   │   └── AK-47 Redline.png
│   └── AWP/
│       └── AWP Asiimov.png
├── Knives/
│   └── Karambit/
│       └── Karambit Doppler Phase 2.png
├── Gloves/
└── Icons/
    └── Chroma 2 Case.png
```

**Never delete or rename files in Global/** - this is the master library.

### Generated Case-Specific Assets

Run the asset organization tool:

```bash
python tools\rename_assets.py --plan-only   # Preview changes
python tools\rename_assets.py --apply       # Execute changes
```

**Process:**
1. Scans `Case-Odds/*.json` for item definitions
2. Matches items to files in `Assets/Global/`
3. Copies and renames to `Assets/Cases/<case-folder>/`
4. Naming pattern: `<caseid>--<rarity>--<itemid>--<variation>.png`
5. Updates case JSON files with direct image paths
6. Generates reports:
   - `tools/reports/rename-plan.csv`
   - `tools/reports/missing-items.csv`
   - `tools/reports/unmatched-global.csv`

**Example output:**

```
Assets/Cases/chroma-2-case/
├── Icons/
│   └── chroma-2-case--icon.png
├── Weapons/
│   ├── chroma-2-case--pink--ak-47-elite-build.png
│   └── chroma-2-case--red--m4a1-s-hyper-beast.png
└── Knives/
    └── chroma-2-case--gold--karambit-doppler.png
```

**Image Processing:**
- Aspect ratio preserved
- Maximum dimension: 512px
- Format: PNG

---

## Trade Lock System

### How It Works

1. **Items are locked for 7 days after acquisition**
   - Set at: `acquiredAt + 7 days`
   - Stored in: `item.lockedUntil` (ISO timestamp)

2. **Sell attempts blocked until unlock**
   - `tcsgo-commit-sell-start.js` checks current time vs `lockedUntil`
   - Error returned: `ITEM_LOCKED` with remaining time

3. **User feedback shows countdown**
   - Overlay displays: "Must wait 5 days, 3 hours"
   - Based on `lockedUntil - Date.now()`

### Configuration

Edit `data/prices.json`:

```json
{
  "config": {
    "tradeLockDays": 7
  }
}
```

---

## Troubleshooting

### "File Not Found" / "Cannot Read JSON"

**Cause:** Wrong repository root path  
**Fix:** Verify all command files use:
```javascript
const TCSGO_BASE = 'A:\\Development\\Version Control\\Github\\TCSGO';
```

### Alias Doesn't Resolve

**Cause:** `case-aliases.json` not rebuilt after adding case  
**Fix:**
```bash
python tools\build_case_aliases.py
```

### Case Won't Open (No Case/Key)

**Cause:** Inventory doesn't have case or key  
**Fix:** Buy case/key first:
```
!buycase c2
!buykey
!open c2
```

### Missing Item Images

**Cause:** Image not in `Assets/Global/` or naming mismatch  
**Fix:**
1. Add missing PNG to `Assets/Global/<Category>/<Weapon>/`
2. If name mismatch, add to `SKIN_ALIASES` in `rename_assets.py`
3. Re-run: `python tools\rename_assets.py --apply`

### Viewer Can't Sell Item

**Cause:** Trade lock still active (7 days)  
**Fix:** Wait until `lockedUntil` expires. Check lock time:
```
!inventory
```

### Overlay Not Receiving Results

**Cause:** Dual-receive not configured in backend commands  
**Fix:** Verify each `tcsgo-commit-*.js` ends with:

```javascript
const payloadStr = JSON.stringify(result);
overlaySendCustomContent({
  codeId: 'tcsgo-controller',
  content: payloadStr
});
setVariable({
  name: 'tcsgo_last_event_json',
  value: payloadStr
});
log(payloadStr);
done();
```

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
     "tiers": {
       "blue": { "items": [...] },
       "purple": { "items": [...] }
     },
     "odds": {...}
   }
   ```

2. **Rebuild aliases:**
   ```bash
   python tools\build_case_aliases.py
   ```

3. **Add assets to `Assets/Global/`:**
   - Case icon
   - Item images

4. **Process assets:**
   ```bash
   python tools\rename_assets.py --apply
   ```

5. **Add price to `data/prices.json`:**
   ```json
   {
     "cases": {
       "new-case-id": {
         "priceCAD": 20.00,
         "priceCoins": 2000
       }
     }
   }
   ```

### Weekly Maintenance

**Sunday (Automated):**
- Full price refresh for all items
- Updates `data/prices.json`

**After Stream:**
- Review `data/inventories.json` for anomalies
- Git commit inventory changes (manual or auto-watcher)

### Backups

**Automatic (if Git watcher enabled):**
- Watches `data/inventories.json`
- Auto-commits on changes (5-second debounce)
- Auto-pushes to GitHub

**Manual:**
```bash
cd /d "A:\Development\Version Control\Github\TCSGO"
git add data/inventories.json data/prices.json
git commit -m "Backup inventories - [date]"
git push origin main
```

---

## Configuration Reference

### Overlay Config (configs.json)

```json
{
  "baseRawUrl": "",
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
| `pollIntervalMs` | 250 | Fallback polling frequency (ms) |
| `ackTimeoutMs` | 3000 | Max wait for command response (ms) |
| `feePercent` | 10 | Market fee when selling items |
| `winnerDisplayMs` | 8000 | Winner card display duration (ms) |
| `debugMode` | false | Enable console logging |

### Price Config (prices.json)

```json
{
  "config": {
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
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `cadToCoins` | 100 | CAD → Coins conversion |
| `marketFeePercent` | 10 | Sell transaction fee |
| `tradeLockDays` | 7 | Days items are locked |
| `statTrakMultiplier` | 1.5 | Price multiplier for StatTrak |
| `wearMultipliers` | Object | Price adjustment by wear |

---

## FAQ

### Q: Why is currency managed in the overlay instead of chat commands?

**A:** Lumia chat commands cannot reliably check or modify viewer loyalty points. The overlay has direct access to `Overlay.getLoyaltyPoints()` and `Overlay.addLoyaltyPoints()`, making it the only reliable place for currency operations.

### Q: What happens if the overlay loses connection during a purchase?

**A:** The overlay uses a 3-second timeout. If the backend command doesn't respond:
1. Overlay assumes failure
2. Refunds the deducted loyalty points automatically
3. Shows error message to viewer

### Q: Why copy assets per case instead of using Global/ directly?

**A:** Per-case copies provide:
- Deterministic, predictable file paths
- Faster lookup (no runtime path guessing)
- Isolation (changes to one case don't affect others)
- Direct paths embedded in case JSON files

### Q: Can I change the trade lock duration?

**A:** Yes, edit `data/prices.json`:
```json
{
  "config": {
    "tradeLockDays": 3  // Changed from 7 to 3 days
  }
}
```

### Q: How are prices refreshed?

**A:**
- **Boot refresh:** Updates prices for items currently in inventories
- **Weekly refresh:** Full refresh of all known items (Sunday)
- **During opens:** Uses cached prices (no network calls)

---

## Safety Rules

1. **Never edit `Assets/Cases/` manually** - always regenerate with tools
2. **Never delete `Assets/Global/` files** - this is the master library
3. **Always backup `data/inventories.json` before bulk operations**
4. **Test overlay commands in a test environment first**
5. **Monitor `data/inventories.json` file size** - it grows with inventory
6. **Never hardcode paths** - use `TCSGO_BASE` variable in all commands

---

## Next Steps

### Immediate (MVP Complete)

- [x] Case alias builder working
- [x] Asset organization pipeline complete
- [x] Backend commands with dual-receive
- [x] Overlay controller with buy/sell/open
- [ ] Test full workflow end-to-end
- [ ] Deploy to production Lumia

### Future Enhancements

- [ ] Animated case opening reel (CSGO-style spin)
- [ ] Souvenir package support (schema 3.1)
- [ ] Advanced rarity sounds (blue/purple/pink/red/gold)
- [ ] Git auto-sync watcher script
- [ ] Price updater service (boot + weekly)
- [ ] Admin commands (grant coins, reset user)
- [ ] Read-only chatbot commands (!help, !cases, !inventory)

---

## Support

**Repository:** `A:\Development\Version Control\Github\TCSGO`  
**Architecture:** Overlay Controller (v2.0)  
**Last Updated:** January 2026

For issues, check:
1. `data/inventories.json` for inventory state
2. Lumia overlay logs for errors
3. `tools/reports/` for asset issues
