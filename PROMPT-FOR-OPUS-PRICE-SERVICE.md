# Prompt for Claude Opus: TCSGO Price Refresh Service

## Context

I'm working on TCSGO, a CS:GO case opening system for Lumia Stream. The system uses local JSON files as the system of record, including `data/prices.json` which caches item prices. Currently, prices are static and need to be manually updated.

**Repository Location:** `A:\Development\Version Control\Github\TCSGO`

**Current System Architecture:**
- 140+ cases with 4,200+ weapon skins
- Local JSON storage (inventories, prices, aliases)
- Windows VM environment
- Python 3 available for scripting
- Git for version control

**Key Files:**
- `data/prices.json` - Cached prices for cases, keys, and items
- `Case-Odds/*.json` - 140 case definition files with item metadata
- `data/inventories.json` - User inventory (NOT to be modified by price service)

---

## Goal

Create a **Price Refresh Service** that:
1. Fetches current prices from Steam Community Market API
2. Updates `data/prices.json` with new prices
3. Runs automatically on Windows boot
4. Runs on a configurable schedule (day of week + time)
5. Has rate limiting to respect API limits (60 requests/minute)
6. Has comprehensive error handling and logging
7. Can be easily configured by the user
8. Includes full documentation

---

## Requirements

### Functional Requirements

1. **Boot-Time Refresh:**
   - Service starts when Windows boots
   - Performs initial price refresh
   - Logs success/failure

2. **Scheduled Refresh:**
   - Runs on specific day(s) of week (e.g., Sunday)
   - Runs at specific time (e.g., 3:00 AM)
   - Configurable via config file

3. **Price Fetching:**
   - Fetch prices from Steam Community Market API
   - Support for cases, keys, and weapon skins
   - Handle API rate limits (max 60/minute)
   - Retry logic for failed requests
   - Fallback to existing prices on error

4. **Price Storage:**
   - Update `data/prices.json` preserving structure
   - Keep existing config values (tradeLockDays, etc.)
   - Add timestamp to each price entry
   - Backup old prices.json before updating

5. **Configuration:**
   - Config file for schedule, API settings, etc.
   - Easy to modify (JSON or INI format)
   - Example config with comments

6. **Logging:**
   - Log all price fetches
   - Log errors with stack traces
   - Log price changes (old vs new)
   - Rotating log files (keep last 7 days)

7. **Testing:**
   - Dry-run mode (fetch prices but don't save)
   - Test script to verify functionality
   - Validation of prices.json schema

### Technical Requirements

**Platform:** Windows 10/11  
**Language:** Python 3.8+  
**Dependencies:** Only standard library (requests, schedule, logging, json, etc.)  
**Installation:** Simple setup script or instructions  

**Integration Points:**
- Must read existing `data/prices.json`
- Must read `Case-Odds/index.json` for item list
- Must NOT modify `data/inventories.json`
- Must work with Git (commit changes after successful refresh)

---

## Current Data Structures

### prices.json Schema

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
    "chroma-2-case": 15.00,
    "chroma-3-case": 12.50
  },
  "keys": {
    "csgo-case-key": 35.00
  },
  "items": {
    "ak-47-elite-build|Field-Tested|0|None": 8.50,
    "awp-asiimov|Field-Tested|0|None": 45.00
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

**Price Key Format for Items:** `<itemId>|<wear>|<statTrak01>|<variant>`

**Fields to Update:**
- `cases` - Case prices in CAD
- `keys` - Key prices in CAD
- `items` - Item prices in CAD

**Fields to PRESERVE:**
- `version`
- `cadToCoins`
- `marketFeePercent`
- `tradeLockDays`
- `statTrakMultiplier`
- `wearMultipliers`
- `rarityFallbackPrices`

### Case-Odds/index.json Schema

```json
{
  "schemaVersion": "3.0-case-index",
  "cases": [
    {
      "id": "chroma-2-case",
      "name": "Chroma 2 Case",
      "caseType": "weapon_case",
      "filename": "chroma-2-case.json"
    }
  ]
}
```

Use this to get the list of all cases to price.

### Case-Odds/<case>.json Schema

Each case file contains items:

```json
{
  "case": {
    "id": "chroma-2-case",
    "name": "Chroma 2 Case"
  },
  "tiers": {
    "blue": [
      {
        "itemId": "cz75-auto-polymer",
        "displayName": "CZ75-Auto | Polymer",
        "weapon": "CZ75-Auto",
        "skin": "Polymer",
        "rarity": "blue"
      }
    ]
  }
}
```

Use these files to get the full list of items to price.

---

## Steam Community Market API

**Endpoint:** `https://steamcommunity.com/market/priceoverview/`

**Parameters:**
- `appid=730` (CS:GO)
- `currency=20` (CAD)
- `market_hash_name=<item_name>`

**Example Request:**
```
GET https://steamcommunity.com/market/priceoverview/?appid=730&currency=20&market_hash_name=AK-47%20%7C%20Elite%20Build%20(Field-Tested)
```

**Example Response:**
```json
{
  "success": true,
  "lowest_price": "$8.50 CAD",
  "median_price": "$8.75 CAD",
  "volume": "234"
}
```

**Market Hash Name Format:**
- Cases: `Chroma 2 Case`
- Keys: `CS:GO Case Key`
- Weapons: `AK-47 | Elite Build (Field-Tested)`
- StatTrak: `StatTrakâ„¢ AK-47 | Elite Build (Field-Tested)`

**Rate Limits:**
- Max 60 requests per minute
- Must implement delays between requests
- Use 1-second delay per request to be safe

**Error Handling:**
- API returns `{"success": false}` on error
- 429 Too Many Requests → wait and retry
- Network errors → retry up to 3 times
- If all retries fail → keep existing price

---

## Deliverables

### 1. Price Refresh Service (`services/price-refresher.py`)

**Features:**
- Fetch prices from Steam Market API
- Update prices.json
- Rate limiting (1 req/second)
- Error handling and retries
- Logging to file
- Dry-run mode (--dry-run flag)
- Progress reporting

**Usage:**
```bash
# Manual run (updates prices.json)
python services/price-refresher.py

# Dry run (shows what would be updated)
python services/price-refresher.py --dry-run

# Force refresh all (ignore cache age)
python services/price-refresher.py --force
```

### 2. Configuration File (`services/price-refresher-config.json`)

**Example:**
```json
{
  "schedule": {
    "enabled": true,
    "dayOfWeek": "sunday",
    "time": "03:00"
  },
  "api": {
    "rateLimit": {
      "requestsPerMinute": 60,
      "delaySeconds": 1.0
    },
    "retries": {
      "maxAttempts": 3,
      "backoffSeconds": 5
    }
  },
  "cache": {
    "maxAgeHours": 168,
    "forceRefresh": false
  },
  "logging": {
    "level": "INFO",
    "rotateAfterDays": 7,
    "maxLogFiles": 7
  },
  "paths": {
    "base": "A:\\Development\\Version Control\\Github\\TCSGO",
    "pricesJson": "data/prices.json",
    "caseOddsDir": "Case-Odds",
    "logsDir": "logs/price-refresher"
  }
}
```

### 3. Windows Scheduler Setup Script (`services/setup-price-refresher.bat`)

**Features:**
- Creates Windows scheduled task
- Runs on boot (delayed start)
- Runs on schedule (configurable day/time)
- Logs to file

**Usage:**
```bash
# Run as Administrator
services\setup-price-refresher.bat
```

### 4. Test Suite (`services/test-price-refresher.py`)

**Tests:**
- Validate prices.json schema
- Test API connectivity
- Test rate limiting
- Test error handling
- Test dry-run mode
- Test backup creation

**Usage:**
```bash
python services/test-price-refresher.py
```

### 5. Documentation (`services/PRICE-REFRESHER-README.md`)

**Sections:**
- Overview
- Installation
  - Prerequisites
  - Setup instructions
  - Windows Task Scheduler setup
- Configuration
  - All config options explained
  - Examples
- Usage
  - Manual run
  - Dry-run mode
  - Testing
- Scheduling
  - How to change day of week
  - How to change time
  - How to disable/enable
- Troubleshooting
  - Common errors
  - API rate limits
  - Network issues
- Logging
  - Where logs are stored
  - How to read logs
  - Log rotation

---

## Testing Requirements

### Test Cases

1. **Manual Run Test:**
   ```bash
   python services/price-refresher.py --dry-run
   ```
   Expected: Shows prices that would be fetched, no changes to files

2. **Actual Run Test:**
   ```bash
   python services/price-refresher.py
   ```
   Expected: Fetches prices, updates prices.json, creates backup

3. **API Rate Limit Test:**
   - Fetch 100+ items
   - Verify requests are spaced 1 second apart
   - Verify no 429 errors

4. **Error Handling Test:**
   - Disconnect network mid-fetch
   - Verify retries happen
   - Verify existing prices preserved on failure

5. **Configuration Test:**
   - Change dayOfWeek to "monday"
   - Change time to "14:00"
   - Verify changes take effect

6. **Backup Test:**
   - Run refresh
   - Verify `prices.json.backup.<timestamp>` created
   - Verify backup has old prices

7. **Schema Validation Test:**
   - Run test suite
   - Verify prices.json structure unchanged
   - Verify all required fields present

---

## Constraints

### Must Haves
- ✅ Works on Windows 10/11
- ✅ Python standard library only (or common packages)
- ✅ Configurable schedule
- ✅ Respects API rate limits
- ✅ Comprehensive error handling
- ✅ Detailed logging
- ✅ Dry-run mode for testing
- ✅ Backup before updating
- ✅ Complete documentation

### Nice to Haves
- 📊 Progress bar during fetch
- 📈 Statistics (how many prices updated, avg price change)
- 🔔 Email/notification on completion
- 📉 Price change alerts (if price drops/rises >10%)
- 🎯 Smart scheduling (skip if recently updated)

### Must Not Do
- ❌ Modify inventories.json
- ❌ Delete existing prices
- ❌ Change config values in prices.json
- ❌ Exceed API rate limits
- ❌ Run multiple instances simultaneously

---

## Success Criteria

The service is successful when:

1. **It runs without manual intervention:**
   - ✅ Starts on boot
   - ✅ Runs on schedule
   - ✅ Handles errors gracefully

2. **It updates prices correctly:**
   - ✅ Fetches from Steam Market API
   - ✅ Updates prices.json
   - ✅ Preserves schema
   - ✅ Creates backups

3. **It's easy to configure:**
   - ✅ User can change day/time in 1 file
   - ✅ No code changes needed
   - ✅ Clear documentation

4. **It's reliable:**
   - ✅ Respects rate limits
   - ✅ Retries on failure
   - ✅ Logs all operations
   - ✅ Doesn't corrupt data

5. **It's tested:**
   - ✅ All test cases pass
   - ✅ Dry-run works
   - ✅ Error handling works

---

## Example Workflow

### Initial Setup (5 minutes)
```bash
# 1. Install (if needed)
cd /d "A:\Development\Version Control\Github\TCSGO"
python -m pip install requests

# 2. Test connectivity
python services/test-price-refresher.py

# 3. Dry run
python services/price-refresher.py --dry-run

# 4. Real run
python services/price-refresher.py

# 5. Setup scheduler
services\setup-price-refresher.bat
```

### Changing Schedule

Edit `services/price-refresher-config.json`:
```json
{
  "schedule": {
    "dayOfWeek": "monday",  // Changed from "sunday"
    "time": "14:00"         // Changed from "03:00"
  }
}
```

Re-run setup:
```bash
services\setup-price-refresher.bat
```

---

## Additional Context

### Current Price Values

Most cases: $5-$50 CAD  
Most keys: $35 CAD  
Most items: $0.10-$500 CAD  

**Outliers:**
- Rare knives: $500-$5000 CAD
- Common skins: $0.03-$0.50 CAD

**Expected Updates:**
- ~140 cases
- ~10 key types
- ~4,200 items (but only fetch popular ones to save time)

**Total API Calls:** ~500-1000 per full refresh

**Time Estimate:** 8-17 minutes (at 1 req/second)

### Error Scenarios to Handle

1. **Network down:** Retry 3x, then keep existing prices
2. **API rate limit (429):** Wait 60 seconds, retry
3. **Invalid response:** Log error, keep existing price
4. **Corrupted prices.json:** Restore from backup
5. **Disk full:** Log error, abort safely
6. **Concurrent access:** Lock file mechanism

---

## Request to Claude Opus

Please create the complete Price Refresh Service following all requirements above.

**Deliverables:**
1. `services/price-refresher.py` - Main service
2. `services/price-refresher-config.json` - Configuration
3. `services/setup-price-refresher.bat` - Windows scheduler setup
4. `services/test-price-refresher.py` - Test suite
5. `services/PRICE-REFRESHER-README.md` - Complete documentation

**Testing:**
- Test all functionality
- Verify dry-run works
- Verify actual updates work
- Document any issues found
- Provide test results

**Documentation:**
- Clear installation steps
- Configuration examples
- Usage examples
- Troubleshooting guide
- FAQ section

**Please ensure:**
- Code is production-ready
- Error handling is comprehensive
- Logging is detailed
- Configuration is intuitive
- Documentation is complete
- Testing is thorough

Thank you!
