# TCSGO System - Updated Plan (January 2026)

**Architecture:** Overlay Controller v2.0  
**Status:** MVP Complete, Ready for Migration & Testing

---

## Current Architecture (What You Have)

```
Viewer Chat (!buycase, !open, !sell)
         ↓
Overlay Controller (case-opening)
  ✓ Parses chat commands
  ✓ Validates loyalty points
  ✓ Deducts/credits via Overlay API
  ✓ Calls backend commit commands
  ✓ Handles refunds on failure
  ✓ Dual-receive reliability (event + polling)
         ↓
Backend Commands (tcsgo-commit-*)
  ✓ tcsgo-commit-open
  ✓ tcsgo-commit-buycase
  ✓ tcsgo-commit-buykey
  ✓ tcsgo-commit-sell-start
  ✓ tcsgo-commit-sell-confirm
  ✓ tcsgo-core (shared utilities)
         ↓
Local JSON Storage
  ✓ data/inventories.json
  ✓ data/prices.json
  ✓ data/case-aliases.json
```

**What's Complete:**
- ✅ Case alias system (auto-generated + manual overrides)
- ✅ Asset organization pipeline (99.7% items matched to images)
- ✅ Backend commands with dual-receive
- ✅ Overlay controller with buy/sell/open flows
- ✅ Trade lock system (7 days)
- ✅ Price caching with fallbacks
- ✅ 140+ cases with odds

**What's Pending:**
- ⏸️ Old obsolete commands still exist (need cleanup)
- ⏸️ End-to-end testing not done
- ⏸️ Git auto-sync watcher (optional)
- ⏸️ Price refresh service (boot + weekly)
- ⏸️ Animated case opening reel
- ⏸️ Read-only chatbot commands (!help, !cases, !inventory)

---

## Immediate Plan (MVP Completion)

### Phase 1: Migration & Cleanup (Today - 20 minutes)

**Goal:** Remove obsolete commands and verify system integrity

**Tasks:**
1. **Backup everything** (Git commit + manual copy)
2. **Delete obsolete commands:**
   - Lumia: Delete `!tcsgo-open`, `!tcsgo-buycase`, `!tcsgo-buykey`, `!tcsgo-sell-start`, `!tcsgo-sell-confirm`
   - Filesystem: Delete corresponding `.js` files
3. **Verify commit commands exist:**
   - Lumia: Confirm `!tcsgo-commit-*` commands present
   - Filesystem: Verify files exist with Windows paths
4. **Update paths if needed:**
   - Search for `/Users/nike/Github/TCSGO` (Mac path)
   - Replace with `A:\\Development\\Version Control\\Github\\TCSGO`
5. **Verify dual-receive:**
   - Check backend commands end with `overlaySendCustomContent()` + `setVariable()`

**Deliverable:** Clean system with only active commands  
**Reference:** Use `MIGRATION-CHECKLIST.md`

---

### Phase 2: End-to-End Testing (Today - 30 minutes)

**Goal:** Verify complete workflow works from viewer chat to inventory updates

**Test Cases:**

#### Test 1: Buy Case
```
Input:  !buycase dreams 2
Expected:
  - Overlay resolves alias: dreams → dreams-nightmares-case
  - Overlay checks price: 1,500 x 2 = 3,000 coins
  - Overlay checks balance (must have ≥3,000)
  - Overlay deducts 3,000 coins
  - Overlay calls tcsgo-commit-buycase
  - Backend updates inventories.json
  - Overlay receives result (event or polling)
  - Shows: "@tcstream Bought 2x Dreams & Nightmares Case!"
Verify:
  - Open data/inventories.json
  - Check cases.dreams-nightmares-case = 2
```

#### Test 2: Buy Key
```
Input:  !buykey 3
Expected:
  - Overlay checks price: 3,500 x 3 = 10,500 coins
  - Overlay deducts 10,500 coins
  - Backend updates keys.csgo-case-key
  - Shows: "@tcstream Bought 3x Key(s)!"
Verify:
  - Check keys.csgo-case-key = 3
```

#### Test 3: Open Case
```
Input:  !open dreams
Expected:
  - Overlay calls tcsgo-commit-open
  - Backend validates case count ≥1, key count ≥1
  - Backend rolls winner (rarity → item → wear → statTrak)
  - Backend consumes 1 case, 1 key
  - Backend adds item to items[] with:
    - Unique oid
    - acquiredAt timestamp
    - lockedUntil = acquiredAt + 7 days
    - priceSnapshot from prices.json
  - Overlay shows winner card
  - Shows: "@tcstream opened AK-47 | Elite Build (Field-Tested)!"
Verify:
  - cases.dreams-nightmares-case decreased by 1
  - keys.csgo-case-key decreased by 1
  - New item in items[] array
  - lockedUntil is 7 days from now
```

#### Test 4: Sell (Trade Locked)
```
Input:  !sell <oid of recently won item>
Expected:
  - Backend checks lockedUntil > now
  - Returns error: ITEM_LOCKED
  - Shows: "@tcstream Item is trade locked. Wait 6 days, 23 hours."
Verify:
  - No sell token created
  - Item still in inventory
```

#### Test 5: Sell (Unlocked) - Skip for now, or manually edit lockedUntil
```
Setup:  Temporarily set lockedUntil to past date in inventories.json
Input:  !sell <oid>
Expected:
  - Backend creates sell token (60s expiry)
  - Shows: "@tcstream Selling AK-47... for 765 coins. Type: !sellconfirm <token>"
Verify:
  - pendingSell object exists with token + expiresAt

Input:  !sellconfirm <token>
Expected:
  - Backend validates token + expiry
  - Backend removes item from items[]
  - Backend clears pendingSell
  - Overlay credits 765 coins
  - Shows: "@tcstream Sold AK-47! +765 coins."
Verify:
  - Item removed from items[]
  - pendingSell cleared
  - Loyalty points increased by 765
```

#### Test 6: Timeout & Refund
```
Setup:  Temporarily break tcsgo-commit-buycase (add throw new Error())
Input:  !buycase c2 1
Expected:
  - Overlay deducts 1,500 coins
  - Backend command fails
  - Overlay waits 3 seconds (ackTimeoutMs)
  - Timeout triggers
  - Overlay refunds 1,500 coins
  - Shows: "@tcstream Purchase failed. Points refunded."
Verify:
  - Loyalty points back to original amount
  - No case added to inventory
```

**Deliverable:** All 6 tests pass (Test 5 optional)  
**Time:** 30 minutes with manual testing

---

### Phase 3: Documentation & Commit (Today - 10 minutes)

**Goal:** Lock in the current working state

**Tasks:**
1. **Replace README:**
   ```bash
   cd /d "A:\Development\Version Control\Github\TCSGO"
   move README.md README-OLD.md
   move README-CLEANED.md README.md
   ```

2. **Create status file:**
   ```bash
   echo Migration completed: January 22, 2026 > SYSTEM-STATUS.txt
   echo Architecture: Overlay Controller v2.0 >> SYSTEM-STATUS.txt
   echo Active commands: tcsgo-commit-* only >> SYSTEM-STATUS.txt
   echo MVP Status: Complete, tested, ready for production >> SYSTEM-STATUS.txt
   ```

3. **Git commit:**
   ```bash
   git add .
   git commit -m "MVP complete - overlay controller architecture, obsolete commands removed"
   git push origin main
   ```

**Deliverable:** Clean Git history, updated documentation

---

## Post-MVP Enhancements (Future Work)

### Enhancement 1: Animated Case Opening Reel

**Goal:** CSGO-style spinning reel animation instead of instant reveal

**What it looks like:**
- Horizontal reel of items scrolling left
- Tick sound as items pass
- Slowdown effect as winner approaches
- Stop on center with rarity glow + sound effect

**Effort:** 2-3 hours (overlay JS/CSS animation)  
**Priority:** High (greatly improves viewer experience)  
**Status:** Not started

---

### Enhancement 2: Git Auto-Sync Watcher

**Goal:** Automatically commit/push inventory changes to GitHub

**How it works:**
- Python watchdog script monitors `data/inventories.json`
- On file change: 5-second debounce
- Auto-runs: `git add`, `git commit`, `git push`
- Runs as background Windows service

**Effort:** 1 hour (Python script + Windows Task Scheduler)  
**Priority:** Medium (nice backup, not critical)  
**Status:** Not started

**Script location:** `tools/tcsgo_git_sync_watch.py`

---

### Enhancement 3: Price Refresh Service

**Goal:** Keep prices.json up-to-date with real market data

**How it works:**
- **Boot refresh:** On VM startup, update prices for items in inventories
- **Weekly refresh:** Every Sunday, full refresh of all known items
- Calls external price API (e.g., Steam Market, CSGOFloat)
- Respects rate limits
- Updates `lastBootRefreshAt` and `lastFullRefreshAt` timestamps

**Effort:** 3-4 hours (Python script + API integration + scheduler)  
**Priority:** Medium (fallback prices work fine, but real data is better)  
**Status:** Not started

**Script location:** `tools/price_updater.py`

---

### Enhancement 4: Read-Only Chatbot Commands

**Goal:** Info commands that don't need overlay (Nightbot/Streamlabs)

**Commands:**
- `!help [page]` - Show command help (paginated)
- `!cases [page] [tag]` - List available cases with prices
- `!inventory [page]` - Show user's inventory

**How it works:**
- Deployed as Nightbot custom commands
- Fetch data from GitHub raw URLs:
  - `https://raw.githubusercontent.com/.../data/case-aliases.json`
  - `https://raw.githubusercontent.com/.../data/inventories.json`
- Return formatted text response

**Effort:** 2 hours (write commands, test, deploy to Nightbot)  
**Priority:** Low (nice to have, not critical)  
**Status:** Not started

---

### Enhancement 5: Souvenir Package Support

**Goal:** Support opening souvenir packages from major tournaments

**What's different:**
- Schema 3.1 (different tier keys: consumer/industrial/milspec/etc)
- No key required (self-contained packages)
- Stickers from specific matches/players

**Effort:** 1-2 hours (extend roll logic + schema support)  
**Priority:** Low (only 10-15 souvenir packages vs 130+ regular cases)  
**Status:** Partially complete (schema defined, not tested)

---

### Enhancement 6: Admin Commands

**Goal:** Streamer/mod tools for managing system

**Commands:**
- `!grantcoins <user> <amount>` - Give loyalty points
- `!resetuser <user>` - Clear user's inventory
- `!resetall` - Emergency full reset

**How it works:**
- Handled in overlay (admin-only)
- Checks Lumia role permissions
- Calls special admin backend commands

**Effort:** 2 hours (overlay checks + backend commands)  
**Priority:** Medium (useful for fixing issues during stream)  
**Status:** Not started

---

## Long-Term Roadmap (Optional)

### Multi-Viewer Trading System
- Trade offers between viewers
- Trade lock validation
- Escrow system (both confirm before swap)

**Effort:** 10-15 hours  
**Priority:** Very Low (complex, needs UI)

### Inventory Showcase Page
- Web page showing all viewer inventories
- Sortable by value, rarity, date
- Hosted on GitHub Pages

**Effort:** 5-6 hours  
**Priority:** Low (cool feature, not essential)

### Daily Login Rewards
- Daily bonus coins for active viewers
- Streak tracking
- Special cases for long streaks

**Effort:** 3-4 hours  
**Priority:** Low (engagement feature)

---

## Prioritized Task List (Next 30 Days)

### Week 1 (This Week)
- [x] Create cleaned README
- [x] Create migration checklist
- [x] Create updated plan
- [ ] **Execute migration** (Phase 1 - 20 min)
- [ ] **End-to-end testing** (Phase 2 - 30 min)
- [ ] **Deploy to production Lumia** (Phase 3 - 10 min)
- [ ] **First live stream test** (monitor for errors)

### Week 2
- [ ] Implement animated case opening reel
- [ ] Test reel animation with 10+ case opens
- [ ] Deploy reel to production

### Week 3
- [ ] Implement Git auto-sync watcher
- [ ] Set up Windows Task Scheduler
- [ ] Monitor for 1 week to verify stability

### Week 4
- [ ] Implement price refresh service (boot + weekly)
- [ ] Set up Sunday weekly refresh
- [ ] Verify prices update correctly

### Future (Low Priority)
- [ ] Read-only chatbot commands
- [ ] Admin commands
- [ ] Souvenir package testing
- [ ] Advanced features (trading, showcase, etc)

---

## Success Metrics

**MVP Complete When:**
- ✅ Migration checklist 100% complete
- ✅ All 6 test cases pass
- ✅ Documentation updated
- ✅ Production deployment successful
- ✅ First live stream with zero errors

**System Healthy When:**
- ✅ Zero missing items in asset reports
- ✅ 100% alias resolution rate
- ✅ Zero overlay timeout errors
- ✅ Inventory JSON file size stable
- ✅ Average command response < 500ms

**User Experience Good When:**
- ✅ Case opens feel responsive (< 2s from chat to animation)
- ✅ No point deduction errors
- ✅ Trade locks clearly communicated
- ✅ Price displays are accurate (within 10% of market)

---

## Decision Log

### Why Overlay Controller Architecture?
**Problem:** Lumia chat commands cannot reliably check/modify loyalty points  
**Solution:** Move ALL currency operations to overlay, backend only mutates files  
**Trade-off:** More complex overlay code, but reliable currency management

### Why Dual-Receive (Event + Polling)?
**Problem:** Lumia event system sometimes drops messages  
**Solution:** Primary event listener + polling fallback every 250ms  
**Trade-off:** Extra polling overhead, but zero dropped results

### Why Local JSON Files?
**Problem:** Remote APIs are slow, unreliable during stream  
**Solution:** Local files as system of record, optional Git sync for backup  
**Trade-off:** Must manage file I/O, but fast and deterministic

### Why 7-Day Trade Lock?
**Problem:** Instant selling reduces item value perception  
**Solution:** CSGO-style trade lock creates scarcity + anticipation  
**Trade-off:** Viewers must wait, but increases engagement long-term

### Why Copy Assets Per Case?
**Problem:** Runtime filename guessing is error-prone  
**Solution:** Generate deterministic copies with paths embedded in JSON  
**Trade-off:** Disk space (300MB assets), but zero lookup failures

---

## File Organization Summary

### Active Files (Keep & Maintain)
```
lumia-commands/
  ✓ tcsgo-commit-open.js
  ✓ tcsgo-commit-buycase.js
  ✓ tcsgo-commit-buykey.js
  ✓ tcsgo-commit-sell-start.js
  ✓ tcsgo-commit-sell-confirm.js
  ✓ tcsgo-core.js

lumia-overlays/case-opening/
  ✓ overlay.html
  ✓ script.js
  ✓ style.css
  ✓ configs.json

data/
  ✓ inventories.json (system of record)
  ✓ prices.json (cached prices)
  ✓ case-aliases.json (generated)
  ✓ case-aliases.manual.json (manual overrides)

tools/
  ✓ build_case_aliases.py
  ✓ rename_assets.py
```

### Obsolete Files (Delete During Migration)
```
lumia-commands/
  ✗ tcsgo-open.js (replaced by tcsgo-commit-open.js)
  ✗ tcsgo-buycase.js (replaced by tcsgo-commit-buycase.js)
  ✗ tcsgo-buykey.js (replaced by tcsgo-commit-buykey.js)
  ✗ tcsgo-sell-start.js (replaced by tcsgo-commit-sell-start.js)
  ✗ tcsgo-sell-confirm.js (replaced by tcsgo-commit-sell-confirm.js)
```

### Optional Files (Keep If Useful)
```
lumia-commands/
  ? tcsgo-checkprice.js (read-only utility, no harm keeping it)
```

---

## Risk Assessment

### Low Risk Items
- Migration (full backups available)
- Documentation updates (non-code changes)
- Testing (read-only operations)

### Medium Risk Items
- Deleting obsolete commands (might delete wrong files)
  - **Mitigation:** Use checklist, backup first
- Path updates (typos could break everything)
  - **Mitigation:** Test one command at a time

### High Risk Items
- Production deployment (affects live stream)
  - **Mitigation:** Test in non-stream environment first
- Inventory JSON corruption (data loss)
  - **Mitigation:** Git commits after every change, auto-sync watcher

### Zero Risk Items (Already Working)
- Asset organization (99.7% complete)
- Case alias system (140+ cases working)
- Backend command logic (tested, working)

---

## Questions to Answer Before Migration

1. **Do you have a backup of your current system?**
   - [ ] Yes (Git commit + manual copy)
   - [ ] No (create backup first)

2. **Are you ready to delete the old commands?**
   - [ ] Yes (I understand they're obsolete)
   - [ ] No (I want to keep them temporarily)

3. **Do you have a test environment or will you test in production?**
   - [ ] Test environment available
   - [ ] Production only (will test carefully)

4. **What's your rollback plan if migration fails?**
   - [ ] Git revert to backup commit
   - [ ] Manual restore from backup folder
   - [ ] No plan yet (create one first)

---

## Next Action (Right Now)

**Immediate:** Execute MIGRATION-CHECKLIST.md (20 minutes)

**Then:** Run end-to-end tests (30 minutes)

**Finally:** Deploy to production Lumia (10 minutes)

**Total Time to MVP:** ~1 hour

After MVP complete, you'll have a clean, working overlay controller system ready for your next stream! 🎉

---

**Last Updated:** January 22, 2026  
**Architecture:** Overlay Controller v2.0  
**Status:** Ready for Migration
