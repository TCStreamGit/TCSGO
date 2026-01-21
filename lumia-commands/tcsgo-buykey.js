/**
 * TCSGO: Buy Key
 * ===============
 * 
 * Lumia Custom JavaScript Command
 * Command Name: tcsgo-buykey
 * 
 * INPUT (via extraSettings or message parsing):
 *   - platform: string (e.g., "twitch")
 *   - username: string
 *   - keyId: string (default "default")
 *   - qty: number (default 1)
 *   - eventId: string (optional, for idempotency)
 * 
 * OUTPUT (returned to overlay):
 *   {
 *     type: "buykey-result",
 *     ok: true/false,
 *     data?: { keyId, qty, newCount },
 *     error?: { code, message }
 *   }
 * 
 * SETUP:
 *   1. Create Lumia Custom JavaScript command named "tcsgo-buykey"
 *   2. Paste this entire file into the JavaScript tab
 *   3. Configure trigger (chat command, etc.)
 *   4. UPDATE basePath below to match your system!
 */

// =============================================================================
// CONFIGURATION - UPDATE THIS!
// =============================================================================

const CONFIG = {
    basePath: '/Users/nike/Github/TCSGO',
    paths: {
        inventories: 'data/inventories.json'
    }
};

// =============================================================================
// UTILITY FUNCTIONS
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

function addKeys(user, keyId, qty) {
    if (!user.keys[keyId]) {
        user.keys[keyId] = 0;
    }
    user.keys[keyId] += qty;
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
    const RESPONSE_TYPE = 'buykey-result';
    
    // Parse input from Lumia variables
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const keyId = '{{keyId}}' !== '{{' + 'keyId}}' ? '{{keyId}}' : 'default';
    const qtyStr = '{{qty}}' !== '{{' + 'qty}}' ? '{{qty}}' : '1';
    const qty = Math.max(1, parseInt(qtyStr, 10) || 1);
    
    // Validate input
    if (!username) {
        const result = errorResponse(RESPONSE_TYPE, 'MISSING_USERNAME', 'Username is required');
        log(JSON.stringify(result));
        done();
        return;
    }
    
    // Load inventories
    const inventories = await loadJson(CONFIG.paths.inventories);
    if (!inventories) {
        const result = errorResponse(RESPONSE_TYPE, 'LOAD_ERROR', 'Failed to load inventories');
        log(JSON.stringify(result));
        done();
        return;
    }
    
    // Get/create user and add keys
    const userKey = buildUserKey(platform, username);
    const user = getOrCreateUser(inventories, userKey);
    
    addKeys(user, keyId, qty);
    
    const newCount = user.keys[keyId];
    
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
        keyId: keyId,
        qty: qty,
        newCount: newCount
    });
    
    log(JSON.stringify(result));
    done();
}

main();
