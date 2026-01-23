async function () {
  "use strict";

  const TCSGO_BASE = "A:\\Development\\Version Control\\Github\\TCSGO";
  const CODE_ID = "tcsgo-controller";
  const ACK_VAR = "tcsgo_last_event_json";
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

  function lowerTrim(raw) {
    return String(raw ?? "").trim().toLowerCase();
  }

  function normSite(raw) {
    const s = String(raw ?? "").toLowerCase();
    if (s.includes("tiktok")) return "tiktok";
    if (s.includes("youtube")) return "youtube";
    if (s.includes("twitch")) return "twitch";
    if (s.includes("kick")) return "kick";
    return s || "twitch";
  }

  function joinPath(base, rel) {
    const b = String(base ?? "").replace(/[\\/]+$/g, "");
    const r = String(rel ?? "").replace(/^[\\/]+/g, "");
    return `${b}\\${r}`.replace(/\//g, "\\");
  }

  function mkError(code, message) {
    return { code: String(code || "ERROR"), message: String(message || "Unknown Error") };
  }

  function dualAck(payloadObj) {
    const payloadStr = JSON.stringify(payloadObj);

    try {
      overlaySendCustomContent({ codeId: CODE_ID, content: payloadStr });
    } catch (_) {}

    try {
      setVariable({ name: ACK_VAR, value: payloadStr, global: true });
    } catch (_) {}

    try { log(payloadStr); } catch (_) {}
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

    log(`[WriteFile] Error | path=${path} | ${lastErr?.message ?? lastErr}`);
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

  const eventId = String(await getVariable("eventId") ?? "");
  const platform = normSite(String(await getVariable("platform") ?? "twitch"));
  const username = String(await getVariable("username") ?? "");
  const alias = String(await getVariable("alias") ?? "");

  log(`[OPEN] Vars | eventId=${eventId} | platform=${platform} | username=${username} | alias=${alias}`);

  let result;

  try {
    if (!eventId) throw mkError("MISSING_EVENT_ID", "Missing eventId.");
    if (!username) throw mkError("MISSING_USERNAME", "Missing username.");
    if (!alias) throw mkError("MISSING_ALIAS", "Missing alias.");

    const aliasesPath = joinPath(TCSGO_BASE, "data\\case-aliases.json");
    const invPath = joinPath(TCSGO_BASE, "data\\inventories.json");
    const pricesPath = joinPath(TCSGO_BASE, "data\\prices.json");

    const [aliasDb, inv, prices] = await Promise.all([
      safeReadJson(aliasesPath, null),
      safeReadJson(invPath, null),
      safeReadJson(pricesPath, null)
    ]);

    if (!aliasDb || !inv || !prices) throw mkError("LOAD_ERROR", "Failed to load data.");

    const aliasKey = lowerTrim(alias);
    const ca = aliasDb?.aliases?.[aliasKey];
    if (!ca) throw mkError("UNKNOWN_ALIAS", `Unknown: ${aliasKey}`);

    const caseId = String(ca.caseId || "");
    const displayName = String(ca.displayName || ca.name || caseId || aliasKey);
    const requiresKey = !!ca.requiresKey;
    const filename = String(ca.filename || "");

    if (!caseId) throw mkError("BAD_ALIAS_RECORD", `Alias Missing caseId: ${aliasKey}`);
    if (!filename) throw mkError("CASE_NOT_FOUND", `Missing filename for alias: ${aliasKey}`);

    if (!inv.users || typeof inv.users !== "object") inv.users = {};

    const userKey = `${lowerTrim(username)}:${lowerTrim(platform)}`;

    if (!inv.users[userKey]) {
      inv.users[userKey] = {
        platform,
        username,
        cases: {},
        keys: {},
        items: [],
        pendingSell: null
      };
    }

    const user = inv.users[userKey];
    if (!user.cases || typeof user.cases !== "object") user.cases = {};
    if (!user.keys || typeof user.keys !== "object") user.keys = {};
    if (!Array.isArray(user.items)) user.items = [];

    if ((user.cases[caseId] || 0) < 1) {
      throw mkError("NO_CASE", `No ${displayName}`);
    }

    const keyId = "csgo-case-key";
    if (requiresKey && (user.keys[keyId] || 0) < 1) {
      throw mkError("NO_KEY", "Key required");
    }

    const caseJsonPath = joinPath(TCSGO_BASE, `Case-Odds\\${filename}`);
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
    inv.lastModified = new Date().toISOString();

    await safeWriteJson(invPath, inv);

    result = {
      type: "open-result",
      ok: true,
      eventId,
      platform,
      username,
      data: {
        eventId,
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

    log(`[OPEN] Success | ${username} Opened ${oi.displayName} | oid=${oi.oid}`);

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

    log(`[OPEN] Error | ${e.code} - ${e.message}`);
  }

  dualAck(result);
  done();
}
