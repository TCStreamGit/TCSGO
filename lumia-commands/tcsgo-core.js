/**
 * TCSGO Core Module - Lumia Custom JavaScript
 * =============================================
 * 
 * SETUP INSTRUCTIONS:
 * 1. Create a new Lumia Custom JavaScript command
 * 2. Set the command to trigger on stream start or manually (!tcsgo-init)
 * 3. Paste this ENTIRE file into the JavaScript tab
 * 4. This initializes the global store used by all other commands
 * 
 * This module provides:
 * - Persistent storage via Lumia's global variables
 * - Roll engine for case openings
 * - Container validation
 * - User/inventory management
 */

// =================================
// CONFIGURATION
// =================================

const TCSGO_CONFIG = {
    version: 1,
    storeKey: 'tcsgo_store',
    pricesKey: 'tcsgo_prices',
    
    // GitHub raw URL (UPDATE THIS!)
    baseRawUrl: 'https://raw.githubusercontent.com/YOUR_USERNAME/TCSGO/main',
    
    // Economy settings
    defaultStartingCoins: 10000,
    marketFeePercent: 10,
    cadToCoins: 1000,
    
    // Cooldowns (milliseconds)
    cooldowns: {
        buycase: 2000,
        buykey: 2000,
        open: 5000,
        sell: 3000,
        buylisting: 3000
    },
    
    // Overlay codeIds
    overlays: {
        caseOpen: 'tcsgocaseopen',
        hud: 'tcsgohud'
    },
    
    // Wear table (default)
    wearTable: [
        { name: 'Factory New', weight: 3 },
        { name: 'Minimal Wear', weight: 24 },
        { name: 'Field-Tested', weight: 33 },
        { name: 'Well-Worn', weight: 24 },
        { name: 'Battle-Scarred', weight: 16 }
    ]
};

const WEAR_TOTAL = TCSGO_CONFIG.wearTable.reduce((s, w) => s + w.weight, 0);

// =================================
// PERSISTENCE LAYER
// =================================

function getStore() {
    try {
        const raw = getVariable(TCSGO_CONFIG.storeKey, { global: true });
        if (!raw) return createEmptyStore();
        
        const store = JSON.parse(raw);
        if (!store || store.v !== TCSGO_CONFIG.version) {
            return migrateStore(store);
        }
        return store;
    } catch (e) {
        console.error('[TCSGO] Failed to load store:', e);
        return createEmptyStore();
    }
}

function saveStore(store) {
    try {
        store.lastSaved = Date.now();
        const json = JSON.stringify(store);
        setVariable(TCSGO_CONFIG.storeKey, json, { global: true });
        return true;
    } catch (e) {
        console.error('[TCSGO] Failed to save store:', e);
        return false;
    }
}

function createEmptyStore() {
    return {
        v: TCSGO_CONFIG.version,
        users: {},
        market: [],
        recentPulls: [],
        sessionStats: {
            totalOpens: 0,
            totalCoinsSpent: 0,
            rarestPull: null
        },
        lastSaved: Date.now()
    };
}

function migrateStore(oldStore) {
    // Future migration logic here
    const newStore = createEmptyStore();
    if (oldStore && oldStore.users) {
        newStore.users = oldStore.users;
    }
    if (oldStore && oldStore.market) {
        newStore.market = oldStore.market;
    }
    return newStore;
}

// =================================
// USER MANAGEMENT
// =================================

function getUser(store, username) {
    const id = username.toLowerCase();
    if (!store.users[id]) {
        store.users[id] = createNewUser(id);
    }
    return store.users[id];
}

function createNewUser(id) {
    return {
        id: id,
        coins: TCSGO_CONFIG.defaultStartingCoins,
        cases: [],
        keys: [],
        items: [],
        stats: {
            totalOpens: 0,
            totalSpent: 0,
            bestPullValue: 0,
            bestPullId: null
        }
    };
}

function addUserCoins(user, amount) {
    user.coins = Math.max(0, user.coins + amount);
}

function addUserCase(user, caseId, qty = 1) {
    const existing = user.cases.find(c => c.caseId === caseId);
    if (existing) {
        existing.qty += qty;
    } else {
        user.cases.push({ caseId, qty });
    }
}

function removeUserCase(user, caseId, qty = 1) {
    const existing = user.cases.find(c => c.caseId === caseId);
    if (!existing || existing.qty < qty) return false;
    existing.qty -= qty;
    if (existing.qty <= 0) {
        user.cases = user.cases.filter(c => c.caseId !== caseId);
    }
    return true;
}

function getUserCaseCount(user, caseId) {
    const existing = user.cases.find(c => c.caseId === caseId);
    return existing ? existing.qty : 0;
}

function addUserKey(user, keyId, qty = 1) {
    const existing = user.keys.find(k => k.keyId === keyId);
    if (existing) {
        existing.qty += qty;
    } else {
        user.keys.push({ keyId, qty });
    }
}

function removeUserKey(user, keyId, qty = 1) {
    const existing = user.keys.find(k => k.keyId === keyId);
    if (!existing || existing.qty < qty) return false;
    existing.qty -= qty;
    if (existing.qty <= 0) {
        user.keys = user.keys.filter(k => k.keyId !== keyId);
    }
    return true;
}

function getUserKeyCount(user, keyId) {
    const existing = user.keys.find(k => k.keyId === keyId);
    return existing ? existing.qty : 0;
}

function addUserItem(user, ownedItem) {
    user.items.push(ownedItem);
}

function removeUserItem(user, oid) {
    const idx = user.items.findIndex(i => i.oid === oid);
    if (idx === -1) return null;
    return user.items.splice(idx, 1)[0];
}

// =================================
// PRICE MANAGEMENT
// =================================

async function loadPrices() {
    try {
        // Check for cached prices
        const cached = getVariable(TCSGO_CONFIG.pricesKey, { global: true });
        if (cached) {
            const prices = JSON.parse(cached);
            // Return cached if less than 1 hour old
            if (prices.snapshotAt && Date.now() - prices.snapshotAt < 3600000) {
                return prices;
            }
        }
        
        // Fetch fresh prices
        const url = `${TCSGO_CONFIG.baseRawUrl}/data/prices.json`;
        const response = await fetch(url);
        const data = await response.json();
        
        const snapshot = {
            snapshotAt: Date.now(),
            cadToCoins: data.cadToCoins || TCSGO_CONFIG.cadToCoins,
            marketFeePercent: data.marketFeePercent || TCSGO_CONFIG.marketFeePercent,
            cases: data.cases || {},
            keys: data.keys || {},
            souvenirPackages: data.souvenirPackages || {}
        };
        
        // Cache it
        setVariable(TCSGO_CONFIG.pricesKey, JSON.stringify(snapshot), { global: true });
        
        return snapshot;
    } catch (e) {
        console.error('[TCSGO] Failed to load prices:', e);
        return null;
    }
}

function getCasePrice(prices, caseId) {
    if (!prices) return null;
    const cadPrice = prices.cases[caseId];
    if (cadPrice === undefined) return null;
    return Math.round(cadPrice * prices.cadToCoins);
}

function getKeyPrice(prices, keyId) {
    if (!prices) return null;
    // Use default key price if specific not found
    const cadPrice = prices.keys[keyId] || prices.keys['default'];
    if (cadPrice === undefined) return null;
    return Math.round(cadPrice * prices.cadToCoins);
}

function getSouvenirPrice(prices, containerId) {
    if (!prices) return null;
    const cadPrice = prices.souvenirPackages[containerId] || prices.souvenirPackages['default'];
    if (cadPrice === undefined) return null;
    return Math.round(cadPrice * prices.cadToCoins);
}

// =================================
// CONTAINER LOADING & VALIDATION
// =================================

async function loadContainer(containerId) {
    try {
        // Convert kebab-case to filename format
        const filename = containerId.split('-').map(w => 
            w.charAt(0).toUpperCase() + w.slice(1)
        ).join('_') + '.json';
        
        const url = `${TCSGO_CONFIG.baseRawUrl}/Case-Odds/${filename}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error(`[TCSGO] Container not found: ${containerId}`);
            return null;
        }
        
        return await response.json();
    } catch (e) {
        console.error('[TCSGO] Failed to load container:', e);
        return null;
    }
}

function validateContainer(container) {
    if (!container || !container.case) {
        return { valid: false, error: 'Invalid container structure' };
    }
    
    const caseData = container.case;
    const unit = container.unit?.scale || 1000000000000;
    
    // Check oddsWeights sum
    const oddsWeights = caseData.oddsWeights || {};
    const oddsSum = Object.values(oddsWeights).reduce((s, v) => s + Number(v), 0);
    
    if (oddsSum !== unit) {
        return { valid: false, error: `oddsWeights sum ${oddsSum} != unit.scale ${unit}` };
    }
    
    // Calculate total item weights
    let itemWeightSum = 0;
    const tiers = caseData.tiers || {};
    
    for (const tierItems of Object.values(tiers)) {
        if (Array.isArray(tierItems)) {
            for (const item of tierItems) {
                itemWeightSum += Number(item.weights?.base || 0);
            }
        }
    }
    
    // Add gold pool items
    if (caseData.goldPool && caseData.goldPool !== 'None' && caseData.goldPool.items) {
        for (const item of caseData.goldPool.items) {
            itemWeightSum += Number(item.weights?.base || 0);
        }
    }
    
    if (itemWeightSum !== unit) {
        return { valid: false, error: `Item weights sum ${itemWeightSum} != unit.scale ${unit}` };
    }
    
    return { valid: true };
}

function isSouvenirPackage(container) {
    return container?.case?.caseType === 'souvenir_package';
}

function requiresKey(container) {
    // Souvenir packages don't require keys
    return !isSouvenirPackage(container);
}

// =================================
// ROLL ENGINE
// =================================

function rollCase(container) {
    const caseData = container.case;
    const unit = container.unit?.scale || 1000000000000;
    
    // Step 1: Roll for tier
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
        // Fallback to first tier
        selectedTier = Object.keys(oddsWeights)[0];
    }
    
    // Step 2: Get items from selected tier
    let tierItems = [];
    
    if (selectedTier === 'gold' && caseData.goldPool && caseData.goldPool !== 'None') {
        tierItems = caseData.goldPool.items || [];
    } else if (caseData.tiers && caseData.tiers[selectedTier]) {
        tierItems = caseData.tiers[selectedTier];
    }
    
    if (tierItems.length === 0) {
        return null;
    }
    
    // Step 3: Roll for item within tier (weighted)
    const tierItemsWithWeights = tierItems.map(item => ({
        item,
        weight: BigInt(item.weights?.base || 1)
    }));
    
    const tierTotalWeight = tierItemsWithWeights.reduce((s, i) => s + i.weight, BigInt(0));
    const itemRoll = BigInt(Math.floor(Math.random() * Number(tierTotalWeight)));
    
    let itemCumulative = BigInt(0);
    let selectedItem = tierItems[0];
    
    for (const { item, weight } of tierItemsWithWeights) {
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
        
        if (totalStWeight > 0 && stWeight > 0) {
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

function rollWear() {
    let roll = Math.random() * WEAR_TOTAL;
    for (const w of TCSGO_CONFIG.wearTable) {
        roll -= w.weight;
        if (roll <= 0) return w.name;
    }
    return TCSGO_CONFIG.wearTable[0].name;
}

// =================================
// OWNED ITEM CREATION
// =================================

function createOwnedItem(rollResult, caseId, prices) {
    const { item, tier, statTrak, wear } = rollResult;
    
    const oid = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Calculate price (placeholder - could be enhanced with item-specific pricing)
    const tierMultipliers = {
        blue: 0.1, purple: 0.5, pink: 2, red: 10, gold: 50,
        consumer: 0.05, industrial: 0.1, milspec: 0.2, restricted: 1, classified: 5, covert: 25
    };
    
    const basePrice = prices ? getCasePrice(prices, caseId) || 1000 : 1000;
    const mult = tierMultipliers[tier] || 1;
    const priceCoins = Math.round(basePrice * mult * (statTrak ? 2 : 1));
    const priceCAD = prices ? priceCoins / prices.cadToCoins : priceCoins / TCSGO_CONFIG.cadToCoins;
    
    return {
        oid,
        itemId: item.itemId,
        caseId,
        displayName: item.displayName,
        rarity: tier,
        category: item.category || 'weapon',
        statTrak,
        wear,
        obtainedAt: Date.now(),
        priceCoins,
        priceCAD
    };
}
