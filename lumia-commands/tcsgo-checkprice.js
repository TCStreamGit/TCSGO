/**
 * TCSGO: Check Price
 * ===================
 * 
 * PORTABLE SETUP: Set Lumia working dir to TCSGO root, OR set TCSGO_BASE below.
 */

const TCSGO_BASE = '';  // e.g., '/Users/nike/Github/TCSGO'

const CONFIG = {
    basePath: TCSGO_BASE,
    paths: { inventories: 'data/inventories.json', prices: 'data/prices.json' }
};

function buildPath(rel) { const b = CONFIG.basePath.replace(/\\/g, '/').replace(/\/$/, ''); const r = rel.replace(/\\/g, '/').replace(/^\//, ''); return b ? `${b}/${r}` : r; }
async function loadJson(rel) { try { return JSON.parse(await readFile(buildPath(rel))); } catch (e) { log(`[TCSGO] loadJson: ${e.message}`); return null; } }
function buildUserKey(p, u) { return `${p.toLowerCase()}:${u.toLowerCase()}`; }
function buildPriceKey(itemId, wear, statTrak, variant) { return `${itemId}|${wear}|${statTrak ? '1' : '0'}|${variant || 'None'}`; }

function getPrice(prices, itemId, wear, statTrak, variant, rarity) {
    const pk = buildPriceKey(itemId, wear, statTrak, variant);
    if (prices.items?.[pk]) { const c = prices.items[pk]; return { cad: c.cad, chosenCoins: c.chosenCoins, isEstimated: false, updatedAt: c.updatedAt, priceKey: pk }; }
    const fb = prices.rarityFallbackPrices?.[rarity || 'mil-spec'];
    if (!fb) return { cad: 0.10, chosenCoins: 100, isEstimated: true, priceKey: pk };
    let cad = fb.cad * (prices.wearMultipliers?.[wear] || 1);
    if (statTrak) cad *= prices.statTrakMultiplier || 2;
    return { cad: Math.round(cad * 100) / 100, chosenCoins: Math.round(cad * (prices.cadToCoins || 1000)), isEstimated: true, priceKey: pk };
}

function checkLock(lu) { const r = Math.max(0, new Date(lu).getTime() - Date.now()); return { locked: r > 0, remainingFormatted: formatDuration(r) }; }
function formatDuration(ms) { if (ms <= 0) return '0s'; const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24); if (d > 0) return `${d}d ${h % 24}h`; if (h > 0) return `${h}h ${m % 60}m`; if (m > 0) return `${m}m ${s % 60}s`; return `${s}s`; }
function successResponse(t, d) { return { type: t, ok: true, timestamp: new Date().toISOString(), data: d }; }
function errorResponse(t, c, m, det = null) { return { type: t, ok: false, timestamp: new Date().toISOString(), error: { code: c, message: m, details: det } }; }

async function main() {
    const RT = 'checkprice-result';
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const oid = '{{oid}}' !== '{{' + 'oid}}' ? '{{oid}}' : null;
    const itemIdInput = '{{itemId}}' !== '{{' + 'itemId}}' ? '{{itemId}}' : null;
    
    if (!username) { log(JSON.stringify(errorResponse(RT, 'MISSING_USERNAME', 'Username required'))); done(); return; }
    if (!oid && !itemIdInput) { log(JSON.stringify(errorResponse(RT, 'MISSING_IDENTIFIER', 'oid or itemId required'))); done(); return; }
    
    const [inv, prices] = await Promise.all([loadJson(CONFIG.paths.inventories), loadJson(CONFIG.paths.prices)]);
    if (!prices) { log(JSON.stringify(errorResponse(RT, 'LOAD_ERROR', 'Failed to load prices'))); done(); return; }
    
    if (oid) {
        if (!inv) { log(JSON.stringify(errorResponse(RT, 'LOAD_ERROR', 'Failed to load inventories'))); done(); return; }
        const user = inv.users?.[buildUserKey(platform, username)];
        if (!user) { log(JSON.stringify(errorResponse(RT, 'USER_NOT_FOUND', 'User not found'))); done(); return; }
        const item = user.items.find(i => i.oid === oid);
        if (!item) { log(JSON.stringify(errorResponse(RT, 'ITEM_NOT_FOUND', 'Item not found', { oid }))); done(); return; }
        
        const pi = getPrice(prices, item.itemId, item.wear, item.statTrak, item.variant || 'None', item.rarity);
        const ls = checkLock(item.lockedUntil);
        
        log(JSON.stringify(successResponse(RT, {
            oid: item.oid, itemId: item.itemId, displayName: item.displayName, wear: item.wear,
            statTrak: item.statTrak, variant: item.variant || 'None', rarity: item.rarity,
            lockedUntil: item.lockedUntil, lockStatus: ls, priceKey: pi.priceKey,
            price: { cad: pi.cad, chosenCoins: pi.chosenCoins, isEstimated: pi.isEstimated, updatedAt: pi.updatedAt || null }
        })));
        done(); return;
    }
    
    const wear = '{{wear}}' !== '{{' + 'wear}}' ? '{{wear}}' : 'Field-Tested';
    const statTrak = ('{{statTrak}}' !== '{{' + 'statTrak}}' ? '{{statTrak}}' : 'false') === 'true';
    const variant = '{{variant}}' !== '{{' + 'variant}}' ? '{{variant}}' : 'None';
    const rarity = '{{rarity}}' !== '{{' + 'rarity}}' ? '{{rarity}}' : 'mil-spec';
    
    const pi = getPrice(prices, itemIdInput, wear, statTrak, variant, rarity);
    log(JSON.stringify(successResponse(RT, {
        oid: null, itemId: itemIdInput, displayName: null, wear, statTrak, variant, rarity,
        lockedUntil: null, lockStatus: null, priceKey: pi.priceKey,
        price: { cad: pi.cad, chosenCoins: pi.chosenCoins, isEstimated: pi.isEstimated, updatedAt: pi.updatedAt || null }
    })));
    done();
}

main();
