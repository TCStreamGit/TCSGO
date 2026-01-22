/**
 * TCSGO Commit: Buy Case
 * =======================
 * Lumia Custom Command - Correct Pattern
 */

async function() {
    const TCSGO_BASE = 'A:\\Development\\Version Control\\Github\\TCSGO';
    
    const CONFIG = {
        basePath: TCSGO_BASE,
        paths: { inventories: 'data/inventories.json', aliases: 'data/case-aliases.json' }
    };

    function buildPath(rel) {
        const base = CONFIG.basePath.replace(/\\/g, '/').replace(/\/$/, '');
        const r = rel.replace(/\\/g, '/').replace(/^\//, '');
        return base ? `${base}/${r}` : r;
    }

    async function loadJson(rel) {
        try { return JSON.parse(await readFile(buildPath(rel))); }
        catch (e) { log(`[TCSGO] loadJson error: ${e.message}`); return null; }
    }

    async function saveJson(rel, data) {
        try { await writeFile(buildPath(rel), JSON.stringify(data, null, 2)); return true; }
        catch (e) { log(`[TCSGO] saveJson error: ${e.message}`); return false; }
    }

    function buildUserKey(p, u) { return `${p.toLowerCase()}:${u.toLowerCase()}`; }

    function getOrCreateUser(inv, key) {
        if (!inv.users[key]) {
            inv.users[key] = { userKey: key, createdAt: new Date().toISOString(), chosenCoins: 0, cases: {}, keys: {}, items: [], pendingSell: null };
        }
        return inv.users[key];
    }

    function successResponse(type, data) { return { type, ok: true, timestamp: new Date().toISOString(), data }; }
    function errorResponse(type, code, msg, det = null) { return { type, ok: false, timestamp: new Date().toISOString(), error: { code, message: msg, details: det } }; }

    // =========================================================================
    // MAIN LOGIC
    // =========================================================================
    
    const RT = 'buycase-result';
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const alias = '{{alias}}' !== '{{' + 'alias}}' ? '{{alias}}' : '{{message}}';
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
    
    if (!alias) {
        const err = errorResponse(RT, 'MISSING_ALIAS', 'Alias required');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    const aliasData = await loadJson(CONFIG.paths.aliases);
    if (!aliasData) {
        const err = errorResponse(RT, 'LOAD_ERROR', 'Failed to load aliases');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    const ca = aliasData.aliases[alias.toLowerCase().trim()];
    if (!ca) {
        const err = errorResponse(RT, 'UNKNOWN_ALIAS', `Unknown: ${alias}`);
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
    user.cases[ca.caseId] = (user.cases[ca.caseId] || 0) + qty;
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
        caseId: ca.caseId, 
        displayName: ca.displayName, 
        qty, 
        newCount: user.cases[ca.caseId] 
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
