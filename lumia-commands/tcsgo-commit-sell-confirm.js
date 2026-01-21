/**
 * TCSGO Commit: Sell Confirm
 * ===========================
 * 
 * Lumia Custom JavaScript Command
 * 
 * INPUT (via extraSettings or message parsing):
 *   - platform: string (e.g., "twitch")
 *   - username: string
 *   - token: string (sell token from sell-start)
 *   - eventId: string (optional)
 * 
 * OUTPUT (returned to overlay):
 *   {
 *     type: "sell-confirm-result",
 *     ok: true/false,
 *     data?: { oid, item, creditedCoins, marketFee },
 *     error?: { code, message, details }
 *   }
 * 
 * BEHAVIOR:
 *   - Validates token matches pending sell
 *   - Validates token not expired
 *   - Removes item from inventory
 *   - Clears pending sell
 *   - Returns creditedCoins for overlay to add via Lumia loyalty points
 * 
 * NOTE: This command returns the credited amount but does NOT add loyalty points.
 * The overlay must call Overlay.addLoyaltyPoints() with the returned amount.
 * 
 * SETUP:
 *   1. Create Lumia Custom JavaScript command named "tcsgo-sell-confirm"
 *   2. Paste this entire file into the JavaScript tab
 *   3. UPDATE basePath below to match your system!
 * 
 * MANUAL TEST:
 *   Input: { platform: "twitch", username: "testuser", token: "sell_abc123" }
 *   Pre-condition: testuser has pendingSell with matching token, not expired
 *   Expected: Removes item, clears pendingSell, returns credited coins
 */

// =============================================================================
// CONFIGURATION - UPDATE THIS!
// =============================================================================

const CONFIG = {
    basePath: '/Users/nike/Github/TCSGO',
    paths: {
        inventories: 'data/inventories.json',
        prices: 'data/prices.json'
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
    const RESPONSE_TYPE = 'sell-confirm-result';
    
    // Parse input
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const token = '{{token}}' !== '{{' + 'token}}' ? '{{token}}' : '{{message}}';
    
    // Validate input
    if (!username) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'MISSING_USERNAME', 'Username is required')));
        done();
        return;
    }
    
    if (!token) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'MISSING_TOKEN', 'Sell token is required')));
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
    
    // Check pending sell exists
    if (!user.pendingSell) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'NO_PENDING_SELL', 'No pending sell found. Start a sell first.')));
        done();
        return;
    }
    
    // Validate token
    if (user.pendingSell.token !== token) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'INVALID_TOKEN', 'Token does not match pending sell', { expected: user.pendingSell.token })));
        done();
        return;
    }
    
    // Check expiration
    const expiresAt = new Date(user.pendingSell.expiresAt).getTime();
    if (Date.now() > expiresAt) {
        user.pendingSell = null;
        inventories.lastModified = new Date().toISOString();
        await saveJson(CONFIG.paths.inventories, inventories);
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'TOKEN_EXPIRED', 'Sell token has expired. Please start a new sell.')));
        done();
        return;
    }
    
    // Find and remove item
    const oid = user.pendingSell.oid;
    const itemIndex = user.items.findIndex(i => i.oid === oid);
    
    if (itemIndex === -1) {
        user.pendingSell = null;
        inventories.lastModified = new Date().toISOString();
        await saveJson(CONFIG.paths.inventories, inventories);
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'ITEM_NOT_FOUND', 'Item no longer exists in inventory', { oid })));
        done();
        return;
    }
    
    const item = user.items.splice(itemIndex, 1)[0];
    
    // Calculate credited amount
    const itemPrice = item.priceSnapshot?.chosenCoins || 0;
    const marketFee = prices.marketFeePercent || 10;
    const creditedCoins = calculateCreditAfterFee(itemPrice, marketFee);
    const feeAmount = itemPrice - creditedCoins;
    
    // Clear pending sell
    const soldItemSummary = user.pendingSell.itemSummary;
    user.pendingSell = null;
    
    // Save
    inventories.lastModified = new Date().toISOString();
    const saved = await saveJson(CONFIG.paths.inventories, inventories);
    
    if (!saved) {
        // Attempt to restore item
        user.items.push(item);
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'SAVE_ERROR', 'Failed to save. Item not removed.')));
        done();
        return;
    }
    
    // Success - NOTE: Overlay must add loyalty points!
    const result = successResponse(RESPONSE_TYPE, {
        oid: oid,
        item: {
            displayName: item.displayName,
            rarity: item.rarity,
            tier: item.tier,
            statTrak: item.statTrak,
            wear: item.wear,
            priceSnapshot: item.priceSnapshot
        },
        creditedCoins: creditedCoins,
        feeAmount: feeAmount,
        marketFeePercent: marketFee,
        message: `Sold! ${creditedCoins} coins will be credited. Overlay must call addLoyaltyPoints().`
    });
    
    log(JSON.stringify(result));
    done();
}

main();
