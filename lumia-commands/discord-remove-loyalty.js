async function () {
  "use strict";

  const LOG_ENABLED = true;                 // Logs To Lumia Logs
  const VALUE_SIGN = -1;                    // -1 for remove
  const DEFAULT_REST_BASE_URL = "http://127.0.0.1:39231";

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

  function pickFirstNonEmpty(...values) {
    for (const value of values) {
      const v = String(value ?? "").trim();
      if (!v) continue;
      if (v.startsWith("{{") && v.endsWith("}}")) continue;
      return v;
    }
    return "";
  }

  function pickFirstNonEmptyRaw(...values) {
    for (const value of values) {
      const v = String(value ?? "").trim();
      if (!v) continue;
      return v;
    }
    return "";
  }

  const extraSettingsRaw =
    (await safeGetVar("extraSettings")) ??
    (await safeGetVar("extra_settings")) ??
    "";

  let extraSettings = null;
  if (extraSettingsRaw && typeof extraSettingsRaw === "object") {
    extraSettings = extraSettingsRaw;
  } else if (typeof extraSettingsRaw === "string" && extraSettingsRaw.trim()) {
    try { extraSettings = JSON.parse(extraSettingsRaw); } catch (_) { extraSettings = null; }
  }
  if (!extraSettings || typeof extraSettings !== "object") extraSettings = null;

  const platformRaw = pickFirstNonEmpty(
    await safeGetVar("restDcPlatform"),
    await safeGetVar("restPlatform"),
    await safeGetVar("rest_platform"),
    extraSettings?.dcPlatform,
    extraSettings?.dc_platform,
    extraSettings?.platform,
    extraSettings?.site,
    extraSettings?.origin,
    extraSettings?.customPlatform,
    extraSettings?.custom_platform,
    extraSettings?.coinsPlatform,
    await safeGetVar("dcPlatform"),
    await safeGetVar("dc_platform"),
    await safeGetVar("customPlatform"),
    await safeGetVar("custom_platform"),
    await safeGetVar("coinsPlatform"),
    await safeGetVar("platform"),
    await safeGetVar("site"),
    await safeGetVar("origin"),
    "{{platform}}",
    "{{site}}",
    "{{origin}}",
    "{{dcPlatform}}",
    "{{dc_platform}}",
    "{{customPlatform}}",
    "{{custom_platform}}",
    "{{coinsPlatform}}",
    ""
  );
  const platform = normSite(platformRaw);

  const username = pickFirstNonEmpty(
    await safeGetVar("restDcUsername"),
    await safeGetVar("restUsername"),
    await safeGetVar("rest_username"),
    extraSettings?.dcUsername,
    extraSettings?.dc_username,
    extraSettings?.username,
    extraSettings?.login,
    extraSettings?.user,
    extraSettings?.userName,
    extraSettings?.handle,
    extraSettings?.displayname,
    extraSettings?.displayName,
    extraSettings?.coinsUsername,
    extraSettings?.customVariable,
    await safeGetVar("dcUsername"),
    await safeGetVar("dc_username"),
    await safeGetVar("customVariable"),
    await safeGetVar("coinsUsername"),
    await safeGetVar("username"),
    await safeGetVar("login"),
    await safeGetVar("user"),
    await safeGetVar("userName"),
    await safeGetVar("handle"),
    await safeGetVar("displayname"),
    await safeGetVar("displayName"),
    "{{username}}",
    "{{login}}",
    "{{user}}",
    "{{userName}}",
    "{{handle}}",
    "{{displayname}}",
    "{{displayName}}",
    ""
  );

  const valueRaw = pickFirstNonEmpty(
    extraSettings?.value,
    extraSettings?.points,
    extraSettings?.coins,
    extraSettings?.amount,
    extraSettings?.delta,
    await safeGetVar("value"),
    await safeGetVar("points"),
    await safeGetVar("coins"),
    await safeGetVar("amount"),
    await safeGetVar("delta"),
    ""
  );
  const valueNum = parseInt(String(valueRaw ?? "").trim(), 10);

  const token = pickFirstNonEmptyRaw(
    extraSettings?.restToken,
    extraSettings?.token,
    extraSettings?.lumiaToken,
    extraSettings?.authToken,
    await safeGetVar("restToken"),
    await safeGetVar("rest_token"),
    await safeGetVar("lumiaToken"),
    await safeGetVar("token"),
    (typeof process !== "undefined" && process && process.env && process.env.LUMIA_REST_TOKEN)
      ? String(process.env.LUMIA_REST_TOKEN).trim()
      : "",
    ""
  );

  const baseUrl = pickFirstNonEmptyRaw(
    extraSettings?.restBaseUrl,
    extraSettings?.baseUrl,
    extraSettings?.base_url,
    await safeGetVar("restBaseUrl"),
    await safeGetVar("rest_base_url"),
    await safeGetVar("baseUrl"),
    await safeGetVar("base_url"),
    (typeof process !== "undefined" && process && process.env && process.env.LUMIA_REST_BASE_URL)
      ? String(process.env.LUMIA_REST_BASE_URL).trim()
      : "",
    DEFAULT_REST_BASE_URL
  );

  let result;
  try {
    if (!platform) throw new Error("Missing Platform.");
    if (!username) throw new Error("Missing Username.");
    if (!Number.isFinite(valueNum) || valueNum === 0) {
      throw new Error("Missing Value.");
    }

    const value = VALUE_SIGN * Math.abs(valueNum);
    const urlBase = String(baseUrl || "").trim().replace(/\/+$/g, "");
    const url = token
      ? `${urlBase}/api/send?token=${encodeURIComponent(token)}`
      : `${urlBase}/api/send`;

    const payload = {
      type: "add-loyalty-points",
      params: { value, username, platform }
    };

    const response = await request({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload
    });

    const status = Number(response?.status || response?.statusCode || 0);
    const ok = response?.ok === true || response?.success === true || status === 200;

    if (!ok) {
      throw new Error(`Request failed | status=${status} | resp=${JSON.stringify(response ?? {})}`);
    }

    result = {
      ok: true,
      platform,
      username,
      value,
      response,
      ts: new Date().toISOString(),
      data: { runId: RUN_ID }
    };
  } catch (err) {
    const message = err?.message ? String(err.message) : String(err);
    result = {
      ok: false,
      platform,
      username,
      error: { code: "DISCORD_REMOVE_LOYALTY_ERROR", message },
      ts: new Date().toISOString(),
      data: { runId: RUN_ID }
    };
  }

  try { logDbg(`[DISCORD-REMOVE-LOYALTY:${RUN_ID}] ${JSON.stringify(result)}`); } catch (_) {}
  finish();
}
