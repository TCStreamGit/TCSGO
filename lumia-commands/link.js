async function () {
  "use strict";

  const LOG_ENABLED = true;
  const STORE_KEY = "tcsgo_link_dedupe_v1";

  const DEFAULT_LINKING_BASE = "Z:\\home\\nike\\Streaming\\TCSGO\\Linking";
  const DISCORD_INDEX_FILE = "discord-user-index.json";
  const USER_LINKS_FILE = "user-links.json";
  const LINK_SESSIONS_FILE = "link-sessions.json";
  const CODE_TTL_MS = 5 * 60 * 1000;
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

  function sanitizeTarget(raw) {
    return String(raw ?? "").trim().replace(/^@+/, "");
  }

  async function resolveLinkingBase() {
    const base = String(await getVariable("TCSGO_LINKING_BASE") ?? "").trim();
    if (base) return base;
    const envBase = (typeof process !== "undefined" && process.env && process.env.TCSGO_LINKING_BASE)
      ? String(process.env.TCSGO_LINKING_BASE).trim()
      : "";
    return envBase || DEFAULT_LINKING_BASE;
  }

  function joinPath(base, rel) {
    const baseStr = String(base ?? "").trim();
    const sep = baseStr.includes("\\") ? "\\" : "/";
    const b = baseStr.replace(/[\\/]+$/g, "");
    const r = String(rel ?? "").replace(/^[\\/]+/g, "");
    return b ? `${b}${sep}${r}` : r;
  }

  function mkError(code, message) {
    return { code: String(code || "ERROR"), message: String(message || "Unknown Error") };
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function parseIso(value) {
    const txt = String(value ?? "").trim();
    if (!txt) return null;
    const t = Date.parse(txt);
    return Number.isFinite(t) ? new Date(t) : null;
  }

  function padCode(num) {
    return String(num).padStart(5, "0");
  }

  function generateCode(sessions) {
    for (let i = 0; i < 20; i += 1) {
      const code = padCode(Math.floor(Math.random() * 100000));
      if (!sessions[code]) return code;
    }
    return padCode(Date.now() % 100000);
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

  function ensureDiscordIndex(data) {
    if (!data || typeof data !== "object") {
      throw mkError("MISSING_INDEX", "discord-user-index.json missing.");
    }
    if (String(data.schemaVersion) !== "1.0-discord-user-index") {
      throw mkError("SCHEMA_MISMATCH", "discord-user-index.json schemaVersion must be 1.0-discord-user-index.");
    }
    if (!data.users || typeof data.users !== "object") {
      throw mkError("MISSING_INDEX", "discord-user-index.json missing users map.");
    }
    return data;
  }

  function ensureUserLinks(data) {
    if (!data || typeof data !== "object") {
      return {
        schemaVersion: "1.0-user-links",
        lastModified: nowIso(),
        users: {},
        reverse: { twitch: {}, youtube: {}, tiktok: {} }
      };
    }
    if (String(data.schemaVersion) !== "1.0-user-links") {
      throw mkError("SCHEMA_MISMATCH", "user-links.json schemaVersion must be 1.0-user-links.");
    }
    if (!data.users || typeof data.users !== "object") data.users = {};
    if (!data.reverse || typeof data.reverse !== "object") data.reverse = {};
    for (const platform of ["twitch", "youtube", "tiktok"]) {
      if (!data.reverse[platform] || typeof data.reverse[platform] !== "object") {
        data.reverse[platform] = {};
      }
    }
    return data;
  }

  function ensureLinkSessions(data) {
    if (!data || typeof data !== "object") {
      return {
        schemaVersion: "1.0-link-sessions",
        lastModified: nowIso(),
        sessions: {}
      };
    }
    if (!data.schemaVersion || String(data.schemaVersion) !== "1.0-link-sessions") {
      data.schemaVersion = "1.0-link-sessions";
    }
    if (!data.sessions || typeof data.sessions !== "object") data.sessions = {};
    return data;
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
      if (!ok) logMsg(`[LINK] TikTok send failed | msg="${msg.slice(0, 120)}"`);
      return;
    }
    try {
      await chatbot({ message: msg, site });
      return;
    } catch (_) {}
    logMsg(`[LINK] chatbot failed | site=${site} | msg="${msg.slice(0, 120)}"`);
  }

  const t0 = Date.now();
  const rawMessage = cleanTemplateValue(await getVariable("rawMessage") ?? "{{rawMessage}}");
  const message = cleanTemplateValue(await getVariable("message") ?? "{{message}}");
  const args = parseArgs(rawMessage, message);

  const targetRaw = args[0] || "";
  const targetDiscordUsername = sanitizeTarget(targetRaw);
  const targetLower = lowerTrim(targetDiscordUsername);

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

  const platformUsername = String(usernameRaw ?? "").trim();
  const platformUsernameLower = lowerTrim(platformUsername);

  const messageId = cleanTemplateValue(await getVariable("messageId") ?? "{{messageId}}");

  logMsg(`[LINK] Vars | platform=${platform} | username=${platformUsername} | target=${targetDiscordUsername}`);

  if (messageId && platform && platformUsernameLower) {
    let store = await getStoreItem(STORE_KEY);
    if (!store || typeof store !== "object") store = {};
    store._msgIds = (store._msgIds && typeof store._msgIds === "object") ? store._msgIds : {};
    const msgKey = `${platform}|${platformUsernameLower}`;
    if (store._msgIds[msgKey] === messageId) {
      done({ shouldStop: true });
      return;
    }
    store._msgIds[msgKey] = messageId;
    await setStore({ name: STORE_KEY, value: store });
  }

  let result;

  try {
    if (!platform) throw mkError("MISSING_PLATFORM", "Missing platform.");
    if (!platformUsernameLower) throw mkError("MISSING_USERNAME", "Missing username.");
    if (!targetLower) throw mkError("MISSING_TARGET", "Missing target Discord username.");

    const base = await resolveLinkingBase();
    if (!base) throw mkError("MISSING_LINKING_BASE", "Missing linking base path.");

    const indexPath = joinPath(base, DISCORD_INDEX_FILE);
    const userLinksPath = joinPath(base, USER_LINKS_FILE);
    const sessionsPath = joinPath(base, LINK_SESSIONS_FILE);

    const [indexRaw, userLinksRaw, sessionsRaw] = await Promise.all([
      safeReadJson(indexPath, null),
      safeReadJson(userLinksPath, null),
      safeReadJson(sessionsPath, null)
    ]);

    const index = ensureDiscordIndex(indexRaw);
    const userLinks = ensureUserLinks(userLinksRaw);
    const linkSessions = ensureLinkSessions(sessionsRaw);

    const discordId = index.users[targetLower];
    if (!discordId) {
      throw mkError("DISCORD_NOT_FOUND", `Discord user "${targetDiscordUsername}" not found.`);
    }

    const entry = userLinks.users[String(discordId)];
    const linkedAccounts = entry && typeof entry.linkedAccounts === "object" ? entry.linkedAccounts : {};
    const existingAccount = linkedAccounts ? linkedAccounts[platform] : null;
    if (existingAccount && typeof existingAccount === "object" && existingAccount.usernameLower) {
      throw mkError("ALREADY_LINKED", `Discord user already linked on ${platform}.`);
    }

    const reverseMap = userLinks.reverse && userLinks.reverse[platform] ? userLinks.reverse[platform] : {};
    const linkedDiscord = reverseMap[platformUsernameLower];
    if (linkedDiscord && String(linkedDiscord) !== String(discordId)) {
      throw mkError("USERNAME_TAKEN", `That ${platform} username is already linked.`);
    }

    const sessions = linkSessions.sessions;
    let activeCode = null;
    let activeSession = null;
    let sessionsChanged = false;
    const nowMs = Date.now();

    for (const [code, session] of Object.entries(sessions)) {
      if (!session || typeof session !== "object") {
        delete sessions[code];
        sessionsChanged = true;
        continue;
      }
      const expiresAt = parseIso(session.expiresAt);
      const expired = !expiresAt || expiresAt.getTime() <= nowMs;
      if (expired) {
        delete sessions[code];
        sessionsChanged = true;
        continue;
      }
      const sessionTarget = lowerTrim(session.targetDiscordUsername);
      if (!activeSession && sessionTarget && sessionTarget === targetLower) {
        activeCode = code;
        activeSession = session;
      }
    }

    let code;
    let expiresAt;
    let ok = true;
    let messageToSend;
    let error = null;

    if (activeSession) {
      code = activeCode;
      expiresAt = activeSession.expiresAt;
      const activeAction = lowerTrim(activeSession.action || "link");
      const activePlatform = normSite(activeSession.platform || "");
      const activeUser = lowerTrim(activeSession.platformUsernameLower || "");
      if (activeAction !== "link") {
        ok = false;
        error = {
          code: "PENDING_UNLINK",
          message: `An unlink is already pending for Discord ${targetDiscordUsername}. Use code ${code} or wait for it to expire.`
        };
        messageToSend = buildMessage(platformUsername, error.message);
      } else if (activePlatform !== platform || activeUser !== platformUsernameLower) {
        ok = false;
        error = {
          code: "PENDING_LINK",
          message: `A link is already pending for Discord ${targetDiscordUsername}. Use code ${code} or wait for it to expire.`
        };
        messageToSend = buildMessage(platformUsername, error.message);
      } else {
        messageToSend = buildMessage(
          platformUsername,
          `Link already pending for Discord ${targetDiscordUsername}. Code: ${code}.`
        );
      }
    } else {
      code = generateCode(sessions);
      expiresAt = new Date(nowMs + CODE_TTL_MS).toISOString();
      sessions[code] = {
        action: "link",
        targetDiscordUsername,
        platform,
        platformUsernameLower,
        code,
        expiresAt
      };
      linkSessions.lastModified = nowIso();
      sessionsChanged = true;
      messageToSend = buildMessage(
        platformUsername,
        `Link code for Discord ${targetDiscordUsername}: ${code}. Post it in Discord to confirm (expires in 5m).`
      );
    }

    if (sessionsChanged) {
      linkSessions.lastModified = nowIso();
      await safeWriteJson(sessionsPath, linkSessions);
    }

    result = {
      type: "link-start-result",
      action: "link",
      ok,
      platform,
      platformUsername,
      targetDiscordUsername,
      code,
      expiresAt,
      error: error || undefined,
      messageToSend,
      data: { timings: { msTotal: Date.now() - t0 } }
    };
  } catch (err) {
    const error = err && err.code
      ? { code: err.code, message: err.message }
      : mkError("LINK_ERROR", err?.message || String(err));
    const messageToSend = buildMessage(platformUsername, error.message);
    result = {
      type: "link-start-result",
      action: "link",
      ok: false,
      platform,
      platformUsername,
      targetDiscordUsername,
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
