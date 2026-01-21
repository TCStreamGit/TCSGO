/**
 * TCSGO: Open Case
 * =================
 * 
 * Lumia Custom JavaScript Command
 * Command Name: tcsgo-open
 * 
 * INPUT (via extraSettings or message parsing):
 *   - platform: string (e.g., "twitch")
 *   - username: string
 *   - alias: string (case alias like "chroma")
 *   - eventId: string (optional, for idempotency)
 * 
 * OUTPUT (returned to overlay):
 *   {
 *     type: "open-result",
 *     ok: true/false,
 *     data?: {
 *       winner: { oid, itemId, displayName, rarity, category, statTrak, wear, variant },
 *       imagePath: "Assets/...",
 *       priceKey: "itemId|wear|statTrak01|variant",
 *       priceSnapshot: { cad, chosenCoins, isEstimated },
 *       acquiredAt, lockedUntil,
 *       newCounts: { cases: { caseId: count }, keys: { keyId: count } }
 *     },
 *     error?: { code, message }
 *   }
 * 
 * SUPPORTS:
 *   - Standard Cases (schemaVersion "3.0-case-export")
 *     - Tier keys: blue, purple, pink, red, gold
 *     - Gold items from case.goldPool.items
 *   - Souvenir Packages (schemaVersion "3.1-container-export")
 *     - Tier keys: consumer, industrial, milspec, restricted, classified, covert
 *     - No gold tier, no StatTrak
 * 
 * SETUP:
 *   1. Create Lumia Custom JavaScript command named "tcsgo-open"
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
        aliases: 'data/case-aliases.json',
        prices: 'data/prices.json',
        caseOdds: 'Case-Odds'
    },
    tradeLockDays: 7,
    wearTable: [
        { name: 'Factory New', weight: 3 },
        { name: 'Minimal Wear', weight: 24 },
        { name: 'Field-Tested', weight: 33 },
        { name: 'Well-Worn', weight: 24 },
        { name: 'Battle-Scarred', weight: 16 }
    ]
};

const WEAR_TOTAL = CONFIG.wearTable.reduce((sum, w) => sum + w.weight, 0);

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
        log(`[TCSGO] loadJson error for ${relativePath}: ${e.message}`);
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

function removeCases(user, caseId, qty) {
    const current = user.cases[caseId] || 0;
    if (current < qty) return false;
    user.cases[caseId] = current - qty;
    if (user.cases[caseId] === 0) delete user.cases[caseId];
    return true;
}

function removeKeys(user, keyId, qty) {
    const current = user.keys[keyId] || 0;
    if (current < qty) return false;
    user.keys[keyId] = current - qty;
    if (user.keys[keyId] === 0) delete user.keys[keyId];
    return true;
}

function generateOid() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 11);
    return `oid_${ts}_${rand}`;
}

function enforceLock(acquiredAt) {
    const acquired = new Date(acquiredAt);
    const lockMs = CONFIG.tradeLockDays * 24 * 60 * 60 * 1000;
    const lockedUntil = new Date(acquired.getTime() + lockMs);
    return lockedUntil.toISOString();
}

function rollWear() {
    let roll = Math.random() * WEAR_TOTAL;
    for (const w of CONFIG.wearTable) {
        roll -= w.weight;
        if (roll <= 0) return w.name;
    }
    return CONFIG.wearTable[0].name;
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
 * Roll case opening using case JSON data
 * Supports both 3.0-case-export and 3.1-container-export schemas
 */
function rollCaseFromJson(caseJson) {
    const caseData = caseJson.case;
    const unit = BigInt(caseJson.unit?.scale || 1000000000000);
    const schemaVersion = caseJson.schemaVersion || '3.0-case-export';
    
    // Roll for tier using oddsWeights
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
    
    // Get tier items
    let tierItems = [];
    
    if (selectedTier === 'gold') {
        // Gold tier: use goldPool.items for standard cases
        const goldPool = caseData.goldPool;
        if (goldPool && goldPool !== 'None' && Array.isArray(goldPool.items)) {
            tierItems = goldPool.items;
        }
    } else if (caseData.tiers && Array.isArray(caseData.tiers[selectedTier])) {
        // Standard tier: use tiers[tierKey]
        tierItems = caseData.tiers[selectedTier];
    }
    
    if (tierItems.length === 0) {
        log(`[TCSGO] No items in tier: ${selectedTier}`);
        return null;
    }
    
    // Roll for item within tier using item.weights.base
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
    
    // Determine StatTrak using item.weights.statTrak / nonStatTrak
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
    
    // Roll wear
    const wear = rollWear();
    
    return {
        item: selectedItem,
        tier: selectedTier,
        statTrak: isStatTrak,
        wear: wear
    };
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

/**
 * Get price snapshot for an item using priceKey lookup with fallback
 */
function getPriceSnapshot(prices, item, wear, statTrak, variant) {
    const priceKey = buildPriceKey(item.itemId, wear, statTrak, variant);
    const rarity = item.rarity || 'mil-spec';
    
    // Try exact priceKey lookup first
    if (prices.items && prices.items[priceKey]) {
        const cached = prices.items[priceKey];
        return {
            cad: cached.cad,
            chosenCoins: cached.chosenCoins,
            isEstimated: false,
            priceKey: priceKey
        };
    }
    
    // Fallback to rarity-based pricing
    const fallback = prices.rarityFallbackPrices?.[rarity];
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
    const RESPONSE_TYPE = 'open-result';
    
    // Parse input
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const alias = '{{alias}}' !== '{{' + 'alias}}' ? '{{alias}}' : '{{message}}';
    
    // Validate input
    if (!username) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'MISSING_USERNAME', 'Username is required')));
        done();
        return;
    }
    
    if (!alias) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'MISSING_ALIAS', 'Case alias is required')));
        done();
        return;
    }
    
    // Load all required data
    const [aliasData, inventories, prices] = await Promise.all([
        loadJson(CONFIG.paths.aliases),
        loadJson(CONFIG.paths.inventories),
        loadJson(CONFIG.paths.prices)
    ]);
    
    if (!aliasData || !inventories || !prices) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'LOAD_ERROR', 'Failed to load required data files')));
        done();
        return;
    }
    
    // Resolve alias
    const aliasKey = alias.toLowerCase().trim();
    const caseAlias = aliasData.aliases[aliasKey];
    if (!caseAlias) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'UNKNOWN_ALIAS', `Unknown case alias: ${alias}`)));
        done();
        return;
    }
    
    const caseId = caseAlias.caseId;
    const requiresKey = caseAlias.requiresKey;
    const caseFilename = caseAlias.filename;
    const keyId = 'default';
    
    // Get user
    const userKey = buildUserKey(platform, username);
    const user = getOrCreateUser(inventories, userKey);
    
    // Check user owns case
    const caseCount = user.cases[caseId] || 0;
    if (caseCount < 1) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'NO_CASE', `You don't have any ${caseAlias.displayName}`, { caseId, owned: caseCount })));
        done();
        return;
    }
    
    // Check user owns key (if required)
    if (requiresKey) {
        const keyCount = user.keys[keyId] || 0;
        if (keyCount < 1) {
            log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'NO_KEY', 'You need a key to open this case', { keyId, owned: keyCount })));
            done();
            return;
        }
    }
    
    // Load case JSON
    const caseJson = await loadJson(`${CONFIG.paths.caseOdds}/${caseFilename}`);
    if (!caseJson) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'CASE_NOT_FOUND', `Failed to load case data: ${caseFilename}`)));
        done();
        return;
    }
    
    // Roll winner
    const rollResult = rollCaseFromJson(caseJson);
    if (!rollResult) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'ROLL_ERROR', 'Failed to roll case')));
        done();
        return;
    }
    
    // Consume case and key
    if (!removeCases(user, caseId, 1)) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'CONSUME_ERROR', 'Failed to consume case')));
        done();
        return;
    }
    
    if (requiresKey && !removeKeys(user, keyId, 1)) {
        // Rollback case
        if (!user.cases[caseId]) user.cases[caseId] = 0;
        user.cases[caseId] += 1;
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'CONSUME_ERROR', 'Failed to consume key')));
        done();
        return;
    }
    
    // Create owned item
    const acquiredAt = new Date().toISOString();
    const lockedUntil = enforceLock(acquiredAt);
    const variant = rollResult.item.variant || 'None';
    const priceSnapshot = getPriceSnapshot(prices, rollResult.item, rollResult.wear, rollResult.statTrak, variant);
    const imagePath = selectRandomImage(rollResult.item);
    
    const ownedItem = {
        oid: generateOid(),
        itemId: rollResult.item.itemId,
        displayName: rollResult.item.displayName,
        rarity: rollResult.item.rarity,
        tier: rollResult.tier,
        category: rollResult.item.category || 'weapon',
        weapon: rollResult.item.weapon,
        skin: rollResult.item.skin,
        variant: variant,
        statTrak: rollResult.statTrak,
        wear: rollResult.wear,
        acquiredAt: acquiredAt,
        lockedUntil: lockedUntil,
        fromCaseId: caseId,
        priceKey: priceSnapshot.priceKey,
        priceSnapshot: {
            cad: priceSnapshot.cad,
            chosenCoins: priceSnapshot.chosenCoins,
            isEstimated: priceSnapshot.isEstimated
        },
        imagePath: imagePath
    };
    
    // Add to user's items
    user.items.push(ownedItem);
    
    // Save inventories
    inventories.lastModified = new Date().toISOString();
    const saved = await saveJson(CONFIG.paths.inventories, inventories);
    
    if (!saved) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'SAVE_ERROR', 'Failed to save inventory')));
        done();
        return;
    }
    
    // Build success response with simplified newCounts
    const result = successResponse(RESPONSE_TYPE, {
        winner: {
            oid: ownedItem.oid,
            itemId: ownedItem.itemId,
            displayName: ownedItem.displayName,
            rarity: ownedItem.rarity,
            tier: ownedItem.tier,
            category: ownedItem.category,
            weapon: ownedItem.weapon,
            skin: ownedItem.skin,
            variant: ownedItem.variant,
            statTrak: ownedItem.statTrak,
            wear: ownedItem.wear
        },
        imagePath: imagePath,
        priceKey: priceSnapshot.priceKey,
        priceSnapshot: {
            cad: priceSnapshot.cad,
            chosenCoins: priceSnapshot.chosenCoins,
            isEstimated: priceSnapshot.isEstimated
        },
        acquiredAt: acquiredAt,
        lockedUntil: lockedUntil,
        newCounts: {
            cases: { [caseId]: user.cases[caseId] || 0 },
            keys: { [keyId]: user.keys[keyId] || 0 }
        }
    });
    
    log(JSON.stringify(result));
    done();
}

main();
