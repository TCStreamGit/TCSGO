async function () {
  "use strict";

  const LOG_ENABLED = true;
  const STORE_KEY = "tcsgo_link_dedupe_v1";
  const TIKTOK_SEND_COMMAND = "tiktok_chat_send";

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

  function cleanTemplateValue(raw) {
    const v = String(raw ?? "").trim();
    if (!v) return "";
    if (v.startsWith("{{") && v.endsWith("}}")) return "";
    return v;
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
    return parts.length > 1 ? parts.slice(1) : parts;
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
    return false;
  }

  async function replyToCaller(site, message) {
    const msg = String(message ?? "").trim();
    if (!msg) return;
    if (site === "tiktok") {
      const ok = await sendToTikTok(msg);
      if (!ok) logMsg(`[COINS] TikTok send failed | msg="${msg.slice(0, 120)}"`);
      return;
    }
    try {
      await chatbot({ message: msg, site });
      return;
    } catch (_) {}
    logMsg(`[COINS] chatbot failed | site=${site} | msg="${msg.slice(0, 120)}"`);
  }

  const t0 = Date.now();
  const rawMessage = cleanTemplateValue(await getVariable("rawMessage") ?? "{{rawMessage}}");
  const message = cleanTemplateValue(await getVariable("message") ?? "{{message}}");
  parseArgs(rawMessage, message);

  const siteRaw =
    (await getVariable("site")) ||
    (await getVariable("platform")) ||
    (await getVariable("origin")) ||
    "{{site}}";
  const platform = normSite(siteRaw);

  const usernameRaw =
    cleanTemplateValue(await getVariable("username") ?? "{{username}}") ||
    cleanTemplateValue(await getVariable("displayname") ?? "{{displayname}}") ||
    cleanTemplateValue(await getVariable("displayName") ?? "{{displayName}}");

  const username = String(usernameRaw ?? "").trim();
  const usernameLower = lowerTrim(username);

  const messageId = cleanTemplateValue(await getVariable("messageId") ?? "{{messageId}}");

  if (messageId && platform && usernameLower) {
    let store = await getStoreItem(STORE_KEY);
    if (!store || typeof store !== "object") store = {};
    store._msgIds = (store._msgIds && typeof store._msgIds === "object") ? store._msgIds : {};
    const msgKey = `${platform}|${usernameLower}`;
    if (store._msgIds[msgKey] === messageId) {
      done({ shouldStop: true });
      return;
    }
    store._msgIds[msgKey] = messageId;
    await setStore({ name: STORE_KEY, value: store });
  }

  const pointsTemplate = "{{get_user_loyalty_points={{username}},{{platform}}}}";
  const pointsRaw = cleanTemplateValue(await getVariable("points") ?? pointsTemplate);

  let result;

  try {
    if (!platform) throw mkError("MISSING_PLATFORM", "Missing platform.");
    if (!username) throw mkError("MISSING_USERNAME", "Missing username.");

    const points = parseInt(pointsRaw, 10);
    if (!Number.isFinite(points)) {
      throw mkError("POINTS_UNAVAILABLE", "Coins are unavailable right now.");
    }

    const messageToSend = buildMessage(username, `You have ${formatNumber(points)} coins.`);

    result = {
      type: "coins-result",
      ok: true,
      platform,
      username,
      points,
      messageToSend,
      data: { timings: { msTotal: Date.now() - t0 } }
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
      data: { timings: { msTotal: Date.now() - t0 } }
    };
  }

  if (result?.messageToSend) {
    await replyToCaller(platform, result.messageToSend);
  }

  logMsg(JSON.stringify(result));
  done();
}
