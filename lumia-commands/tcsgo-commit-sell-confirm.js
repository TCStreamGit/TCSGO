/**
 * TCSGO Commit: Sell Confirm
 * ===========================
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
async function saveJson(rel, data) { try { await writeFile(buildPath(rel), JSON.stringify(data, null, 2)); return true; } catch (e) { log(`[TCSGO] saveJson: ${e.message}`); return false; } }
function buildUserKey(p, u) { return `${p.toLowerCase()}:${u.toLowerCase()}`; }
function successResponse(t, d) { return { type: t, ok: true, timestamp: new Date().toISOString(), data: d }; }
function errorResponse(t, c, m, det = null) { return { type: t, ok: false, timestamp: new Date().toISOString(), error: { code: c, message: m, details: det } }; }

async function main() {
    const RT = 'sell-confirm-result';
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const token = '{{token}}' !== '{{' + 'token}}' ? '{{token}}' : '{{message}}';
    
    if (!username) { log(JSON.stringify(errorResponse(RT, 'MISSING_USERNAME', 'Username required'))); done(); return; }
    if (!token) { log(JSON.stringify(errorResponse(RT, 'MISSING_TOKEN', 'Token required'))); done(); return; }
    
    const [inv, prices] = await Promise.all([loadJson(CONFIG.paths.inventories), loadJson(CONFIG.paths.prices)]);
    if (!inv) { log(JSON.stringify(errorResponse(RT, 'LOAD_ERROR', 'Failed to load inventories'))); done(); return; }
    
    const user = inv.users[buildUserKey(platform, username)];
    if (!user) { log(JSON.stringify(errorResponse(RT, 'USER_NOT_FOUND', 'User not found'))); done(); return; }
    
    if (!user.pendingSell) { log(JSON.stringify(errorResponse(RT, 'NO_PENDING_SELL', 'No pending sell'))); done(); return; }
    if (user.pendingSell.token !== token) { log(JSON.stringify(errorResponse(RT, 'INVALID_TOKEN', 'Invalid token'))); done(); return; }
    if (Date.now() >= new Date(user.pendingSell.expiresAt).getTime()) { user.pendingSell = null; log(JSON.stringify(errorResponse(RT, 'TOKEN_EXPIRED', 'Token expired'))); done(); return; }
    
    const oid = user.pendingSell.oid;
    const idx = user.items.findIndex(i => i.oid === oid);
    if (idx === -1) { user.pendingSell = null; log(JSON.stringify(errorResponse(RT, 'ITEM_NOT_FOUND', 'Item gone'))); done(); return; }
    
    const credit = user.pendingSell.creditAmount;
    const fee = prices?.marketFeePercent || 10;
    
    user.items.splice(idx, 1);
    user.chosenCoins = (user.chosenCoins || 0) + credit;
    const soldItem = { ...user.pendingSell.itemSummary, oid };
    user.pendingSell = null;
    inv.lastModified = new Date().toISOString();
    
    if (!await saveJson(CONFIG.paths.inventories, inv)) { log(JSON.stringify(errorResponse(RT, 'SAVE_ERROR', 'Save failed'))); done(); return; }
    
    log(JSON.stringify(successResponse(RT, { oid, item: soldItem, creditedCoins: credit, newBalance: user.chosenCoins, marketFeePercent: fee })));
    done();
}

main();
