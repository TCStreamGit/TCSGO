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

  // ============================================================
  // INPUTS (From Overlay.callCommand)
  // ============================================================

  const t0 = Date.now();

  const eventId = String(await getVariable("eventId") ?? "");
  const platform = normSite(String(await getVariable("platform") ?? "twitch"));
  const username = String(await getVariable("username") ?? "");
  const keyId = String(await getVariable("keyId") ?? "csgo-case-key");
  const qtyRaw = await getVariable("qty");
  const qty = Math.max(1, parseInt(qtyRaw, 10) || 1);

  logMsg(`[BUYKEY] Vars | eventId=${eventId} | platform=${platform} | username=${username} | keyId=${keyId} | qty=${qty}`);

  let result;

  try {
    if (!eventId) throw mkError("MISSING_EVENT_ID", "Missing eventId.");
    if (!username) throw mkError("MISSING_USERNAME", "Missing username.");
    if (!keyId) throw mkError("MISSING_KEY_ID", "Missing keyId.");

    const invPath = joinPath(TCSGO_BASE, "data\\inventories.json");

    let inv = await safeReadJson(invPath, { schemaVersion: "1.0-inventories", users: {} });
    if (!inv || typeof inv !== "object") throw mkError("INV_LOAD_FAILED", "Failed to load inventories.");
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

    const u = inv.users[userKey];
    if (!u.keys || typeof u.keys !== "object") u.keys = {};

    const prev = parseInt(u.keys[keyId] ?? 0, 10) || 0;
    const next = prev + qty;
    u.keys[keyId] = next;

    inv.lastModified = new Date().toISOString();

    await safeWriteJson(invPath, inv);

    result = {
      type: "buykey-result",
      ok: true,
      eventId,
      platform,
      username,
      data: {
        eventId,
        keyId,
        qty,
        newCount: next,
        timings: { msTotal: Date.now() - t0 }
      }
    };

    logMsg(`[BUYKEY] Success | ${username} Bought ${qty}x ${keyId} | NewCount=${next}`);

  } catch (err) {
    const e =
      (err && typeof err === "object" && ("code" in err) && ("message" in err))
        ? err
        : mkError("BUYKEY_FAILED", (err && err.message) ? err.message : String(err));

    result = {
      type: "buykey-result",
      ok: false,
      eventId: eventId || "",
      platform,
      username,
      error: e,
      data: { timings: { msTotal: Date.now() - t0 } }
    };

    logMsg(`[BUYKEY] Error | ${e.code} - ${e.message}`);
  }

  dualAck(result);
  done();
}
