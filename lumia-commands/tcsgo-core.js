/**
 * TCSGO Core Module v2 - Phase 1 Foundation
 * ==========================================
 * 
 * Lumia Custom JavaScript utility module for local file-based operations.
 * 
 * IMPORTANT: This file contains SHARED FUNCTIONS that should be copied into
 * each commit command file. Lumia Custom JavaScript does not support imports,
 * so you must include the functions you need at the top of each command.
 * 
 * Alternatively, you can load this file using readFile() and eval(), but
 * for reliability, copying the needed functions is recommended.
 * 
 * DATA FILE LOCATIONS (relative to Lumia Stream's working directory):
 *   - Inventories: TCSGO/data/inventories.json
 *   - Aliases:     TCSGO/data/case-aliases.json  
 *   - Prices:      TCSGO/data/prices.json
 *   - Case Odds:   TCSGO/Case-Odds/{filename}.json
 * 
 * NOTE: You must configure BASE_PATH below to match your local setup!
 */

// =============================================================================
// CONFIGURATION - UPDATE THIS PATH!
// =============================================================================

const TCSGO_CONFIG = {
    // Base path to TCSGO folder - UPDATE THIS for your system!
    // Windows example: 'C:\\Users\\YourName\\Documents\\TCSGO'
    // Mac example: '/Users/YourName/Github/TCSGO'
    basePath: '/Users/nike/Github/TCSGO',
    
    // Relative paths from basePath
    paths: {
        inventories: 'data/inventories.json',
        aliases: 'data/case-aliases.json',
        prices: 'data/prices.json',
        caseOdds: 'Case-Odds'
    },
    
    // Default wear distribution (weights must sum to 100)
    wearTable: [
        { name: 'Factory New', weight: 3 },
        { name: 'Minimal Wear', weight: 24 },
        { name: 'Field-Tested', weight: 33 },
        { name: 'Well-Worn', weight: 24 },
        { name: 'Battle-Scarred', weight: 16 }
    ],
    
    // Trade lock duration in days
    tradeLockDays: 7,
    
    // Sell token expiration in seconds
    sellTokenExpirationSeconds: 60
};

const WEAR_TOTAL = TCSGO_CONFIG.wearTable.reduce((sum, w) => sum + w.weight, 0);

// =============================================================================
// FILE I/O UTILITIES
// =============================================================================

/**
 * Build full path from relative path
 */
function buildPath(relativePath) {
    const base = TCSGO_CONFIG.basePath.replace(/\\/g, '/');
    const rel = relativePath.replace(/\\/g, '/');
    return `${base}/${rel}`;
}

/**
 * Load JSON from file path
 * @param {string} relativePath - Path relative to basePath
 * @returns {object|null} Parsed JSON or null on error
 */
async function loadJson(relativePath) {
    try {
        const fullPath = buildPath(relativePath);
        const content = await readFile(fullPath);
        return JSON.parse(content);
    } catch (e) {
        log(`[TCSGO] loadJson error for ${relativePath}: ${e.message}`);
        return null;
    }
}

/**
 * Save JSON to file path (atomic write via temp file)
 * @param {string} relativePath - Path relative to basePath
 * @param {object} data - Object to serialize
 * @returns {boolean} Success status
 */
async function saveJson(relativePath, data) {
    try {
        const fullPath = buildPath(relativePath);
        const json = JSON.stringify(data, null, 2);
        await writeFile(fullPath, json);
        return true;
    } catch (e) {
        log(`[TCSGO] saveJson error for ${relativePath}: ${e.message}`);
        return false;
    }
}

/**
 * Load inventories data file
 */
async function loadInventories() {
    return await loadJson(TCSGO_CONFIG.paths.inventories);
}

/**
 * Save inventories data file
 */
async function saveInventories(data) {
    data.lastModified = new Date().toISOString();
    return await saveJson(TCSGO_CONFIG.paths.inventories, data);
}

/**
 * Load case aliases data file
 */
async function loadAliases() {
    return await loadJson(TCSGO_CONFIG.paths.aliases);
}

/**
 * Load prices data file
 */
async function loadPrices() {
    return await loadJson(TCSGO_CONFIG.paths.prices);
}

/**
 * Load case JSON from Case-Odds folder
 * @param {string} filename - e.g., "Chroma_Case.json"
 */
async function loadCaseJson(filename) {
    const path = `${TCSGO_CONFIG.paths.caseOdds}/${filename}`;
    return await loadJson(path);
}

// =============================================================================
// USER KEY UTILITIES
// =============================================================================

/**
 * Build user key from platform and username
 * Format: "platform:username" (lowercase)
 */
function buildUserKey(platform, username) {
    return `${platform.toLowerCase()}:${username.toLowerCase()}`;
}

/**
 * Parse user key back to components
 */
function parseUserKey(userKey) {
    const [platform, ...usernameParts] = userKey.split(':');
    return { platform, username: usernameParts.join(':') };
}

/**
 * Get or create user in inventories
 */
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

// =============================================================================
// ID GENERATORS
// =============================================================================

/**
 * Generate unique owned item ID
 * Format: oid_timestamp_random
 */
function generateOid() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 11);
    return `oid_${ts}_${rand}`;
}

/**
 * Generate unique event ID
 * Format: evt_timestamp_random
 */
function generateEventId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `evt_${ts}_${rand}`;
}

/**
 * Generate sell token
 * Format: sell_timestamp_random
 */
function generateSellToken() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 12);
    return `sell_${ts}_${rand}`;
}

// =============================================================================
// TRADE LOCK UTILITIES
// =============================================================================

/**
 * Calculate lockedUntil timestamp from acquiredAt
 * @param {string} acquiredAt - ISO timestamp
 * @returns {string} ISO timestamp when item unlocks
 */
function enforceLock(acquiredAt) {
    const acquired = new Date(acquiredAt);
    const lockMs = TCSGO_CONFIG.tradeLockDays * 24 * 60 * 60 * 1000;
    const lockedUntil = new Date(acquired.getTime() + lockMs);
    return lockedUntil.toISOString();
}

/**
 * Check if item is still trade locked
 * @param {string} lockedUntil - ISO timestamp
 * @returns {object} { locked: boolean, remainingMs: number }
 */
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

/**
 * Format milliseconds as human readable duration
 */
function formatDuration(ms) {
    if (ms <= 0) return '0s';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        const remHours = hours % 24;
        return `${days}d ${remHours}h`;
    }
    if (hours > 0) {
        const remMins = minutes % 60;
        return `${hours}h ${remMins}m`;
    }
    if (minutes > 0) {
        const remSecs = seconds % 60;
        return `${minutes}m ${remSecs}s`;
    }
    return `${seconds}s`;
}

// =============================================================================
// ROLL ENGINE
// =============================================================================

/**
 * Roll a random wear value using configured wear table
 * @returns {string} Wear name (e.g., "Factory New")
 */
function rollWear() {
    let roll = Math.random() * WEAR_TOTAL;
    for (const w of TCSGO_CONFIG.wearTable) {
        roll -= w.weight;
        if (roll <= 0) return w.name;
    }
    return TCSGO_CONFIG.wearTable[0].name;
}

/**
 * Roll case opening using case JSON data
 * @param {object} caseJson - Loaded case JSON with unit, case, oddsWeights, tiers, goldPool
 * @returns {object|null} { item, tier, statTrak, wear } or null on error
 */
function rollCaseFromJson(caseJson) {
    const caseData = caseJson.case;
    const unit = BigInt(caseJson.unit?.scale || 1000000000000);
    
    // Step 1: Roll for tier using oddsWeights
    const oddsWeights = caseData.oddsWeights || {};
    const tierRoll = BigInt(Math.floor(Math.random() * Number(unit)));
    
    let cumulative = BigInt(0);
    let selectedTier = null;
    
    for (const [tier, weight] of Object.entries(oddsWeights)) {
        cumulative += BigInt(weight);
        if (tierRoll < cumulative) {
            selectedTier = tier;
            break;
        }
    }
    
    if (!selectedTier) {
        selectedTier = Object.keys(oddsWeights)[0];
    }
    
    // Step 2: Get items from selected tier
    let tierItems = [];
    
    if (selectedTier === 'gold') {
        const goldPool = caseData.goldPool;
        if (goldPool && goldPool !== 'None' && Array.isArray(goldPool.items)) {
            tierItems = goldPool.items;
        }
    } else if (caseData.tiers && Array.isArray(caseData.tiers[selectedTier])) {
        tierItems = caseData.tiers[selectedTier];
    }
    
    if (tierItems.length === 0) {
        log(`[TCSGO] No items in tier: ${selectedTier}`);
        return null;
    }
    
    // Step 3: Roll for item within tier (weighted by base)
    const itemsWithWeights = tierItems.map(item => ({
        item,
        weight: BigInt(item.weights?.base || 1)
    }));
    
    const tierTotal = itemsWithWeights.reduce((sum, i) => sum + i.weight, BigInt(0));
    const itemRoll = BigInt(Math.floor(Math.random() * Number(tierTotal)));
    
    let itemCumulative = BigInt(0);
    let selectedItem = tierItems[0];
    
    for (const { item, weight } of itemsWithWeights) {
        itemCumulative += weight;
        if (itemRoll < itemCumulative) {
            selectedItem = item;
            break;
        }
    }
    
    // Step 4: Determine StatTrak
    let isStatTrak = false;
    
    if (selectedItem.statTrakEligible && caseData.supportsStatTrak) {
        const stWeight = BigInt(selectedItem.weights?.statTrak || 0);
        const nonStWeight = BigInt(selectedItem.weights?.nonStatTrak || 0);
        const totalStWeight = stWeight + nonStWeight;
        
        if (totalStWeight > BigInt(0) && stWeight > BigInt(0)) {
            const stRoll = BigInt(Math.floor(Math.random() * Number(totalStWeight)));
            isStatTrak = stRoll < stWeight;
        }
    }
    
    // Step 5: Roll wear
    const wear = rollWear();
    
    return {
        item: selectedItem,
        tier: selectedTier,
        statTrak: isStatTrak,
        wear: wear
    };
}

// =============================================================================
// PRICE UTILITIES
// =============================================================================

/**
 * Get price snapshot for an item
 * @param {object} prices - Loaded prices.json
 * @param {object} item - Item from case JSON
 * @param {string} wear - Wear name
 * @param {boolean} statTrak - Is StatTrak
 * @returns {object} { cad, chosenCoins }
 */
function getPriceSnapshot(prices, item, wear, statTrak) {
    const rarity = item.rarity || 'mil-spec';
    
    // Try item-specific price first
    const itemPrices = prices.itemVariantPrices?.[item.itemId];
    if (itemPrices && itemPrices[wear]) {
        const variantPrice = statTrak ? itemPrices[wear].statTrak : itemPrices[wear].normal;
        if (variantPrice !== undefined) {
            return {
                cad: variantPrice,
                chosenCoins: Math.round(variantPrice * prices.cadToCoins)
            };
        }
    }
    
    // Fall back to rarity price with multipliers
    const fallback = prices.rarityFallbackPrices?.[rarity];
    if (!fallback) {
        return { cad: 0.10, chosenCoins: 100 };
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
        chosenCoins: Math.round(baseCad * prices.cadToCoins)
    };
}

/**
 * Calculate credited coins after market fee
 * @param {number} coins - Original coin value
 * @param {number} feePercent - Fee percentage (e.g., 10 for 10%)
 * @returns {number} Coins credited to user
 */
function calculateCreditAfterFee(coins, feePercent) {
    return Math.floor(coins * (1 - feePercent / 100));
}

// =============================================================================
// RESPONSE BUILDERS
// =============================================================================

/**
 * Build success response
 */
function successResponse(type, data) {
    return {
        type: type,
        ok: true,
        timestamp: new Date().toISOString(),
        data: data
    };
}

/**
 * Build error response
 */
function errorResponse(type, code, message, details = null) {
    return {
        type: type,
        ok: false,
        timestamp: new Date().toISOString(),
        error: {
            code: code,
            message: message,
            details: details
        }
    };
}

// =============================================================================
// CASE/KEY INVENTORY HELPERS
// =============================================================================

/**
 * Add cases to user inventory
 */
function addCases(user, caseId, qty) {
    if (!user.cases[caseId]) {
        user.cases[caseId] = 0;
    }
    user.cases[caseId] += qty;
}

/**
 * Remove cases from user inventory
 * @returns {boolean} Success (false if insufficient)
 */
function removeCases(user, caseId, qty) {
    const current = user.cases[caseId] || 0;
    if (current < qty) return false;
    user.cases[caseId] = current - qty;
    if (user.cases[caseId] === 0) {
        delete user.cases[caseId];
    }
    return true;
}

/**
 * Add keys to user inventory
 */
function addKeys(user, keyId, qty) {
    if (!user.keys[keyId]) {
        user.keys[keyId] = 0;
    }
    user.keys[keyId] += qty;
}

/**
 * Remove keys from user inventory
 * @returns {boolean} Success (false if insufficient)
 */
function removeKeys(user, keyId, qty) {
    const current = user.keys[keyId] || 0;
    if (current < qty) return false;
    user.keys[keyId] = current - qty;
    if (user.keys[keyId] === 0) {
        delete user.keys[keyId];
    }
    return true;
}

/**
 * Select a random image from item.image and item.imageAlternates
 */
function selectRandomImage(item) {
    const images = [item.image];
    if (Array.isArray(item.imageAlternates)) {
        images.push(...item.imageAlternates);
    }
    const validImages = images.filter(img => img);
    if (validImages.length === 0) return null;
    return validImages[Math.floor(Math.random() * validImages.length)];
}

// =============================================================================
// EXPORT MARKER (for reference - Lumia doesn't use exports)
// =============================================================================

// All functions above are available when this code is included in a command.
// Copy the functions you need into each command file.

log('[TCSGO Core] Module loaded. Copy needed functions into command files.');
