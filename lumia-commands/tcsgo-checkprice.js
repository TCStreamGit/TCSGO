/**
 * TCSGO: Check Price
 * ===================
 * 
 * Lumia Custom JavaScript Command
 * Command Name: tcsgo-checkprice
 * 
 * INPUT (via extraSettings or message parsing):
 *   - platform: string (e.g., "twitch")
 *   - username: string
 *   - oid: string (preferred) OR itemId: string
 * 
 * OUTPUT (returned to overlay):
 *   {
 *     type: "checkprice-result",
 *     ok: true/false,
 *     data?: {
 *       oid, itemId, displayName, wear, statTrak, variant, lockedUntil,
 *       priceKey,
 *       price: { cad, chosenCoins, isEstimated, updatedAt? }
 *     },
 *     error?: { code, message }
 *   }
 * 
 * BEHAVIOR:
 *   - If oid provided: looks up item in user's inventory
 *   - Uses priceKey to find exact price in prices.items
 *   - If exact price missing: computes fallback from rarityFallbackPrices + wearMultipliers + statTrakMultiplier
 *   - Marks isEstimated=true when using fallback pricing
 * 
 * PRICE KEY FORMAT:
 *   "<itemId>|<wear>|<statTrak01>|<variant>"
 *   Example: "ak-47-elite-build|Factory New|1|None"
 * 
 * SETUP:
 *   1. Create Lumia Custom JavaScript command named "tcsgo-checkprice"
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

function buildUserKey(platform, username) {
    return `${platform.toLowerCase()}:${username.toLowerCase()}`;
}

/**
 * Build priceKey for an item
 * Format: "itemId|wear|statTrak01|variant"
 */
function buildPriceKey(itemId, wear, statTrak, variant) {
    const stFlag = statTrak ? '1' : '0';
    const variantStr = variant || 'None';
    return `${itemId}|${wear}|${stFlag}|${variantStr}`;
}

/**
 * Parse priceKey back to components
 */
function parsePriceKey(priceKey) {
    const parts = priceKey.split('|');
    if (parts.length !== 4) return null;
    return {
        itemId: parts[0],
        wear: parts[1],
        statTrak: parts[2] === '1',
        variant: parts[3]
    };
}

/**
 * Get price for an item, with fallback to rarity-based pricing
 */
function getPrice(prices, itemId, wear, statTrak, variant, rarity) {
    const priceKey = buildPriceKey(itemId, wear, statTrak, variant);
    
    // Try exact priceKey lookup first
    if (prices.items && prices.items[priceKey]) {
        const cached = prices.items[priceKey];
        return {
            cad: cached.cad,
            chosenCoins: cached.chosenCoins,
            isEstimated: false,
            updatedAt: cached.updatedAt,
            priceKey: priceKey
        };
    }
    
    // Fallback to rarity-based pricing
    const fallbackRarity = rarity || 'mil-spec';
    const fallback = prices.rarityFallbackPrices?.[fallbackRarity];
    
    if (!fallback) {
        return {
            cad: 0.10,
            chosenCoins: 100,
            isEstimated: true,
            priceKey: priceKey
        };
    }
    
    let baseCad = fallback.cad;
    
    // Apply wear multiplier
    const wearMult = prices.wearMultipliers?.[wear] || 1.0;
    baseCad *= wearMult;
    
    // Apply StatTrak multiplier
    if (statTrak) {
        baseCad *= prices.statTrakMultiplier || 2.0;
    }
    
    return {
        cad: Math.round(baseCad * 100) / 100,
        chosenCoins: Math.round(baseCad * (prices.cadToCoins || 1000)),
        isEstimated: true,
        priceKey: priceKey
    };
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
    const RESPONSE_TYPE = 'checkprice-result';
    
    // Parse input
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const oid = '{{oid}}' !== '{{' + 'oid}}' ? '{{oid}}' : null;
    const itemIdInput = '{{itemId}}' !== '{{' + 'itemId}}' ? '{{itemId}}' : null;
    
    // Validate input
    if (!username) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'MISSING_USERNAME', 'Username is required')));
        done();
        return;
    }
    
    if (!oid && !itemIdInput) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'MISSING_IDENTIFIER', 'Either oid or itemId is required')));
        done();
        return;
    }
    
    // Load data
    const [inventories, prices] = await Promise.all([
        loadJson(CONFIG.paths.inventories),
        loadJson(CONFIG.paths.prices)
    ]);
    
    if (!prices) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'LOAD_ERROR', 'Failed to load prices data')));
        done();
        return;
    }
    
    // If oid provided, look up item in inventory
    if (oid) {
        if (!inventories) {
            log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'LOAD_ERROR', 'Failed to load inventories')));
            done();
            return;
        }
        
        const userKey = buildUserKey(platform, username);
        const user = inventories.users?.[userKey];
        
        if (!user) {
            log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'USER_NOT_FOUND', 'User not found')));
            done();
            return;
        }
        
        const item = user.items.find(i => i.oid === oid);
        if (!item) {
            log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'ITEM_NOT_FOUND', 'Item not found in your inventory', { oid })));
            done();
            return;
        }
        
        // Get price for the owned item
        const priceInfo = getPrice(
            prices,
            item.itemId,
            item.wear,
            item.statTrak,
            item.variant || 'None',
            item.rarity
        );
        
        const lockStatus = checkLock(item.lockedUntil);
        
        const result = successResponse(RESPONSE_TYPE, {
            oid: item.oid,
            itemId: item.itemId,
            displayName: item.displayName,
            wear: item.wear,
            statTrak: item.statTrak,
            variant: item.variant || 'None',
            rarity: item.rarity,
            lockedUntil: item.lockedUntil,
            lockStatus: {
                locked: lockStatus.locked,
                remainingFormatted: lockStatus.remainingFormatted
            },
            priceKey: priceInfo.priceKey,
            price: {
                cad: priceInfo.cad,
                chosenCoins: priceInfo.chosenCoins,
                isEstimated: priceInfo.isEstimated,
                updatedAt: priceInfo.updatedAt || null
            }
        });
        
        log(JSON.stringify(result));
        done();
        return;
    }
    
    // If only itemId provided, we need wear/statTrak/variant from input
    // This is a simpler lookup mode - just check the price for given params
    const wear = '{{wear}}' !== '{{' + 'wear}}' ? '{{wear}}' : 'Field-Tested';
    const statTrakStr = '{{statTrak}}' !== '{{' + 'statTrak}}' ? '{{statTrak}}' : 'false';
    const statTrak = statTrakStr === 'true' || statTrakStr === '1';
    const variant = '{{variant}}' !== '{{' + 'variant}}' ? '{{variant}}' : 'None';
    const rarity = '{{rarity}}' !== '{{' + 'rarity}}' ? '{{rarity}}' : 'mil-spec';
    
    const priceInfo = getPrice(prices, itemIdInput, wear, statTrak, variant, rarity);
    
    const result = successResponse(RESPONSE_TYPE, {
        oid: null,
        itemId: itemIdInput,
        displayName: null, // Not available without case JSON lookup
        wear: wear,
        statTrak: statTrak,
        variant: variant,
        rarity: rarity,
        lockedUntil: null,
        lockStatus: null,
        priceKey: priceInfo.priceKey,
        price: {
            cad: priceInfo.cad,
            chosenCoins: priceInfo.chosenCoins,
            isEstimated: priceInfo.isEstimated,
            updatedAt: priceInfo.updatedAt || null
        }
    });
    
    log(JSON.stringify(result));
    done();
}

main();
