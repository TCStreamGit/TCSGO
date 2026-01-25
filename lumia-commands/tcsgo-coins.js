async function () {
  "use strict";

  const LOG_ENABLED = true;
  const DEFAULT_CODE_ID = "tcsgo-link-controller";

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

  function sendAck(payload, codeId) {
    const payloadStr = JSON.stringify(payload);
    try {
      overlaySendCustomContent({ codeId, content: payloadStr });
    } catch (_) {}
    logMsg(payloadStr);
  }

  const t0 = Date.now();
  const eventId = String(await getVariable("eventId") ?? "");
  const codeId = String(await getVariable("codeId") ?? DEFAULT_CODE_ID);
  const platform = normSite(String(await getVariable("platform") ?? ""));
  const username = String(await getVariable("username") ?? "");

  const pointsTemplate = "{{get_user_loyalty_points={{username}},{{platform}}}}";
  const pointsRaw = cleanTemplateValue(await getVariable("points") ?? pointsTemplate);

  let result;

  try {
    if (!eventId) throw mkError("MISSING_EVENT_ID", "Missing eventId.");
    if (!platform) throw mkError("MISSING_PLATFORM", "Missing platform.");
    if (!username) throw mkError("MISSING_USERNAME", "Missing username.");

    const points = parseInt(pointsRaw, 10);
    if (!Number.isFinite(points)) {
      throw mkError("POINTS_UNAVAILABLE", "Coins are unavailable right now.");
    }

    const message = buildMessage(username, `You have ${formatNumber(points)} coins.`);

    result = {
      type: "coins-result",
      ok: true,
      eventId,
      platform,
      username,
      points,
      messageToSend: message,
      data: { timings: { msTotal: Date.now() - t0 } }
    };
  } catch (err) {
    const error = err && err.code
      ? { code: err.code, message: err.message }
      : mkError("COINS_ERROR", err?.message || String(err));
    const message = buildMessage(username, error.message);
    result = {
      type: "coins-result",
      ok: false,
      eventId,
      platform,
      username,
      error,
      messageToSend: message,
      data: { timings: { msTotal: Date.now() - t0 } }
    };
  }

  sendAck(result, codeId || DEFAULT_CODE_ID);
  done();
}
