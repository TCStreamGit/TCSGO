/**
 * TCSGO: Sell Start
 * ==================
 * 
 * PORTABLE SETUP: Set Lumia working dir to TCSGO root, OR set TCSGO_BASE below.
 */

const TCSGO_BASE = '';  // e.g., '/Users/nike/Github/TCSGO'

const CONFIG = {
    basePath: TCSGO_BASE,
    paths: { inventories: 'data/inventories.json', prices: 'data/prices.json' },
    sellTokenExpirationSeconds: 60
};

function buildPath(rel) { const b = CONFIG.basePath.replace(/\\/g, '/').replace(/\/$/, ''); const r = rel.replace(/\\/g, '/').replace(/^\//, ''); return b ? `${b}/${r}` : r; }
async function loadJson(rel) { try { return JSON.parse(await readFile(buildPath(rel))); } catch (e) { log(`[TCSGO] loadJson: ${e.message}`); return null; } }
async function saveJson(rel, data) { try { await writeFile(buildPath(rel), JSON.stringify(data, null, 2)); return true; } catch (e) { log(`[TCSGO] saveJson: ${e.message}`); return false; } }
function buildUserKey(p, u) { return `${p.toLowerCase()}:${u.toLowerCase()}`; }
function generateSellToken() { return `sell_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 12)}`; }
function checkLock(lu) { const r = Math.max(0, new Date(lu).getTime() - Date.now()); return { locked: r > 0, remainingMs: r, remainingFormatted: formatDuration(r) }; }
function formatDuration(ms) { if (ms <= 0) return '0s'; const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24); if (d > 0) return `${d}d ${h % 24}h`; if (h > 0) return `${h}h ${m % 60}m`; if (m > 0) return `${m}m ${s % 60}s`; return `${s}s`; }
function calculateCreditAfterFee(coins, fee) { return Math.floor(coins * (1 - fee / 100)); }
function successResponse(t, d) { return { type: t, ok: true, timestamp: new Date().toISOString(), data: d }; }
function errorResponse(t, c, m, det = null) { return { type: t, ok: false, timestamp: new Date().toISOString(), error: { code: c, message: m, details: det } }; }

async function main() {
    const RT = 'sell-start-result';
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const oid = '{{oid}}' !== '{{' + 'oid}}' ? '{{oid}}' : '{{message}}';
    
    if (!username) { log(JSON.stringify(errorResponse(RT, 'MISSING_USERNAME', 'Username required'))); done(); return; }
    if (!oid) { log(JSON.stringify(errorResponse(RT, 'MISSING_OID', 'OID required'))); done(); return; }
    
    const [inv, prices] = await Promise.all([loadJson(CONFIG.paths.inventories), loadJson(CONFIG.paths.prices)]);
    if (!inv || !prices) { log(JSON.stringify(errorResponse(RT, 'LOAD_ERROR', 'Failed to load data'))); done(); return; }
    
    const user = inv.users[buildUserKey(platform, username)];
    if (!user) { log(JSON.stringify(errorResponse(RT, 'USER_NOT_FOUND', 'User not found'))); done(); return; }
    
    const item = user.items.find(i => i.oid === oid);
    if (!item) { log(JSON.stringify(errorResponse(RT, 'ITEM_NOT_FOUND', 'Item not found', { oid }))); done(); return; }
    
    const ls = checkLock(item.lockedUntil);
    if (ls.locked) { log(JSON.stringify(errorResponse(RT, 'ITEM_LOCKED', `Locked for ${ls.remainingFormatted}`, { lockedUntil: item.lockedUntil }))); done(); return; }
    
    if (user.pendingSell && Date.now() < new Date(user.pendingSell.expiresAt).getTime()) {
        log(JSON.stringify(errorResponse(RT, 'PENDING_SELL_EXISTS', 'Pending sell exists', { existingOid: user.pendingSell.oid })));
        done(); return;
    }
    
    const fee = prices.marketFeePercent || 10;
    const credit = calculateCreditAfterFee(item.priceSnapshot?.chosenCoins || 0, fee);
    const token = generateSellToken();
    const expiresAt = new Date(Date.now() + CONFIG.sellTokenExpirationSeconds * 1000).toISOString();
    
    user.pendingSell = { token, oid, expiresAt, itemSummary: { displayName: item.displayName, rarity: item.rarity, statTrak: item.statTrak, wear: item.wear }, creditAmount: credit };
    inv.lastModified = new Date().toISOString();
    
    if (!await saveJson(CONFIG.paths.inventories, inv)) { log(JSON.stringify(errorResponse(RT, 'SAVE_ERROR', 'Save failed'))); done(); return; }
    
    log(JSON.stringify(successResponse(RT, { token, oid, expiresAt, expiresInSeconds: CONFIG.sellTokenExpirationSeconds, item: { displayName: item.displayName, rarity: item.rarity, tier: item.tier, statTrak: item.statTrak, wear: item.wear, priceSnapshot: item.priceSnapshot }, creditAmount: credit, marketFeePercent: fee })));
    done();
}

main();
