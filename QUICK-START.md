# TCSGO Quick Start Guide

**Last Updated:** January 22, 2026  
**Current Status:** ✅ Ready for Testing

---

## 🚀 You Are Here

```
[✅✅✅✅✅✅✅✅✅✅] Phase 1-5 Complete (100%)
[████████░░░░░░░░░░░░] Phase 6 Testing (40%)
```

**What's Done:**
- ✅ All 5 backend commands fixed (correct Lumia pattern)
- ✅ Overlay controller working
- ✅ Dual-receive reliability implemented
- ✅ Documentation complete
- ✅ Windows paths configured

**What's Next:**
- ⏳ Run test commands
- ⏳ Verify system works end-to-end
- ⏳ Deploy to production

---

## 📝 Files You Just Created

1. **README.md** (30KB) - Complete system documentation
   - Installation guide
   - Architecture explanation
   - Testing procedures
   - Troubleshooting guide
   - Configuration reference

2. **PROJECT-PLAN.md** (15KB) - Project status & roadmap
   - What's complete
   - What's testing
   - What's next (post-MVP)
   - Timeline & metrics
   - Lessons learned

---

## ⚡ Next Steps (Do This Now)

### Step 1: Update Commands in Lumia (5 minutes)

Open Lumia Stream → Settings → Commands

For each command, replace content with the `-FIXED.js` version:

| Lumia Command Name | Copy From File |
|--------------------|----------------|
| `tcsgo-commit-buycase` | `lumia-commands\tcsgo-commit-buycase-FIXED.js` |
| `tcsgo-commit-buykey` | `lumia-commands\tcsgo-commit-buykey-FIXED.js` |
| `tcsgo-commit-open` | `lumia-commands\tcsgo-commit-open-FIXED.js` |
| `tcsgo-commit-sell-start` | `lumia-commands\tcsgo-commit-sell-start-FIXED.js` |
| `tcsgo-commit-sell-confirm` | `lumia-commands\tcsgo-commit-sell-confirm-FIXED.js` |

**Critical:** Verify each command starts with:
```javascript
async function() {
    const TCSGO_BASE = 'A:\\Development\\Version Control\\Github\\TCSGO';
    // ... rest of code
    done();
}
```

### Step 2: Enable Debug Mode (1 minute)

Edit `lumia-overlays\case-opening\configs.json`:
```json
{
  "debugMode": true
}
```

Reload overlay in Lumia.

### Step 3: Run First Test (2 minutes)

In your Twitch chat (or test chat), type:
```
!buycase c2 1
```

**Take a screenshot of:**
1. Overlay debug console (F12)
2. Chat window
3. Any toast notifications

Send me the screenshot!

---

## 📸 What I Need From You

### Debug Screenshot Should Show:

```
[✓] [Debug] [Data] Aliases Fetched | aliases=540
[✓] [Debug] [Data] Prices Fetched
[✓] [Debug] [Data] Load Complete
[✓] [Debug] [Events] Registered overlaycontent + chat
[✓] [Debug] [Polling] Started | intervalMs=250
[✓] [Debug] [Init] Controller Ready

[ℹ] [Chat] Command: buycase Args: ['c2', '1'] User: your-username
[ℹ] [BuyCase] Case: Chroma 2 Case, Price: 1500, Qty: 1, Total: 1500
[ℹ] [BuyCase] User points: 50000
[ℹ] [BuyCase] Deducted points, new balance: 48500
[ℹ] [Commit] Called: tcsgo-commit-buycase eventId: evt_xyz123
[✓] [Router] Processing event: buycase-result evt_xyz123
[✓] [Router] Matched pending event, resolving
```

---

## 🧪 Test Sequence

After I review your first test, run these in order:

### Test 2: Buy Key
```
!buykey 1
```

### Test 3: Open Case
```
!open c2
```

### Test 4: Unknown Alias (Should Fail)
```
!buycase fakealias 1
```

---

## 🆘 If Something Goes Wrong

### Commands Don't Execute

**Check:**
1. Commands exist in Lumia with exact names: `tcsgo-commit-*`
2. Each command starts with `async function() {`
3. Each command has Windows path: `A:\\Development\\...`
4. Overlay is enabled in Lumia

### "Unknown alias" Error

**Fix:**
```bash
cd /d "A:\Development\Version Control\Github\TCSGO"
python tools\build_case_aliases.py
```

Then use a known alias: `c2`, `c3`, `cs20`, or `dz`

### Timeout / No Response

**Check:**
1. Command logs in Lumia (Settings → Logs)
2. Look for errors in command execution
3. Verify dual-receive code at end of each command:
   ```javascript
   overlaySendCustomContent({...});
   setVariable({...});
   log(payloadStr);
   done();
   ```

---

## 📚 Additional Resources

- **README.md** - Full system documentation
- **PROJECT-PLAN.md** - Project status & roadmap
- **MIGRATION-CHECKLIST.md** - Step-by-step migration guide (if needed)

---

## ✅ Success Criteria

**Test 1 passes when:**
- ✅ Chat shows: "@username Bought 1x Chroma 2 Case!"
- ✅ Toast shows: "Case Purchased"
- ✅ Points deducted from balance
- ✅ `data/inventories.json` shows case count increased

**If successful:** Continue to Test 2  
**If failed:** Send debug screenshot and I'll diagnose

---

## 🎯 Your Mission

1. ✅ Update 5 commands in Lumia
2. ✅ Enable debug mode
3. ⏳ Run `!buycase c2 1`
4. ⏳ Take screenshot
5. ⏳ Send me the screenshot

**I'm ready to help debug!** 🚀
