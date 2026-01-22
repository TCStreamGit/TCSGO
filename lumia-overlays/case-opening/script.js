/**
 * TCSGO Case Opening Controller V1
 * - Studio Toast Debug (Bottom-Right Like Multichat)
 * - Leader Election + Chat Dedup (Prevents Double-Processing)
 * - Fetch-First Data Load (Then Storage Fallback)
 */

(function () {
  "use strict";

  // Capture Lumia Host Toast (Do NOT Fall Back To Overlay.toast, That Shows Inside The Overlay)
const HOST_TOAST =
  (typeof toast === "function")
    ? toast
    : (typeof window !== "undefined" && typeof window.toast === "function")
      ? window.toast
      : null;


function normalizeToastType(t) {
  const x = String(t || "info").toLowerCase().trim();
  if (x === "warn") return "warning";
  if (x === "error") return "error";
  if (x === "success") return "success";
  if (x === "warning") return "warning";
  return "info";
}

function hostToast(message, type = "info") {
  if (!HOST_TOAST) return false;
  const msg = String(message ?? "");
  const tt = normalizeToastType(type);

  // Support Both Common Host Signatures
  try { HOST_TOAST(msg, tt); return true; } catch (_) {}
  try { HOST_TOAST({ message: msg, type: tt }); return true; } catch (_) {}

  return false;
}

  // =========================================================================
  // DEFAULT CONFIG
  // =========================================================================

  const DEFAULT_CONFIG = {
    /* Data Loading */
    baseRawUrl: "https://raw.githubusercontent.com/TCStreamGit/TCSGO/main",
    pollIntervalMs: 250,
    ackTimeoutMs: 3000,

    /* Reply Behaviour */
    chatReplyMode: "chat", // "off" | "toast" | "chat" | "both"

    /* Economy */
    feePercent: 10,
    defaultKeyPriceCoins: 3500,

    /* Overlay Routing */
    codeId: "tcsgo-controller",

    /* UI */
    winnerDisplayMs: 8000,

    /* Command Prefix + Viewer Command Names */
    commandPrefix: "!",
    cmdBuyCase: "buycase",
    cmdBuyKey: "buykey",
    cmdOpen: "open",
    cmdSell: "sell",
    cmdSellConfirm: "sellconfirm",

    /* Commit Command Names */
    commitBuyCase: "tcsgo-commit-buycase",
    commitBuyKey: "tcsgo-commit-buykey",
    commitOpen: "tcsgo-commit-open",
    commitSellStart: "tcsgo-commit-sell-start",
    commitSellConfirm: "tcsgo-commit-sell-confirm",

    /* Debug Master */
    debugEnabled: true,
    debugOutput: "toast", // "toast" | "console" | "both"
    debugAll: false,

    /* Debug Toggles */
    debugInit: true,
    debugConfig: true,
    debugData: true,
    debugStorage: true,
    debugFetch: true,
    debugVariables: true,

    debugEventsPrimary: true,
    debugEventsPoll: false,

    debugRouter: true,
    debugDedup: true,
    debugUnsolicited: true,

    debugChatIn: true,
    debugCommands: true,

    debugBuyCase: true,
    debugBuyKey: true,
    debugOpen: true,
    debugSell: true,
    debugSellConfirm: true,

    debugCommit: true,
    debugTimeouts: true,

    debugPoints: true,
    debugChatSend: true,

    debugWinnerCard: true,
    debugErrors: true
  };

  let CONFIG = { ...DEFAULT_CONFIG };

  // =========================================================================
  // CACHED DATA
  // =========================================================================

  let aliasCache = null;  // Expected Shape: { aliases: { key: { caseId, displayName } } }
  let pricesCache = null; // Expected Shape: { cadToCoins, cases: { caseId: cadPrice }, keys: { default: cadPrice } }

  // =========================================================================
  // EVENT ROUTING STATE
  // =========================================================================

  const pendingEvents = new Map(); // eventId -> { resolve, reject, timeoutId }
  let lastProcessedEventId = null;

  let pollIntervalRef = null;
  let lastPolledRaw = "";

  // =========================================================================
  // LEADER + CHAT DEDUP (Fixes TikTok Double-Fires / Multi-Instance)
  // =========================================================================

  const INSTANCE_ID = `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let IS_LEADER = true;
  const RECENT_CHAT = new Map(); // key -> ts

  // =========================================================================
  // CONFIG HELPERS
  // =========================================================================

  function getConfigSource() {
    const od =
      (typeof Overlay !== "undefined" && Overlay && Overlay.data) ||
      (typeof data !== "undefined" && data) ||
      (typeof window !== "undefined" && window && window.data) ||
      {};
    return od && typeof od === "object" ? od : {};
  }

  function cfgBoolFrom(src, key, fallback = false) {
    const v = src ? src[key] : undefined;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return v.toLowerCase() === "true";
    return fallback;
  }

  function cfgNumFrom(src, key, fallback = 0) {
    const v = src ? src[key] : undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function cfgStrFrom(src, key, fallback = "") {
    const v = src ? src[key] : undefined;
    return typeof v === "string" && v.trim() ? v.trim() : fallback;
  }

  function clampNum(n, min, max, fallback) {
    const x = Number(n);
    if (!Number.isFinite(x)) return fallback;
    return Math.max(min, Math.min(max, x));
  }

  // =========================================================================
  // STUDIO TOAST (Bottom-Right Like Multichat)
  // =========================================================================

  function studioToast(message, type = "info") {
  // Only Use Host Toast (Bottom-Right In Studio). Never Use Overlay.toast/Overlay.log.
  const ok = hostToast(message, type);

  if (!ok) {
    // Safe Fallback That Does Not Touch Overlay UI
    try {
      const t = normalizeToastType(type);
      console.log(`[${t}] ${String(message ?? "")}`);
    } catch (_) {}
  }

  return ok;
}



  // =========================================================================
  // DEBUG HELPERS (Now Uses CONFIG, Not Overlay.data)
  // =========================================================================

  function debugOn(key) {
    if (!CONFIG.debugEnabled) return false;
    if (CONFIG.debugAll) return true;
    return key ? !!CONFIG[key] : true;
  }

  function debugEmit(message, toastType = "info", key = "") {
    if (!CONFIG.debugEnabled) return;
    if (key && !debugOn(key)) return;

    const out = String(CONFIG.debugOutput || "toast").toLowerCase();
    const msg = String(message ?? "");
    const full = `[Debug] ${msg}`;

  // Multichat Behaviour: Toasts Go To Studio (Not Overlay UI)
    if (out === "toast" || out === "both") {
      studioToast(full, toastType);
    }

    if (out === "console" || out === "both") {
      try { console.log(full); } catch (_) {}
    }
  }



  function debugError(prefix, err, key = "debugErrors") {
    const e = err || {};
    const msg = `${prefix} | ${e.message || String(e)}`;
    debugEmit(msg, "error", key);
    if (e && e.stack) debugEmit(String(e.stack).slice(0, 500), "error", key);
  }

  // =========================================================================
  // INIT
  // =========================================================================

  async function init() {
    loadConfig();
    hostToast(`[Debug] Host Toast Available=${!!HOST_TOAST}`, "info");
    debugEmit(`[Init] Starting | Instance=${INSTANCE_ID}`, "info", "debugInit");

    await loadDataFiles();

    setupEventListeners();
    startLeaderElection();
    startPolling();

    debugEmit("[Init] Controller Ready", "success", "debugInit");
  }

  // =========================================================================
  // LOAD CONFIG
  // =========================================================================

  function loadConfig() {
    const src = getConfigSource();

    CONFIG = { ...DEFAULT_CONFIG };

    // Strings
    CONFIG.baseRawUrl = cfgStrFrom(src, "baseRawUrl", DEFAULT_CONFIG.baseRawUrl);
    CONFIG.codeId = cfgStrFrom(src, "codeId", DEFAULT_CONFIG.codeId);
    CONFIG.chatReplyMode = cfgStrFrom(src, "chatReplyMode", DEFAULT_CONFIG.chatReplyMode).toLowerCase();

    // Numbers
    CONFIG.pollIntervalMs = clampNum(cfgNumFrom(src, "pollIntervalMs", DEFAULT_CONFIG.pollIntervalMs), 50, 5000, DEFAULT_CONFIG.pollIntervalMs);
    CONFIG.ackTimeoutMs = clampNum(cfgNumFrom(src, "ackTimeoutMs", DEFAULT_CONFIG.ackTimeoutMs), 250, 30000, DEFAULT_CONFIG.ackTimeoutMs);
    CONFIG.feePercent = clampNum(cfgNumFrom(src, "feePercent", DEFAULT_CONFIG.feePercent), 0, 100, DEFAULT_CONFIG.feePercent);
    CONFIG.defaultKeyPriceCoins = clampNum(cfgNumFrom(src, "defaultKeyPriceCoins", DEFAULT_CONFIG.defaultKeyPriceCoins), 0, 1e12, DEFAULT_CONFIG.defaultKeyPriceCoins);
    CONFIG.winnerDisplayMs = clampNum(cfgNumFrom(src, "winnerDisplayMs", DEFAULT_CONFIG.winnerDisplayMs), 500, 60000, DEFAULT_CONFIG.winnerDisplayMs);

    // Viewer Commands
    CONFIG.commandPrefix = cfgStrFrom(src, "commandPrefix", DEFAULT_CONFIG.commandPrefix);
    CONFIG.cmdBuyCase = cfgStrFrom(src, "cmdBuyCase", DEFAULT_CONFIG.cmdBuyCase);
    CONFIG.cmdBuyKey = cfgStrFrom(src, "cmdBuyKey", DEFAULT_CONFIG.cmdBuyKey);
    CONFIG.cmdOpen = cfgStrFrom(src, "cmdOpen", DEFAULT_CONFIG.cmdOpen);
    CONFIG.cmdSell = cfgStrFrom(src, "cmdSell", DEFAULT_CONFIG.cmdSell);
    CONFIG.cmdSellConfirm = cfgStrFrom(src, "cmdSellConfirm", DEFAULT_CONFIG.cmdSellConfirm);

    // Commit Commands
    CONFIG.commitBuyCase = cfgStrFrom(src, "commitBuyCase", DEFAULT_CONFIG.commitBuyCase);
    CONFIG.commitBuyKey = cfgStrFrom(src, "commitBuyKey", DEFAULT_CONFIG.commitBuyKey);
    CONFIG.commitOpen = cfgStrFrom(src, "commitOpen", DEFAULT_CONFIG.commitOpen);
    CONFIG.commitSellStart = cfgStrFrom(src, "commitSellStart", DEFAULT_CONFIG.commitSellStart);
    CONFIG.commitSellConfirm = cfgStrFrom(src, "commitSellConfirm", DEFAULT_CONFIG.commitSellConfirm);

    // Debug
    CONFIG.debugEnabled = cfgBoolFrom(src, "debugEnabled", DEFAULT_CONFIG.debugEnabled);
    CONFIG.debugOutput = cfgStrFrom(src, "debugOutput", DEFAULT_CONFIG.debugOutput).toLowerCase();
    CONFIG.debugAll = cfgBoolFrom(src, "debugAll", DEFAULT_CONFIG.debugAll);

    const debugKeys = [
      "debugInit","debugConfig","debugData","debugStorage","debugFetch","debugVariables",
      "debugEventsPrimary","debugEventsPoll","debugRouter","debugDedup","debugUnsolicited",
      "debugChatIn","debugCommands","debugBuyCase","debugBuyKey","debugOpen","debugSell","debugSellConfirm",
      "debugCommit","debugTimeouts","debugPoints","debugChatSend","debugWinnerCard","debugErrors"
    ];
    for (const k of debugKeys) CONFIG[k] = cfgBoolFrom(src, k, DEFAULT_CONFIG[k]);

    if (!["toast", "console", "both"].includes(CONFIG.debugOutput)) {
      CONFIG.debugOutput = DEFAULT_CONFIG.debugOutput;
    }
    if (!["off", "toast", "chat", "both"].includes(CONFIG.chatReplyMode)) {
      CONFIG.chatReplyMode = DEFAULT_CONFIG.chatReplyMode;
    }

    debugEmit(
      `[Config] baseRawUrl=${CONFIG.baseRawUrl} | prefix=${CONFIG.commandPrefix} | debugOutput=${CONFIG.debugOutput} | chatReplyMode=${CONFIG.chatReplyMode}`,
      "info",
      "debugConfig"
    );
  }

  // =========================================================================
  // COMMAND HELPERS
  // =========================================================================

  function getPrefixes() {
    return String(CONFIG.commandPrefix || "!")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function matchPrefix(message) {
    const msg = String(message || "");
    for (const p of getPrefixes()) {
      if (p && msg.startsWith(p)) return p;
    }
    return "";
  }

  function getCmdFull(cmdKey) {
    const pfx = getPrefixes()[0] || "!";
    const name = String(CONFIG[cmdKey] || "").trim();
    return `${pfx}${name}`;
  }

  // =========================================================================
  // STORAGE / VARIABLES
  // =========================================================================

  async function safeGetStorage(key) {
    if (typeof Overlay !== "undefined" && Overlay.getStorage) {
      try {
        const v = await Overlay.getStorage(key);
        debugEmit(`[Storage] Get | key=${key} | hit=${v != null && v !== ""}`, "info", "debugStorage");
        return v;
      } catch (err) {
        debugError(`[Storage] Get Failed | key=${key}`, err, "debugStorage");
      }
    }
    return null;
  }

  async function safeSetStorage(key, value) {
    if (typeof Overlay !== "undefined" && Overlay.setStorage) {
      try {
        await Overlay.setStorage(key, value);
        debugEmit(`[Storage] Set | key=${key} | ok=true`, "success", "debugStorage");
        return true;
      } catch (err) {
        debugError(`[Storage] Set Failed | key=${key}`, err, "debugStorage");
      }
    }
    return false;
  }

  async function safeGetVariable(name) {
    if (typeof Overlay !== "undefined" && Overlay.getVariable) {
      try {
        const v = await Overlay.getVariable(name);
        debugEmit(`[Var] Get | name=${name} | hasValue=${!!v}`, "info", "debugVariables");
        return v;
      } catch (err) {
        debugError(`[Var] Get Failed | name=${name}`, err, "debugVariables");
      }
    }
    return null;
  }

  async function safeSetVariable(name, value) {
    if (typeof Overlay !== "undefined" && Overlay.setVariable) {
      try {
        await Overlay.setVariable(name, value);
        debugEmit(`[Var] Set | name=${name} | ok=true`, "success", "debugVariables");
        return true;
      } catch (err) {
        debugError(`[Var] Set Failed | name=${name}`, err, "debugVariables");
      }
    }
    return false;
  }

  // =========================================================================
  // DATA LOADING (Fetch First, Then Storage)
  // =========================================================================

  async function loadDataFiles() {
    debugEmit("[Data] Load Start", "info", "debugData");

    const base = String(CONFIG.baseRawUrl || "").replace(/\/+$/g, "");

    // 1) Fetch First
    if (base) {
      try {
        const aUrl = `${base}/data/case-aliases.json`;
        debugEmit(`[Data] Fetch Aliases | ${aUrl}`, "info", "debugFetch");
        const resp = await fetch(aUrl, { cache: "no-store" });
        if (!resp.ok) throw new Error(`Aliases Fetch Failed (${resp.status})`);
        aliasCache = await resp.json();
        await safeSetStorage("tcsgo_aliases", JSON.stringify(aliasCache));
        debugEmit(`[Data] Aliases Fetched | aliases=${Object.keys(aliasCache?.aliases || {}).length}`, "success", "debugData");
      } catch (e) {
        debugError("[Data] Fetch Aliases Failed", e, "debugFetch");
      }

      try {
        const pUrl = `${base}/data/prices.json`;
        debugEmit(`[Data] Fetch Prices | ${pUrl}`, "info", "debugFetch");
        const resp = await fetch(pUrl, { cache: "no-store" });
        if (!resp.ok) throw new Error(`Prices Fetch Failed (${resp.status})`);
        pricesCache = await resp.json();
        await safeSetStorage("tcsgo_prices", JSON.stringify(pricesCache));
        debugEmit("[Data] Prices Fetched", "success", "debugData");
      } catch (e) {
        debugError("[Data] Fetch Prices Failed", e, "debugFetch");
      }
    } else {
      debugEmit("[Data] baseRawUrl Empty (Skipping Fetch)", "warning", "debugData");
    }

    // 2) Storage Fallback
    if (!aliasCache) {
      const raw = await safeGetStorage("tcsgo_aliases");
      if (raw) {
        try {
          aliasCache = typeof raw === "string" ? JSON.parse(raw) : raw;
          debugEmit(`[Data] Aliases From Storage | aliases=${Object.keys(aliasCache?.aliases || {}).length}`, "success", "debugData");
        } catch (e) {
          debugError("[Data] Aliases Storage Parse Failed", e, "debugData");
        }
      }
    }

    if (!pricesCache) {
      const raw = await safeGetStorage("tcsgo_prices");
      if (raw) {
        try {
          pricesCache = typeof raw === "string" ? JSON.parse(raw) : raw;
          debugEmit("[Data] Prices From Storage", "success", "debugData");
        } catch (e) {
          debugError("[Data] Prices Storage Parse Failed", e, "debugData");
        }
      }
    }

    // Validation (This Will Tell You Exactly Why "Dream" Misses)
    const aliasCount = Object.keys(aliasCache?.aliases || {}).length;
    debugEmit(`[Data] Alias Shape | hasAliasesProp=${!!aliasCache?.aliases} | aliasCount=${aliasCount}`, "info", "debugData");

    debugEmit("[Data] Load Complete", "success", "debugData");
  }

  // =========================================================================
  // EVENTS (PRIMARY)
  // =========================================================================

  function setupEventListeners() {
    if (typeof Overlay !== "undefined" && Overlay.on) {
      Overlay.on("overlaycontent", (eventData) => {
        debugEmit(`[Events] overlaycontent | hasContent=${!!eventData?.content}`, "info", "debugEventsPrimary");
        handleIncomingEvent(eventData.content, "overlaycontent");
      });

      Overlay.on("chat", (chatData) => {
        if (debugOn("debugChatIn")) {
          const m = String(chatData?.message || "").slice(0, 140);
          debugEmit(
            `[Chat] In | platform=${chatData?.platform || chatData?.site || ""} | user=${chatData?.username || chatData?.displayname || ""} | msg="${m}"`,
            "info",
            "debugChatIn"
          );
        }
        handleChatMessage(chatData);
      });

      debugEmit("[Events] Registered overlaycontent + chat", "success", "debugEventsPrimary");
    } else {
      debugEmit("[Events] Overlay.on Missing", "warning", "debugEventsPrimary");
    }
  }

  // =========================================================================
  // POLLING (FALLBACK)
  // =========================================================================

  function startPolling() {
    if (pollIntervalRef) return;

    pollIntervalRef = setInterval(async () => {
      try {
        const eventJson = await safeGetVariable("tcsgo_last_event_json");
        if (!eventJson || eventJson === "null" || eventJson === "") return;
        if (String(eventJson) === String(lastPolledRaw)) return;
        lastPolledRaw = String(eventJson);

        debugEmit("[Polling] New Variable Payload", "info", "debugEventsPoll");
        handleIncomingEvent(eventJson, "poll");
      } catch (err) {
        debugError("[Polling] Error", err, "debugErrors");
      }
    }, CONFIG.pollIntervalMs);

    debugEmit(`[Polling] Started | intervalMs=${CONFIG.pollIntervalMs}`, "success", "debugEventsPoll");
  }

  function stopPolling() {
    if (!pollIntervalRef) return;
    clearInterval(pollIntervalRef);
    pollIntervalRef = null;
    debugEmit("[Polling] Stopped", "warning", "debugEventsPoll");
  }

  // =========================================================================
  // ROUTER
  // =========================================================================

  function handleIncomingEvent(payloadStr, sourceLabel) {
    if (!payloadStr) return;

    let payload;
    try {
      payload = typeof payloadStr === "string" ? JSON.parse(payloadStr) : payloadStr;
    } catch (err) {
      debugError(`[Router] Payload Parse Failed | source=${sourceLabel || ""}`, err, "debugErrors");
      return;
    }

    const eventId = payload.eventId || payload.data?.eventId || "";
    const type = payload.type || "(missing type)";
    const ok = payload.ok;

    debugEmit(`[Router] In | source=${sourceLabel} | type=${type} | ok=${ok} | eventId=${eventId || "(none)"}`, ok ? "info" : "warning", "debugRouter");

    if (eventId && eventId === lastProcessedEventId) {
      debugEmit(`[Router] Duplicate Ignored | eventId=${eventId}`, "warning", "debugDedup");
      return;
    }
    if (eventId) lastProcessedEventId = eventId;

    if (eventId && pendingEvents.has(eventId)) {
      const pending = pendingEvents.get(eventId);
      clearTimeout(pending.timeoutId);
      pendingEvents.delete(eventId);

      debugEmit(`[Router] Matched Pending | eventId=${eventId} | ok=${ok}`, ok ? "success" : "error", "debugCommit");
      if (payload.ok) pending.resolve(payload);
      else pending.reject(payload);
      return;
    }

    handleUnsolicitedEvent(payload);
  }

  function handleUnsolicitedEvent(payload) {
    const type = payload.type;
    debugEmit(`[Router] Unsolicited | type=${String(type || "")}`, "info", "debugUnsolicited");

    switch (type) {
      case "open-result":
        if (payload.ok && payload.data?.winner) showWinnerCard(payload.data, payload.username || "Unknown");
        break;

      case "buycase-result":
      case "buykey-result":
        studioToast(payload.ok ? "Purchase Complete" : "Purchase Failed", payload.ok ? "success" : "error");
        break;

      case "sell-start-result":
        if (payload.ok) {
          const d = payload.data || {};
          studioToast(`Sell Started | Confirm: ${getCmdFull("cmdSellConfirm")} ${d.token}`, "info");
        } else {
          studioToast(payload?.error?.message || "Sell Failed", "error");
        }
        break;

      case "sell-confirm-result":
        if (payload.ok) {
          const d = payload.data || {};
          studioToast(`Sold | +${formatNumber(d.creditedCoins)} Coins`, "success");
        } else {
          studioToast(payload?.error?.message || "Sell Failed", "error");
        }
        break;

      default:
        debugEmit(`[Router] Unhandled Type | ${String(type || "")}`, "warning", "debugRouter");
    }
  }

  // =========================================================================
  // LEADER ELECTION + CHAT DEDUP
  // =========================================================================

  async function leaderTick() {
    const varName = "tcsgo_controller_leader_v1";
    const ttlMs = 6000;

    const now = Date.now();
    const raw = await safeGetVariable(varName);

    let rec = null;
    try { rec = raw ? JSON.parse(raw) : null; } catch (_) {}

    const stale = !rec || !rec.ts || (now - Number(rec.ts)) > ttlMs;

    if (stale || rec.id === INSTANCE_ID) {
      await safeSetVariable(varName, JSON.stringify({ id: INSTANCE_ID, ts: now }));
      IS_LEADER = true;
      return;
    }

    IS_LEADER = rec.id === INSTANCE_ID;
  }

  function startLeaderElection() {
    setInterval(() => { leaderTick(); }, 2000);
    leaderTick();
  }

  function shouldProcessChat(chatData) {
    const platform = String(chatData?.platform || chatData?.site || "").toLowerCase();
    const user = String(chatData?.username || chatData?.displayname || "").toLowerCase();
    const msg = String(chatData?.message || "").trim();

    const key = `${platform}|${user}|${msg}`;
    const now = Date.now();
    const dedupMs = 1500;

    const last = RECENT_CHAT.get(key);
    if (last && (now - last) < dedupMs) return false;

    RECENT_CHAT.set(key, now);

    if (RECENT_CHAT.size > 300) {
      for (const [k, t] of RECENT_CHAT) {
        if ((now - t) > 6000) RECENT_CHAT.delete(k);
      }
    }
    return true;
  }

  // =========================================================================
  // CHAT PARSING
  // =========================================================================

  function handleChatMessage(chatData) {
    if (!IS_LEADER) return;
    if (!shouldProcessChat(chatData)) return;

    const messageRaw = String(chatData?.message || "").trim();
    const username = chatData?.username || chatData?.displayname || "Unknown";
    const platform = chatData?.platform || chatData?.site || "twitch";

    const pfx = matchPrefix(messageRaw);
    if (!pfx) return;

    const content = messageRaw.slice(pfx.length).trim();
    if (!content) return;

    const parts = content.split(/\s+/);
    const command = String(parts[0] || "").toLowerCase();
    const args = parts.slice(1);

    debugEmit(
      `[Chat] Command Parsed | cmd=${command} | args=${JSON.stringify(args)} | user=${username} | platform=${platform}`,
      "info",
      "debugCommands"
    );

    const cBuyCase = String(CONFIG.cmdBuyCase || "buycase").toLowerCase();
    const cBuyKey = String(CONFIG.cmdBuyKey || "buykey").toLowerCase();
    const cOpen = String(CONFIG.cmdOpen || "open").toLowerCase();
    const cSell = String(CONFIG.cmdSell || "sell").toLowerCase();
    const cSellConfirm = String(CONFIG.cmdSellConfirm || "sellconfirm").toLowerCase();

    if (command === cBuyCase) return void handleBuyCase(username, platform, args);
    if (command === cBuyKey) return void handleBuyKey(username, platform, args);
    if (command === cOpen) return void handleOpen(username, platform, args);
    if (command === cSell) return void handleSell(username, platform, args);
    if (command === cSellConfirm) return void handleSellConfirm(username, platform, args);
  }

  // =========================================================================
  // ALIAS + PRICES
  // =========================================================================

  function resolveAlias(alias) {
    const key = String(alias || "").toLowerCase().trim();

    if (!aliasCache) {
      debugEmit(`[Alias] Cache Missing | key=${key}`, "error", "debugData");
      return null;
    }
    if (!aliasCache.aliases) {
      debugEmit(`[Alias] Invalid Shape (Missing .aliases) | key=${key}`, "error", "debugData");
      return null;
    }

    const hit = aliasCache.aliases[key] || null;
    if (!hit) {
      const all = Object.keys(aliasCache.aliases || {});
      const suggestions = all
        .filter((k) => k.includes(key) || key.includes(k))
        .slice(0, 8);

      debugEmit(
        `[Alias] Miss | key=${key} | aliasCount=${all.length} | suggestions=${suggestions.join(",") || "(none)"}`,
        "warning",
        "debugData"
      );
    }
    return hit;
  }

  function getCasePrice(caseId) {
    try {
      if (pricesCache && pricesCache.cases && pricesCache.cases[caseId] !== undefined) {
        const cadPrice = Number(pricesCache.cases[caseId]);
        const cadToCoins = Number(pricesCache.cadToCoins || 1000);
        const coins = Math.round(cadPrice * cadToCoins);
        return Number.isFinite(coins) ? coins : 2000;
      }
    } catch (e) {
      debugError("[Prices] getCasePrice Error", e, "debugErrors");
    }
    return 2000;
  }

  function getKeyPrice() {
    try {
      if (pricesCache && pricesCache.keys && pricesCache.keys.default !== undefined) {
        const cadPrice = Number(pricesCache.keys.default);
        const cadToCoins = Number(pricesCache.cadToCoins || 1000);
        const coins = Math.round(cadPrice * cadToCoins);
        return Number.isFinite(coins) ? coins : CONFIG.defaultKeyPriceCoins;
      }
    } catch (e) {
      debugError("[Prices] getKeyPrice Error", e, "debugErrors");
    }
    return CONFIG.defaultKeyPriceCoins;
  }

  // =========================================================================
  // LOYALTY POINTS
  // =========================================================================

  async function getLoyaltyPoints(username, platform) {
    if (typeof Overlay !== "undefined" && Overlay.getLoyaltyPoints) {
      try {
        const v = await Overlay.getLoyaltyPoints({ username, platform });
        debugEmit(`[Points] Get | user=${username} | platform=${platform} | value=${v}`, "success", "debugPoints");
        return Number(v) || 0;
      } catch (err) {
        debugError(`[Points] Get Failed | user=${username} | platform=${platform}`, err, "debugPoints");
        return 0;
      }
    }
    debugEmit("[Points] Get Skipped (API Missing)", "warning", "debugPoints");
    return 0;
  }

  async function addLoyaltyPoints(username, platform, value) {
    if (typeof Overlay !== "undefined" && Overlay.addLoyaltyPoints) {
      try {
        const v = await Overlay.addLoyaltyPoints({ username, platform, value });
        debugEmit(`[Points] Add | user=${username} | platform=${platform} | delta=${value} | new=${v}`, "success", "debugPoints");
        return Number(v) || 0;
      } catch (err) {
        debugError(`[Points] Add Failed | user=${username} | platform=${platform} | delta=${value}`, err, "debugPoints");
        return 0;
      }
    }
    debugEmit("[Points] Add Skipped (API Missing)", "warning", "debugPoints");
    return 0;
  }

  // =========================================================================
  // CHAT SEND (Uses Studio Toast When You Set chatReplyMode="toast")
  // =========================================================================

  async function sendChatMessage(message, platform) {
    const msg = String(message || "").trim();
    if (!msg) return;

    const mode = String(CONFIG.chatReplyMode || "chat").toLowerCase();
    if (mode === "off") return;

    if (mode === "toast" || mode === "both") studioToast(msg, "info");
    if (mode === "toast") return;

    if (typeof Overlay !== "undefined" && Overlay.chatbot) {
      try {
        await Overlay.chatbot({ message: msg, platform, chatAsSelf: false });
        debugEmit(`[ChatSend] OK | platform=${platform} | msg="${msg.slice(0, 120)}"`, "success", "debugChatSend");
        return;
      } catch (err) {
        debugError(`[ChatSend] Failed | platform=${platform}`, err, "debugChatSend");
      }
    }

    debugEmit(`[ChatSend] (No Send) ${msg}`, "warning", "debugChatSend");
  }

  // =========================================================================
  // COMMIT COMMAND INVOCATION
  // =========================================================================

  function callCommitCommand(commandName, params, eventId) {
    return new Promise((resolve, reject) => {
      const cmd = String(commandName || "").trim();
      if (!cmd) return reject({ ok: false, error: { code: "NO_CMD", message: "Commit Command Name Missing" } });

      debugEmit(`[Commit] Call | cmd=${cmd} | eventId=${eventId}`, "info", "debugCommit");

      const timeoutId = setTimeout(() => {
        if (!pendingEvents.has(eventId)) return;
        pendingEvents.delete(eventId);
        debugEmit(`[Commit] Timeout | cmd=${cmd} | eventId=${eventId} | ms=${CONFIG.ackTimeoutMs}`, "error", "debugTimeouts");
        reject({ ok: false, error: { code: "TIMEOUT", message: "Command timed out" } });
      }, CONFIG.ackTimeoutMs);

      pendingEvents.set(eventId, { resolve, reject, timeoutId });

      if (typeof Overlay !== "undefined" && Overlay.callCommand) {
        try {
          Overlay.callCommand(cmd, params);
          debugEmit(`[Commit] Called | cmd=${cmd} | eventId=${eventId}`, "success", "debugCommit");
        } catch (e) {
          clearTimeout(timeoutId);
          pendingEvents.delete(eventId);
          debugError(`[Commit] callCommand Threw | cmd=${cmd}`, e, "debugErrors");
          reject({ ok: false, error: { code: "CALL_FAILED", message: "Overlay.callCommand failed" } });
        }
      } else {
        clearTimeout(timeoutId);
        pendingEvents.delete(eventId);
        reject({ ok: false, error: { code: "NO_OVERLAY", message: "Overlay API unavailable" } });
      }
    });
  }

  // =========================================================================
  // BUY CASE
  // =========================================================================

  async function handleBuyCase(username, platform, args) {
    const alias = args[0];
    const qty = Math.max(1, parseInt(args[1], 10) || 1);

    debugEmit(`[BuyCase] Start | user=${username} | alias=${alias || ""} | qty=${qty}`, "info", "debugBuyCase");

    if (!alias) return void sendChatMessage(`@${username} Usage: ${getCmdFull("cmdBuyCase")} <alias> [qty]`, platform);

    const caseInfo = resolveAlias(alias);
    if (!caseInfo) {
      debugEmit(`[BuyCase] Unknown Alias | alias=${alias}`, "warning", "debugBuyCase");
      return void sendChatMessage(`@${username} Unknown case: ${alias}`, platform);
    }

    const pricePerCase = getCasePrice(caseInfo.caseId);
    const totalCost = pricePerCase * qty;

    const currentPoints = await getLoyaltyPoints(username, platform);
    debugEmit(`[BuyCase] Balance | have=${currentPoints} | need=${totalCost}`, "info", "debugPoints");

    if (currentPoints < totalCost) {
      return void sendChatMessage(`@${username} Need ${formatNumber(totalCost)}, Have ${formatNumber(currentPoints)}.`, platform);
    }

    const deducted = await addLoyaltyPoints(username, platform, -totalCost);

    const eventId = generateEventId();
    try {
      await callCommitCommand(CONFIG.commitBuyCase, { eventId, platform, username, alias, qty }, eventId);
      await sendChatMessage(`@${username} Bought ${qty}x ${caseInfo.displayName}! Balance: ${formatNumber(deducted)}`, platform);
      studioToast(`Case Purchased | ${username} | ${qty}x ${caseInfo.displayName}`, "success");
    } catch (errPayload) {
      await addLoyaltyPoints(username, platform, totalCost);
      const errMsg = errPayload?.error?.message || "Purchase failed";
      await sendChatMessage(`@${username} ${errMsg}. Points Refunded.`, platform);
      studioToast(`Purchase Failed | ${errMsg}`, "error");
    }
  }

  // =========================================================================
  // BUY KEY
  // =========================================================================

  async function handleBuyKey(username, platform, args) {
    const qty = Math.max(1, parseInt(args[0], 10) || 1);

    debugEmit(`[BuyKey] Start | user=${username} | qty=${qty}`, "info", "debugBuyKey");

    const pricePerKey = getKeyPrice();
    const totalCost = pricePerKey * qty;

    const currentPoints = await getLoyaltyPoints(username, platform);

    if (currentPoints < totalCost) {
      return void sendChatMessage(`@${username} Need ${formatNumber(totalCost)}, Have ${formatNumber(currentPoints)}.`, platform);
    }

    const deducted = await addLoyaltyPoints(username, platform, -totalCost);

    const eventId = generateEventId();
    try {
      await callCommitCommand(CONFIG.commitBuyKey, { eventId, platform, username, qty }, eventId);
      await sendChatMessage(`@${username} Bought ${qty}x Key(s)! Balance: ${formatNumber(deducted)}`, platform);
      studioToast(`Keys Purchased | ${username} | ${qty}x`, "success");
    } catch (errPayload) {
      await addLoyaltyPoints(username, platform, totalCost);
      const errMsg = errPayload?.error?.message || "Purchase failed";
      await sendChatMessage(`@${username} ${errMsg}. Points Refunded.`, platform);
      studioToast(`Purchase Failed | ${errMsg}`, "error");
    }
  }

  // =========================================================================
  // OPEN
  // =========================================================================

  async function handleOpen(username, platform, args) {
    const alias = args[0];

    debugEmit(`[Open] Start | user=${username} | alias=${alias || ""}`, "info", "debugOpen");

    if (!alias) return void sendChatMessage(`@${username} Usage: ${getCmdFull("cmdOpen")} <alias>`, platform);

    const caseInfo = resolveAlias(alias);
    if (!caseInfo) return void sendChatMessage(`@${username} Unknown case: ${alias}`, platform);

    const eventId = generateEventId();

    try {
      const result = await callCommitCommand(CONFIG.commitOpen, { eventId, platform, username, alias }, eventId);
      if (result.ok && result.data) {
        showWinnerCard(result.data, username);
        const winner = result.data.winner || {};
        const stStr = winner.statTrak ? "StatTrak™ " : "";
        await sendChatMessage(`@${username} Opened ${stStr}${winner.displayName} (${winner.wear})!`, platform);
      }
    } catch (errPayload) {
      const errMsg = errPayload?.error?.message || "Open failed";
      await sendChatMessage(`@${username} ${errMsg}`, platform);
      studioToast(`Open Failed | ${errMsg}`, "error");
    }
  }

  // =========================================================================
  // SELL START / CONFIRM
  // =========================================================================

  async function handleSell(username, platform, args) {
    const oid = args[0];
    if (!oid) return void sendChatMessage(`@${username} Usage: ${getCmdFull("cmdSell")} <oid>`, platform);

    const eventId = generateEventId();
    try {
      const result = await callCommitCommand(CONFIG.commitSellStart, { eventId, platform, username, oid }, eventId);
      if (result.ok && result.data) {
        const d = result.data;
        await sendChatMessage(
          `@${username} Selling ${d.item.displayName} For ${formatNumber(d.creditAmount)} Coins (${d.marketFeePercent}% Fee). ` +
          `Confirm: ${getCmdFull("cmdSellConfirm")} ${d.token} (${d.expiresInSeconds}s)`,
          platform
        );
        studioToast(`Sell Started | Token=${d.token}`, "info");
      }
    } catch (errPayload) {
      const errMsg = errPayload?.error?.message || "Sell failed";
      await sendChatMessage(`@${username} ${errMsg}`, platform);
      studioToast(`Sell Failed | ${errMsg}`, "error");
    }
  }

  async function handleSellConfirm(username, platform, args) {
    const token = args[0];
    if (!token) return void sendChatMessage(`@${username} Usage: ${getCmdFull("cmdSellConfirm")} <token>`, platform);

    const eventId = generateEventId();
    try {
      const result = await callCommitCommand(CONFIG.commitSellConfirm, { eventId, platform, username, token }, eventId);
      if (result.ok && result.data) {
        const d = result.data;
        await addLoyaltyPoints(username, platform, d.creditedCoins);
        await sendChatMessage(`@${username} Sold ${d.item.displayName}! +${formatNumber(d.creditedCoins)} Coins.`, platform);
        studioToast(`Sold | +${formatNumber(d.creditedCoins)} Coins`, "success");
      }
    } catch (errPayload) {
      const errMsg = errPayload?.error?.message || "Confirm failed";
      await sendChatMessage(`@${username} ${errMsg}`, platform);
      studioToast(`Sell Confirm Failed | ${errMsg}`, "error");
    }
  }

  // =========================================================================
  // WINNER CARD UI
  // =========================================================================

  function showWinnerCard(resultData, username) {
    debugEmit(`[Winner] Show | user=${username}`, "info", "debugWinnerCard");

    const container = document.getElementById("winner-container");
    if (!container) return;

    const winner = resultData?.winner || {};
    const rarity = normalizeRarity(winner.rarity || winner.tier);
    container.className = `rarity-${rarity}`;

    const imgEl = document.getElementById("winner-image");
    if (imgEl) imgEl.src = resultData?.imagePath || "";

    const nameEl = document.getElementById("winner-name");
    if (nameEl) nameEl.textContent = winner.displayName || "Unknown Item";

    const stEl = document.getElementById("winner-stattrak");
    if (stEl) stEl.classList.toggle("hidden", !winner.statTrak);

    const wearEl = document.getElementById("winner-wear");
    if (wearEl) wearEl.textContent = winner.wear || "Unknown";

    const userEl = document.getElementById("winner-username");
    if (userEl) userEl.textContent = username;

    container.classList.remove("hidden", "fade-out");

    setTimeout(() => {
      container.classList.add("fade-out");
      setTimeout(() => container.classList.add("hidden"), 400);
    }, CONFIG.winnerDisplayMs);
  }

  function normalizeRarity(rarity) {
    if (!rarity) return "blue";
    const r = String(rarity).toLowerCase().replace(/[-\s]/g, "");
    const map = {
      milspec: "milspec",
      restricted: "restricted",
      classified: "classified",
      covert: "covert",
      consumer: "consumer",
      industrial: "industrial",
      extraordinary: "gold",
      blue: "blue",
      purple: "purple",
      pink: "pink",
      red: "red",
      gold: "gold"
    };
    return map[r] || "blue";
  }

  // =========================================================================
  // UTILS
  // =========================================================================

  function generateEventId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `evt_${ts}_${rand}`;
  }

  function formatNumber(num) {
    return (Number(num) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // =========================================================================
  // STARTUP + EXPORTS
  // =========================================================================

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.TCSGOController = {
    studioToast,
    debugEmit,
    debugOn: (k) => debugOn(k),
    getConfig: () => ({ ...CONFIG }),
    getAliasCache: () => aliasCache,
    getPricesCache: () => pricesCache,
    stopPolling,
    startPolling
  };
})();
