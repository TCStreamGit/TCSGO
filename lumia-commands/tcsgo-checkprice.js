async function () {
  "use strict";

  const LOG_ENABLED = true;
  const TIKTOK_SEND_COMMAND = "tiktok_chat_send";

  const TCSGO_BASE = "A:\\Development\\Version Control\\Github\\TCSGO";
  const CODE_ID = "tcsgo-controller";
  const ACK_VAR = "tcsgo_last_event_json";
  const CASE_ALIASES_PATH = "data\\case-aliases.json";

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
    const s = lowerTrim(raw);
    if (s.includes("tiktok")) return "tiktok";
    if (s.includes("youtube")) return "youtube";
    if (s.includes("twitch")) return "twitch";
    if (s.includes("kick")) return "kick";
    return s || "twitch";
  }

  function cleanTemplateValue(raw) {
    const v = String(raw ?? "").trim();
    if (!v) return "";
    if (v.startsWith("{{") && v.endsWith("}}")) return "";
    return v;
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

    logMsg(payloadStr);
  }

  async function safeReadJson(fullPath, fallbackObj = null) {
    try {
      const raw = await readFile(fullPath);
      const txt = String(raw ?? "");
      return JSON.parse(txt);
    } catch (_) {
      return fallbackObj;
    }
  }

  function parseArgs(message) {
    const msg = String(message ?? "").trim();
    if (!msg) return [];
    const parts = msg.split(/\s+/);
    return parts.length > 1 ? parts.slice(1) : [];
  }

  function buildUserKey(u, p) {
    return `${lowerTrim(u)}:${lowerTrim(p)}`;
  }

  function buildPriceKey(itemId, wear, statTrak, variant) {
    return `${itemId}|${wear}|${statTrak ? "1" : "0"}|${variant || "None"}`;
  }

  function getPrice(prices, itemId, wear, statTrak, variant, rarity) {
    const pk = buildPriceKey(itemId, wear, statTrak, variant);
    const entry = prices?.items?.[pk];

    if (entry !== undefined && entry !== null) {
      if (typeof entry === "number") {
        const cad = entry;
        return {
          cad,
          chosenCoins: Math.round(cad * (prices.cadToCoins || 1000)),
          isEstimated: false,
          updatedAt: null,
          priceKey: pk
        };
      }

      if (typeof entry === "string") {
        const cad = Number(entry);
        if (Number.isFinite(cad)) {
          return {
            cad,
            chosenCoins: Math.round(cad * (prices.cadToCoins || 1000)),
            isEstimated: false,
            updatedAt: null,
            priceKey: pk
          };
        }
      }

      if (typeof entry === "object") {
        const cadRaw = Number(entry.cad ?? entry.price ?? entry.value);
        const coinsRaw = Number(entry.chosenCoins ?? entry.coins);
        const cad = Number.isFinite(cadRaw) ? cadRaw : null;
        const chosenCoins = Number.isFinite(coinsRaw)
          ? coinsRaw
          : (Number.isFinite(cad) ? Math.round(cad * (prices.cadToCoins || 1000)) : NaN);

        if (Number.isFinite(cad) || Number.isFinite(chosenCoins)) {
          return {
            cad,
            chosenCoins,
            isEstimated: false,
            updatedAt: entry.updatedAt || null,
            priceKey: pk
          };
        }
      }
    }

    const fb = prices?.rarityFallbackPrices?.[rarity || "mil-spec"];
    if (!fb) return { cad: 0.10, chosenCoins: 100, isEstimated: true, priceKey: pk };
    let cad = Number(fb.cad) * (prices.wearMultipliers?.[wear] || 1);
    if (statTrak) cad *= prices.statTrakMultiplier || 2;
    return {
      cad: Math.round(cad * 100) / 100,
      chosenCoins: Math.round(cad * (prices.cadToCoins || 1000)),
      isEstimated: true,
      priceKey: pk
    };
  }

  function checkLock(lu) {
    const r = Math.max(0, new Date(lu).getTime() - Date.now());
    return { locked: r > 0, remainingFormatted: formatDuration(r) };
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "0s";
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  function formatNumber(num) {
    return (Number(num) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatPriceText(price) {
    if (!price || typeof price !== "object") return "Price unavailable";
    const coins = Number(price.chosenCoins);
    const cad = Number(price.cad);
    const parts = [];
    if (Number.isFinite(coins)) parts.push(`${formatNumber(coins)} Coins`);
    if (Number.isFinite(cad)) parts.push(`$${cad.toFixed(2)} CAD`);
    const base = parts.length ? parts.join(" | ") : "Price unavailable";
    return price.isEstimated ? `${base} (est)` : base;
  }

  function formatCaseSource(caseSource) {
    if (!caseSource) return "";
    const name = String(caseSource.displayName || caseSource.caseId || "").trim();
    return name;
  }

  function findItemInCase(caseJson, itemIdLower) {
    const tiers = caseJson?.case?.tiers || {};
    for (const [tier, items] of Object.entries(tiers)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (lowerTrim(item?.itemId) === itemIdLower) return { item, tier };
      }
    }

    const goldItems = caseJson?.case?.goldPool?.items;
    if (Array.isArray(goldItems)) {
      for (const item of goldItems) {
        if (lowerTrim(item?.itemId) === itemIdLower) return { item, tier: "gold" };
      }
    }

    return null;
  }

  function normalizeQuery(raw) {
    return lowerTrim(String(raw ?? ""));
  }

  function matchItemQuery(item, query) {
    if (!item || !query) return false;
    const id = normalizeQuery(item.itemId);
    const name = normalizeQuery(item.displayName);
    return id === query || name === query;
  }

  async function findItemInCases(caseDb, query) {
    const q = normalizeQuery(query);
    const cases = caseDb?.cases ? Object.values(caseDb.cases) : [];

    for (const info of cases) {
      const filename = String(info?.filename ?? "").trim();
      if (!filename) continue;
      const casePath = joinPath(TCSGO_BASE, `Case-Odds\\${filename}`);
      const caseJson = await safeReadJson(casePath, null);
      if (!caseJson?.case) continue;

      const match = findItemInCase(caseJson, q);
      if (match) {
        const displayName = String(info.displayName || caseJson.case.name || info.caseId || "");
        return {
          caseInfo: {
            caseId: info.caseId,
            displayName,
            caseType: info.caseType,
            requiresKey: info.requiresKey
          },
          item: match.item,
          tier: match.tier
        };
      }

      const tiers = caseJson?.case?.tiers || {};
      for (const items of Object.values(tiers)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (!matchItemQuery(item, q)) continue;
          const displayName = String(info.displayName || caseJson.case.name || info.caseId || "");
          return {
            caseInfo: {
              caseId: info.caseId,
              displayName,
              caseType: info.caseType,
              requiresKey: info.requiresKey
            },
            item,
            tier: item.tier || item.rarity || "unknown"
          };
        }
      }

      const goldItems = caseJson?.case?.goldPool?.items;
      if (Array.isArray(goldItems)) {
        for (const item of goldItems) {
          if (!matchItemQuery(item, q)) continue;
          const displayName = String(info.displayName || caseJson.case.name || info.caseId || "");
          return {
            caseInfo: {
              caseId: info.caseId,
              displayName,
              caseType: info.caseType,
              requiresKey: info.requiresKey
            },
            item,
            tier: item.tier || item.rarity || "gold"
          };
        }
      }
    }

    return null;
  }

  async function reply(site, message) {
    const msg = String(message ?? "").trim();
    if (!msg) return;
    if (site === "tiktok") {
      try { callCommand({ name: TIKTOK_SEND_COMMAND, variableValues: { message: msg } }); return; } catch (_) {}
    }
    try { chatbot({ message: msg, platform: site, site }); } catch (_) {}
  }

  // ============================================================
  // INPUTS (From Overlay.callCommand or Chat)
  // ============================================================

  const t0 = Date.now();

  const rawMessage = cleanTemplateValue(await getVariable("message") ?? "{{message}}");
  const args = parseArgs(rawMessage);

  const eventId = String(await getVariable("eventId") ?? "");
  const platform = normSite(
    (await getVariable("platform")) ||
    (await getVariable("site")) ||
    (await getVariable("origin")) ||
    "twitch"
  );
  const username =
    cleanTemplateValue(await getVariable("username")) ||
    cleanTemplateValue(await getVariable("displayname")) ||
    cleanTemplateValue(await getVariable("displayName")) ||
    cleanTemplateValue(await getVariable("user")) ||
    "";

  let oid = String(await getVariable("oid") ?? "");
  let itemIdInput = String(await getVariable("itemId") ?? "");

  if (!oid && !itemIdInput && args.length) {
    const arg = String(args[0] ?? "").trim();
    if (lowerTrim(arg).startsWith("oid_")) oid = arg;
    else itemIdInput = arg;
  }

  oid = String(oid ?? "").trim();
  itemIdInput = String(itemIdInput ?? "").trim();

  const isChat = !!rawMessage;
  const usernameLabel = username || "viewer";

  logMsg(`[CHECKPRICE] Vars | eventId=${eventId} | platform=${platform} | username=${usernameLabel} | oid=${oid} | itemId=${itemIdInput} | chat=${isChat}`);

  let result;

  try {
    if (!username) throw mkError("MISSING_USERNAME", "Username required");
    if (!oid && !itemIdInput) throw mkError("MISSING_IDENTIFIER", "oid or itemId required");

    const pricesPath = joinPath(TCSGO_BASE, "data\\prices.json");
    const invPath = joinPath(TCSGO_BASE, "data\\inventories.json");
    const aliasesPath = joinPath(TCSGO_BASE, CASE_ALIASES_PATH);

    const prices = await safeReadJson(pricesPath, null);
    if (!prices) throw mkError("LOAD_ERROR", "Failed to load prices");

    const aliasDb = await safeReadJson(aliasesPath, null);

    if (oid) {
      const inv = await safeReadJson(invPath, null);
      if (!inv) throw mkError("LOAD_ERROR", "Failed to load inventories");

      const user = inv.users?.[buildUserKey(username, platform)];
      if (!user) throw mkError("USER_NOT_FOUND", "User not found");

      const item = (user.items || []).find(i => lowerTrim(i.oid) === lowerTrim(oid));
      if (!item) throw { code: "ITEM_NOT_FOUND", message: "Item not found", details: { oid } };

      const pi = getPrice(prices, item.itemId, item.wear, item.statTrak, item.variant || "None", item.rarity);
      const ls = checkLock(item.lockedUntil);

      let caseSource = null;
      if (item.fromCaseId) {
        const hit = aliasDb?.cases?.[item.fromCaseId];
        caseSource = hit
          ? { caseId: hit.caseId, displayName: hit.displayName || hit.caseId, caseType: hit.caseType }
          : { caseId: item.fromCaseId, displayName: item.fromCaseId };
      }

      result = {
        type: "checkprice-result",
        ok: true,
        eventId: eventId || "",
        platform,
        username,
        data: {
          eventId: eventId || "",
          oid: item.oid,
          itemId: item.itemId,
          displayName: item.displayName,
          wear: item.wear,
          statTrak: item.statTrak,
          variant: item.variant || "None",
          rarity: item.rarity,
          lockedUntil: item.lockedUntil,
          lockStatus: ls,
          caseSource,
          priceKey: pi.priceKey,
          price: {
            cad: pi.cad,
            chosenCoins: pi.chosenCoins,
            isEstimated: pi.isEstimated,
            updatedAt: pi.updatedAt || null
          },
          timings: { msTotal: Date.now() - t0 }
        }
      };
    } else {
      if (!aliasDb || !aliasDb.cases) throw mkError("LOAD_ERROR", "Failed to load case aliases");

      const wearRaw = await getVariable("wear");
      const statTrakRaw = await getVariable("statTrak");
      const variantRaw = await getVariable("variant");
      const rarityRaw = await getVariable("rarity");

      const wear = String(wearRaw ?? "Field-Tested");
      const statTrakStr = String(statTrakRaw ?? "false").toLowerCase();
      const statTrak = statTrakStr === "true" || statTrakStr === "1" || statTrakRaw === true;
      const variant = String(variantRaw ?? "None");
      let rarity = String(rarityRaw ?? "").trim();

      const match = await findItemInCases(aliasDb, itemIdInput);
      if (!match) throw mkError("ITEM_NOT_FOUND", "Item not found in case data");

      const foundItem = match.item || {};
      const displayName = String(foundItem.displayName || itemIdInput);
      const resolvedItemId = String(foundItem.itemId || itemIdInput);
      const foundVariant = String(foundItem.variant || variant || "None");
      const foundRarity = String(foundItem.rarity || rarity || "mil-spec");
      rarity = foundRarity;

      const pi = getPrice(prices, resolvedItemId, wear, statTrak, foundVariant, rarity);

      result = {
        type: "checkprice-result",
        ok: true,
        eventId: eventId || "",
        platform,
        username,
        data: {
          eventId: eventId || "",
          oid: null,
          itemId: resolvedItemId,
          displayName,
          wear,
          statTrak,
          variant: foundVariant,
          rarity,
          lockedUntil: null,
          lockStatus: null,
          caseSource: match.caseInfo || null,
          priceKey: pi.priceKey,
          price: {
            cad: pi.cad,
            chosenCoins: pi.chosenCoins,
            isEstimated: pi.isEstimated,
            updatedAt: pi.updatedAt || null
          },
          timings: { msTotal: Date.now() - t0 }
        }
      };
    }
  } catch (err) {
    const e =
      (err && typeof err === "object" && ("code" in err) && ("message" in err))
        ? err
        : mkError("CHECKPRICE_FAILED", (err && err.message) ? err.message : String(err));

    result = {
      type: "checkprice-result",
      ok: false,
      eventId: eventId || "",
      platform,
      username,
      error: e,
      data: { timings: { msTotal: Date.now() - t0 } }
    };
  }

  dualAck(result);

  if (isChat) {
    if (result.ok && result.data) {
      const data = result.data;
      const name = String(data.displayName || data.itemId || "Unknown Item");
      const variant = data.variant && data.variant !== "None" ? ` ${data.variant}` : "";
      const st = data.statTrak ? " StatTrak" : "";
      const wear = data.wear ? ` (${data.wear})` : "";
      const rarity = data.rarity ? ` [${data.rarity}]` : "";
      const priceText = formatPriceText(data.price);
      const caseName = formatCaseSource(data.caseSource);

      const parts = [
        `${name}${variant}${st}${wear}${rarity}`,
        priceText
      ];

      if (caseName) parts.push(`Case: ${caseName}`);
      if (data.oid) parts.push(`OID: ${data.oid}`);
      if (data.lockStatus?.locked) parts.push(`locked ${data.lockStatus.remainingFormatted}`);

      await reply(platform, `@${usernameLabel} ${parts.join(" | ")}`);
    } else {
      const errMsg = result?.error?.message || "Checkprice failed";
      const usage = result?.error?.code === "MISSING_IDENTIFIER"
        ? " Usage: !checkprice <oid|itemId|itemName>."
        : "";
      await reply(platform, `@${usernameLabel} ${errMsg}.${usage}`.replace("..", "."));
    }
  }

  done();
}
