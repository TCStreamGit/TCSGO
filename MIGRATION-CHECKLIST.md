# TCSGO Migration Checklist - Cleanup & Verification

**Purpose:** Remove obsolete commands and verify the overlay controller architecture is working correctly.

**Estimated Time:** 15-20 minutes

---

## Phase 1: Backup (5 minutes)

### ☐ 1.1 Backup Current System

Before making any changes, create a full backup:

```bash
cd /d "A:\Development\Version Control\Github\TCSGO"

# Option A: Git commit
git add .
git commit -m "Backup before migration - [DATE]"
git push origin main

# Option B: Manual copy
# Copy entire TCSGO folder to: A:\Backups\TCSGO-backup-[DATE]
```

**Verify:** Backup exists and contains:
- `lumia-commands/` folder
- `lumia-overlays/` folder
- `data/` folder

---

## Phase 2: Delete Obsolete Commands (3 minutes)

### ☐ 2.1 Delete Old Non-Commit Commands

These commands are **obsolete** and replaced by `tcsgo-commit-*` versions:

**In Lumia Stream:**
1. Open Lumia Stream
2. Go to: Settings → Commands
3. Delete these commands:
   - `!tcsgo-open`
   - `!tcsgo-buycase`
   - `!tcsgo-buykey`
   - `!tcsgo-sell-start`
   - `!tcsgo-sell-confirm`

**On Filesystem:**
Delete these files from `A:\Development\Version Control\Github\TCSGO\lumia-commands\`:
- `tcsgo-open.js`
- `tcsgo-buycase.js`
- `tcsgo-buykey.js`
- `tcsgo-sell-start.js`
- `tcsgo-sell-confirm.js`

**Keep this one (optional utility):**
- `tcsgo-checkprice.js` - Can be kept as a read-only command if desired

### ☐ 2.2 Verify Commit Commands Exist

**In Lumia Stream, verify these commands exist:**
- `!tcsgo-commit-open`
- `!tcsgo-commit-buycase`
- `!tcsgo-commit-buykey`
- `!tcsgo-commit-sell-start`
- `!tcsgo-commit-sell-confirm`
- `!tcsgo-core` (shared utilities)

**On Filesystem, verify these files exist:**
- `tcsgo-commit-open.js`
- `tcsgo-commit-buycase.js`
- `tcsgo-commit-buykey.js`
- `tcsgo-commit-sell-start.js`
- `tcsgo-commit-sell-confirm.js`
- `tcsgo-core.js`

---

## Phase 3: Verify Paths (5 minutes)

### ☐ 3.1 Check All Command File Paths

Open each `tcsgo-commit-*.js` file and verify the base path is:

```javascript
const TCSGO_BASE = 'A:\\Development\\Version Control\\Github\\TCSGO';
```

**Files to check:**
- `tcsgo-commit-open.js`
- `tcsgo-commit-buycase.js`
- `tcsgo-commit-buykey.js`
- `tcsgo-commit-sell-start.js`
- `tcsgo-commit-sell-confirm.js`
- `tcsgo-core.js`

**Search pattern:** Look for `/Users/nike/Github/TCSGO` (old Mac path)  
**Replace with:** `A:\\Development\\Version Control\\Github\\TCSGO` (Windows path)

### ☐ 3.2 Verify Data Files Exist

Check that these files exist and are valid JSON:

```bash
cd /d "A:\Development\Version Control\Github\TCSGO\data"
dir
```

**Required files:**
- `inventories.json`
- `prices.json`
- `case-aliases.json`
- `case-aliases.manual.json`

**Test validity:**
Open each file in a text editor and verify it's valid JSON (no syntax errors).

---

## Phase 4: Verify Dual-Receive Implementation (5 minutes)

### ☐ 4.1 Check Backend Commands Have Dual-Return

Open each `tcsgo-commit-*.js` file and verify it ends with:

```javascript
// Build result object
const result = {
  eventId: eventId,
  type: '<command-type>-result',
  ok: true,
  username: username,
  platform: platform,
  error: null,
  data: { /* ... */ }
};

// Dual-return: event system + polling fallback
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

**Files to check:**
- `tcsgo-commit-open.js`
- `tcsgo-commit-buycase.js`
- `tcsgo-commit-buykey.js`
- `tcsgo-commit-sell-start.js`
- `tcsgo-commit-sell-confirm.js`

**If missing:** Update the file to include dual-return code at the end.

---

## Phase 5: Verify Overlay Controller (2 minutes)

### ☐ 5.1 Check Overlay Files Exist

Verify overlay folder exists at:
```
A:\Development\Version Control\Github\TCSGO\lumia-overlays\case-opening\
```

**Required files:**
- `overlay.html`
- `script.js`
- `style.css`
- `configs.json`

### ☐ 5.2 Verify Overlay Calls Commit Commands

Open `lumia-overlays\case-opening\script.js` and search for these function calls:

```javascript
Overlay.callCommand('tcsgo-commit-buycase', {...})
Overlay.callCommand('tcsgo-commit-buykey', {...})
Overlay.callCommand('tcsgo-commit-open', {...})
Overlay.callCommand('tcsgo-commit-sell-start', {...})
Overlay.callCommand('tcsgo-commit-sell-confirm', {...})
```

**If calling `tcsgo-open` (non-commit):** Update to `tcsgo-commit-open`  
**If calling `tcsgo-buycase` (non-commit):** Update to `tcsgo-commit-buycase`  
Etc.

### ☐ 5.3 Verify Overlay Has Dual-Receive Listeners

In `script.js`, verify these exist:

```javascript
// Primary: Event listener
Overlay.on('overlaycontent', (data) => {
  if (data.codeId === 'tcsgo-controller') {
    handleEventResult(data.content);
  }
});

// Fallback: Polling
setInterval(async () => {
  const rawJson = await Overlay.getVariable('tcsgo_last_event_json');
  if (rawJson && rawJson.value) {
    handleEventResult(rawJson.value);
  }
}, 250);
```

---

## Phase 6: Test End-to-End (Optional but Recommended)

### ☐ 6.1 Test Buy Case Flow

1. **Enable overlay** in Lumia Stream
2. **Send test chat:** `!buycase dreams 1`
3. **Expected result:**
   - Overlay checks your loyalty points
   - If sufficient: deducts points, calls backend
   - Backend updates `data/inventories.json`
   - Overlay receives result (via event or polling)
   - Shows confirmation message

**Verify:**
- Open `data/inventories.json`
- Check your user has 1x `dreams-nightmares-case` in `cases` object

### ☐ 6.2 Test Open Case Flow

1. **Send test chat:** `!open dreams`
2. **Expected result:**
   - Overlay calls `tcsgo-commit-open`
   - Backend consumes case + key
   - Backend adds item to inventory
   - Overlay shows winner card

**Verify:**
- Open `data/inventories.json`
- Check case count decreased by 1
- Check new item exists in `items[]` array with:
  - Unique `oid`
  - `lockedUntil` timestamp (7 days from now)
  - `priceSnapshot` value

### ☐ 6.3 Test Sell Flow

1. **Get item OID from inventory:**
   - Open `data/inventories.json`
   - Find an item where `lockedUntil` has passed (or temporarily remove the lock)
   - Copy the `oid`

2. **Send test chat:** `!sell <oid>`
3. **Expected result:**
   - Overlay calls `tcsgo-commit-sell-start`
   - Backend generates sell token
   - Overlay shows: "Type !sellconfirm <token>"

4. **Send confirm chat:** `!sellconfirm <token>`
5. **Expected result:**
   - Overlay calls `tcsgo-commit-sell-confirm`
   - Backend removes item
   - Overlay credits loyalty points
   - Shows confirmation

**Verify:**
- Item removed from `data/inventories.json`
- Your loyalty points increased

---

## Phase 7: Final Cleanup & Documentation

### ☐ 7.1 Update README

Replace old README with the cleaned version:

```bash
cd /d "A:\Development\Version Control\Github\TCSGO"

# Backup old README
move README.md README-OLD-BACKUP.md

# Use new cleaned README
move README-CLEANED.md README.md
```

### ☐ 7.2 Commit Changes

```bash
git add .
git commit -m "Migration complete - removed obsolete commands, updated README"
git push origin main
```

### ☐ 7.3 Document Current State

Create a status file:

```bash
echo Migration completed: [DATE] > MIGRATION-STATUS.txt
echo Active commands: tcsgo-commit-* >> MIGRATION-STATUS.txt
echo Obsolete commands deleted: tcsgo-open, tcsgo-buycase, etc >> MIGRATION-STATUS.txt
echo Architecture: Overlay Controller v2.0 >> MIGRATION-STATUS.txt
```

---

## Troubleshooting

### Issue: Overlay not receiving results

**Symptom:** Commands execute but overlay shows "timeout" errors

**Fix:**
1. Verify dual-receive code exists in backend commands (Phase 4.1)
2. Check Lumia logs for `overlaySendCustomContent` errors
3. Verify polling fallback is running (should see polls every 250ms in console)

### Issue: "File not found" errors in command logs

**Symptom:** Backend commands fail with path errors

**Fix:**
1. Verify paths are correct (Phase 3.1)
2. Check that `data/` folder exists at: `A:\Development\Version Control\Github\TCSGO\data\`
3. Verify all data files exist (Phase 3.2)

### Issue: Alias not resolving

**Symptom:** "Unknown case" error when using short aliases

**Fix:**
1. Rebuild aliases: `python tools\build_case_aliases.py`
2. Verify `data/case-aliases.json` exists and contains expected aliases
3. Check `data/case-aliases.manual.json` for manual overrides

### Issue: Points not being deducted/credited

**Symptom:** Commands execute but loyalty points don't change

**Fix:**
1. Verify overlay script calls `Overlay.addLoyaltyPoints()` for buy commands
2. Verify overlay script calls `Overlay.addLoyaltyPoints()` for sell-confirm
3. Check Lumia has loyalty points enabled for the platform (Twitch/YouTube/etc)

---

## Rollback Plan (If Needed)

If migration fails and you need to rollback:

### Option A: Git Rollback

```bash
cd /d "A:\Development\Version Control\Github\TCSGO"
git log  # Find backup commit hash
git reset --hard <backup-commit-hash>
git push origin main --force
```

### Option B: Manual Restore

1. Delete current TCSGO folder
2. Restore from backup: `A:\Backups\TCSGO-backup-[DATE]`
3. Re-import commands into Lumia from backup folder

---

## Success Criteria

Migration is complete when:

- [x] Old `tcsgo-*` commands deleted from Lumia and filesystem
- [x] Active `tcsgo-commit-*` commands verified in Lumia
- [x] All paths updated to Windows path (`A:\...`)
- [x] Dual-receive implemented in all backend commands
- [x] Overlay calls `tcsgo-commit-*` commands (not `tcsgo-*`)
- [x] End-to-end test successful (buy → open → sell)
- [x] Documentation updated (new README in place)
- [x] Changes committed to Git

**Post-Migration:** You should have a clean, working overlay controller architecture with no obsolete commands.

---

## Next Steps After Migration

Once migration is complete:

1. **Monitor first stream** - Watch for any errors in Lumia logs
2. **Test all commands** - Have mods test buy/open/sell during stream
3. **Verify Git sync** - Check that `data/inventories.json` updates are being committed
4. **Document any issues** - Note any edge cases for future fixes
5. **Plan enhancements** - Review "Next Steps" section in README for future features

---

**Estimated Total Time:** 15-20 minutes  
**Risk Level:** Low (full backups created in Phase 1)  
**Rollback Available:** Yes (Git or manual restore)

Good luck with the migration! 🚀
