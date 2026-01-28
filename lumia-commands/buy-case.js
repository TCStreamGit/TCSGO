async function () {
  "use strict";

  /*
   * Description: Buy One Or More Cases Using Loyalty Points Without Requiring The Overlay.
   * Command Name: !buy-case
   * Aliases: !buy case, !Buy Case, !BUY CASE, !buy Case, !Buy case, !buycase, !BUYCASE, !BuyCase, !buy-case, !Buy-Case, !BUY-CASE, !buy_case, !Buy_Case, !BUY_CASE
   * Usage Examples:
   * - !buy-case cs20
   * - !buy-case cs20 2
   */
  const LOG_ENABLED = false;

  const COMMAND_PREFIX = "!";
  const COMMAND_PRIMARY = "buy-case";
  const COMMAND_KEY = "buy-case";
  const COMMAND_ALIASES = [
    "buy case",
    "Buy Case",
    "BUY CASE",
    "buy Case",
    "Buy case",
    "buycase",
    "BUYCASE",
    "BuyCase",
    "buy-case",
    "Buy-Case",
    "BUY-CASE",
    "buy_case",
    "Buy_Case",
    "BUY_CASE"
  ];
  const COMMIT_BUYCASE_COMMAND = "tcsgo-commit-buycase";
  const TIKTOK_SEND_COMMAND = "tiktok_chat_send";

  // Overlay handshake: the overlay marks handled chat commands here.
  const CHAT_HANDLED_VAR = "tcsgo_last_chat_handled_v1";
  const CHAT_HANDLED_WINDOW_MS = 4000;
  const HANDLED_CHECK_DELAY_MS = 350;

  // Command-level dedupe to reduce duplicate triggers from some platforms.
  const STORE_KEY = "tcsgo_buy_case_chat_v2";
  const COOLDOWN_STORE_KEY = "tcsgo_buy_case_cooldowns_v1";
  const QUEUE_STORE_KEY = "tcsgo_buy_case_queue_v1";
  const QUEUE_ACTIVE_TTL_MS = 30000;

  const COOLDOWN_DEFAULT_SEC = 60;
  const COOLDOWN_MOD_SEC = 45;
  const COOLDOWN_SUPPORTER_SEC = 30;
  const COOLDOWN_STREAMER_SEC = 0;

  const ACK_VARS = ["tcsgo_last_buycase_json", "tcsgo_last_event_json"];
  const ACK_TIMEOUT_MS = 8000;
  const ACK_POLL_INTERVAL_MS = 200;

  // Disable REST fallback; require native addLoyaltyPoints in Lumia chat context.
  const ALLOW_REST_FALLBACK = false;

  const DEFAULT_LINKING_BASE = "Z:\\home\\nike\\Streaming\\TCSGO\\Linking";
  const DISCORD_INDEX_FILE = "discord-user-index.json";
  const USER_LINKS_FILE = "user-links.json";
  const LINK_PLATFORM_PREFERENCE = ["twitch", "youtube", "tiktok"];

  const DEFAULT_REST_BASE_URL = "http://127.0.0.1:39231";
  const POINTS_TEMPLATE = "{{get_user_loyalty_points={{username}},{{platform}}}}";

  function logMsg(message) {
    if (!LOG_ENABLED) return;
    try { log(message); } catch (_) {}
  }

  async function safeGetVar(name) {
    try { return await getVariable(String(name)); } catch (_) { return null; }
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
    if (s.includes("discord")) return "discord";
    return s || "twitch";
  }

  function cleanUser(raw) {
    return lowerTrim(raw).replace(/^@+/, "");
  }

  function normalizeCmdKey(raw) {
    return lowerTrim(raw).replace(/[\s_-]+/g, "");
  }

  const COMMAND_ALIAS_KEYS = new Set(COMMAND_ALIASES.map((a) => normalizeCmdKey(a)));

  function parseCommand(message) {
    const msg = String(message || "").trim();
    if (!msg || !msg.startsWith(COMMAND_PREFIX)) return null;
    const content = msg.slice(COMMAND_PREFIX.length).trim();
    if (!content) return null;

    const parts = content.split(/\s+/);
    const firstKey = normalizeCmdKey(parts[0] || "");
    const firstTwoKey = normalizeCmdKey(parts.slice(0, 2).join(" "));

    if (COMMAND_ALIAS_KEYS.has(firstKey)) {
      return { commandKey: firstKey, args: parts.slice(1), rawMessage: msg, consumed: 1 };
    }
    if (COMMAND_ALIAS_KEYS.has(firstTwoKey)) {
      return { commandKey: firstTwoKey, args: parts.slice(2), rawMessage: msg, consumed: 2 };
    }
    return null;
  }

  function makeEventId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `evt_${ts}_${rand}`;
  }

  function safeJsonParse(raw) {
    try { return JSON.parse(String(raw)); } catch (_) { return null; }
  }

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatNumber(num) {
    return (Number(num) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatSignedNumber(num) {
    const n = Math.trunc(Number(num) || 0);
    return n >= 0 ? `+${n}` : `${n}`;
  }

  function coerceBool(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const v = String(value ?? "").trim().toLowerCase();
    if (!v) return false;
    if (v.startsWith("{{") && v.endsWith("}}")) return false;
    if (["true", "1", "yes", "y", "on"].includes(v)) return true;
    if (["false", "0", "no", "n", "off"].includes(v)) return false;
    return false;
  }

  async function resolveUserLevels() {
    const templates = {
      broadcaster: "{{userLevelsRaw.broadcaster}}",
      moderator: "{{userLevelsRaw.moderator}}",
      vip: "{{userLevelsRaw.vip}}",
      tier1: "{{userLevelsRaw.tier1}}",
      tier2: "{{userLevelsRaw.tier2}}",
      tier3: "{{userLevelsRaw.tier3}}",
      subscriber: "{{userLevelsRaw.subscriber}}",
      member: "{{userLevelsRaw.member}}"
    };

    const rawCandidates = [
      await safeGetVar("userLevelsRaw"),
      await safeGetVar("userLevels"),
      await safeGetVar("levels")
    ];

    let levels = {};
    for (const raw of rawCandidates) {
      if (!raw) continue;
      if (typeof raw === "object") {
        levels = { ...levels, ...raw };
        continue;
      }
      const parsed = safeJsonParse(raw);
      if (parsed && typeof parsed === "object") {
        levels = { ...levels, ...parsed };
      }
    }

    for (const [k, tmpl] of Object.entries(templates)) {
      if (levels[k] === undefined) levels[k] = tmpl;
    }

    const isStreamer = coerceBool(levels.broadcaster) || coerceBool(levels.isSelf);
    const isMod = coerceBool(levels.moderator) || coerceBool(levels.mod);
    const isVip = coerceBool(levels.vip);
    const isSub =
      coerceBool(levels.subscriber) ||
      coerceBool(levels.tier1) ||
      coerceBool(levels.tier2) ||
      coerceBool(levels.tier3);
    const isMember = coerceBool(levels.member);
    const isSupporter = isVip || isSub || isMember;

    return { isStreamer, isMod, isSupporter };
  }

  function pickCooldownSeconds(levels) {
    if (levels.isStreamer) return COOLDOWN_STREAMER_SEC;
    if (levels.isMod) return COOLDOWN_MOD_SEC;
    if (levels.isSupporter) return COOLDOWN_SUPPORTER_SEC;
    return COOLDOWN_DEFAULT_SEC;
  }

  function formatSecsShort(totalSecs) {
    const s = Math.max(0, Math.ceil(Number(totalSecs) || 0));
    return `${s}s`;
  }

  async function loadCooldownStore() {
    const raw = await getStoreItem(COOLDOWN_STORE_KEY);
    return raw && typeof raw === "object" ? raw : {};
  }

  async function saveCooldownStore(store) {
    await setStore({ name: COOLDOWN_STORE_KEY, value: store });
  }

  async function checkCooldown(site, username, usernameRaw, effectivePlatform, effectiveUsername) {
    const levels = await resolveUserLevels();
    const cooldownSeconds = pickCooldownSeconds(levels);
    if (cooldownSeconds <= 0) return true;

    const nowMs = Date.now();
    const store = await loadCooldownStore();
    const key = `${lowerTrim(effectivePlatform || site)}:${lowerTrim(effectiveUsername || username)}:${lowerTrim(COMMAND_KEY)}`;
    const replyKey = `${key}:lastReplyUse`;
    const lastUseMs = Number(store[key] || 0);
    const remaining = Math.max(0, Math.ceil(((lastUseMs + (cooldownSeconds * 1000)) - nowMs) / 1000));

    if (remaining > 0) {
      const lastReplyUse = Number(store[replyKey] || 0);
      if (lastReplyUse !== lastUseMs) {
        store[replyKey] = lastUseMs;
        await saveCooldownStore(store);
        await reply(site, `@${usernameRaw} That command is on cooldown. ${formatSecsShort(remaining)} remaining.`);
      }
      return false;
    }

    store[key] = nowMs;
    store[replyKey] = 0;
    await saveCooldownStore(store);
    return true;
  }

  async function reply(site, message) {
    const msg = String(message ?? "").trim();
    if (!msg) return;
    if (site === "tiktok") {
      try { callCommand({ name: TIKTOK_SEND_COMMAND, variableValues: { message: msg } }); return; } catch (_) {}
    }
    let sent = false;
    try { chatbot({ message: msg, platform: site, site }); sent = true; } catch (_) {}
    if (!sent) {
      try { triggerAction({ action: "chatbot-message", variableValues: { value: msg, platform: site } }); sent = true; } catch (_) {}
    }
    if (!sent) logMsg(`[BUY-CASE] Reply failed | site=${site} | msg="${msg.slice(0, 120)}"`);
  }

  async function wasHandledByOverlay({ site, username, rawMessage, command }) {
    await sleep(HANDLED_CHECK_DELAY_MS);
    const raw = await safeGetVar(CHAT_HANDLED_VAR);
    const rec = raw ? safeJsonParse(raw) : null;
    if (!rec || typeof rec !== "object") return false;

    const ageMs = Date.now() - Number(rec.ts || 0);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > CHAT_HANDLED_WINDOW_MS) return false;

    const sameCommand = lowerTrim(rec.command) === lowerTrim(command);
    const sameSite = lowerTrim(rec.platform) === lowerTrim(site);
    const sameUser = lowerTrim(rec.username) === lowerTrim(username);
    const sameMessage = String(rec.message || "").trim() === String(rawMessage || "").trim();

    return sameCommand && sameSite && sameUser && sameMessage;
  }

  async function checkMessageDedupe(site, username, messageId) {
    if (!messageId) return false;
    let store = await getStoreItem(STORE_KEY);
    if (!store || typeof store !== "object") store = {};
    store._msgIds = (store._msgIds && typeof store._msgIds === "object") ? store._msgIds : {};

    const key = `${site}|${username}`;
    if (store._msgIds[key] === messageId) return true;

    store._msgIds[key] = messageId;
    await setStore({ name: STORE_KEY, value: store });
    return false;
  }

  function safeCwd() {
    try {
      if (typeof process !== "undefined" && process.cwd) {
        return String(process.cwd() || "").trim();
      }
    } catch (_) {}
    return "";
  }

  async function resolveBasePath() {
    const base = String(await safeGetVar("TCSGO_BASE") ?? "").trim();
    if (base) return base;
    const envBase = (typeof process !== "undefined" && process.env && process.env.TCSGO_BASE)
      ? String(process.env.TCSGO_BASE).trim()
      : "";
    return envBase;
  }

  function joinPath(base, rel) {
    const baseStr = String(base ?? "").trim();
    const sep = baseStr.includes("\\") ? "\\" : "/";
    const b = baseStr.replace(/[\\/]+$/g, "");
    const r = String(rel ?? "").replace(/^[\\/]+/g, "");
    return b ? `${b}${sep}${r}` : r;
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

  async function resolveLinkingBase() {
    const base = String(await safeGetVar("TCSGO_LINKING_BASE") ?? "").trim();
    if (base) return base;
    const envBase = (typeof process !== "undefined" && process.env && process.env.TCSGO_LINKING_BASE)
      ? String(process.env.TCSGO_LINKING_BASE).trim()
      : "";
    return envBase || DEFAULT_LINKING_BASE;
  }

  function pickLinkedAccount(entry) {
    const linked = entry && typeof entry.linkedAccounts === "object" ? entry.linkedAccounts : null;
    if (!linked) return null;
    for (const platform of LINK_PLATFORM_PREFERENCE) {
      const rec = linked[platform];
      const usernameLower = cleanUser(rec?.usernameLower || rec?.username);
      if (usernameLower) return { platform, username: usernameLower };
    }
    return null;
  }

  async function resolveLinkedIdentity(platformRaw, usernameRaw) {
    const requestedPlatform = normSite(platformRaw || "twitch");
    const requestedUsername = cleanUser(usernameRaw);

    if (!requestedUsername || requestedPlatform !== "discord") {
      return {
        requestedPlatform,
        requestedUsername,
        effectivePlatform: requestedPlatform,
        effectiveUsername: requestedUsername,
        linkedFromDiscord: false
      };
    }

    try {
      const linkingBase = await resolveLinkingBase();
      const indexPath = joinPath(linkingBase, DISCORD_INDEX_FILE);
      const linksPath = joinPath(linkingBase, USER_LINKS_FILE);

      const [indexRaw, linksRaw] = await Promise.all([
        safeReadJson(indexPath, null),
        safeReadJson(linksPath, null)
      ]);

      const indexUsers = indexRaw && typeof indexRaw.users === "object" ? indexRaw.users : {};
      const discordId = String(indexUsers[requestedUsername] || "").trim();
      if (!discordId) {
        return {
          requestedPlatform,
          requestedUsername,
          effectivePlatform: requestedPlatform,
          effectiveUsername: requestedUsername,
          linkedFromDiscord: false,
          linkStatus: "discord-not-found"
        };
      }

      const usersMap = linksRaw && typeof linksRaw.users === "object" ? linksRaw.users : {};
      const entry = usersMap[discordId];
      const linked = pickLinkedAccount(entry);
      if (!linked) {
        return {
          requestedPlatform,
          requestedUsername,
          effectivePlatform: requestedPlatform,
          effectiveUsername: requestedUsername,
          linkedFromDiscord: false,
          linkStatus: "no-linked-account",
          discordId
        };
      }

      return {
        requestedPlatform,
        requestedUsername,
        effectivePlatform: linked.platform,
        effectiveUsername: linked.username,
        linkedFromDiscord: true,
        discordId
      };
    } catch (err) {
      logMsg(`[BUY-CASE] Discord link resolve failed | ${err?.message || err}`);
      return {
        requestedPlatform,
        requestedUsername,
        effectivePlatform: requestedPlatform,
        effectiveUsername: requestedUsername,
        linkedFromDiscord: false,
        linkStatus: "link-resolve-error"
      };
    }
  }

  async function loadAliasAndPrices() {
    const basePathRaw = await resolveBasePath();
    const cwdPath = safeCwd();

    const baseCandidates = [];
    if (basePathRaw) baseCandidates.push(basePathRaw);
    baseCandidates.push("");
    if (cwdPath && !baseCandidates.includes(cwdPath)) baseCandidates.push(cwdPath);

    let aliasFallback = null;
    let pricesFallback = null;

    for (const baseCandidate of baseCandidates) {
      const aliasesPath = joinPath(baseCandidate, "data/case-aliases.json");
      const pricesPath = joinPath(baseCandidate, "data/prices.json");

      const [aliasDb, prices] = await Promise.all([
        safeReadJson(aliasesPath, null),
        safeReadJson(pricesPath, null)
      ]);

      if (aliasDb && prices) {
        return { aliasDb, prices };
      }

      if (aliasDb && !aliasFallback) aliasFallback = aliasDb;
      if (prices && !pricesFallback) pricesFallback = prices;
    }

    return { aliasDb: aliasFallback, prices: pricesFallback };
  }

  function getCadToCoins(prices) {
    const v = Number(prices?.cadToCoins || 1000);
    return Number.isFinite(v) && v > 0 ? v : 1000;
  }

  function getCasePriceCoins(prices, caseId) {
    try {
      const cadPrice = Number(prices?.cases?.[caseId]);
      if (Number.isFinite(cadPrice)) {
        return Math.max(0, Math.round(cadPrice * getCadToCoins(prices)));
      }
    } catch (_) {}
    return 2000;
  }

  function extractPointsFromResponse(resp) {
    const candidates = [
      resp,
      resp?.data,
      resp?.result,
      resp?.payload
    ];
    for (const obj of candidates) {
      if (!obj || typeof obj !== "object") continue;
      for (const key of ["points", "value", "loyaltyPoints", "loyalty", "coins", "balance"]) {
        const n = Number(obj[key]);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }

  function pickFirstNonEmptyRaw(...values) {
    for (const value of values) {
      const v = String(value ?? "").trim();
      if (!v) continue;
      return v;
    }
    return "";
  }

  async function getRestConfig() {
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

    const token = pickFirstNonEmptyRaw(
      extraSettings?.restToken,
      extraSettings?.token,
      extraSettings?.lumiaToken,
      extraSettings?.authToken,
      await safeGetVar("restToken"),
      await safeGetVar("rest_token"),
      await safeGetVar("lumiaToken"),
      await safeGetVar("authToken"),
      await safeGetVar("token"),
      (typeof process !== "undefined" && process && process.env && process.env.LUMIA_REST_TOKEN)
        ? String(process.env.LUMIA_REST_TOKEN).trim()
        : ""
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

    return { token, baseUrl };
  }

  async function restAddLoyaltyPoints(value, username, platform) {
    const cfg = await getRestConfig();
    const urlBase = String(cfg.baseUrl || "").trim().replace(/\/+$/g, "");
    if (!urlBase) return { ok: false, response: null };

    const url = cfg.token
      ? `${urlBase}/api/send?token=${encodeURIComponent(cfg.token)}`
      : `${urlBase}/api/send`;

    const payload = {
      type: "add-loyalty-points",
      params: { value, username, platform }
    };

    try {
      const response = await request({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      });

      const status = Number(response?.status || response?.statusCode || 0);
      const ok = response?.ok === true || response?.success === true || status === 200;
      return { ok, response };
    } catch (err) {
      logMsg(`[BUY-CASE] REST add-loyalty-points failed | ${err?.message || err}`);
      return { ok: false, response: null };
    }
  }

  async function actionsAdjustLoyaltyPoints(delta, username) {
    if (typeof actions !== "function") {
      return { ok: false, response: null };
    }

    const value = formatSignedNumber(delta);
    const payload = {
      base: "lumiaActions",
      type: "setUserLoyaltyPoint",
      value: {
        message: String(username || "").trim(),
        value,
        options: [],
        on: false,
        duration: 1000,
        voice: "",
        volume: 100,
        color: "",
        chatas: "chatbot"
      }
    };

    try {
      const response = await actions(payload);
      return { ok: true, response };
    } catch (err) {
      logMsg(`[BUY-CASE] actions setUserLoyaltyPoint failed | ${err?.message || err}`);
      return { ok: false, response: null };
    }
  }

  async function adjustCoins(delta, username, platform, pointsBefore) {
    const value = Math.trunc(Number(delta) || 0);
    if (!value) {
      return {
        ok: true,
        pointsAfter: Number.isFinite(pointsBefore) ? pointsBefore : null,
        method: "none"
      };
    }

    const actionsResult = await actionsAdjustLoyaltyPoints(value, username);
    if (actionsResult.ok) {
      return {
        ok: true,
        pointsAfter: Number.isFinite(pointsBefore) ? pointsBefore + value : null,
        method: "actions"
      };
    }

    if (typeof addLoyaltyPoints === "function") {
      try {
        const result = await addLoyaltyPoints({ value, username, platform });
        const n = Number(result);
        return {
          ok: true,
          pointsAfter: Number.isFinite(n) ? n : (Number.isFinite(pointsBefore) ? pointsBefore + value : null),
          method: "native"
        };
      } catch (err) {
        logMsg(`[BUY-CASE] native addLoyaltyPoints failed | ${err?.message || err}`);
      }
    }

    if (!ALLOW_REST_FALLBACK) {
      return {
        ok: false,
        pointsAfter: Number.isFinite(pointsBefore) ? pointsBefore : null,
        method: "loyalty-unavailable"
      };
    }

    const restResult = await restAddLoyaltyPoints(value, username, platform);
    if (restResult.ok) {
      const restPoints = extractPointsFromResponse(restResult.response);
      const fallbackPoints = Number.isFinite(pointsBefore) ? pointsBefore + value : null;
      return { ok: true, pointsAfter: restPoints ?? fallbackPoints, method: "rest" };
    }

    return { ok: false, pointsAfter: Number.isFinite(pointsBefore) ? pointsBefore : null, method: "failed" };
  }

  async function pollAck(eventId) {
    const deadline = Date.now() + ACK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      for (const varName of ACK_VARS) {
        const raw = await safeGetVar(varName);
        if (!raw) continue;
        const payload = safeJsonParse(raw);
        const payloadEventId = payload?.eventId || payload?.data?.eventId || "";
        const payloadType = lowerTrim(payload?.type);
        if (payloadEventId === eventId && payloadType === "buycase-result") {
          return payload;
        }
      }
      await sleep(ACK_POLL_INTERVAL_MS);
    }
    return null;
  }

  function normalizeQueueStore(store) {
    const shaped = store && typeof store === "object" ? store : {};
    shaped._queue = Array.isArray(shaped._queue) ? shaped._queue : [];
    shaped._queueActive = shaped._queueActive && typeof shaped._queueActive === "object" ? shaped._queueActive : null;
    return shaped;
  }

  function queueIsActive(queueActive, nowMs) {
    if (!queueActive || typeof queueActive !== "object") return false;
    const ts = Number(queueActive.ts || 0);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return (nowMs - ts) < QUEUE_ACTIVE_TTL_MS;
  }

  async function tryAcquireQueueLock(runnerId) {
    const nowMs = Date.now();
    let store = normalizeQueueStore(await getStoreItem(QUEUE_STORE_KEY));

    if (queueIsActive(store._queueActive, nowMs) && store._queueActive.runnerId !== runnerId) {
      return false;
    }

    store._queueActive = { runnerId, ts: nowMs };
    await setStore({ name: QUEUE_STORE_KEY, value: store });

    store = normalizeQueueStore(await getStoreItem(QUEUE_STORE_KEY));
    return store._queueActive?.runnerId === runnerId;
  }

  async function refreshQueueHeartbeat(runnerId) {
    let store = normalizeQueueStore(await getStoreItem(QUEUE_STORE_KEY));
    if (!store._queueActive || store._queueActive.runnerId !== runnerId) return;
    store._queueActive.ts = Date.now();
    await setStore({ name: QUEUE_STORE_KEY, value: store });
  }

  async function releaseQueueLock(runnerId) {
    let store = normalizeQueueStore(await getStoreItem(QUEUE_STORE_KEY));
    if (store._queueActive?.runnerId !== runnerId) return;
    store._queueActive = null;
    await setStore({ name: QUEUE_STORE_KEY, value: store });
  }

  async function enqueueJob(job) {
    let store = normalizeQueueStore(await getStoreItem(QUEUE_STORE_KEY));
    store._queue.push(job);
    await setStore({ name: QUEUE_STORE_KEY, value: store });
  }

  async function dequeueJob(runnerId) {
    let store = normalizeQueueStore(await getStoreItem(QUEUE_STORE_KEY));
    if (!store._queueActive || store._queueActive.runnerId !== runnerId) return null;
    const job = store._queue.shift() || null;
    await setStore({ name: QUEUE_STORE_KEY, value: store });
    return job;
  }

  async function processSingleJob(job, runnerId) {
    const {
      eventId,
      site,
      username,
      usernameRaw,
      alias,
      qty,
      displayName,
      totalCost,
      pointsBefore,
      effectivePlatform,
      effectiveUsername,
      linkedFromDiscord
    } = job;

    const hasPoints = Number.isFinite(pointsBefore);
    if (hasPoints && pointsBefore < totalCost) {
      await reply(
        site,
        `@${usernameRaw} Insufficient coins. Need ${formatNumber(totalCost)}, have ${formatNumber(pointsBefore)}.`
      );
      return;
    }

    if (!hasPoints && totalCost > 0 && linkedFromDiscord) {
      logMsg("[BUY-CASE] Points precheck unavailable for linked Discord request; proceeding with loyalty adjustment.");
    }

    let pointsAfter = hasPoints ? pointsBefore : null;
    let coinsAdjusted = false;

    if (totalCost > 0) {
      const adjust = await adjustCoins(-totalCost, effectiveUsername, effectivePlatform, pointsBefore);
      if (!adjust.ok) {
        const errMsg =
          adjust.method === "loyalty-unavailable"
            ? "Coins system unavailable right now."
            : "Coins deduction failed.";
        await reply(site, `@${usernameRaw} ${errMsg} Purchase canceled.`);
        return;
      }
      coinsAdjusted = true;
      if (Number.isFinite(adjust.pointsAfter)) pointsAfter = adjust.pointsAfter;
      logMsg(`[BUY-CASE] Coins adjusted | method=${adjust.method} | delta=-${totalCost}`);
    }

    try {
      await callCommand({
        name: COMMIT_BUYCASE_COMMAND,
        variableValues: {
          eventId,
          platform: effectivePlatform,
          username: effectiveUsername,
          alias,
          qty
        }
      });
      logMsg(
        `[BUY-CASE] Dispatched | eventId=${eventId} | site=${site} | user=${username} | ` +
        `effective=${effectivePlatform}:${effectiveUsername} | alias=${alias} | qty=${qty}`
      );
    } catch (err) {
      const msg = err?.message ? String(err.message) : String(err);
      logMsg(`[BUY-CASE] Dispatch failed | ${msg}`);

      if (coinsAdjusted && totalCost > 0) {
        await adjustCoins(totalCost, effectiveUsername, effectivePlatform, pointsAfter ?? pointsBefore);
      }

      await reply(site, `@${usernameRaw} Purchase failed to dispatch. Try again.`);
      return;
    }

    const ack = await pollAck(eventId);
    await refreshQueueHeartbeat(runnerId);

    if (!ack) {
      await reply(site, `@${usernameRaw} Purchase dispatched. If it does not appear, try again.`);
      return;
    }

    if (ack.ok) {
      const balanceLabel = Number.isFinite(pointsAfter) ? ` Balance: ${formatNumber(pointsAfter)}.` : "";
      await reply(site, `@${usernameRaw} Bought ${qty}x ${displayName}.${balanceLabel}`);
      return;
    }

    if (coinsAdjusted && totalCost > 0) {
      const refund = await adjustCoins(totalCost, effectiveUsername, effectivePlatform, pointsAfter ?? pointsBefore);
      if (refund.ok && Number.isFinite(refund.pointsAfter)) pointsAfter = refund.pointsAfter;
    }

    const errMsg = ack?.error?.message || "Purchase failed.";
    await reply(site, `@${usernameRaw} ${errMsg}`);
  }

  async function processQueue() {
    const runnerId = `runner_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const acquired = await tryAcquireQueueLock(runnerId);
    if (!acquired) return;

    try {
      while (true) {
        await refreshQueueHeartbeat(runnerId);
        const job = await dequeueJob(runnerId);
        if (!job) break;
        await processSingleJob(job, runnerId);
      }
    } finally {
      await releaseQueueLock(runnerId);
    }
  }

  const siteRaw =
    (await safeGetVar("platform")) ||
    (await safeGetVar("site")) ||
    (await safeGetVar("origin")) ||
    "";
  const site = normSite(siteRaw);

  const usernameRaw =
    (await safeGetVar("username")) ||
    (await safeGetVar("displayname")) ||
    (await safeGetVar("displayName")) ||
    "viewer";
  const username = cleanUser(usernameRaw);

  const message = String(await safeGetVar("message") ?? "").trim();
  const rawMessage = String(await safeGetVar("rawMessage") ?? "").trim();
  const messageId = String(await safeGetVar("messageId") ?? "").trim();

  const parsed = parseCommand(message) || parseCommand(rawMessage);
  if (!parsed) { done(); return; }

  if (await checkMessageDedupe(site, username, messageId)) {
    logMsg(`[BUY-CASE] Dedupe | site=${site} | user=${username} | messageId=${messageId}`);
    done({ shouldStop: true });
    return;
  }

  const overlayHandled = await wasHandledByOverlay({
    site,
    username,
    rawMessage: parsed.rawMessage,
    command: parsed.commandKey
  });

  if (overlayHandled) {
    logMsg(`[BUY-CASE] Overlay handled | site=${site} | user=${username}`);
    done({ shouldStop: true });
    return;
  }

  const alias = String(parsed.args[0] || "").trim();
  const qtyRaw = parsed.args[1];
  const qty = Math.max(1, parseInt(String(qtyRaw ?? "1"), 10) || 1);

  if (!alias) {
    await reply(site, `@${usernameRaw} Usage: ${COMMAND_PREFIX}${COMMAND_PRIMARY} <alias> [qty]`);
    done({ shouldStop: true });
    return;
  }

  const { aliasDb, prices } = await loadAliasAndPrices();
  if (!aliasDb || !aliasDb.aliases) {
    await reply(site, `@${usernameRaw} Case data is unavailable right now.`);
    done({ shouldStop: true });
    return;
  }

  const aliasKey = lowerTrim(alias);
  const caseInfo = aliasDb.aliases[aliasKey];
  if (!caseInfo) {
    await reply(site, `@${usernameRaw} Unknown case: ${alias}`);
    done({ shouldStop: true });
    return;
  }

  const caseId = String(caseInfo.caseId || "");
  const displayName = String(caseInfo.displayName || caseInfo.name || caseId || aliasKey);
  const pricePerCase = getCasePriceCoins(prices, caseId);
  const totalCost = pricePerCase * qty;

  const identity = await resolveLinkedIdentity(site, username);
  const effectivePlatform = identity.effectivePlatform || site;
  const effectiveUsername = identity.effectiveUsername || username;

  if (identity.linkedFromDiscord) {
    logMsg(
      `[BUY-CASE] Discord mapped | ${identity.requestedPlatform}:${identity.requestedUsername} -> ` +
      `${effectivePlatform}:${effectiveUsername}`
    );
  }

  const pointsRawInitial = String(await safeGetVar("points") ?? "").trim();
  const pointsRaw =
    (!pointsRawInitial || (pointsRawInitial.startsWith("{{") && pointsRawInitial.endsWith("}}")))
      ? String(POINTS_TEMPLATE)
      : pointsRawInitial;
  const pointsParsed = parseInt(pointsRaw, 10);

  const sameIdentity =
    lowerTrim(effectivePlatform) === lowerTrim(site) &&
    lowerTrim(effectiveUsername) === lowerTrim(username);
  const pointsBefore = sameIdentity && Number.isFinite(pointsParsed) ? pointsParsed : NaN;

  if (!sameIdentity && Number.isFinite(pointsParsed)) {
    logMsg("[BUY-CASE] Points precheck uses caller identity; linked effective identity differs.");
  }

  const cooldownOk = await checkCooldown(site, username, usernameRaw, effectivePlatform, effectiveUsername);
  if (!cooldownOk) {
    done({ shouldStop: true });
    return;
  }

  const eventId = makeEventId();
  const job = {
    eventId,
    site,
    username,
    usernameRaw,
    alias: aliasKey,
    qty,
    displayName,
    totalCost,
    pointsBefore,
    effectivePlatform,
    effectiveUsername,
    linkedFromDiscord: identity.linkedFromDiscord
  };

  await enqueueJob(job);
  await processQueue();
  done({ shouldStop: true });
}

