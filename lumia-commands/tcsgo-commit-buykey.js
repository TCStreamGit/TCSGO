/**
 * TCSGO Commit: Buy Key
 * ======================
 * Lumia Custom Command - Correct Pattern
 */

async function() {
    const TCSGO_BASE = 'A:\\Development\\Version Control\\Github\\TCSGO';
    
    const CONFIG = {
        basePath: TCSGO_BASE,
        paths: { inventories: 'data/inventories.json' }
    };

    function normalizeWinPath(p) {
        return String(p || "")
          .trim()
          .replace(/[\\/]+/g, "\\")
          .replace(/\\$/, "");
      }
      
      function buildPath(rel) {
        const base = normalizeWinPath(CONFIG.basePath);
        const r = normalizeWinPath(rel).replace(/^\\+/, "");
        return base ? `${base}\\${r}` : r;
      }
          

    async function loadJson(rel) { 
        try { 
            return JSON.parse(await readFile(buildPath(rel))); 
        } catch (e) { 
            log(`[TCSGO] loadJson: ${e.message}`); 
            return null; 
        } 
    }

    async function saveJson(rel, data) {
        try {
          const path = buildPath(rel);
          const content = JSON.stringify(data, null, 2);
      
          await writeFile(path, content);
      
          // Verify (Handles Silent Failures + CRLF Differences)
          const verify = await readFile(path);
          const norm = (s) => String(s ?? "").replace(/\r\n/g, "\n");
      
          if (norm(verify) !== norm(content)) {
            throw new Error("Write Verification Failed");
          }
      
          return true;
        } catch (e) {
          log(`[TCSGO] saveJson: ${e.message}`);
          return false;
        }
      }
      

    function buildUserKey(p, u) { 
        return `${p.toLowerCase()}:${u.toLowerCase()}`; 
    }

    function getOrCreateUser(inv, key) { 
        if (!inv.users[key]) {
            inv.users[key] = { 
                userKey: key, 
                createdAt: new Date().toISOString(), 
                chosenCoins: 0, 
                cases: {}, 
                keys: {}, 
                items: [], 
                pendingSell: null 
            }; 
        }
        return inv.users[key]; 
    }

    function successResponse(t, d) { 
        return { type: t, ok: true, timestamp: new Date().toISOString(), data: d }; 
    }

    function errorResponse(t, c, m, det = null) { 
        return { type: t, ok: false, timestamp: new Date().toISOString(), error: { code: c, message: m, details: det } }; 
    }

    // =========================================================================
    // MAIN LOGIC
    // =========================================================================

    const RT = 'buykey-result';
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const keyId = '{{keyId}}' !== '{{' + 'keyId}}' ? '{{keyId}}' : 'csgo-case-key';
    const qty = Math.max(1, parseInt('{{qty}}' !== '{{' + 'qty}}' ? '{{qty}}' : '1', 10) || 1);
    
    if (!username) { 
        const err = errorResponse(RT, 'MISSING_USERNAME', 'Username required');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    const inv = await loadJson(CONFIG.paths.inventories);
    if (!inv) { 
        const err = errorResponse(RT, 'LOAD_ERROR', 'Failed to load inventories');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    const user = getOrCreateUser(inv, buildUserKey(platform, username));
    user.keys[keyId] = (user.keys[keyId] || 0) + qty;
    inv.lastModified = new Date().toISOString();
    
    if (!await saveJson(CONFIG.paths.inventories, inv)) { 
        const err = errorResponse(RT, 'SAVE_ERROR', 'Save failed');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    // SUCCESS - Build final result
    const result = successResponse(RT, { 
        userKey: user.userKey, 
        keyId, 
        qty, 
        newCount: user.keys[keyId] 
    });
    
    // DUAL-RECEIVE: Send via both event system and variable polling
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
}
