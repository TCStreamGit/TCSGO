async function () {
  "use strict";

  /*
   * Description: Commit Case Open Results And Grant Items.
   * Command Name: tcsgo-commit-open
   * Aliases: None
   * Usage Examples:
   * - tcsgo-commit-open
   */
  const LOG_ENABLED = false;

  const CODE_ID = "tcsgo-controller";
  const ACK_VAR = "tcsgo_last_event_json";
  const ACK_VAR_OPEN = "tcsgo_last_open_json";
  const DEFAULT_LINKING_BASE = "Z:\\home\\nike\\Streaming\\TCSGO\\Linking";
  const DISCORD_INDEX_FILE = "discord-user-index.json";
  const USER_LINKS_FILE = "user-links.json";
  const LINK_PLATFORM_PREFERENCE = ["twitch", "youtube", "tiktok"];
  const TRADE_LOCK_DAYS = 7;
  const WEAR_TABLE = [
    { name: "Factory New", weight: 3 },
    { name: "Minimal Wear", weight: 24 },
    { name: "Field-Tested", weight: 33 },
    { name: "Well-Worn", weight: 24 },
    { name: "Battle-Scarred", weight: 16 }
  ];
  const WEAR_TOTAL = WEAR_TABLE.reduce((s, w) => s + w.weight, 0);

  // ============================================================
  // HELPERS
  // ============================================================

  function logMsg(message) {
    if (!LOG_ENABLED) return;
    try { log(message); } catch (_) {}
  }

  function lowerTrim(raw) {
    return String(raw ?? "").trim().toLowerCase();
  }

  function normSite(raw) {
    const s = String(raw ?? "").toLowerCase();
    if (s.includes("tiktok")) return "tiktok";
    if (s.includes("youtube")) return "youtube";
    if (s.includes("twitch")) return "twitch";
    if (s.includes("kick")) return "kick";
    if (s.includes("discord")) return "discord";
    return s || "twitch";
  }

  async function resolveBasePath() {
    const base = String(await getVariable("TCSGO_BASE") ?? "").trim();
    if (base) return base;
    const envBase = (typeof process !== "undefined" && process.env && process.env.TCSGO_BASE)
      ? String(process.env.TCSGO_BASE).trim()
      : "";
    return envBase;
  }

  function safeCwd() {
    try {
      if (typeof process !== "undefined" && process.cwd) {
        return String(process.cwd() || "").trim();
      }
    } catch (_) {}
    return "";
  }

  function joinPath(base, rel) {
    const baseStr = String(base ?? "").trim();
    const sep = baseStr.includes("\\") ? "\\" : "/";
    const b = baseStr.replace(/[\\/]+$/g, "");
    const r = String(rel ?? "").replace(/^[\\/]+/g, "");
    return b ? `${b}${sep}${r}` : r;
  }

  function mkError(code, message) {
    return { code: String(code || "ERROR"), message: String(message || "Unknown Error") };
  }

  function uuidv4() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function createEmptyInventories() {
    return {
      schemaVersion: "2.0-inventories",
      lastModified: new Date().toISOString(),
      inventoriesById: {},
      identityIndex: {},
      discordIndex: {}
    };
  }

  function ensureInventoryRoot(inv) {
    if (!inv || typeof inv !== "object") return createEmptyInventories();
    const schema = String(inv.schemaVersion ?? "");
    if (schema && !schema.startsWith("2.0-")) {
      throw mkError("SCHEMA_MISMATCH", "Inventories schema 2.0 required.");
    }
    if (!inv.schemaVersion) inv.schemaVersion = "2.0-inventories";
    if (!inv.inventoriesById || typeof inv.inventoriesById !== "object") inv.inventoriesById = {};
    if (!inv.identityIndex || typeof inv.identityIndex !== "object") inv.identityIndex = {};
    if (!inv.discordIndex || typeof inv.discordIndex !== "object") inv.discordIndex = {};
    return inv;
  }

  function getOrCreateInventory(inv, identityKey, nowIso) {
    let inventoryId = inv.identityIndex[identityKey];
    if (!inventoryId) {
      inventoryId = `inv_${uuidv4()}`;
      inv.identityIndex[identityKey] = inventoryId;
      inv.inventoriesById[inventoryId] = {
        createdAt: nowIso,
        cases: {},
        keys: {},
        items: [],
        identities: [identityKey],
        mergedInto: null,
        mergedAt: null
      };
    }
    const inventory = inv.inventoriesById[inventoryId];
    if (!inventory || typeof inventory !== "object") {
      throw mkError("INVENTORY_NOT_FOUND", `Missing inventory ${inventoryId}`);
    }
    if (!Array.isArray(inventory.identities)) inventory.identities = [];
    if (!inventory.identities.includes(identityKey)) inventory.identities.push(identityKey);
    if (!inventory.cases || typeof inventory.cases !== "object") inventory.cases = {};
    if (!inventory.keys || typeof inventory.keys !== "object") inventory.keys = {};
    if (!Array.isArray(inventory.items)) inventory.items = [];
    return { inventory, inventoryId };
  }

  function dualAck(payloadObj) {
    const payloadStr = JSON.stringify(payloadObj);

    try {
      overlaySendCustomContent({ codeId: CODE_ID, content: payloadStr });
    } catch (_) {}

    try {
      setVariable({ name: ACK_VAR, value: payloadStr, global: true });
    } catch (_) {}

    try {
      setVariable({ name: ACK_VAR_OPEN, value: payloadStr, global: true });
    } catch (_) {}

    logMsg(payloadStr);
  }

  async function safeReadJson(fullPath, fallbackObj = null) {
    try {
      const raw = await readFile(fullPath);
      const txt = String(raw ?? "");
      return JSON.parse(txt);
    } catch (e) {
      return fallbackObj;
    }
  }

  function cleanUser(raw) {
    return lowerTrim(raw).replace(/^@+/, "");
  }

  async function resolveLinkingBase() {
    const base = String(await getVariable("TCSGO_LINKING_BASE") ?? "").trim();
    if (base) return base;
    const envBase = (typeof process !== "undefined" && process.env && process.env.TCSGO_LINKING_BASE)
      ? String(process.env.TCSGO_LINKING_BASE).trim()
      : "";
    return envBase || DEFAULT_LINKING_BASE;
  }

  function pickLinkedAccount(entry) {
    const linked = entry && typeof entry.linkedAccounts === "object" ? entry.linkedAccounts : null;
    if (!linked) return null;
    for (const platform of LINK_PLATFORM_PREFERENCE) {
      const rec = linked[platform];
      const usernameLower = cleanUser(rec?.usernameLower || rec?.username);
      if (usernameLower) return { platform, username: usernameLower };
    }
    return null;
  }

  async function resolveLinkedIdentity(platformRaw, usernameRaw) {
    const requestedPlatform = normSite(platformRaw || "twitch");
    const requestedUsername = cleanUser(usernameRaw);

    if (!requestedUsername) {
      return {
        requestedPlatform,
        requestedUsername,
        effectivePlatform: requestedPlatform,
        effectiveUsername: requestedUsername,
        linkedFromDiscord: false,
        linkStatus: "missing-username"
      };
    }

    if (requestedPlatform !== "discord") {
      return {
        requestedPlatform,
        requestedUsername,
        effectivePlatform: requestedPlatform,
        effectiveUsername: requestedUsername,
        linkedFromDiscord: false
      };
    }

    try {
      const linkingBase = await resolveLinkingBase();
      const indexPath = joinPath(linkingBase, DISCORD_INDEX_FILE);
      const linksPath = joinPath(linkingBase, USER_LINKS_FILE);

      const [indexRaw, linksRaw] = await Promise.all([
        safeReadJson(indexPath, null),
        safeReadJson(linksPath, null)
      ]);

      const indexUsers = indexRaw && typeof indexRaw.users === "object" ? indexRaw.users : {};
      const discordId = String(indexUsers[requestedUsername] || "").trim();
      if (!discordId) {
        return {
          requestedPlatform,
          requestedUsername,
          effectivePlatform: requestedPlatform,
          effectiveUsername: requestedUsername,
          linkedFromDiscord: false,
          linkStatus: "discord-not-found"
        };
      }

      const usersMap = linksRaw && typeof linksRaw.users === "object" ? linksRaw.users : {};
      const entry = usersMap[discordId];
      const linked = pickLinkedAccount(entry);

      if (!linked) {
        return {
          requestedPlatform,
          requestedUsername,
          effectivePlatform: requestedPlatform,
          effectiveUsername: requestedUsername,
          linkedFromDiscord: false,
          linkStatus: "no-linked-account",
          discordId
        };
      }

      return {
        requestedPlatform,
        requestedUsername,
        effectivePlatform: linked.platform,
        effectiveUsername: linked.username,
        linkedFromDiscord: true,
        discordId
      };
    } catch (err) {
      logMsg(`[OPEN] Discord link resolve failed | ${err?.message || err}`);
      return {
        requestedPlatform,
        requestedUsername,
        effectivePlatform: requestedPlatform,
        effectiveUsername: requestedUsername,
        linkedFromDiscord: false,
        linkStatus: "link-resolve-error"
      };
    }
  }

  function normalizeNewlines(raw) {
    return String(raw ?? "").replace(/\r\n/g, "\n");
  }

  async function verifyWrite(path, content) {
    const verify = await readFile(path);
    if (normalizeNewlines(verify) !== normalizeNewlines(content)) {
      throw new Error("Write Verification Failed");
    }
  }

  async function safeWriteFile(path, content) {
    // Prefer the command-style signature first to avoid worker errors.
    const attempts = [
      () => writeFile({ path, message: content, append: false }),
      () => writeFile(path, content)
    ];

    let lastErr = null;

    for (const attempt of attempts) {
      try {
        await attempt();
        await verifyWrite(path, content);
        return true;
      } catch (e) {
        lastErr = e;
      }
    }

    logMsg(`[WriteFile] Error | path=${path} | ${lastErr?.message ?? lastErr}`);
    return false;
  }

  async function safeWriteJson(fullPath, obj) {
    const out = JSON.stringify(obj, null, 2) + "\n";
    const ok = await safeWriteFile(fullPath, out);
    if (!ok) throw new Error("Write Failed (All Methods)");
  }

  function removeCases(u, id, q) {
    const c = u.cases[id] || 0;
    if (c < q) return false;
    u.cases[id] = c - q;
    if (!u.cases[id]) delete u.cases[id];
    return true;
  }

  function removeKeys(u, id, q) {
    const c = u.keys[id] || 0;
    if (c < q) return false;
    u.keys[id] = c - q;
    if (!u.keys[id]) delete u.keys[id];
    return true;
  }

  function generateOid() {
    return `oid_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 11)}`;
  }

  function enforceLock(at) {
    return new Date(new Date(at).getTime() + TRADE_LOCK_DAYS * 86400000).toISOString();
  }

  function rollWear() {
    let r = Math.random() * WEAR_TOTAL;
    for (const w of WEAR_TABLE) {
      r -= w.weight;
      if (r <= 0) return w.name;
    }
    return WEAR_TABLE[0].name;
  }

  function rollCaseFromJson(cj) {
    const cd = cj.case, unit = BigInt(cj.unit?.scale || 1e12), ow = cd.oddsWeights || {};
    const tr = BigInt(Math.floor(Math.random() * Number(unit)));
    let cum = 0n, selTier = null;

    for (const [t, w] of Object.entries(ow)) {
      cum += BigInt(w);
      if (tr < cum) {
        selTier = t;
        break;
      }
    }

    if (!selTier) selTier = Object.keys(ow)[0];

    let items = selTier === "gold" && cd.goldPool?.items ? cd.goldPool.items : cd.tiers?.[selTier] || [];
    if (!items.length) return null;

    const iw = items.map(i => ({ item: i, weight: BigInt(i.weights?.base || 1) }));
    const tt = iw.reduce((s, x) => s + x.weight, 0n), ir = BigInt(Math.floor(Math.random() * Number(tt)));
    let ic = 0n, si = items[0];

    for (const { item, weight } of iw) {
      ic += weight;
      if (ir < ic) {
        si = item;
        break;
      }
    }

    let st = false;
    if (si.statTrakEligible && cd.supportsStatTrak) {
      const sw = BigInt(si.weights?.statTrak || 0), nw = BigInt(si.weights?.nonStatTrak || 0), tw = sw + nw;
      if (tw > 0n && sw > 0n) {
        st = BigInt(Math.floor(Math.random() * Number(tw))) < sw;
      }
    }

    return { item: si, tier: selTier, statTrak: st, wear: rollWear() };
  }

  function selectRandomImage(item) {
    const imgs = [item.image, ...(item.imageAlternates || [])].filter(Boolean);
    return imgs.length ? imgs[Math.floor(Math.random() * imgs.length)] : null;
  }

  function getPriceSnapshot(pr, item, wear, st) {
    const r = item.rarity || "mil-spec", fb = pr.rarityFallbackPrices?.[r];
    if (!fb) return { cad: 0.1, chosenCoins: 100 };
    let c = fb.cad * (pr.wearMultipliers?.[wear] || 1);
    if (st) c *= pr.statTrakMultiplier || 2;
    return { cad: Math.round(c * 100) / 100, chosenCoins: Math.round(c * pr.cadToCoins) };
  }

  // ============================================================
  // INPUTS (From Overlay.callCommand)
  // ============================================================

  const t0 = Date.now();

  const basePathRaw = await resolveBasePath();
  const cwdPath = safeCwd();
  const eventId = String(await getVariable("eventId") ?? "");
  const platform = normSite(String(await getVariable("platform") ?? "twitch"));
  const username = String(await getVariable("username") ?? "");
  const alias = String(await getVariable("alias") ?? "");

  const identity = await resolveLinkedIdentity(platform, username);
  const effectivePlatform = identity.effectivePlatform;
  const effectiveUsername = identity.effectiveUsername;

  if (identity.linkedFromDiscord) {
    logMsg(
      `[OPEN] Discord mapped | ${identity.requestedPlatform}:${identity.requestedUsername} -> ` +
      `${effectivePlatform}:${effectiveUsername}`
    );
  }

  logMsg(
    `[OPEN] Vars | eventId=${eventId} | platform=${platform} | username=${username} | alias=${alias} | ` +
    `effective=${effectivePlatform}:${effectiveUsername} | baseRaw=${basePathRaw || "(empty)"} | cwd=${cwdPath || "(unknown)"}`
  );

  let result;

  try {
    if (!eventId) throw mkError("MISSING_EVENT_ID", "Missing eventId.");
    if (!username) throw mkError("MISSING_USERNAME", "Missing username.");
    if (!alias) throw mkError("MISSING_ALIAS", "Missing alias.");

    const baseCandidates = [];
    if (basePathRaw) baseCandidates.push(basePathRaw);
    baseCandidates.push(""); // allow relative paths from the current worker directory
    if (cwdPath && !baseCandidates.includes(cwdPath)) baseCandidates.push(cwdPath);

    let basePathUsed = "";
    let aliasesPath = "";
    let invPath = "";
    let pricesPath = "";
    let aliasDb = null;
    let inv = null;
    let prices = null;

    for (const baseCandidate of baseCandidates) {
      const aPath = joinPath(baseCandidate, "data/case-aliases.json");
      const iPath = joinPath(baseCandidate, "data/inventories.json");
      const pPath = joinPath(baseCandidate, "data/prices.json");

      const [aDb, iDb, pDb] = await Promise.all([
        safeReadJson(aPath, null),
        safeReadJson(iPath, null),
        safeReadJson(pPath, null)
      ]);

      if (aDb && iDb && pDb) {
        basePathUsed = baseCandidate;
        aliasesPath = aPath;
        invPath = iPath;
        pricesPath = pPath;
        aliasDb = aDb;
        inv = iDb;
        prices = pDb;
        break;
      }
    }

    if (!aliasDb || !inv || !prices) {
      const baseLabel = basePathRaw ? `base=${basePathRaw}` : "base=(empty)";
      const cwdLabel = cwdPath ? `cwd=${cwdPath}` : "cwd=(unknown)";
      throw mkError(
        basePathRaw ? "LOAD_ERROR" : "MISSING_TCSGO_BASE",
        basePathRaw
          ? `Failed to load data. ${baseLabel} | ${cwdLabel}`
          : `Missing TCSGO_BASE or working directory is not TCSGO. ${cwdLabel}`
      );
    }

    logMsg(`[OPEN] Base Path | used=${basePathUsed || "(relative)"}`);

    const aliasKey = lowerTrim(alias);
    const ca = aliasDb?.aliases?.[aliasKey];
    if (!ca) throw mkError("UNKNOWN_ALIAS", `Unknown: ${aliasKey}`);

    const caseId = String(ca.caseId || "");
    const displayName = String(ca.displayName || ca.name || caseId || aliasKey);
    const requiresKey = !!ca.requiresKey;
    const filename = String(ca.filename || "");

    if (!caseId) throw mkError("BAD_ALIAS_RECORD", `Alias Missing caseId: ${aliasKey}`);
    if (!filename) throw mkError("CASE_NOT_FOUND", `Missing filename for alias: ${aliasKey}`);

    const invRoot = ensureInventoryRoot(inv);
    const identityKey = `${lowerTrim(effectivePlatform)}:${lowerTrim(effectiveUsername)}`;
    const nowIso = new Date().toISOString();
    const { inventory: user } = getOrCreateInventory(invRoot, identityKey, nowIso);

    if ((user.cases[caseId] || 0) < 1) {
      throw mkError("NO_CASE", `No ${displayName}`);
    }

    const keyId = "csgo-case-key";
    if (requiresKey && (user.keys[keyId] || 0) < 1) {
      throw mkError("NO_KEY", "Key required");
    }

    const caseJsonPath = joinPath(basePathUsed, `Case-Odds/${filename}`);
    const caseJson = await safeReadJson(caseJsonPath, null);
    if (!caseJson) throw mkError("CASE_NOT_FOUND", `Load failed: ${filename}`);

    const roll = rollCaseFromJson(caseJson);
    if (!roll) throw mkError("ROLL_ERROR", "Roll failed");

    if (!removeCases(user, caseId, 1)) {
      throw mkError("CONSUME_ERROR", "Case consume failed");
    }

    if (requiresKey && !removeKeys(user, keyId, 1)) {
      // Rollback case consumption
      user.cases[caseId] = (user.cases[caseId] || 0) + 1;
      throw mkError("CONSUME_ERROR", "Key consume failed");
    }

    const at = new Date().toISOString();
    const ps = getPriceSnapshot(prices, roll.item, roll.wear, roll.statTrak);

    const oi = {
      oid: generateOid(),
      itemId: roll.item.itemId,
      displayName: roll.item.displayName,
      rarity: roll.item.rarity,
      tier: roll.tier,
      category: roll.item.category || "weapon",
      weapon: roll.item.weapon,
      skin: roll.item.skin,
      variant: roll.item.variant || "None",
      statTrak: roll.statTrak,
      wear: roll.wear,
      acquiredAt: at,
      lockedUntil: enforceLock(at),
      fromCaseId: caseId,
      priceSnapshot: ps,
      imagePath: selectRandomImage(roll.item)
    };

    user.items.push(oi);
    invRoot.lastModified = new Date().toISOString();

    await safeWriteJson(invPath, invRoot);

    result = {
      type: "open-result",
      ok: true,
      eventId,
      platform,
      username,
      data: {
        eventId,
        alias: aliasKey,
        caseId,
        caseDisplayName: displayName,
        caseFilename: filename,
        requiresKey,
        effectivePlatform,
        effectiveUsername,
        linkedFromDiscord: identity.linkedFromDiscord,
        winner: {
          oid: oi.oid,
          itemId: oi.itemId,
          displayName: oi.displayName,
          rarity: oi.rarity,
          tier: oi.tier,
          category: oi.category,
          weapon: oi.weapon,
          skin: oi.skin,
          variant: oi.variant,
          statTrak: oi.statTrak,
          wear: oi.wear
        },
        imagePath: oi.imagePath,
        priceSnapshot: ps,
        acquiredAt: at,
        lockedUntil: oi.lockedUntil,
        newCounts: {
          cases: { ...user.cases },
          keys: { ...user.keys }
        },
        timings: { msTotal: Date.now() - t0 }
      }
    };

    const successSuffix = identity.linkedFromDiscord
      ? ` | effective=${effectivePlatform}:${effectiveUsername}`
      : "";
    logMsg(`[OPEN] Success | ${username} Opened ${oi.displayName} | oid=${oi.oid}${successSuffix}`);

  } catch (err) {
    const e =
      (err && typeof err === "object" && ("code" in err) && ("message" in err))
        ? err
        : mkError("OPEN_FAILED", (err && err.message) ? err.message : String(err));

    result = {
      type: "open-result",
      ok: false,
      eventId: eventId || "",
      platform,
      username,
      error: e,
      data: { timings: { msTotal: Date.now() - t0 } }
    };

    logMsg(`[OPEN] Error | ${e.code} - ${e.message}`);
  }

  dualAck(result);
  done();
}
