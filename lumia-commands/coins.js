async function () {
  "use strict";

  const LOG_ENABLED = true;                 // Logs To Lumia Logs
  const CHAT_DEBUG_ENABLED = false;         // If True, Sends A Debug Line To Twitch Chat
  const STORE_KEY = "tcsgo_link_dedupe_v1";

  // If Lumia Runs This Command Twice (One Run Missing Variables),
  // This Lets The Second Run Recover Context From The First Run.
  const CTX_STORE_KEY = "tcsgo_coins_ctx_v1";
  const CTX_TTL_MS = 2500;

  const TIKTOK_SEND_COMMAND = "tiktok_chat_send";
  const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  let _finished = false;
  function finish(payload) {
    if (_finished) return;
    _finished = true;
    try { done(payload); } catch (_) {}
  }

  function logExec(message) {
    if (!LOG_ENABLED) return;
    const msg = String(message ?? "");
    try { addLog(msg); } catch (_) {
      try { log(msg); } catch (__) {
        try { console.log(msg); } catch (___) {}
      }
    }
  }

  function logDbg(message) {
    if (!LOG_ENABLED) return;
    const msg = String(message ?? "");
    try { log(msg); } catch (_) {
      try { console.log(msg); } catch (__) {}
    }
  }

  async function safeGetVar(name) {
    try { return await getVariable(String(name)); } catch (_) { return null; }
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
    if (s.includes("facebook")) return "facebook";
    if (s.includes("trovo")) return "trovo";
    return s || "twitch";
  }

  function parseArgs(rawMessage, message) {
    const rm = String(rawMessage ?? "").trim();
    if (rm) {
      const parts = rm.split(/\s+/);
      return parts.length > 1 ? parts.slice(1) : [];
    }

    const msg = String(message ?? "").trim();
    if (!msg) return [];

    const parts = msg.split(/\s+/);

    // If Message Still Includes The Trigger (Example: "!coins"), Strip It
    if (parts[0] && String(parts[0]).startsWith("!")) {
      return parts.length > 1 ? parts.slice(1) : [];
    }

    // Otherwise Message Is Probably Already Just The Args
    return parts;
  }

  function formatNumber(num) {
    return (Number(num) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function mkError(code, message) {
    return { code: String(code || "ERROR"), message: String(message || "Unknown Error") };
  }

  function buildMessage(username, message) {
    const name = String(username ?? "").trim();
    return name ? `@${name} ${message}` : message;
  }

  async function sendToTikTok(message) {
    try {
      await callCommand({ name: TIKTOK_SEND_COMMAND, variableValues: { message } });
      return true;
    } catch (_) {}

    try {
      await callCommand({ name: TIKTOK_SEND_COMMAND, message });
      return true;
    } catch (_) {}

    try {
      await callCommand(TIKTOK_SEND_COMMAND, { message });
      return true;
    } catch (_) {}

    return false;
  }

  async function replyToCaller(site, message) {
    const msg = String(message ?? "").trim();
    if (!msg) return;

    if (site === "tiktok") {
      const ok = await sendToTikTok(msg);
      if (!ok) logExec(`[COINS:${RUN_ID}] TikTok Send Failed | msg="${msg.slice(0, 120)}"`);
      return;
    }

    try {
      await chatbot({ message: msg, site });
      return;
    } catch (_) {}

    logExec(`[COINS:${RUN_ID}] chatbot failed | site=${site} | msg="${msg.slice(0, 120)}"`);
  }

  /* =========================
     Snapshot Variables (Once)
  ========================= */
  const nowMs = Date.now();

  const snap = {
    tsMs: nowMs,

    // Primary
    username: String((await safeGetVar("username")) ?? "").trim(),
    message: String((await safeGetVar("message")) ?? "").trim(),
    rawMessage: String((await safeGetVar("rawMessage")) ?? "").trim(),
    platform: String((await safeGetVar("platform")) ?? "").trim(),
    site: String((await safeGetVar("site")) ?? "").trim(),
    origin: String((await safeGetVar("origin")) ?? "").trim(),
    messageId: String((await safeGetVar("messageId")) ?? "").trim(),

    // Common Alts
    user: String((await safeGetVar("user")) ?? "").trim(),
    userName: String((await safeGetVar("userName")) ?? "").trim(),
    login: String((await safeGetVar("login")) ?? "").trim(),
    handle: String((await safeGetVar("handle")) ?? "").trim(),
    displayname: String((await safeGetVar("displayname")) ?? "").trim(),
    displayName: String((await safeGetVar("displayName")) ?? "").trim(),

    // Optional Inputs
    points: String((await safeGetVar("points")) ?? "").trim()
  };

  // Save Context For A Very Short Window (Helps If Lumia Double-Invokes)
  try {
    const hasAny =
      !!(snap.username || snap.message || snap.rawMessage || snap.messageId || snap.platform || snap.site || snap.origin);

    if (hasAny) {
      await setStore({ name: CTX_STORE_KEY, value: snap });
    }
  } catch (_) {}

  // If We’re Missing Core Chat Vars, Try Recovering From Recent Context
  let ctx = snap;

  const needsRecover =
    (!ctx.username && !ctx.login && !ctx.user && !ctx.userName && !ctx.handle && !ctx.displayname && !ctx.displayName) ||
    (!ctx.rawMessage && !ctx.message) ||
    (!ctx.platform && !ctx.site && !ctx.origin);

  if (needsRecover) {
    try {
      const prev = await getStoreItem(CTX_STORE_KEY);
      if (prev && typeof prev === "object") {
        const ts = Number(prev.tsMs || 0);
        if (Number.isFinite(ts) && ts > 0 && (nowMs - ts) <= CTX_TTL_MS) {
          ctx = {
            tsMs: nowMs,

            username: ctx.username || String(prev.username || "").trim(),
            message: ctx.message || String(prev.message || "").trim(),
            rawMessage: ctx.rawMessage || String(prev.rawMessage || "").trim(),
            platform: ctx.platform || String(prev.platform || "").trim(),
            site: ctx.site || String(prev.site || "").trim(),
            origin: ctx.origin || String(prev.origin || "").trim(),
            messageId: ctx.messageId || String(prev.messageId || "").trim(),

            user: ctx.user || String(prev.user || "").trim(),
            userName: ctx.userName || String(prev.userName || "").trim(),
            login: ctx.login || String(prev.login || "").trim(),
            handle: ctx.handle || String(prev.handle || "").trim(),
            displayname: ctx.displayname || String(prev.displayname || "").trim(),
            displayName: ctx.displayName || String(prev.displayName || "").trim(),

            points: ctx.points || String(prev.points || "").trim()
          };
        }
      }
    } catch (_) {}
  }

  /* =========================
     Derive Effective Values
  ========================= */
  const platformRaw = ctx.platform || ctx.site || ctx.origin || "";
  const platform = normSite(platformRaw);

  const username =
    String(ctx.username || "").trim() ||
    String(ctx.login || "").trim() ||
    String(ctx.user || "").trim() ||
    String(ctx.userName || "").trim() ||
    String(ctx.handle || "").trim() ||
    String(ctx.displayname || "").trim() ||
    String(ctx.displayName || "").trim();

  const usernameLower = lowerTrim(username);

  const rawMessage = String(ctx.rawMessage || "").trim();
  const message = String(ctx.message || "").trim();
  parseArgs(rawMessage, message);

  const messageId = String(ctx.messageId || "").trim();

  if (CHAT_DEBUG_ENABLED) {
    try {
      await chatbot({
        site: "twitch",
        message:
          `DEBUG !coins | run=${RUN_ID} | username="${username}" | platform="${platform}" | message="${message}" | rawMessage="${rawMessage}"`
      });
    } catch (_) {}
  }

  logExec(
    `[COINS:${RUN_ID}] Vars | platform=${platform} | username=${username} | msgId=${messageId}`
  );

  /* =========================
     Dedupe (MessageId Or Short Raw Hash)
  ========================= */
  try {
    let store = await getStoreItem(STORE_KEY);
    if (!store || typeof store !== "object") store = {};

    store._msgIds = (store._msgIds && typeof store._msgIds === "object") ? store._msgIds : {};
    store._raw = (store._raw && typeof store._raw === "object") ? store._raw : {};
    store._rawTs = (store._rawTs && typeof store._rawTs === "object") ? store._rawTs : {};

    const userKey = usernameLower ? `${platform}|${usernameLower}` : `${platform}|`;

    if (messageId && usernameLower) {
      if (store._msgIds[userKey] === messageId) {
        finish({ shouldStop: true });
        return;
      }
      store._msgIds[userKey] = messageId;
      await setStore({ name: STORE_KEY, value: store });
    } else {
      // Fallback Dedupe When MessageId Is Missing
      const rawKey = lowerTrim(rawMessage || message);
      if (rawKey) {
        const last = String(store._raw[userKey] || "");
        const lastTs = Number(store._rawTs[userKey] || 0);

        if (last === rawKey && Number.isFinite(lastTs) && (nowMs - lastTs) <= 2000) {
          finish({ shouldStop: true });
          return;
        }

        store._raw[userKey] = rawKey;
        store._rawTs[userKey] = nowMs;
        await setStore({ name: STORE_KEY, value: store });
      }
    }
  } catch (_) {}

  const t0 = Date.now();
  const pointsTemplate = "{{get_user_loyalty_points={{username}},{{platform}}}}";
  const pointsRaw = String(ctx.points || "").trim() || pointsTemplate;

  let result;

  try {
    if (!platform) throw mkError("MISSING_PLATFORM", "Missing Platform.");
    if (!username) throw mkError("MISSING_USERNAME", "Missing Username.");

    const points = parseInt(pointsRaw, 10);
    if (!Number.isFinite(points)) {
      throw mkError("POINTS_UNAVAILABLE", "Coins Are Unavailable Right Now.");
    }

    const messageToSend = buildMessage(username, `You Have ${formatNumber(points)} Coins.`);

    result = {
      type: "coins-result",
      ok: true,
      platform,
      username,
      points,
      messageToSend,
      data: { timings: { msTotal: Date.now() - t0 }, runId: RUN_ID }
    };
  } catch (err) {
    const error = err && err.code
      ? { code: err.code, message: err.message }
      : mkError("COINS_ERROR", err?.message || String(err));
    const messageToSend = buildMessage(username, error.message);
    result = {
      type: "coins-result",
      ok: false,
      platform,
      username,
      error,
      messageToSend,
      data: { timings: { msTotal: Date.now() - t0 }, runId: RUN_ID }
    };
  }

  if (result && result.messageToSend) {
    try { await replyToCaller(platform, result.messageToSend); } catch (_) {}
  }

  try { logDbg(`[COINS:${RUN_ID}] ${JSON.stringify(result)}`); } catch (_) {}

  finish();
}
