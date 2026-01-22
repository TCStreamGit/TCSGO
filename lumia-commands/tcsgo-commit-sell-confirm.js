/**
 * TCSGO Commit: Sell Confirm
 * ===========================
 * Lumia Custom Command - Correct Pattern
 */

async function() {
    const TCSGO_BASE = 'A:\\Development\\Version Control\\Github\\TCSGO';

    const CONFIG = {
        basePath: TCSGO_BASE,
        paths: { inventories: 'data/inventories.json', prices: 'data/prices.json' }
    };

    function buildPath(rel) { 
        const b = CONFIG.basePath.replace(/\\/g, '/').replace(/\/$/, ''); 
        const r = rel.replace(/\\/g, '/').replace(/^\//, ''); 
        return b ? `${b}/${r}` : r; 
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
            await writeFile(buildPath(rel), JSON.stringify(data, null, 2)); 
            return true; 
        } catch (e) { 
            log(`[TCSGO] saveJson: ${e.message}`); 
            return false; 
        } 
    }

    function buildUserKey(p, u) { 
        return `${p.toLowerCase()}:${u.toLowerCase()}`; 
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

    const RT = 'sell-confirm-result';
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const token = '{{token}}' !== '{{' + 'token}}' ? '{{token}}' : '{{message}}';
    
    if (!username) { 
        const err = errorResponse(RT, 'MISSING_USERNAME', 'Username required');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    if (!token) { 
        const err = errorResponse(RT, 'MISSING_TOKEN', 'Token required');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    const [inv, prices] = await Promise.all([
        loadJson(CONFIG.paths.inventories), 
        loadJson(CONFIG.paths.prices)
    ]);
    
    if (!inv) { 
        const err = errorResponse(RT, 'LOAD_ERROR', 'Failed to load inventories');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    const user = inv.users[buildUserKey(platform, username)];
    if (!user) { 
        const err = errorResponse(RT, 'USER_NOT_FOUND', 'User not found');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    if (!user.pendingSell) { 
        const err = errorResponse(RT, 'NO_PENDING_SELL', 'No pending sell');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    if (user.pendingSell.token !== token) { 
        const err = errorResponse(RT, 'INVALID_TOKEN', 'Invalid token');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    if (Date.now() >= new Date(user.pendingSell.expiresAt).getTime()) { 
        user.pendingSell = null; 
        const err = errorResponse(RT, 'TOKEN_EXPIRED', 'Token expired');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    const oid = user.pendingSell.oid;
    const idx = user.items.findIndex(i => i.oid === oid);
    
    if (idx === -1) { 
        user.pendingSell = null; 
        const err = errorResponse(RT, 'ITEM_NOT_FOUND', 'Item gone');
        const errStr = JSON.stringify(err);
        overlaySendCustomContent({ codeId: 'tcsgo-controller', content: errStr });
        setVariable({ name: 'tcsgo_last_event_json', value: errStr });
        log(errStr);
        done();
        return;
    }
    
    const credit = user.pendingSell.creditAmount;
    const fee = prices?.marketFeePercent || 10;
    
    user.items.splice(idx, 1);
    user.chosenCoins = (user.chosenCoins || 0) + credit;
    const soldItem = { ...user.pendingSell.itemSummary, oid };
    user.pendingSell = null;
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
        oid, 
        item: soldItem, 
        creditedCoins: credit, 
        newBalance: user.chosenCoins, 
        marketFeePercent: fee 
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
