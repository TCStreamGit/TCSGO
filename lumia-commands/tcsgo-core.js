/**
 * TCSGO Core Module v2.1 - Portable Configuration
 * ================================================
 * 
 * Lumia Custom JavaScript utility module for local file-based operations.
 * 
 * PORTABLE SETUP:
 *   1. Set Lumia Stream's working directory to TCSGO folder root
 *   2. All paths are then relative: data/inventories.json, Case-Odds/etc.
 *   
 *   OR if Lumia's working dir is elsewhere, set TCSGO_BASE below to the
 *   full path to your TCSGO folder.
 */

// =============================================================================
// CONFIGURATION - PORTABLE PATH SETUP
// =============================================================================

const LOG_ENABLED = false;

function logMsg(message) {
    if (!LOG_ENABLED) return;
    try { log(message); } catch (_) {}
}

// Option 1: Set Lumia working dir to TCSGO root, leave this empty
// Option 2: Set full path here if Lumia working dir is different
const TCSGO_BASE = '';  // e.g., 'A:\\Development\\Version Control\\Github\\TCSGO' or 'C:\\Users\\You\\TCSGO'

const TCSGO_CONFIG = {
    basePath: TCSGO_BASE,
    paths: {
        inventories: 'data/inventories.json',
        aliases: 'data/case-aliases.json',
        prices: 'data/prices.json',
        caseOdds: 'Case-Odds'
    },
    wearTable: [
        { name: 'Factory New', weight: 3 },
        { name: 'Minimal Wear', weight: 24 },
        { name: 'Field-Tested', weight: 33 },
        { name: 'Well-Worn', weight: 24 },
        { name: 'Battle-Scarred', weight: 16 }
    ],
    tradeLockDays: 7,
    sellTokenExpirationSeconds: 60
};

const WEAR_TOTAL = TCSGO_CONFIG.wearTable.reduce((sum, w) => sum + w.weight, 0);

// =============================================================================
// FILE I/O UTILITIES
// =============================================================================

function buildPath(relativePath) {
    const base = TCSGO_CONFIG.basePath.replace(/\\/g, '/').replace(/\/$/, '');
    const rel = relativePath.replace(/\\/g, '/').replace(/^\//, '');
    return base ? `${base}/${rel}` : rel;
}

async function loadJson(relativePath) {
    try {
        const fullPath = buildPath(relativePath);
        const content = await readFile(fullPath);
        return JSON.parse(content);
    } catch (e) {
        logMsg(`[TCSGO] loadJson error for ${relativePath}: ${e.message}`);
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
        logMsg(`[TCSGO] saveJson error for ${relativePath}: ${e.message}`);
        return false;
    }
}

async function loadInventories() {
    return await loadJson(TCSGO_CONFIG.paths.inventories);
}

async function saveInventories(data) {
    data.lastModified = new Date().toISOString();
    return await saveJson(TCSGO_CONFIG.paths.inventories, data);
}

async function loadAliases() {
    return await loadJson(TCSGO_CONFIG.paths.aliases);
}

async function loadPrices() {
    return await loadJson(TCSGO_CONFIG.paths.prices);
}

async function loadCaseJson(filename) {
    const path = `${TCSGO_CONFIG.paths.caseOdds}/${filename}`;
    return await loadJson(path);
}

// =============================================================================
// USER KEY UTILITIES
// =============================================================================

function buildUserKey(platform, username) {
    return `${platform.toLowerCase()}:${username.toLowerCase()}`;
}

function parseUserKey(userKey) {
    const [platform, ...usernameParts] = userKey.split(':');
    return { platform, username: usernameParts.join(':') };
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

// =============================================================================
// ID GENERATORS
// =============================================================================

function generateOid() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 11);
    return `oid_${ts}_${rand}`;
}

function generateEventId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `evt_${ts}_${rand}`;
}

function generateSellToken() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 12);
    return `sell_${ts}_${rand}`;
}

// =============================================================================
// TRADE LOCK UTILITIES
// =============================================================================

function enforceLock(acquiredAt) {
    const acquired = new Date(acquiredAt);
    const lockMs = TCSGO_CONFIG.tradeLockDays * 24 * 60 * 60 * 1000;
    const lockedUntil = new Date(acquired.getTime() + lockMs);
    return lockedUntil.toISOString();
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

// =============================================================================
// ROLL ENGINE
// =============================================================================

function rollWear() {
    let roll = Math.random() * WEAR_TOTAL;
    for (const w of TCSGO_CONFIG.wearTable) {
        roll -= w.weight;
        if (roll <= 0) return w.name;
    }
    return TCSGO_CONFIG.wearTable[0].name;
}

function rollCaseFromJson(caseJson) {
    const caseData = caseJson.case;
    const unit = BigInt(caseJson.unit?.scale || 1000000000000);
    
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
    
    if (!selectedTier) selectedTier = Object.keys(oddsWeights)[0];
    
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
        logMsg(`[TCSGO] No items in tier: ${selectedTier}`);
        return null;
    }
    
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
    
    return {
        item: selectedItem,
        tier: selectedTier,
        statTrak: isStatTrak,
        wear: rollWear()
    };
}

// =============================================================================
// PRICE UTILITIES
// =============================================================================

function getPriceSnapshot(prices, item, wear, statTrak) {
    const rarity = item.rarity || 'mil-spec';
    
    const itemPrices = prices.itemVariantPrices?.[item.itemId];
    if (itemPrices && itemPrices[wear]) {
        const variantPrice = statTrak ? itemPrices[wear].statTrak : itemPrices[wear].normal;
        if (variantPrice !== undefined) {
            return { cad: variantPrice, chosenCoins: Math.round(variantPrice * prices.cadToCoins) };
        }
    }
    
    const fallback = prices.rarityFallbackPrices?.[rarity];
    if (!fallback) return { cad: 0.10, chosenCoins: 100 };
    
    let baseCad = fallback.cad;
    baseCad *= prices.wearMultipliers?.[wear] || 1.0;
    if (statTrak) baseCad *= prices.statTrakMultiplier || 2.0;
    
    return {
        cad: Math.round(baseCad * 100) / 100,
        chosenCoins: Math.round(baseCad * prices.cadToCoins)
    };
}

function calculateCreditAfterFee(coins, feePercent) {
    return Math.floor(coins * (1 - feePercent / 100));
}

// =============================================================================
// RESPONSE BUILDERS
// =============================================================================

function successResponse(type, data) {
    return { type, ok: true, timestamp: new Date().toISOString(), data };
}

function errorResponse(type, code, message, details = null) {
    return { type, ok: false, timestamp: new Date().toISOString(), error: { code, message, details } };
}

// =============================================================================
// INVENTORY HELPERS
// =============================================================================

function addCases(user, caseId, qty) {
    user.cases[caseId] = (user.cases[caseId] || 0) + qty;
}

function removeCases(user, caseId, qty) {
    const current = user.cases[caseId] || 0;
    if (current < qty) return false;
    user.cases[caseId] = current - qty;
    if (user.cases[caseId] === 0) delete user.cases[caseId];
    return true;
}

function addKeys(user, keyId, qty) {
    user.keys[keyId] = (user.keys[keyId] || 0) + qty;
}

function removeKeys(user, keyId, qty) {
    const current = user.keys[keyId] || 0;
    if (current < qty) return false;
    user.keys[keyId] = current - qty;
    if (user.keys[keyId] === 0) delete user.keys[keyId];
    return true;
}

function selectRandomImage(item) {
    const images = [item.image];
    if (Array.isArray(item.imageAlternates)) images.push(...item.imageAlternates);
    const validImages = images.filter(img => img);
    if (validImages.length === 0) return null;
    return validImages[Math.floor(Math.random() * validImages.length)];
}

logMsg('[TCSGO Core] Module loaded. Copy needed functions into command files.');
