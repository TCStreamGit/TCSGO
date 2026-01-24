async function () {
  "use strict";

  const LOG_ENABLED = true;

  const TCSGO_BASE = "A:\\Development\\Version Control\\Github\\TCSGO";
  const CODE_ID = "tcsgo-controller";
  const ACK_VAR = "tcsgo_last_event_json";
  const SELL_TOKEN_EXPIRATION_SECONDS = 60;

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

  function generateSellToken() {
    return `sell_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 12)}`;
  }

  function checkLock(lu) {
    const r = Math.max(0, new Date(lu).getTime() - Date.now());
    return { locked: r > 0, remainingMs: r, remainingFormatted: formatDuration(r) };
  }

  function formatDuration(ms) {
    if (ms <= 0) return "0s";
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  function calculateCreditAfterFee(coins, fee) {
    return Math.floor(coins * (1 - fee / 100));
  }

  // ============================================================
  // INPUTS (From Overlay.callCommand)
  // ============================================================

  const t0 = Date.now();

  const eventId = String(await getVariable("eventId") ?? "");
  const platform = normSite(String(await getVariable("platform") ?? "twitch"));
  const username = String(await getVariable("username") ?? "");
  const oid = String(await getVariable("oid") ?? "");
  const query = String(
    (await getVariable("query")) ??
    (await getVariable("itemId")) ??
    (await getVariable("itemName")) ??
    ""
  ).trim();

  logMsg(`[SELLSTART] Vars | eventId=${eventId} | platform=${platform} | username=${username} | oid=${oid} | query=${query}`);

  let result;

  try {
    if (!eventId) throw mkError("MISSING_EVENT_ID", "Missing eventId.");
    if (!username) throw mkError("MISSING_USERNAME", "Missing username.");
    if (!oid && !query) throw mkError("MISSING_IDENTIFIER", "Missing oid or item identifier.");

    const invPath = joinPath(TCSGO_BASE, "data\\inventories.json");
    const pricesPath = joinPath(TCSGO_BASE, "data\\prices.json");

    const [inv, prices] = await Promise.all([
      safeReadJson(invPath, null),
      safeReadJson(pricesPath, null)
    ]);

    if (!inv || !prices) throw mkError("LOAD_ERROR", "Failed to load data.");

    if (!inv.users || typeof inv.users !== "object") inv.users = {};

    const user = inv.users[`${lowerTrim(username)}:${lowerTrim(platform)}`];
    if (!user) throw mkError("USER_NOT_FOUND", "User not found");

    if (!Array.isArray(user.items)) user.items = [];

    let item = null;
    let resolvedOid = oid;

    if (oid) {
      item = user.items.find(i => lowerTrim(i.oid) === lowerTrim(oid));
    }

    if (!item && query) {
      const q = lowerTrim(query);
      const matches = user.items.filter(i => lowerTrim(i.itemId) === q || lowerTrim(i.displayName) === q);
      if (matches.length > 1) {
        throw {
          code: "AMBIGUOUS_ITEM",
          message: `Multiple items match "${query}". Use oid.`,
          details: { count: matches.length }
        };
      }
      if (matches.length === 1) {
        item = matches[0];
        resolvedOid = item.oid;
      }
    }

    if (!item) {
      throw { code: "ITEM_NOT_FOUND", message: "Item not found", details: { oid, query } };
    }

    const ls = checkLock(item.lockedUntil);
    if (ls.locked) {
      throw {
        code: "ITEM_LOCKED",
        message: `Locked for ${ls.remainingFormatted}`,
        details: { lockedUntil: item.lockedUntil }
      };
    }

    if (user.pendingSell && Date.now() < new Date(user.pendingSell.expiresAt).getTime()) {
      throw {
        code: "PENDING_SELL_EXISTS",
        message: "Pending sell exists",
        details: { existingOid: user.pendingSell.oid }
      };
    }

    const fee = prices.marketFeePercent || 10;
    const credit = calculateCreditAfterFee(item.priceSnapshot?.chosenCoins || 0, fee);
    const token = generateSellToken();
    const expiresAt = new Date(Date.now() + SELL_TOKEN_EXPIRATION_SECONDS * 1000).toISOString();

    user.pendingSell = {
      token,
      oid: resolvedOid,
      expiresAt,
      itemSummary: {
        displayName: item.displayName,
        rarity: item.rarity,
        statTrak: item.statTrak,
        wear: item.wear
      },
      creditAmount: credit
    };
    inv.lastModified = new Date().toISOString();

    await safeWriteJson(invPath, inv);

    result = {
      type: "sell-start-result",
      ok: true,
      eventId,
      platform,
      username,
      data: {
        eventId,
        token,
        oid: resolvedOid,
        expiresAt,
        expiresInSeconds: SELL_TOKEN_EXPIRATION_SECONDS,
        item: {
          displayName: item.displayName,
          rarity: item.rarity,
          tier: item.tier,
          statTrak: item.statTrak,
          wear: item.wear,
          priceSnapshot: item.priceSnapshot
        },
        creditAmount: credit,
        marketFeePercent: fee,
        timings: { msTotal: Date.now() - t0 }
      }
    };

    logMsg(`[SELLSTART] Success | ${username} token=${token} | oid=${resolvedOid}`);

  } catch (err) {
    const e =
      (err && typeof err === "object" && ("code" in err) && ("message" in err))
        ? err
        : mkError("SELL_START_FAILED", (err && err.message) ? err.message : String(err));

    result = {
      type: "sell-start-result",
      ok: false,
      eventId: eventId || "",
      platform,
      username,
      error: e,
      data: { timings: { msTotal: Date.now() - t0 } }
    };

    logMsg(`[SELLSTART] Error | ${e.code} - ${e.message}`);
  }

  dualAck(result);
  done();
}
