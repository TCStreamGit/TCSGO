async function () {
  "use strict";

  const TCSGO_BASE = "A:\\Development\\Version Control\\Github\\TCSGO";
  const CODE_ID = "tcsgo-controller";
  const ACK_VAR = "tcsgo_last_event_json";

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

  // ============================================================
  // INPUTS (From Overlay.callCommand)
  // ============================================================

  const t0 = Date.now();

  const eventId = String(await getVariable("eventId") ?? "");
  const platform = normSite(String(await getVariable("platform") ?? "twitch"));
  const username = String(await getVariable("username") ?? "");
  const token = String(await getVariable("token") ?? "");

  log(`[SELLCONFIRM] Vars | eventId=${eventId} | platform=${platform} | username=${username} | token=${token}`);

  let result;

  try {
    if (!eventId) throw mkError("MISSING_EVENT_ID", "Missing eventId.");
    if (!username) throw mkError("MISSING_USERNAME", "Missing username.");
    if (!token) throw mkError("MISSING_TOKEN", "Missing token.");

    const invPath = joinPath(TCSGO_BASE, "data\\inventories.json");
    const pricesPath = joinPath(TCSGO_BASE, "data\\prices.json");

    const [inv, prices] = await Promise.all([
      safeReadJson(invPath, null),
      safeReadJson(pricesPath, {})
    ]);

    if (!inv) throw mkError("LOAD_ERROR", "Failed to load inventories.");

    if (!inv.users || typeof inv.users !== "object") inv.users = {};

    const user = inv.users[`${lowerTrim(username)}:${lowerTrim(platform)}`];
    if (!user) throw mkError("USER_NOT_FOUND", "User not found");

    if (!user.pendingSell) throw mkError("NO_PENDING_SELL", "No pending sell");

    if (user.pendingSell.token !== token) throw mkError("INVALID_TOKEN", "Invalid token");

    if (Date.now() >= new Date(user.pendingSell.expiresAt).getTime()) {
      user.pendingSell = null;
      throw mkError("TOKEN_EXPIRED", "Token expired");
    }

    if (!Array.isArray(user.items)) user.items = [];

    const oid = user.pendingSell.oid;
    const idx = user.items.findIndex(i => i.oid === oid);

    if (idx === -1) {
      user.pendingSell = null;
      throw mkError("ITEM_NOT_FOUND", "Item gone");
    }

    const credit = user.pendingSell.creditAmount;
    const fee = prices?.marketFeePercent || 10;

    user.items.splice(idx, 1);
    user.chosenCoins = (user.chosenCoins || 0) + credit;
    const soldItem = { ...user.pendingSell.itemSummary, oid };
    user.pendingSell = null;
    inv.lastModified = new Date().toISOString();

    await safeWriteJson(invPath, inv);

    result = {
      type: "sell-confirm-result",
      ok: true,
      eventId,
      platform,
      username,
      data: {
        eventId,
        oid,
        item: soldItem,
        creditedCoins: credit,
        newBalance: user.chosenCoins,
        marketFeePercent: fee,
        timings: { msTotal: Date.now() - t0 }
      }
    };

    log(`[SELLCONFIRM] Success | ${username} oid=${oid} | +${credit}`);

  } catch (err) {
    const e =
      (err && typeof err === "object" && ("code" in err) && ("message" in err))
        ? err
        : mkError("SELL_CONFIRM_FAILED", (err && err.message) ? err.message : String(err));

    result = {
      type: "sell-confirm-result",
      ok: false,
      eventId: eventId || "",
      platform,
      username,
      error: e,
      data: { timings: { msTotal: Date.now() - t0 } }
    };

    log(`[SELLCONFIRM] Error | ${e.code} - ${e.message}`);
  }

  dualAck(result);
  done();
}
