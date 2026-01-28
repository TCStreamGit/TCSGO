async function () {
  "use strict";

  /*
   * Description: Confirm A Pending Single-Item Sale Without Requiring The Overlay.
   * Command Name: !sell-confirm
   * Aliases: !sell confirm, !Sell Confirm, !SELL CONFIRM, !sell Confirm, !Sell confirm, !sellconfirm, !SELLCONFIRM, !SellConfirm, !sell-confirm, !Sell-Confirm, !SELL-CONFIRM, !sell_confirm, !Sell_Confirm, !SELL_CONFIRM
   * Usage Examples:
   * - !sell-confirm ABC123
   */
  const LOG_ENABLED = false;

  const COMMAND_PREFIX = "!";
  const COMMAND_PRIMARY = "sell-confirm";
  const COMMAND_KEY = "sell-confirm";
  const COMMAND_ALIASES = [
    "sell confirm",
    "Sell Confirm",
    "SELL CONFIRM",
    "sell Confirm",
    "Sell confirm",
    "sellconfirm",
    "SELLCONFIRM",
    "SellConfirm",
    "sell-confirm",
    "Sell-Confirm",
    "SELL-CONFIRM",
    "sell_confirm",
    "Sell_Confirm",
    "SELL_CONFIRM"
  ];

  const COMMIT_SELL_CONFIRM = "tcsgo-commit-sell-confirm";
  const TIKTOK_SEND_COMMAND = "tiktok_chat_send";

  const ACK_TYPE = "sell-confirm-result";
  const ACK_VARS = ["tcsgo_last_sell_confirm_json", "tcsgo_last_event_json"];
  const MAX_WAIT_MS = 12000;
  const ACK_POLL_MS = 200;

  const CHAT_HANDLED_VAR = "tcsgo_last_chat_handled_v1";
  const CHAT_HANDLED_WINDOW_MS = 4000;
  const HANDLED_CHECK_DELAY_MS = 350;

  const DEDUPE_STORE_KEY = "tcsgo_sell_confirm_dedupe_v1";
  const COOLDOWN_STORE_KEY = "tcsgo_sell_confirm_cooldowns_v1";
  const QUEUE_STORE_KEY = "tcsgo_sell_confirm_queue_v1";
  const QUEUE_ACTIVE_TTL_MS = 30000;

  const COOLDOWN_DEFAULT_SEC = 60;
  const COOLDOWN_MOD_SEC = 45;
  const COOLDOWN_SUPPORTER_SEC = 30;
  const COOLDOWN_STREAMER_SEC = 0;

  const DEFAULT_LINKING_BASE = "Z:\\home\\nike\\Streaming\\TCSGO\\Linking";
  const DISCORD_INDEX_FILE = "discord-user-index.json";
  const USER_LINKS_FILE = "user-links.json";
  const LINK_PLATFORM_PREFERENCE = ["twitch", "youtube", "tiktok"];

  const DEFAULT_REST_BASE_URL = "http://127.0.0.1:39231";

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
    if (!sent) logMsg(`[SELL-CONFIRM] Reply failed | site=${site} | msg="${msg.slice(0, 120)}"`);
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
    let store = await getStoreItem(DEDUPE_STORE_KEY);
    if (!store || typeof store !== "object") store = {};
    store._msgIds = (store._msgIds && typeof store._msgIds === "object") ? store._msgIds : {};

    const key = `${site}|${username}`;
    if (store._msgIds[key] === messageId) return true;

    store._msgIds[key] = messageId;
    await setStore({ name: DEDUPE_STORE_KEY, value: store });
    return false;
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
      logMsg(`[SELL-CONFIRM] Discord link resolve failed | ${err?.message || err}`);
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

  async function getRestConfig() {
    const token = String(
      (await safeGetVar("restToken")) ||
      (await safeGetVar("rest_token")) ||
      (await safeGetVar("lumiaToken")) ||
      (await safeGetVar("token")) ||
      ((typeof process !== "undefined" && process.env && process.env.LUMIA_REST_TOKEN) ? process.env.LUMIA_REST_TOKEN : "") ||
      ""
    ).trim();

    const baseUrl = String(
      (await safeGetVar("restBaseUrl")) ||
      (await safeGetVar("rest_base_url")) ||
      (await safeGetVar("baseUrl")) ||
      (await safeGetVar("base_url")) ||
      ((typeof process !== "undefined" && process.env && process.env.LUMIA_REST_BASE_URL) ? process.env.LUMIA_REST_BASE_URL : "") ||
      DEFAULT_REST_BASE_URL
    ).trim();

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
      logMsg(`[SELL-CONFIRM] REST add-loyalty-points failed | ${err?.message || err}`);
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
        logMsg(`[SELL-CONFIRM] native addLoyaltyPoints failed | ${err?.message || err}`);
      }
    }

    const restResult = await restAddLoyaltyPoints(value, username, platform);
    if (restResult.ok) {
      return { ok: true, pointsAfter: null, method: "rest" };
    }

    return { ok: false, pointsAfter: Number.isFinite(pointsBefore) ? pointsBefore : null, method: "failed" };
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

  function ackMatchesJob(payload, job) {
    if (!payload || typeof payload !== "object") return false;
    if (lowerTrim(payload.type) !== lowerTrim(ACK_TYPE)) return false;
    const payloadEventId = payload.eventId || payload.data?.eventId || "";
    return payloadEventId === job.eventId;
  }

  async function pollAck(job) {
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      for (const varName of ACK_VARS) {
        const raw = await safeGetVar(varName);
        if (!raw) continue;
        const payload = safeJsonParse(raw);
        if (ackMatchesJob(payload, job)) return payload;
      }
      await sleep(ACK_POLL_MS);
    }
    return null;
  }

  async function processSingleJob(job, runnerId) {
    const { eventId, site, usernameRaw, effectivePlatform, effectiveUsername, token } = job;

    try {
      await callCommand({
        name: COMMIT_SELL_CONFIRM,
        variableValues: {
          eventId,
          platform: effectivePlatform,
          username: effectiveUsername,
          token
        }
      });
    } catch (err) {
      const msg = err?.message ? String(err.message) : String(err);
      logMsg(`[SELL-CONFIRM] Dispatch failed | ${msg}`);
      await reply(site, `@${usernameRaw} Sell confirm failed to dispatch. Try again.`);
      return;
    }

    const ack = await pollAck(job);
    await refreshQueueHeartbeat(runnerId);

    if (!ack) {
      await reply(site, `@${usernameRaw} Sell confirm dispatched. If it does not appear, try again.`);
      return;
    }

    if (!ack.ok) {
      const errMsg = ack?.error?.message || "Sell confirm failed.";
      await reply(site, `@${usernameRaw} ${errMsg}`);
      return;
    }

    const d = ack.data || {};
    const credit = Math.trunc(Number(d.creditedCoins) || 0);
    if (credit > 0) {
      const creditResult = await adjustCoins(credit, effectiveUsername, effectivePlatform, NaN);
      if (!creditResult.ok) {
        logMsg(`[SELL-CONFIRM] Coin credit failed | credit=${credit}`);
      }
    }

    await reply(
      site,
      `@${usernameRaw} Sold ${d.item?.displayName || "item"}! +${formatNumber(d.creditedCoins)} coins.`
    );
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
    logMsg(`[SELL-CONFIRM] Dedupe | site=${site} | user=${username} | messageId=${messageId}`);
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
    logMsg(`[SELL-CONFIRM] Overlay handled | site=${site} | user=${username}`);
    done({ shouldStop: true });
    return;
  }

  const identity = await resolveLinkedIdentity(site, username);
  const effectivePlatform = identity.effectivePlatform || site;
  const effectiveUsername = identity.effectiveUsername || username;

  if (identity.linkedFromDiscord) {
    logMsg(
      `[SELL-CONFIRM] Discord mapped | ${identity.requestedPlatform}:${identity.requestedUsername} -> ` +
      `${effectivePlatform}:${effectiveUsername}`
    );
  }

  const cooldownOk = await checkCooldown(site, username, usernameRaw, effectivePlatform, effectiveUsername);
  if (!cooldownOk) {
    done({ shouldStop: true });
    return;
  }

  const token = String(parsed.args[0] || "").trim();
  if (!token) {
    await reply(site, `@${usernameRaw} Usage: ${COMMAND_PREFIX}${COMMAND_PRIMARY} <token>`);
    done({ shouldStop: true });
    return;
  }

  const job = {
    eventId: makeEventId(),
    site,
    usernameRaw,
    effectivePlatform,
    effectiveUsername,
    token
  };

  await enqueueJob(job);
  await processQueue();
  done({ shouldStop: true });
}


