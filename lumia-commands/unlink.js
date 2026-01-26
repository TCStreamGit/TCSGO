async function () {
  "use strict";

  const LOG_ENABLED = true;                 // Logs To Lumia Logs
  const CHAT_DEBUG_ENABLED = false;         // If True, Sends A Debug Line To Twitch Chat
  const STORE_KEY = "tcsgo_link_dedupe_v1";

  // If Lumia Runs This Command Twice (One Run Missing Variables),
  // This Lets The Second Run Recover Context From The First Run.
  const CTX_STORE_KEY = "tcsgo_unlink_ctx_v1";
  const CTX_TTL_MS = 2500;

  // Detect Which writeFile Signature Works And Stick To It (Prevents Repeated Errors)
  const WRITEFILE_MODE_STORE_KEY = "tcsgo_writefile_mode_v1"; // "object" | "string"
  const WRITEFILE_MODE_DEFAULT = "object";                    // Prefer Object Form First

  const DEFAULT_LINKING_BASE = "Z:\\home\\nike\\Streaming\\TCSGO\\Linking";
  const DISCORD_INDEX_FILE = "discord-user-index.json";
  const USER_LINKS_FILE = "user-links.json";
  const LINK_SESSIONS_FILE = "link-sessions.json";
  const CODE_TTL_MS = 5 * 60 * 1000;
  const TIKTOK_SEND_COMMAND = "tiktok_chat_send";
  const DISCORD_LINK_CHANNEL_ID = "1464686722993491979";
  const DISCORD_LINK_CHANNEL_NAME = "🤖｜𝑪𝒉𝒐𝒔𝒆𝒏-𝑩𝒐𝒕";

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

    // If Message Still Includes The Trigger (Example: "!unlink"), Strip It
    if (parts[0] && String(parts[0]).startsWith("!")) {
      return parts.length > 1 ? parts.slice(1) : [];
    }

    // Otherwise Message Is Probably Already Just The Args (Example: "TanChosen")
    return parts;
  }

  function sanitizeTarget(raw) {
    return String(raw ?? "").trim().replace(/^@+/, "");
  }

  function resolveLinkingBase(linkingBaseVarValue) {
    const base = String(linkingBaseVarValue ?? "").trim();
    if (base) return base;

    const envBase =
      (typeof process !== "undefined" && process && process.env && process.env.TCSGO_LINKING_BASE)
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
        logExec(`[UNLINK:${RUN_ID}] WriteFile Error | path=${path} | ${e2?.message ?? e2}`);
        return false;
      }
    }
  }

  async function safeWriteJson(fullPath, obj) {
    const out = JSON.stringify(obj, null, 2) + "\n";
    const ok = await safeWriteFile(fullPath, out, false);
    if (!ok) throw new Error("Write Failed");
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

  function formatDiscordChannel() {
    const name = String(DISCORD_LINK_CHANNEL_NAME ?? "").trim();
    if (name) return name;
    return DISCORD_LINK_CHANNEL_ID ? `<#${DISCORD_LINK_CHANNEL_ID}>` : "the link-confirmation channel";
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
      if (!ok) logExec(`[UNLINK:${RUN_ID}] TikTok Send Failed | msg="${msg.slice(0, 120)}"`);
      return;
    }

    try {
      await chatbot({ message: msg, site });
      return;
    } catch (_) {}

    logExec(`[UNLINK:${RUN_ID}] chatbot failed | site=${site} | msg="${msg.slice(0, 120)}"`);
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
    targetDiscordUsername: String((await safeGetVar("targetDiscordUsername")) ?? "").trim(),
    linkingBase: String((await safeGetVar("TCSGO_LINKING_BASE")) ?? "").trim()
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

            targetDiscordUsername: ctx.targetDiscordUsername || String(prev.targetDiscordUsername || "").trim(),
            linkingBase: ctx.linkingBase || String(prev.linkingBase || "").trim()
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

  const platformUsername =
    String(ctx.username || "").trim() ||
    String(ctx.login || "").trim() ||
    String(ctx.user || "").trim() ||
    String(ctx.userName || "").trim() ||
    String(ctx.handle || "").trim() ||
    String(ctx.displayname || "").trim() ||
    String(ctx.displayName || "").trim();

  const platformUsernameLower = lowerTrim(platformUsername);

  const rawMessage = String(ctx.rawMessage || "").trim();
  const message = String(ctx.message || "").trim();
  const args = parseArgs(rawMessage, message);

  const targetRaw = String(args[0] || ctx.targetDiscordUsername || "").trim();
  let targetDiscordUsername = sanitizeTarget(targetRaw);
  let targetLower = lowerTrim(targetDiscordUsername);

  const messageId = String(ctx.messageId || "").trim();

  if (CHAT_DEBUG_ENABLED) {
    try {
      await chatbot({
        site: "twitch",
        message:
          `DEBUG !unlink | run=${RUN_ID} | username="${platformUsername}" | platform="${platform}" | message="${message}" | rawMessage="${rawMessage}"`
      });
    } catch (_) {}
  }

  logExec(
    `[UNLINK:${RUN_ID}] Vars | platform=${platform} | username=${platformUsername} | target=${targetDiscordUsername} | msgId=${messageId}`
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

    const userKey = platformUsernameLower ? `${platform}|${platformUsernameLower}` : `${platform}|`;

    if (messageId && platformUsernameLower) {
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

  /* =========================
     Main Logic
  ========================= */
  const t0 = Date.now();
  let result;

  try {
    if (!platform) throw mkError("MISSING_PLATFORM", "Missing Platform.");
    if (!platformUsernameLower) {
      throw mkError(
        "MISSING_USERNAME",
        "Missing Username (UNLINK.JS V2). If This Is Called From Another Command, Pass username/message/rawMessage/platform Into This Command."
      );
    }
    const base = resolveLinkingBase(ctx.linkingBase);
    if (!base) throw mkError("MISSING_LINKING_BASE", "Missing Linking Base Path.");

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

    let discordId = "";
    if (!targetLower) {
      const reverseLookup = userLinks.reverse && userLinks.reverse[platform] ? userLinks.reverse[platform] : {};
      const autoDiscordId = reverseLookup[platformUsernameLower];
      if (!autoDiscordId) {
        throw mkError(
          "MISSING_TARGET",
          `Missing Target Discord Username. You Are Not Linked On ${platform}.`
        );
      }
      const autoEntry = userLinks.users[String(autoDiscordId)];
      targetDiscordUsername = String(autoEntry?.discordUsernameLower || autoDiscordId);
      targetLower = lowerTrim(targetDiscordUsername);
      discordId = String(autoDiscordId);
    } else {
      discordId = String(index.users[targetLower] || "");
    }

    if (!discordId) {
      throw mkError("DISCORD_NOT_FOUND", `Discord User "${targetDiscordUsername}" Not Found.`);
    }

    const entry = userLinks.users[String(discordId)];
    const linkedAccounts = entry && typeof entry.linkedAccounts === "object" ? entry.linkedAccounts : {};
    const existingAccount = linkedAccounts ? linkedAccounts[platform] : null;

    if (!existingAccount || typeof existingAccount !== "object" || !existingAccount.usernameLower) {
      throw mkError("NOT_LINKED", `Discord User Has No ${platform} Link To Remove.`);
    }

    const linkedUsername = lowerTrim(existingAccount.usernameLower || "");
    if (linkedUsername !== platformUsernameLower) {
      throw mkError("USERNAME_MISMATCH", `That ${platform} Account Is Not Linked To This Discord User.`);
    }

    const reverseMap = userLinks.reverse && userLinks.reverse[platform] ? userLinks.reverse[platform] : {};
    const linkedDiscord = reverseMap[platformUsernameLower];
    if (linkedDiscord && String(linkedDiscord) !== String(discordId)) {
      throw mkError("USERNAME_TAKEN", `That ${platform} Username Is Linked Elsewhere.`);
    }

    const sessions = linkSessions.sessions;
    let activeCode = null;
    let activeSession = null;
    let pendingLinkCode = null;
    let pendingLinkSession = null;
    let sessionsChanged = false;

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
      if (!sessionTarget || sessionTarget !== targetLower) {
        continue;
      }

      const sessionAction = lowerTrim(session.action || "link");
      const sessionPlatform = normSite(session.platform || "");
      const sessionUser = lowerTrim(session.platformUsernameLower || "");

      if (sessionAction !== "unlink") {
        if (!pendingLinkSession) {
          pendingLinkCode = code;
          pendingLinkSession = session;
        }
        continue;
      }

      if (!activeSession && sessionPlatform === platform && sessionUser === platformUsernameLower) {
        activeCode = code;
        activeSession = session;
      }
    }

    let code;
    let expiresAt;
    let ok = true;
    let messageToSend;
    let error = null;

    if (pendingLinkSession) {
      ok = false;
      error = {
        code: "PENDING_LINK",
        message: `A Link Is Already Pending For Discord ${targetDiscordUsername}. Please Wait For It To Expire Or Finish It In ${formatDiscordChannel()}.`
      };
      messageToSend = buildMessage(platformUsername, error.message);
    } else if (activeSession) {
      code = activeCode;
      expiresAt = activeSession.expiresAt;
      messageToSend = buildMessage(
        platformUsername,
        `Unlink Already Pending For Discord ${targetDiscordUsername}. Code: ${code}. Post It In ${formatDiscordChannel()} (Expires In 5m).`
      );
    } else {
      code = generateCode(sessions);
      expiresAt = new Date(nowMs + CODE_TTL_MS).toISOString();
      sessions[code] = {
        action: "unlink",
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
        `Unlink Code For Discord ${targetDiscordUsername}: ${code}. Post It In ${formatDiscordChannel()} To Confirm (Expires In 5m).`
      );
    }

    if (sessionsChanged) {
      linkSessions.lastModified = nowIso();
      await safeWriteJson(sessionsPath, linkSessions);
    }

    result = {
      type: "unlink-start-result",
      action: "unlink",
      ok,
      platform,
      platformUsername,
      targetDiscordUsername,
      code,
      expiresAt,
      error: error || undefined,
      messageToSend,
      data: { timings: { msTotal: Date.now() - t0 }, runId: RUN_ID }
    };
  } catch (err) {
    const error = err && err.code
      ? { code: err.code, message: err.message }
      : mkError("UNLINK_ERROR", err?.message || String(err));

    const messageToSend = buildMessage(platformUsername, error.message);

    result = {
      type: "unlink-start-result",
      action: "unlink",
      ok: false,
      platform,
      platformUsername,
      targetDiscordUsername,
      error,
      messageToSend,
      data: { timings: { msTotal: Date.now() - t0 }, runId: RUN_ID }
    };
  }

  if (result && result.messageToSend) {
    try { await replyToCaller(platform, result.messageToSend); } catch (_) {}
  }

  try { logDbg(`[UNLINK:${RUN_ID}] ${JSON.stringify(result)}`); } catch (_) {}

  finish();
}
