/**
 * TCSGO Commit: Buy Case
 * =======================
 * 
 * Lumia Custom JavaScript Command
 * 
 * INPUT (via extraSettings or message parsing):
 *   - platform: string (e.g., "twitch")
 *   - username: string
 *   - alias: string (case alias like "chroma")
 *   - qty: number (default 1)
 *   - eventId: string (optional, for idempotency)
 * 
 * OUTPUT (returned to overlay):
 *   {
 *     type: "buycase-result",
 *     ok: true/false,
 *     data?: { caseId, qty, newCount, displayName },
 *     error?: { code, message }
 *   }
 * 
 * SETUP:
 *   1. Create Lumia Custom JavaScript command named "tcsgo-buycase"
 *   2. Paste this entire file into the JavaScript tab
 *   3. Configure trigger (chat command, etc.)
 *   4. UPDATE basePath below to match your system!
 * 
 * MANUAL TEST:
 *   Input: { platform: "twitch", username: "testuser", alias: "chroma", qty: 1 }
 *   Expected: Adds 1 chroma-case to testuser's inventory
 */

// =============================================================================
// CONFIGURATION - UPDATE THIS!
// =============================================================================

const CONFIG = {
    basePath: '/Users/nike/Github/TCSGO',
    paths: {
        inventories: 'data/inventories.json',
        aliases: 'data/case-aliases.json'
    }
};

// =============================================================================
// UTILITY FUNCTIONS (copied from tcsgo-core.js)
// =============================================================================

function buildPath(relativePath) {
    const base = CONFIG.basePath.replace(/\\/g, '/');
    const rel = relativePath.replace(/\\/g, '/');
    return `${base}/${rel}`;
}

async function loadJson(relativePath) {
    try {
        const fullPath = buildPath(relativePath);
        const content = await readFile(fullPath);
        return JSON.parse(content);
    } catch (e) {
        log(`[TCSGO] loadJson error: ${e.message}`);
        return null;
    }
}

async function saveJson(relativePath, data) {
    try {
        const fullPath = buildPath(relativePath);
        const json = JSON.stringify(data, null, 2);
        await writeFile(fullPath, json);
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
            userKey: userKey,
            createdAt: new Date().toISOString(),
            chosenCoins: 0,
            cases: {},
            keys: {},
            items: [],
            pendingSell: null
        };
    }
    return inventories.users[userKey];
}

function addCases(user, caseId, qty) {
    if (!user.cases[caseId]) {
        user.cases[caseId] = 0;
    }
    user.cases[caseId] += qty;
}

function successResponse(type, data) {
    return {
        type: type,
        ok: true,
        timestamp: new Date().toISOString(),
        data: data
    };
}

function errorResponse(type, code, message, details = null) {
    return {
        type: type,
        ok: false,
        timestamp: new Date().toISOString(),
        error: { code, message, details }
    };
}

// =============================================================================
// MAIN COMMAND LOGIC
// =============================================================================

async function main() {
    const RESPONSE_TYPE = 'buycase-result';
    
    // Parse input from Lumia variables
    // In Lumia, you can access variables like {{platform}}, {{username}}, etc.
    // Or from extraSettings if called via Overlay.callCommand()
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const alias = '{{alias}}' !== '{{' + 'alias}}' ? '{{alias}}' : '{{message}}';
    const qtyStr = '{{qty}}' !== '{{' + 'qty}}' ? '{{qty}}' : '1';
    const qty = Math.max(1, parseInt(qtyStr, 10) || 1);
    
    // Validate input
    if (!username) {
        const result = errorResponse(RESPONSE_TYPE, 'MISSING_USERNAME', 'Username is required');
        log(JSON.stringify(result));
        done();
        return;
    }
    
    if (!alias) {
        const result = errorResponse(RESPONSE_TYPE, 'MISSING_ALIAS', 'Case alias is required');
        log(JSON.stringify(result));
        done();
        return;
    }
    
    // Load aliases
    const aliasData = await loadJson(CONFIG.paths.aliases);
    if (!aliasData) {
        const result = errorResponse(RESPONSE_TYPE, 'LOAD_ERROR', 'Failed to load case aliases');
        log(JSON.stringify(result));
        done();
        return;
    }
    
    // Resolve alias
    const aliasKey = alias.toLowerCase().trim();
    const caseAlias = aliasData.aliases[aliasKey];
    if (!caseAlias) {
        const result = errorResponse(RESPONSE_TYPE, 'UNKNOWN_ALIAS', `Unknown case alias: ${alias}`);
        log(JSON.stringify(result));
        done();
        return;
    }
    
    const caseId = caseAlias.caseId;
    const displayName = caseAlias.displayName;
    
    // Load inventories
    const inventories = await loadJson(CONFIG.paths.inventories);
    if (!inventories) {
        const result = errorResponse(RESPONSE_TYPE, 'LOAD_ERROR', 'Failed to load inventories');
        log(JSON.stringify(result));
        done();
        return;
    }
    
    // Get/create user and add cases
    const userKey = buildUserKey(platform, username);
    const user = getOrCreateUser(inventories, userKey);
    
    addCases(user, caseId, qty);
    
    const newCount = user.cases[caseId];
    
    // Save inventories
    inventories.lastModified = new Date().toISOString();
    const saved = await saveJson(CONFIG.paths.inventories, inventories);
    
    if (!saved) {
        const result = errorResponse(RESPONSE_TYPE, 'SAVE_ERROR', 'Failed to save inventories');
        log(JSON.stringify(result));
        done();
        return;
    }
    
    // Success response
    const result = successResponse(RESPONSE_TYPE, {
        userKey: userKey,
        caseId: caseId,
        displayName: displayName,
        qty: qty,
        newCount: newCount
    });
    
    log(JSON.stringify(result));
    
    // Optionally send to overlay
    // Overlay.callCommand('tcsgo-overlay-update', { payload: result });
    
    done();
}

main();
