async function () {
  "use strict";

  const LOG_ENABLED = true;                 // Logs To Lumia Logs
  const CHAT_DEBUG_ENABLED = false;         // If True, Sends A Debug Line To Twitch Chat
  const RESULT_DEBUG_ENABLED = true;        // Include Debug Info In Result JSON

  // Detect Which writeFile Signature Works And Stick To It
  const WRITEFILE_MODE_STORE_KEY = "tcsgo_writefile_mode_v1"; // "object" | "string"
  const WRITEFILE_MODE_DEFAULT = "object";                    // Prefer Object Form First

  const DEFAULT_DISCORD_COINS_PATH = "Z:\\home\\nike\\TheChosenBot\\discord-coins.json";
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

  function summarizeValue(value, maxLen = 160) {
    if (value === null || value === undefined) return "";
    let text = "";
    if (typeof value === "string") {
      text = value;
    } else {
      try { text = JSON.stringify(value); } catch (_) { text = String(value); }
    }
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > maxLen) text = text.slice(0, maxLen) + "...";
    return text;
  }

  function logGroup(label, obj, maxLen = 1200) {
    if (!LOG_ENABLED) return;
    if (!obj || typeof obj !== "object") {
      logExec(`[DISCORD-COINS:${RUN_ID}] ${label} | (no data)`);
      return;
    }
    const parts = [];
    for (const key of Object.keys(obj)) {
      parts.push(`${key}=${summarizeValue(obj[key])}`);
    }
    let line = parts.join(" | ");
    if (line.length > maxLen) line = line.slice(0, maxLen) + "...";
    logExec(`[DISCORD-COINS:${RUN_ID}] ${label} | ${line}`);
  }

  let PREFETCH_VARS = null;

  async function safeGetVar(name) {
    if (PREFETCH_VARS && Object.prototype.hasOwnProperty.call(PREFETCH_VARS, name)) {
      return PREFETCH_VARS[name];
    }
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

  function pickFromPrefetch(...keys) {
    if (!PREFETCH_VARS) return "";
    const values = [];
    for (const key of keys) {
      values.push(PREFETCH_VARS[key]);
    }
    return pickFirstNonEmptyRaw(...values);
  }

  function isTemplateLike(value) {
    const v = String(value ?? "").trim();
    return !!v && v.startsWith("{{") && v.endsWith("}}");
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeWriteMode(raw) {
    const s = String(raw ?? "").trim().toLowerCase();
    if (s === "object" || s === "obj") return "object";
    if (s === "string" || s === "str") return "string";
    return "";
  }

  async function writeFileObject(path, content, append) {
    await writeFile({ path, message: content, append: !!append });
  }

  async function writeFileString(path, content) {
    await writeFile(path, content);
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

  async function safeWriteFile(path, content, append = false) {
    const txt = String(content ?? "");
    const app = !!append;

    let mode = "";
    try { mode = normalizeWriteMode(await getStoreItem(WRITEFILE_MODE_STORE_KEY)); } catch (_) {}
    if (!mode) mode = WRITEFILE_MODE_DEFAULT;

    const otherMode = (mode === "object") ? "string" : "object";

    async function tryMode(m) {
      if (m === "object") {
        await writeFileObject(path, txt, app);
      } else {
        await writeFileString(path, txt);
      }
      if (!app) await verifyWrite(path, txt);
    }

    try {
      await tryMode(mode);
      try { await setStore({ name: WRITEFILE_MODE_STORE_KEY, value: mode }); } catch (_) {}
      return true;
    } catch (_) {
      try {
        await tryMode(otherMode);
        try { await setStore({ name: WRITEFILE_MODE_STORE_KEY, value: otherMode }); } catch (_) {}
        return true;
      } catch (e2) {
        logExec(`[DISCORD-COINS:${RUN_ID}] WriteFile Error | path=${path} | ${e2?.message ?? e2}`);
        return false;
      }
    }
  }

  async function safeWriteJson(fullPath, obj) {
    const out = JSON.stringify(obj, null, 2) + "\n";
    const ok = await safeWriteFile(fullPath, out, false);
    if (!ok) throw new Error("Write Failed");
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

  function ensureCoinsState(data) {
    if (!data || typeof data !== "object") {
      return {
        schemaVersion: "1.0-discord-coins",
        lastModified: nowIso(),
        responses: {}
      };
    }
    if (String(data.schemaVersion) !== "1.0-discord-coins") {
      data.schemaVersion = "1.0-discord-coins";
    }
    if (!data.responses || typeof data.responses !== "object") {
      data.responses = {};
    }
    return data;
  }

  function resolveCoinsPath(pathVar, envVar) {
    const fromVar = String(pathVar ?? "").trim();
    if (fromVar) return fromVar;
    const fromEnv =
      (typeof process !== "undefined" && process && process.env && process.env.TCSGO_DISCORD_COINS_PATH)
        ? String(process.env.TCSGO_DISCORD_COINS_PATH).trim()
        : "";
    if (fromEnv) return fromEnv;
    const fromEnvAlt = String(envVar ?? "").trim();
    if (fromEnvAlt) return fromEnvAlt;
    return DEFAULT_DISCORD_COINS_PATH;
  }

  async function replyToCaller(site, message) {
    const msg = String(message ?? "").trim();
    if (!msg) return;
    if (site === "tiktok") {
      try { await callCommand({ name: TIKTOK_SEND_COMMAND, variableValues: { message: msg } }); } catch (_) {}
      return;
    }
    try { await chatbot({ message: msg, site }); } catch (_) {}
  }

  try {
    PREFETCH_VARS = {
      restDcPlatform: await getVariable("restDcPlatform"),
      restPlatform: await getVariable("restPlatform"),
      rest_platform: await getVariable("rest_platform"),
      restDcUsername: await getVariable("restDcUsername"),
      restUsername: await getVariable("restUsername"),
      rest_username: await getVariable("rest_username"),
      restRequestId: await getVariable("restRequestId"),
      rest_requestId: await getVariable("rest_requestId"),
      rest_request_id: await getVariable("rest_request_id"),
      restDiscordUserId: await getVariable("restDiscordUserId"),
      rest_discordUserId: await getVariable("rest_discordUserId"),
      rest_discord_user_id: await getVariable("rest_discord_user_id"),
      extraSettings: await getVariable("extraSettings"),
      extra_settings: await getVariable("extra_settings"),
      dcPlatform: await getVariable("dcPlatform"),
      dc_platform: await getVariable("dc_platform"),
      dcUsername: await getVariable("dcUsername"),
      dc_username: await getVariable("dc_username"),
      discordUserId: await getVariable("discordUserId"),
      discord_id: await getVariable("discord_id"),
      discordId: await getVariable("discordId"),
      customPlatform: await getVariable("customPlatform"),
      custom_platform: await getVariable("custom_platform"),
      customVariable: await getVariable("customVariable"),
      customUsername: await getVariable("customUsername"),
      custom_username: await getVariable("custom_username"),
      extraPlatform: await getVariable("extraPlatform"),
      extraUsername: await getVariable("extraUsername"),
      coinsPlatform: await getVariable("coinsPlatform"),
      coinsUsername: await getVariable("coinsUsername"),
      requestId: await getVariable("requestId"),
      request_id: await getVariable("request_id"),
      reqId: await getVariable("reqId"),
      dcRequestId: await getVariable("dcRequestId"),
      customRequestId: await getVariable("customRequestId"),
      username: await getVariable("username"),
      user: await getVariable("user"),
      userName: await getVariable("userName"),
      login: await getVariable("login"),
      handle: await getVariable("handle"),
      displayname: await getVariable("displayname"),
      displayName: await getVariable("displayName"),
      platform: await getVariable("platform"),
      site: await getVariable("site"),
      origin: await getVariable("origin"),
      discordCoinsPath: await getVariable("discordCoinsPath"),
      TCSGO_DISCORD_COINS_PATH: await getVariable("TCSGO_DISCORD_COINS_PATH"),
      points: await getVariable("points")
    };
  } catch (_) {
    PREFETCH_VARS = null;
  }

  if (PREFETCH_VARS) {
    logGroup("Prefetch", PREFETCH_VARS);
  }

  const t0 = Date.now();

  // Best-Effort: Some Builds Expose REST params.extraSettings As A Variable
  const extraSettingsRaw =
    (await safeGetVar("extraSettings")) ??
    (await safeGetVar("extra_settings")) ??
    "";

  logExec(
    `[DISCORD-COINS:${RUN_ID}] extraSettingsRaw | type=${typeof extraSettingsRaw} | value=${summarizeValue(extraSettingsRaw)}`
  );

  let extraSettings = null;

  if (extraSettingsRaw && typeof extraSettingsRaw === "object") {
    extraSettings = extraSettingsRaw;
  } else if (typeof extraSettingsRaw === "string" && extraSettingsRaw.trim()) {
    try { extraSettings = JSON.parse(extraSettingsRaw); } catch (_) { extraSettings = null; }
  }

  if (!extraSettings || typeof extraSettings !== "object") {
    extraSettings = null;
  }

  if (LOG_ENABLED) {
    const extraSummary = extraSettings
      ? JSON.stringify(extraSettings).slice(0, 240)
      : String(extraSettingsRaw ?? "");
    logExec(
      `[DISCORD-COINS:${RUN_ID}] Prefetch | restDcUsername=${String(await safeGetVar("restDcUsername") ?? "")} | ` +
      `restUsername=${String(await safeGetVar("restUsername") ?? "")} | extraSettings=${extraSummary}`
    );
  }
  if (extraSettings) {
    logExec(`[DISCORD-COINS:${RUN_ID}] extraSettings parsed | ${summarizeValue(extraSettings, 400)}`);
  }



  let platformRaw = pickFirstNonEmpty(
    // REST-Set Globals (Recommended Path)
    await safeGetVar("restDcPlatform"),
    await safeGetVar("restPlatform"),
    await safeGetVar("rest_platform"),

    // If REST extraSettings Is Exposed (Patch 1)
    extraSettings?.dcPlatform,
    extraSettings?.dc_platform,
    extraSettings?.platform,
    extraSettings?.site,
    extraSettings?.origin,
    extraSettings?.customPlatform,
    extraSettings?.custom_platform,
    extraSettings?.coinsPlatform,
    extraSettings?.extraPlatform,

    // Normal Command Variables
    await safeGetVar("platform"),
    await safeGetVar("site"),
    await safeGetVar("origin"),
    await safeGetVar("dcPlatform"),
    await safeGetVar("dc_platform"),
    await safeGetVar("coinsPlatform"),
    await safeGetVar("customPlatform"),
    await safeGetVar("custom_platform"),
    await safeGetVar("extraPlatform"),

    // Template Fallbacks (Safe To Keep)
    "{{platform}}",
    "{{site}}",
    "{{origin}}",
    "{{dcPlatform}}",
    "{{dc_platform}}",
    "{{coinsPlatform}}",
    "{{customPlatform}}",
    "{{custom_platform}}",
    "{{extraPlatform}}",

    ""
  );
  if (!platformRaw) {
    const fallback = pickFromPrefetch(
      "restDcPlatform",
      "restPlatform",
      "rest_platform",
      "dcPlatform",
      "dc_platform",
      "coinsPlatform",
      "customPlatform",
      "custom_platform",
      "extraPlatform",
      "platform",
      "site",
      "origin"
    );
    if (fallback) {
      platformRaw = fallback;
      logExec(`[DISCORD-COINS:${RUN_ID}] platformRaw fallback from prefetch | ${summarizeValue(platformRaw)}`);
    }
  }
  const platform = normSite(platformRaw);




  let username = pickFirstNonEmpty(
    // REST-Set Globals (Recommended Path)
    await safeGetVar("restDcUsername"),
    await safeGetVar("restUsername"),
    await safeGetVar("rest_username"),

    // If REST extraSettings Is Exposed (Patch 1)
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
    extraSettings?.customUsername,
    extraSettings?.custom_username,
    extraSettings?.extraUsername,

    // Normal Command Variables
    await safeGetVar("dcUsername"),
    await safeGetVar("dc_username"),
    await safeGetVar("customVariable"),
    await safeGetVar("coinsUsername"),
    await safeGetVar("customUsername"),
    await safeGetVar("custom_username"),
    await safeGetVar("extraUsername"),

    await safeGetVar("username"),
    await safeGetVar("login"),
    await safeGetVar("user"),
    await safeGetVar("userName"),
    await safeGetVar("handle"),
    await safeGetVar("displayname"),
    await safeGetVar("displayName"),

    // Template Fallbacks (Safe To Keep)
    "{{dcUsername}}",
    "{{dc_username}}",
    "{{customVariable}}",
    "{{coinsUsername}}",
    "{{customUsername}}",
    "{{custom_username}}",
    "{{extraUsername}}",

    "{{username}}",
    "{{login}}",
    "{{user}}",
    "{{userName}}",
    "{{handle}}",
    "{{displayname}}",
    "{{displayName}}",

    ""
  );
  if (!username) {
    const fallback = pickFromPrefetch(
      "restDcUsername",
      "restUsername",
      "rest_username",
      "dcUsername",
      "dc_username",
      "customVariable",
      "coinsUsername",
      "customUsername",
      "custom_username",
      "extraUsername",
      "username",
      "login",
      "user",
      "userName",
      "handle",
      "displayname",
      "displayName"
    );
    if (fallback) {
      username = fallback;
      logExec(`[DISCORD-COINS:${RUN_ID}] username fallback from prefetch | ${summarizeValue(username)}`);
    }
  }


  const requestIdRaw = pickFirstNonEmpty(
    // REST-Set Globals (Recommended Path)
    await safeGetVar("restRequestId"),
    await safeGetVar("rest_requestId"),
    await safeGetVar("rest_request_id"),

    // If REST extraSettings Is Exposed (Patch 1)
    extraSettings?.requestId,
    extraSettings?.request_id,
    extraSettings?.reqId,
    extraSettings?.dcRequestId,
    extraSettings?.customRequestId,

    // Normal Command Variables
    await safeGetVar("requestId"),
    await safeGetVar("request_id"),
    await safeGetVar("reqId"),
    await safeGetVar("dcRequestId"),
    await safeGetVar("customRequestId"),

    // Template Fallbacks (Safe To Keep)
    "{{requestId}}",
    "{{request_id}}",
    "{{reqId}}",
    "{{dcRequestId}}",
    "{{customRequestId}}",

    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const requestId = requestIdRaw || RUN_ID;





  const discordUserId = pickFirstNonEmpty(
    // REST-Set Globals (Recommended Path)
    await safeGetVar("restDiscordUserId"),
    await safeGetVar("rest_discordUserId"),
    await safeGetVar("rest_discord_user_id"),

    // If REST extraSettings Is Exposed (Patch 1)
    extraSettings?.discordUserId,
    extraSettings?.discord_id,
    extraSettings?.discordId,

    // Normal Command Variables
    await safeGetVar("discordUserId"),
    await safeGetVar("discord_id"),
    await safeGetVar("discordId"),

    // Template Fallbacks (Safe To Keep)
    "{{discordUserId}}",
    "{{discord_id}}",
    "{{discordId}}",

    ""
  );





  const coinsPath = resolveCoinsPath(
    await safeGetVar("discordCoinsPath"),
    await safeGetVar("TCSGO_DISCORD_COINS_PATH")
  );

  const pointsTemplateDc = "{{get_user_loyalty_points={{dcUsername}},{{dcPlatform}}}}";
  const pointsTemplateCustom = "{{get_user_loyalty_points={{customVariable}},{{customPlatform}}}}";

  let pointsRaw = String(await safeGetVar("points") ?? "").trim();
  if (!pointsRaw || isTemplateLike(pointsRaw)) {
    const fallback = pickFirstNonEmptyRaw(pointsTemplateDc, pointsTemplateCustom);
    if (fallback) {
      pointsRaw = fallback;
      logExec(`[DISCORD-COINS:${RUN_ID}] pointsRaw fallback | ${summarizeValue(pointsRaw)}`);
    }
  }
  const pointsValue = parseInt(pointsRaw, 10);

  logExec(
    `[DISCORD-COINS:${RUN_ID}] Resolved | platformRaw=${summarizeValue(platformRaw)} | platform=${platform} | ` +
    `username=${summarizeValue(username)} | requestIdRaw=${summarizeValue(requestIdRaw)} | ` +
    `discordUserId=${summarizeValue(discordUserId)} | pointsRaw=${summarizeValue(pointsRaw)}`
  );

  const debugInfo = RESULT_DEBUG_ENABLED
    ? {
        prefetch: PREFETCH_VARS ? {
          restDcUsername: summarizeValue(PREFETCH_VARS.restDcUsername),
          restUsername: summarizeValue(PREFETCH_VARS.restUsername),
          restDcPlatform: summarizeValue(PREFETCH_VARS.restDcPlatform),
          restPlatform: summarizeValue(PREFETCH_VARS.restPlatform),
          restRequestId: summarizeValue(PREFETCH_VARS.restRequestId),
          restDiscordUserId: summarizeValue(PREFETCH_VARS.restDiscordUserId),
          extraSettings: summarizeValue(PREFETCH_VARS.extraSettings, 240),
          extra_settings: summarizeValue(PREFETCH_VARS.extra_settings, 240),
          dcUsername: summarizeValue(PREFETCH_VARS.dcUsername),
          dcPlatform: summarizeValue(PREFETCH_VARS.dcPlatform),
          customVariable: summarizeValue(PREFETCH_VARS.customVariable),
          username: summarizeValue(PREFETCH_VARS.username),
          platform: summarizeValue(PREFETCH_VARS.platform)
        } : null,
        extraSettingsRawType: typeof extraSettingsRaw,
        extraSettingsRaw: summarizeValue(extraSettingsRaw, 240),
        extraSettingsParsed: extraSettings ? summarizeValue(extraSettings, 400) : "",
        resolved: {
          platformRaw: summarizeValue(platformRaw),
          platform,
          username: summarizeValue(username),
          requestIdRaw: summarizeValue(requestIdRaw),
          requestId,
          discordUserId: summarizeValue(discordUserId),
          pointsRaw: summarizeValue(pointsRaw)
        }
      }
    : null;

  if (CHAT_DEBUG_ENABLED) {
    try {
      await replyToCaller(
        platform,
        `DEBUG discord-coins | run=${RUN_ID} | username="${username}" | platform="${platform}" | pointsRaw="${pointsRaw}"`
      );
    } catch (_) {}
  }

  logExec(
    `[DISCORD-COINS:${RUN_ID}] Vars | platform=${platform} | username=${username} | requestId=${requestId}`
  );

  let result;

  try {
    if (!platform) throw new Error("Missing Platform.");
    if (!username) {
      throw new Error(
        "Missing Username. If triggered via REST, pass extraSettings {dcUsername, dcPlatform, requestId} " +
        "or {customVariable} for username."
      );
    }
    if (!Number.isFinite(pointsValue)) {
      throw new Error(
        "Points Unavailable. Ensure the command has a variable named 'points' set to " +
        "{{get_user_loyalty_points={{username}},{{platform}}}}."
      );
    }

    result = {
      ok: true,
      requestId,
      discordUserId,
      platform,
      username,
      points: Math.trunc(pointsValue),
      ts: nowIso(),
      data: { timings: { msTotal: Date.now() - t0 }, runId: RUN_ID },
      ...(debugInfo ? { debug: debugInfo } : {})
    };
  } catch (err) {
    const message = err?.message ? String(err.message) : String(err);
    result = {
      ok: false,
      requestId,
      discordUserId,
      platform,
      username,
      error: { code: "DISCORD_COINS_ERROR", message },
      ts: nowIso(),
      data: { timings: { msTotal: Date.now() - t0 }, runId: RUN_ID },
      ...(debugInfo ? { debug: debugInfo } : {})
    };
  }

  try {
    try {
      const initKey = "tcsgo_discord_coins_init_v1";
      const init = await getStoreItem(initKey);
      if (!init) {
        await safeWriteJson(coinsPath, ensureCoinsState(null));
        await setStore({ name: initKey, value: true });
      }
    } catch (_) {}

    const state = ensureCoinsState(await safeReadJson(coinsPath, null));
    state.responses[requestId] = result;
    state.lastModified = nowIso();
    await safeWriteJson(coinsPath, state);
  } catch (e) {
    logExec(`[DISCORD-COINS:${RUN_ID}] Failed to write response | ${e?.message ?? e}`);
  }

  try { logDbg(`[DISCORD-COINS:${RUN_ID}] ${JSON.stringify(result)}`); } catch (_) {}

  finish();
}
