/**
 * TCSGO Commit: Open Case
 * ========================
 * 
 * PORTABLE SETUP: Set Lumia working dir to TCSGO root, OR set TCSGO_BASE below.
 */

const TCSGO_BASE = '';  // e.g., '/Users/nike/Github/TCSGO'

const CONFIG = {
    basePath: TCSGO_BASE,
    paths: { inventories: 'data/inventories.json', aliases: 'data/case-aliases.json', prices: 'data/prices.json', caseOdds: 'Case-Odds' },
    tradeLockDays: 7,
    wearTable: [{ name: 'Factory New', weight: 3 }, { name: 'Minimal Wear', weight: 24 }, { name: 'Field-Tested', weight: 33 }, { name: 'Well-Worn', weight: 24 }, { name: 'Battle-Scarred', weight: 16 }]
};
const WEAR_TOTAL = CONFIG.wearTable.reduce((s, w) => s + w.weight, 0);

function buildPath(rel) { const b = CONFIG.basePath.replace(/\\/g, '/').replace(/\/$/, ''); const r = rel.replace(/\\/g, '/').replace(/^\//, ''); return b ? `${b}/${r}` : r; }
async function loadJson(rel) { try { return JSON.parse(await readFile(buildPath(rel))); } catch (e) { log(`[TCSGO] loadJson: ${e.message}`); return null; } }
async function saveJson(rel, data) { try { await writeFile(buildPath(rel), JSON.stringify(data, null, 2)); return true; } catch (e) { log(`[TCSGO] saveJson: ${e.message}`); return false; } }
function buildUserKey(p, u) { return `${p.toLowerCase()}:${u.toLowerCase()}`; }
function getOrCreateUser(inv, key) { if (!inv.users[key]) inv.users[key] = { userKey: key, createdAt: new Date().toISOString(), chosenCoins: 0, cases: {}, keys: {}, items: [], pendingSell: null }; return inv.users[key]; }
function removeCases(u, id, q) { const c = u.cases[id] || 0; if (c < q) return false; u.cases[id] = c - q; if (!u.cases[id]) delete u.cases[id]; return true; }
function removeKeys(u, id, q) { const c = u.keys[id] || 0; if (c < q) return false; u.keys[id] = c - q; if (!u.keys[id]) delete u.keys[id]; return true; }
function generateOid() { return `oid_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 11)}`; }
function enforceLock(at) { return new Date(new Date(at).getTime() + CONFIG.tradeLockDays * 86400000).toISOString(); }
function rollWear() { let r = Math.random() * WEAR_TOTAL; for (const w of CONFIG.wearTable) { r -= w.weight; if (r <= 0) return w.name; } return CONFIG.wearTable[0].name; }

function rollCaseFromJson(cj) {
    const cd = cj.case, unit = BigInt(cj.unit?.scale || 1e12), ow = cd.oddsWeights || {};
    const tr = BigInt(Math.floor(Math.random() * Number(unit)));
    let cum = 0n, selTier = null;
    for (const [t, w] of Object.entries(ow)) { cum += BigInt(w); if (tr < cum) { selTier = t; break; } }
    if (!selTier) selTier = Object.keys(ow)[0];
    let items = selTier === 'gold' && cd.goldPool?.items ? cd.goldPool.items : cd.tiers?.[selTier] || [];
    if (!items.length) return null;
    const iw = items.map(i => ({ item: i, weight: BigInt(i.weights?.base || 1) }));
    const tt = iw.reduce((s, x) => s + x.weight, 0n), ir = BigInt(Math.floor(Math.random() * Number(tt)));
    let ic = 0n, si = items[0];
    for (const { item, weight } of iw) { ic += weight; if (ir < ic) { si = item; break; } }
    let st = false;
    if (si.statTrakEligible && cd.supportsStatTrak) { const sw = BigInt(si.weights?.statTrak || 0), nw = BigInt(si.weights?.nonStatTrak || 0), tw = sw + nw; if (tw > 0n && sw > 0n) st = BigInt(Math.floor(Math.random() * Number(tw))) < sw; }
    return { item: si, tier: selTier, statTrak: st, wear: rollWear() };
}

function selectRandomImage(item) { const imgs = [item.image, ...(item.imageAlternates || [])].filter(Boolean); return imgs.length ? imgs[Math.floor(Math.random() * imgs.length)] : null; }
function getPriceSnapshot(pr, item, wear, st) { const r = item.rarity || 'mil-spec', fb = pr.rarityFallbackPrices?.[r]; if (!fb) return { cad: 0.1, chosenCoins: 100 }; let c = fb.cad * (pr.wearMultipliers?.[wear] || 1); if (st) c *= pr.statTrakMultiplier || 2; return { cad: Math.round(c * 100) / 100, chosenCoins: Math.round(c * pr.cadToCoins) }; }
function successResponse(t, d) { return { type: t, ok: true, timestamp: new Date().toISOString(), data: d }; }
function errorResponse(t, c, m, det = null) { return { type: t, ok: false, timestamp: new Date().toISOString(), error: { code: c, message: m, details: det } }; }

async function main() {
    const RT = 'open-result';
    const platform = '{{platform}}' !== '{{' + 'platform}}' ? '{{platform}}' : 'twitch';
    const username = '{{username}}' !== '{{' + 'username}}' ? '{{username}}' : null;
    const alias = '{{alias}}' !== '{{' + 'alias}}' ? '{{alias}}' : '{{message}}';
    
    if (!username) { log(JSON.stringify(errorResponse(RT, 'MISSING_USERNAME', 'Username required'))); done(); return; }
    if (!alias) { log(JSON.stringify(errorResponse(RT, 'MISSING_ALIAS', 'Alias required'))); done(); return; }
    
    const [aliasData, inv, prices] = await Promise.all([loadJson(CONFIG.paths.aliases), loadJson(CONFIG.paths.inventories), loadJson(CONFIG.paths.prices)]);
    if (!aliasData || !inv || !prices) { log(JSON.stringify(errorResponse(RT, 'LOAD_ERROR', 'Failed to load data'))); done(); return; }
    
    const ca = aliasData.aliases[alias.toLowerCase().trim()];
    if (!ca) { log(JSON.stringify(errorResponse(RT, 'UNKNOWN_ALIAS', `Unknown: ${alias}`))); done(); return; }
    
    const { caseId, requiresKey, filename } = ca, keyId = 'default', userKey = buildUserKey(platform, username), user = getOrCreateUser(inv, userKey);
    if ((user.cases[caseId] || 0) < 1) { log(JSON.stringify(errorResponse(RT, 'NO_CASE', `No ${ca.displayName}`))); done(); return; }
    if (requiresKey && (user.keys[keyId] || 0) < 1) { log(JSON.stringify(errorResponse(RT, 'NO_KEY', 'Key required'))); done(); return; }
    
    const caseJson = await loadJson(`${CONFIG.paths.caseOdds}/${filename}`);
    if (!caseJson) { log(JSON.stringify(errorResponse(RT, 'CASE_NOT_FOUND', `Load failed: ${filename}`))); done(); return; }
    
    const roll = rollCaseFromJson(caseJson);
    if (!roll) { log(JSON.stringify(errorResponse(RT, 'ROLL_ERROR', 'Roll failed'))); done(); return; }
    if (!removeCases(user, caseId, 1)) { log(JSON.stringify(errorResponse(RT, 'CONSUME_ERROR', 'Case consume failed'))); done(); return; }
    if (requiresKey && !removeKeys(user, keyId, 1)) { user.cases[caseId] = (user.cases[caseId] || 0) + 1; log(JSON.stringify(errorResponse(RT, 'CONSUME_ERROR', 'Key consume failed'))); done(); return; }
    
    const at = new Date().toISOString(), ps = getPriceSnapshot(prices, roll.item, roll.wear, roll.statTrak);
    const oi = { oid: generateOid(), itemId: roll.item.itemId, displayName: roll.item.displayName, rarity: roll.item.rarity, tier: roll.tier, category: roll.item.category || 'weapon', weapon: roll.item.weapon, skin: roll.item.skin, variant: roll.item.variant || 'None', statTrak: roll.statTrak, wear: roll.wear, acquiredAt: at, lockedUntil: enforceLock(at), fromCaseId: caseId, priceSnapshot: ps, imagePath: selectRandomImage(roll.item) };
    
    user.items.push(oi); inv.lastModified = new Date().toISOString();
    if (!await saveJson(CONFIG.paths.inventories, inv)) { log(JSON.stringify(errorResponse(RT, 'SAVE_ERROR', 'Save failed'))); done(); return; }
    
    log(JSON.stringify(successResponse(RT, { winner: { oid: oi.oid, itemId: oi.itemId, displayName: oi.displayName, rarity: oi.rarity, tier: oi.tier, category: oi.category, weapon: oi.weapon, skin: oi.skin, variant: oi.variant, statTrak: oi.statTrak, wear: oi.wear }, imagePath: oi.imagePath, priceSnapshot: ps, acquiredAt: at, lockedUntil: oi.lockedUntil, newCounts: { cases: { ...user.cases }, keys: { ...user.keys } } })));
    done();
}

main();
