/**
 * TCSGO: Sell Start
 * ==================
 * 
 * Lumia Custom JavaScript Command
 * Command Name: tcsgo-sell-start
 * 
 * INPUT (via extraSettings or message parsing):
 *   - platform: string (e.g., "twitch")
 *   - username: string
 *   - oid: string (owned item ID)
 *   - eventId: string (optional)
 * 
 * OUTPUT (returned to overlay):
 *   {
 *     type: "sell-start-result",
 *     ok: true/false,
 *     data?: { token, oid, expiresAt, item, creditAmount },
 *     error?: { code, message, details }
 *   }
 * 
 * BEHAVIOR:
 *   - Validates item exists and belongs to user
 *   - Checks trade lock (blocks if now < lockedUntil)
 *   - Creates a sell token with 60-second expiration
 *   - Stores pendingSell on user record
 *   - Returns token and item info for confirmation UI
 * 
 * SETUP:
 *   1. Create Lumia Custom JavaScript command named "tcsgo-sell-start"
 *   2. Paste this entire file into the JavaScript tab
 *   3. UPDATE basePath below to match your system!
 */

// =============================================================================
// CONFIGURATION - UPDATE THIS!
// =============================================================================

const CONFIG = {
    basePath: '/Users/nike/Github/TCSGO',
    paths: {
        inventories: 'data/inventories.json',
        prices: 'data/prices.json'
    },
    sellTokenExpirationSeconds: 60
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

function generateSellToken() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 12);
    return `sell_${ts}_${rand}`;
}

function checkLock(lockedUntil) {
    const unlockTime = new Date(lockedUntil).getTime();
    const now = Date.now();
    const remainingMs = Math.max(0, unlockTime - now);
    return {
        locked: remainingMs > 0,
        remainingMs: remainingMs,
        remainingFormatted: formatDuration(remainingMs)
    };
}

function formatDuration(ms) {
    if (ms <= 0) return '0s';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function calculateCreditAfterFee(coins, feePercent) {
    return Math.floor(coins * (1 - feePercent / 100));
}

function successResponse(type, data) {
    return { type, ok: true, timestamp: new Date().toISOString(), data };
}

function errorResponse(type, code, message, details = null) {
    return { type, ok: false, timestamp: new Date().toISOString(), error: { code, message, details } };
}

// =============================================================================
// MAIN COMMAND LOGIC
// =============================================================================

async function main() {
    const RESPONSE_TYPE = 'sell-start-result';
    
    // Parse input
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const oid = '{{oid}}' !== '{{' + 'oid}}' ? '{{oid}}' : '{{message}}';
    
    // Validate input
    if (!username) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'MISSING_USERNAME', 'Username is required')));
        done();
        return;
    }
    
    if (!oid) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'MISSING_OID', 'Item OID is required')));
        done();
        return;
    }
    
    // Load data
    const [inventories, prices] = await Promise.all([
        loadJson(CONFIG.paths.inventories),
        loadJson(CONFIG.paths.prices)
    ]);
    
    if (!inventories || !prices) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'LOAD_ERROR', 'Failed to load data files')));
        done();
        return;
    }
    
    // Get user
    const userKey = buildUserKey(platform, username);
    const user = inventories.users[userKey];
    
    if (!user) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'USER_NOT_FOUND', 'User not found')));
        done();
        return;
    }
    
    // Find item
    const item = user.items.find(i => i.oid === oid);
    if (!item) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'ITEM_NOT_FOUND', 'Item not found in your inventory', { oid })));
        done();
        return;
    }
    
    // Check trade lock
    const lockStatus = checkLock(item.lockedUntil);
    if (lockStatus.locked) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'ITEM_LOCKED', 
            `Item is trade locked for ${lockStatus.remainingFormatted}`, 
            { lockedUntil: item.lockedUntil, remainingMs: lockStatus.remainingMs }
        )));
        done();
        return;
    }
    
    // Check for existing pending sell
    if (user.pendingSell) {
        const existingExpires = new Date(user.pendingSell.expiresAt).getTime();
        if (Date.now() < existingExpires) {
            log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'PENDING_SELL_EXISTS', 
                'You already have a pending sell. Confirm or wait for it to expire.', 
                { existingOid: user.pendingSell.oid, expiresAt: user.pendingSell.expiresAt }
            )));
            done();
            return;
        }
        // Clear expired pending sell
        user.pendingSell = null;
    }
    
    // Calculate credit amount
    const itemPrice = item.priceSnapshot?.chosenCoins || 0;
    const marketFee = prices.marketFeePercent || 10;
    const creditAmount = calculateCreditAfterFee(itemPrice, marketFee);
    
    // Create sell token
    const token = generateSellToken();
    const expiresAt = new Date(Date.now() + CONFIG.sellTokenExpirationSeconds * 1000).toISOString();
    
    user.pendingSell = {
        token: token,
        oid: oid,
        expiresAt: expiresAt,
        itemSummary: {
            displayName: item.displayName,
            rarity: item.rarity,
            statTrak: item.statTrak,
            wear: item.wear
        },
        creditAmount: creditAmount
    };
    
    // Save
    inventories.lastModified = new Date().toISOString();
    const saved = await saveJson(CONFIG.paths.inventories, inventories);
    
    if (!saved) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'SAVE_ERROR', 'Failed to save data')));
        done();
        return;
    }
    
    // Success
    const result = successResponse(RESPONSE_TYPE, {
        token: token,
        oid: oid,
        expiresAt: expiresAt,
        expiresInSeconds: CONFIG.sellTokenExpirationSeconds,
        item: {
            displayName: item.displayName,
            rarity: item.rarity,
            tier: item.tier,
            statTrak: item.statTrak,
            wear: item.wear,
            priceSnapshot: item.priceSnapshot
        },
        creditAmount: creditAmount,
        marketFeePercent: marketFee
    });
    
    log(JSON.stringify(result));
    done();
}

main();
