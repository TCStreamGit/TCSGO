/**
 * TCSGO Commit: Buy Case
 * =======================
 * 
 * PORTABLE SETUP: Set Lumia working dir to TCSGO root, OR set TCSGO_BASE below.
 */

const TCSGO_BASE = '';  // e.g., 'A:\Development\Version Control\Github\TCSGO'

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

async function main() {
    const RT = 'buycase-result';
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const alias = '{{alias}}' !== '{{' + 'alias}}' ? '{{alias}}' : '{{message}}';
    const qty = Math.max(1, parseInt('{{qty}}' !== '{{' + 'qty}}' ? '{{qty}}' : '1', 10) || 1);
    
    if (!username) { log(JSON.stringify(errorResponse(RT, 'MISSING_USERNAME', 'Username required'))); done(); return; }
    if (!alias) { log(JSON.stringify(errorResponse(RT, 'MISSING_ALIAS', 'Alias required'))); done(); return; }
    
    const aliasData = await loadJson(CONFIG.paths.aliases);
    if (!aliasData) { log(JSON.stringify(errorResponse(RT, 'LOAD_ERROR', 'Failed to load aliases'))); done(); return; }
    
    const ca = aliasData.aliases[alias.toLowerCase().trim()];
    if (!ca) { log(JSON.stringify(errorResponse(RT, 'UNKNOWN_ALIAS', `Unknown: ${alias}`))); done(); return; }
    
    const inv = await loadJson(CONFIG.paths.inventories);
    if (!inv) { log(JSON.stringify(errorResponse(RT, 'LOAD_ERROR', 'Failed to load inventories'))); done(); return; }
    
    const user = getOrCreateUser(inv, buildUserKey(platform, username));
    user.cases[ca.caseId] = (user.cases[ca.caseId] || 0) + qty;
    inv.lastModified = new Date().toISOString();
    
    if (!await saveJson(CONFIG.paths.inventories, inv)) { log(JSON.stringify(errorResponse(RT, 'SAVE_ERROR', 'Save failed'))); done(); return; }
    
    log(JSON.stringify(successResponse(RT, { userKey: user.userKey, caseId: ca.caseId, displayName: ca.displayName, qty, newCount: user.cases[ca.caseId] })));
    done();
}

main();
