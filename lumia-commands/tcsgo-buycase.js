/**
 * TCSGO: Buy Case
 * ================
 * 
 * Lumia Custom JavaScript Command
 * 
 * PORTABLE SETUP:
 *   Set Lumia working dir to TCSGO root, OR set TCSGO_BASE below.
 */

// =============================================================================
// PORTABLE CONFIG
// =============================================================================
const TCSGO_BASE = '';  // e.g., 'A:\Development\Version Control\Github\TCSGO'

const CONFIG = {
    basePath: TCSGO_BASE,
    paths: {
        inventories: 'data/inventories.json',
        aliases: 'data/case-aliases.json'
    }
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function buildPath(relativePath) {
    const base = CONFIG.basePath.replace(/\\/g, '/').replace(/\/$/, '');
    const rel = relativePath.replace(/\\/g, '/').replace(/^\//, '');
    return base ? `${base}/${rel}` : rel;
}

async function loadJson(relativePath) {
    try {
        const content = await readFile(buildPath(relativePath));
        return JSON.parse(content);
    } catch (e) {
        log(`[TCSGO] loadJson error: ${e.message}`);
        return null;
    }
}

async function saveJson(relativePath, data) {
    try {
        await writeFile(buildPath(relativePath), JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        log(`[TCSGO] saveJson error: ${e.message}`);
        return false;
    }
}

function buildUserKey(platform, username) {
    return `${platform.toLowerCase()}:${username.toLowerCase()}`;
}

function getOrCreateUser(inventories, userKey) {
    if (!inventories.users[userKey]) {
        inventories.users[userKey] = {
            userKey, createdAt: new Date().toISOString(),
            chosenCoins: 0, cases: {}, keys: {}, items: [], pendingSell: null
        };
    }
    return inventories.users[userKey];
}

function addCases(user, caseId, qty) {
    user.cases[caseId] = (user.cases[caseId] || 0) + qty;
}

function successResponse(type, data) {
    return { type, ok: true, timestamp: new Date().toISOString(), data };
}

function errorResponse(type, code, message, details = null) {
    return { type, ok: false, timestamp: new Date().toISOString(), error: { code, message, details } };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
    const RESPONSE_TYPE = 'buycase-result';
    
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const alias = '{{alias}}' !== '{{' + 'alias}}' ? '{{alias}}' : '{{message}}';
    const qty = Math.max(1, parseInt('{{qty}}' !== '{{' + 'qty}}' ? '{{qty}}' : '1', 10) || 1);
    
    if (!username) { log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'MISSING_USERNAME', 'Username required'))); done(); return; }
    if (!alias) { log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'MISSING_ALIAS', 'Case alias required'))); done(); return; }
    
    const aliasData = await loadJson(CONFIG.paths.aliases);
    if (!aliasData) { log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'LOAD_ERROR', 'Failed to load aliases'))); done(); return; }
    
    const caseAlias = aliasData.aliases[alias.toLowerCase().trim()];
    if (!caseAlias) { log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'UNKNOWN_ALIAS', `Unknown case: ${alias}`))); done(); return; }
    
    const inventories = await loadJson(CONFIG.paths.inventories);
    if (!inventories) { log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'LOAD_ERROR', 'Failed to load inventories'))); done(); return; }
    
    const userKey = buildUserKey(platform, username);
    const user = getOrCreateUser(inventories, userKey);
    
    addCases(user, caseAlias.caseId, qty);
    inventories.lastModified = new Date().toISOString();
    
    if (!await saveJson(CONFIG.paths.inventories, inventories)) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'SAVE_ERROR', 'Failed to save')));
        done(); return;
    }
    
    log(JSON.stringify(successResponse(RESPONSE_TYPE, {
        userKey, caseId: caseAlias.caseId, displayName: caseAlias.displayName,
        qty, newCount: user.cases[caseAlias.caseId]
    })));
    done();
}

main();
