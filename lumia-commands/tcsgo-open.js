/**
 * TCSGO: Open Case
 * =================
 * 
 * Lumia Custom JavaScript Command
 * 
 * PORTABLE SETUP:
 *   Set Lumia working dir to TCSGO root, OR set TCSGO_BASE below.
 */

// =============================================================================
// PORTABLE CONFIG - Set TCSGO_BASE if Lumia working dir isn't TCSGO root
// =============================================================================
const TCSGO_BASE = '';  // e.g., '/Users/nike/Github/TCSGO'

const CONFIG = {
    basePath: TCSGO_BASE,
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
    const base = CONFIG.basePath.replace(/\\/g, '/').replace(/\/$/, '');
    const rel = relativePath.replace(/\\/g, '/').replace(/^\//, '');
    return base ? `${base}/${rel}` : rel;
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
        await writeFile(fullPath, JSON.stringify(data, null, 2));
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
    return `oid_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 11)}`;
}

function enforceLock(acquiredAt) {
    const lockMs = CONFIG.tradeLockDays * 24 * 60 * 60 * 1000;
    return new Date(new Date(acquiredAt).getTime() + lockMs).toISOString();
}

function rollWear() {
    let roll = Math.random() * WEAR_TOTAL;
    for (const w of CONFIG.wearTable) {
        roll -= w.weight;
        if (roll <= 0) return w.name;
    }
    return CONFIG.wearTable[0].name;
}

function buildPriceKey(itemId, wear, statTrak, variant) {
    return `${itemId}|${wear}|${statTrak ? '1' : '0'}|${variant || 'None'}`;
}

function rollCaseFromJson(caseJson) {
    const caseData = caseJson.case;
    const unit = BigInt(caseJson.unit?.scale || 1000000000000);
    const oddsWeights = caseData.oddsWeights || {};
    const tierRoll = BigInt(Math.floor(Math.random() * Number(unit)));
    
    let cumulative = BigInt(0), selectedTier = null;
    for (const [tier, weight] of Object.entries(oddsWeights)) {
        cumulative += BigInt(weight);
        if (tierRoll < cumulative) { selectedTier = tier; break; }
    }
    if (!selectedTier) selectedTier = Object.keys(oddsWeights)[0];
    
    let tierItems = [];
    if (selectedTier === 'gold') {
        const gp = caseData.goldPool;
        if (gp && gp !== 'None' && Array.isArray(gp.items)) tierItems = gp.items;
    } else if (caseData.tiers?.[selectedTier]) {
        tierItems = caseData.tiers[selectedTier];
    }
    
    if (!tierItems.length) { log(`[TCSGO] No items in tier: ${selectedTier}`); return null; }
    
    const itemsW = tierItems.map(item => ({ item, weight: BigInt(item.weights?.base || 1) }));
    const tierTotal = itemsW.reduce((s, i) => s + i.weight, BigInt(0));
    const itemRoll = BigInt(Math.floor(Math.random() * Number(tierTotal)));
    
    let itemCum = BigInt(0), selectedItem = tierItems[0];
    for (const { item, weight } of itemsW) {
        itemCum += weight;
        if (itemRoll < itemCum) { selectedItem = item; break; }
    }
    
    let isStatTrak = false;
    if (selectedItem.statTrakEligible && caseData.supportsStatTrak) {
        const stW = BigInt(selectedItem.weights?.statTrak || 0);
        const nstW = BigInt(selectedItem.weights?.nonStatTrak || 0);
        const totW = stW + nstW;
        if (totW > 0n && stW > 0n) {
            isStatTrak = BigInt(Math.floor(Math.random() * Number(totW))) < stW;
        }
    }
    
    return { item: selectedItem, tier: selectedTier, statTrak: isStatTrak, wear: rollWear() };
}

function selectRandomImage(item) {
    const imgs = [item.image, ...(item.imageAlternates || [])].filter(Boolean);
    return imgs.length ? imgs[Math.floor(Math.random() * imgs.length)] : null;
}

function getPriceSnapshot(prices, item, wear, statTrak, variant) {
    const priceKey = buildPriceKey(item.itemId, wear, statTrak, variant);
    const rarity = item.rarity || 'mil-spec';
    
    if (prices.items?.[priceKey]) {
        const c = prices.items[priceKey];
        return { cad: c.cad, chosenCoins: c.chosenCoins, isEstimated: false, priceKey };
    }
    
    const fb = prices.rarityFallbackPrices?.[rarity];
    if (!fb) return { cad: 0.10, chosenCoins: 100, isEstimated: true, priceKey };
    
    let cad = fb.cad * (prices.wearMultipliers?.[wear] || 1.0);
    if (statTrak) cad *= prices.statTrakMultiplier || 2.0;
    
    return {
        cad: Math.round(cad * 100) / 100,
        chosenCoins: Math.round(cad * (prices.cadToCoins || 1000)),
        isEstimated: true, priceKey
    };
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
    const RESPONSE_TYPE = 'open-result';
    
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const alias = '{{alias}}' !== '{{' + 'alias}}' ? '{{alias}}' : '{{message}}';
    
    if (!username) { log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'MISSING_USERNAME', 'Username required'))); done(); return; }
    if (!alias) { log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'MISSING_ALIAS', 'Case alias required'))); done(); return; }
    
    const [aliasData, inventories, prices] = await Promise.all([
        loadJson(CONFIG.paths.aliases),
        loadJson(CONFIG.paths.inventories),
        loadJson(CONFIG.paths.prices)
    ]);
    
    if (!aliasData || !inventories || !prices) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'LOAD_ERROR', 'Failed to load data files')));
        done(); return;
    }
    
    const caseAlias = aliasData.aliases[alias.toLowerCase().trim()];
    if (!caseAlias) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'UNKNOWN_ALIAS', `Unknown case: ${alias}`)));
        done(); return;
    }
    
    const { caseId, requiresKey, filename: caseFilename } = caseAlias;
    const keyId = 'default';
    const userKey = buildUserKey(platform, username);
    const user = getOrCreateUser(inventories, userKey);
    
    if ((user.cases[caseId] || 0) < 1) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'NO_CASE', `No ${caseAlias.displayName} owned`)));
        done(); return;
    }
    
    if (requiresKey && (user.keys[keyId] || 0) < 1) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'NO_KEY', 'Key required')));
        done(); return;
    }
    
    const caseJson = await loadJson(`${CONFIG.paths.caseOdds}/${caseFilename}`);
    if (!caseJson) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'CASE_NOT_FOUND', `Failed to load: ${caseFilename}`)));
        done(); return;
    }
    
    const roll = rollCaseFromJson(caseJson);
    if (!roll) { log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'ROLL_ERROR', 'Roll failed'))); done(); return; }
    
    if (!removeCases(user, caseId, 1)) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'CONSUME_ERROR', 'Failed to consume case')));
        done(); return;
    }
    
    if (requiresKey && !removeKeys(user, keyId, 1)) {
        user.cases[caseId] = (user.cases[caseId] || 0) + 1;
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'CONSUME_ERROR', 'Failed to consume key')));
        done(); return;
    }
    
    const acquiredAt = new Date().toISOString();
    const variant = roll.item.variant || 'None';
    const priceSnapshot = getPriceSnapshot(prices, roll.item, roll.wear, roll.statTrak, variant);
    
    const ownedItem = {
        oid: generateOid(),
        itemId: roll.item.itemId,
        displayName: roll.item.displayName,
        rarity: roll.item.rarity,
        tier: roll.tier,
        category: roll.item.category || 'weapon',
        weapon: roll.item.weapon,
        skin: roll.item.skin,
        variant,
        statTrak: roll.statTrak,
        wear: roll.wear,
        acquiredAt,
        lockedUntil: enforceLock(acquiredAt),
        fromCaseId: caseId,
        priceKey: priceSnapshot.priceKey,
        priceSnapshot: { cad: priceSnapshot.cad, chosenCoins: priceSnapshot.chosenCoins, isEstimated: priceSnapshot.isEstimated },
        imagePath: selectRandomImage(roll.item)
    };
    
    user.items.push(ownedItem);
    inventories.lastModified = new Date().toISOString();
    
    if (!await saveJson(CONFIG.paths.inventories, inventories)) {
        log(JSON.stringify(errorResponse(RESPONSE_TYPE, 'SAVE_ERROR', 'Failed to save')));
        done(); return;
    }
    
    log(JSON.stringify(successResponse(RESPONSE_TYPE, {
        winner: {
            oid: ownedItem.oid, itemId: ownedItem.itemId, displayName: ownedItem.displayName,
            rarity: ownedItem.rarity, tier: ownedItem.tier, category: ownedItem.category,
            weapon: ownedItem.weapon, skin: ownedItem.skin, variant: ownedItem.variant,
            statTrak: ownedItem.statTrak, wear: ownedItem.wear
        },
        imagePath: ownedItem.imagePath,
        priceKey: priceSnapshot.priceKey,
        priceSnapshot: { cad: priceSnapshot.cad, chosenCoins: priceSnapshot.chosenCoins, isEstimated: priceSnapshot.isEstimated },
        acquiredAt, lockedUntil: ownedItem.lockedUntil,
        newCounts: { cases: { [caseId]: user.cases[caseId] || 0 }, keys: { [keyId]: user.keys[keyId] || 0 } }
    })));
    done();
}

main();
