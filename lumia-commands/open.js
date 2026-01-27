async function () {
  "use strict";

  /*
   * Command: !open
   * Description: Open a case. The overlay is only required for the animation/spin.
   * Aliases: !open, !open-case, !open case, !OpenCase, !Open Case
   */
  const LOG_ENABLED = true;

  const COMMAND_PREFIX = "!";
  const COMMAND_PRIMARY = "open";
  const COMMAND_KEY = "open";
  const COMMAND_ALIASES = ["open", "open-case", "open case"];
  const COMMIT_OPEN_COMMAND = "tcsgo-commit-open";
  const TIKTOK_SEND_COMMAND = "tiktok_chat_send";

  const ACK_VARS = ["tcsgo_last_open_json", "tcsgo_last_event_json"];
  const ACK_TYPE = "open-result";
  const MAX_WAIT_MS = 12000;
  const ACK_POLL_MS = 200;

  // Overlay handshake: the overlay marks handled chat commands here.
  const CHAT_HANDLED_VAR = "tcsgo_last_chat_handled_v1";
  const CHAT_HANDLED_WINDOW_MS = 4000;
  const HANDLED_CHECK_DELAY_MS = 350;

  // Command-level dedupe to reduce duplicate triggers from some platforms.
  const STORE_KEY = "tcsgo_open_case_chat_v2";
  const QUEUE_ACTIVE_TTL_MS = 30000;

  // Cooldowns requested by the workspace:
  // - Regular viewers: 60s
  // - Mods: 45s
  // - Supporters: 30s
  // - Streamer/broadcaster: 0s
  const COOLDOWN_DEFAULT_SEC = 60;
  const COOLDOWN_MOD_SEC = 45;
  const COOLDOWN_SUPPORTER_SEC = 30;
  const COOLDOWN_STREAMER_SEC = 0;

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

  function normalizeStore(store) {
    const shaped = store && typeof store === "object" ? store : {};
    shaped._msgIds = (shaped._msgIds && typeof shaped._msgIds === "object") ? shaped._msgIds : {};
    shaped._cooldowns = (shaped._cooldowns && typeof shaped._cooldowns === "object") ? shaped._cooldowns : {};
    shaped._cooldownReplies = (shaped._cooldownReplies && typeof shaped._cooldownReplies === "object") ? shaped._cooldownReplies : {};
    shaped._queue = Array.isArray(shaped._queue) ? shaped._queue : [];
    shaped._queueActive = (shaped._queueActive && typeof shaped._queueActive === "object") ? shaped._queueActive : null;
    return shaped;
  }

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    if (!sent) logMsg(`[OPENCHAT] Reply failed | site=${site} | msg="${msg.slice(0, 120)}"`);
  }

  function getEventTimestamp(eventId) {
    const raw = String(eventId || "");
    const match = /^evt_([0-9a-z]+)_/i.exec(raw);
    if (!match) return null;
    const ts = parseInt(match[1], 36);
    return Number.isFinite(ts) ? ts : null;
  }

  function formatSecsShort(totalSecs) {
    const s = Math.max(0, Math.ceil(Number(totalSecs) || 0));
    return `${s}s`;
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

  async function checkMessageDedupe(store, site, username, messageId) {
    if (!messageId) return false;
    const key = `${site}|${username}`;
    if (store._msgIds[key] === messageId) return true;

    store._msgIds[key] = messageId;
    await setStore({ name: STORE_KEY, value: store });
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

    // Fill missing keys from Lumia templates.
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

  async function checkCooldown(store, site, username, usernameRaw, levels) {
    const cooldownSeconds = pickCooldownSeconds(levels);
    if (cooldownSeconds <= 0) return true;

    const nowMs = Date.now();
    const key = `${site}:${username}:${lowerTrim(COMMAND_KEY)}`;
    const replyKey = `${key}:lastReplyUse`;
    const lastUseMs = Number(store._cooldowns[key] || 0);
    const remaining = Math.max(0, Math.ceil(((lastUseMs + (cooldownSeconds * 1000)) - nowMs) / 1000));

    if (remaining > 0) {
      const lastReplyUse = Number(store._cooldownReplies[replyKey] || 0);
      if (lastReplyUse !== lastUseMs) {
        store._cooldownReplies[replyKey] = lastUseMs;
        await setStore({ name: STORE_KEY, value: store });
        await reply(site, `@${usernameRaw} That command is on cooldown. ${formatSecsShort(remaining)} remaining.`);
      }
      return false;
    }

    store._cooldowns[key] = nowMs;
    store._cooldownReplies[replyKey] = 0;
    await setStore({ name: STORE_KEY, value: store });
    return true;
  }

  function queueIsActive(queueActive, nowMs) {
    if (!queueActive || typeof queueActive !== "object") return false;
    const ts = Number(queueActive.ts || 0);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return (nowMs - ts) < QUEUE_ACTIVE_TTL_MS;
  }

  async function tryAcquireQueueLock(runnerId) {
    const nowMs = Date.now();
    let store = normalizeStore(await getStoreItem(STORE_KEY));

    if (queueIsActive(store._queueActive, nowMs) && store._queueActive.runnerId !== runnerId) {
      return false;
    }

    store._queueActive = { runnerId, ts: nowMs };
    await setStore({ name: STORE_KEY, value: store });

    // Re-read to confirm we still hold the lock.
    store = normalizeStore(await getStoreItem(STORE_KEY));
    return store._queueActive?.runnerId === runnerId;
  }

  async function refreshQueueHeartbeat(runnerId) {
    let store = normalizeStore(await getStoreItem(STORE_KEY));
    if (!store._queueActive || store._queueActive.runnerId !== runnerId) return;
    store._queueActive.ts = Date.now();
    await setStore({ name: STORE_KEY, value: store });
  }

  async function releaseQueueLock(runnerId) {
    let store = normalizeStore(await getStoreItem(STORE_KEY));
    if (store._queueActive?.runnerId !== runnerId) return;
    store._queueActive = null;
    await setStore({ name: STORE_KEY, value: store });
  }

  async function enqueueJob(job) {
    let store = normalizeStore(await getStoreItem(STORE_KEY));
    store._queue.push(job);
    await setStore({ name: STORE_KEY, value: store });
  }

  async function dequeueJob(runnerId) {
    let store = normalizeStore(await getStoreItem(STORE_KEY));
    if (!store._queueActive || store._queueActive.runnerId !== runnerId) return null;
    const job = store._queue.shift() || null;
    store._queue = store._queue;
    await setStore({ name: STORE_KEY, value: store });
    return job;
  }

  function ackMatchesJob(payload, job, startMs) {
    if (!payload || typeof payload !== "object") return false;
    if (lowerTrim(payload.type) !== ACK_TYPE) return false;

    const payloadEventId = payload.eventId || payload.data?.eventId || "";
    if (payloadEventId && payloadEventId === job.eventId) return true;

    // Fallback match: allow a recent open-result for the same user/platform.
    const payloadTs = getEventTimestamp(payloadEventId);
    if (payloadTs && payloadTs < (startMs - 1000)) return false;

    const payloadUser = lowerTrim(payload.username || payload.data?.username);
    const payloadPlatform = lowerTrim(payload.platform || payload.data?.platform);
    if (!payloadUser || !payloadPlatform) return false;
    if (payloadUser !== lowerTrim(job.username)) return false;
    if (payloadPlatform !== lowerTrim(job.site)) return false;
    if (!payload.data?.winner) return false;

    logMsg(`[OPENCHAT] Ack Fallback Match | payloadEventId=${payloadEventId || "(none)"} | jobEventId=${job.eventId}`);
    return true;
  }

  async function pollAck(job) {
    const startMs = Date.now();
    const deadline = startMs + MAX_WAIT_MS;

    while (Date.now() < deadline) {
      for (const varName of ACK_VARS) {
        const raw = await safeGetVar(varName);
        if (!raw) continue;
        const payload = safeJsonParse(raw);
        if (ackMatchesJob(payload, job, startMs)) return payload;
      }
      await sleep(ACK_POLL_MS);
    }

    return null;
  }

  function formatOpenResultMessage(usernameRaw, payload) {
    const winner = payload?.data?.winner || {};
    const name = winner.displayName || "Unknown Item";
    const wear = winner.wear ? ` (${winner.wear})` : "";
    const stStr = winner.statTrak ? "StatTrak™ " : "";
    return `@${usernameRaw} Opened ${stStr}${name}${wear}!`;
  }

  async function processSingleJob(job, runnerId) {
    try {
      await callCommand({
        name: COMMIT_OPEN_COMMAND,
        variableValues: {
          eventId: job.eventId,
          platform: job.site,
          username: job.username,
          alias: job.alias
        }
      });
      logMsg(`[OPENCHAT] Dispatched | eventId=${job.eventId} | site=${job.site} | user=${job.username} | alias=${job.alias}`);
    } catch (err) {
      const msg = err?.message ? String(err.message) : String(err);
      logMsg(`[OPENCHAT] Dispatch failed | ${msg}`);
      await reply(job.site, `@${job.usernameRaw} Open failed to dispatch. Try again.`);
      return;
    }

    const ack = await pollAck(job);
    await refreshQueueHeartbeat(runnerId);

    if (!ack) {
      await reply(job.site, `@${job.usernameRaw} Open dispatched. If it does not appear, try again.`);
      return;
    }

    if (ack.ok) {
      await reply(job.site, formatOpenResultMessage(job.usernameRaw, ack));
      return;
    }

    const errMsg = ack?.error?.message || "Open failed.";
    await reply(job.site, `@${job.usernameRaw} ${errMsg}`);
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

  let store = normalizeStore(await getStoreItem(STORE_KEY));

  if (await checkMessageDedupe(store, site, username, messageId)) {
    logMsg(`[OPENCHAT] Dedupe | site=${site} | user=${username} | messageId=${messageId}`);
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
    logMsg(`[OPENCHAT] Overlay handled | site=${site} | user=${username}`);
    done({ shouldStop: true });
    return;
  }

  const alias = String(parsed.args[0] || "").trim();
  if (!alias) {
    await reply(site, `@${usernameRaw} Usage: ${COMMAND_PREFIX}${COMMAND_PRIMARY} <alias>`);
    done({ shouldStop: true });
    return;
  }

  const levels = await resolveUserLevels();
  store = normalizeStore(await getStoreItem(STORE_KEY));
  const cooldownOk = await checkCooldown(store, site, username, usernameRaw, levels);
  if (!cooldownOk) {
    done({ shouldStop: true });
    return;
  }

  const job = {
    eventId: makeEventId(),
    site,
    username,
    usernameRaw,
    alias
  };

  await enqueueJob(job);
  await processQueue();

  done({ shouldStop: true });
}
