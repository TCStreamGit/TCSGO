async function () {
  "use strict";

  const LOG_ENABLED = true;

  const TCSGO_BASE = "A:\\Development\\Version Control\\Github\\TCSGO";
  const CODE_ID = "tcsgo-controller";
  const ACK_VAR = "tcsgo_last_event_json";

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

  function buildUserKey(u, p) {
    return `${lowerTrim(u)}:${lowerTrim(p)}`;
  }

  function buildPriceKey(itemId, wear, statTrak, variant) {
    return `${itemId}|${wear}|${statTrak ? "1" : "0"}|${variant || "None"}`;
  }

  function getPrice(prices, itemId, wear, statTrak, variant, rarity) {
    const pk = buildPriceKey(itemId, wear, statTrak, variant);
    if (prices.items?.[pk]) {
      const c = prices.items[pk];
      return { cad: c.cad, chosenCoins: c.chosenCoins, isEstimated: false, updatedAt: c.updatedAt, priceKey: pk };
    }
    const fb = prices.rarityFallbackPrices?.[rarity || "mil-spec"];
    if (!fb) return { cad: 0.10, chosenCoins: 100, isEstimated: true, priceKey: pk };
    let cad = fb.cad * (prices.wearMultipliers?.[wear] || 1);
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
    if (ms <= 0) return "0s";
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  // ============================================================
  // INPUTS (From Overlay.callCommand or Chat)
  // ============================================================

  const t0 = Date.now();

  const eventId = String(await getVariable("eventId") ?? "");
  const platform = normSite(String(await getVariable("platform") ?? "twitch"));
  const username = String(await getVariable("username") ?? "");
  const oid = String(await getVariable("oid") ?? "");
  const itemIdInput = String(await getVariable("itemId") ?? "");

  logMsg(`[CHECKPRICE] Vars | eventId=${eventId} | platform=${platform} | username=${username} | oid=${oid} | itemId=${itemIdInput}`);

  let result;

  try {
    if (!username) throw mkError("MISSING_USERNAME", "Username required");
    if (!oid && !itemIdInput) throw mkError("MISSING_IDENTIFIER", "oid or itemId required");

    const pricesPath = joinPath(TCSGO_BASE, "data\\prices.json");
    const invPath = joinPath(TCSGO_BASE, "data\\inventories.json");

    const prices = await safeReadJson(pricesPath, null);
    if (!prices) throw mkError("LOAD_ERROR", "Failed to load prices");

    if (oid) {
      const inv = await safeReadJson(invPath, null);
      if (!inv) throw mkError("LOAD_ERROR", "Failed to load inventories");

      const user = inv.users?.[buildUserKey(username, platform)];
      if (!user) throw mkError("USER_NOT_FOUND", "User not found");

      const item = (user.items || []).find(i => i.oid === oid);
      if (!item) throw { code: "ITEM_NOT_FOUND", message: "Item not found", details: { oid } };

      const pi = getPrice(prices, item.itemId, item.wear, item.statTrak, item.variant || "None", item.rarity);
      const ls = checkLock(item.lockedUntil);

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
      const wearRaw = await getVariable("wear");
      const statTrakRaw = await getVariable("statTrak");
      const variantRaw = await getVariable("variant");
      const rarityRaw = await getVariable("rarity");

      const wear = String(wearRaw ?? "Field-Tested");
      const statTrakStr = String(statTrakRaw ?? "false").toLowerCase();
      const statTrak = statTrakStr === "true" || statTrakStr === "1" || statTrakRaw === true;
      const variant = String(variantRaw ?? "None");
      const rarity = String(rarityRaw ?? "mil-spec");

      const pi = getPrice(prices, itemIdInput, wear, statTrak, variant, rarity);

      result = {
        type: "checkprice-result",
        ok: true,
        eventId: eventId || "",
        platform,
        username,
        data: {
          eventId: eventId || "",
          oid: null,
          itemId: itemIdInput,
          displayName: null,
          wear,
          statTrak,
          variant,
          rarity,
          lockedUntil: null,
          lockStatus: null,
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
  done();
}
