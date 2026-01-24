/**
 * TCSGO Case Opening Controller V2 (FIXED)
 * - Fixed loyalty points deduction to match working ChosenSlots/ChosenSend pattern
 * - Simplified addLoyaltyPoints call with correct parameter order: { value, username, platform }
 * - Removed overly complex tryOverlayCall wrapper and verification loops
 */

(function () {
  "use strict";

  // =========================================================================
  // HOST TOAST (Capture Before Anything Can Shadow It)
  // =========================================================================

  const HOST_TOAST =
    (typeof window !== "undefined" && typeof window.toast === "function")
      ? window.toast
      : (typeof toast !== "undefined" && typeof toast === "function")
        ? toast
        : (typeof Overlay !== "undefined" && Overlay && typeof Overlay.toast === "function")
          ? Overlay.toast
          : null;

  function normalizeToastType(t) {
    const x = String(t || "info").toLowerCase().trim();
    if (x === "warn") return "warning";
    if (x === "warning") return "warning";
    if (x === "success") return "success";
    if (x === "error") return "error";
    return "info";
  }

  function hostToast(message, type = "info") {
    if (!HOST_TOAST) return false;

    const msg = String(message ?? "");
    const tt = normalizeToastType(type);

    try { HOST_TOAST(msg, tt); return true; } catch (_) {}
    try { HOST_TOAST({ message: msg, type: tt }); return true; } catch (_) {}
    try { HOST_TOAST({ text: msg, type: tt }); return true; } catch (_) {}

    return false;
  }

  function studioToast(message, type = "info") {
    if (hostToast(message, type)) return true;

    try {
      if (typeof Overlay !== "undefined" && Overlay && typeof Overlay.log === "function") {
        try { Overlay.log(String(message ?? "")); return true; } catch (_) {}
        try { Overlay.log({ message: String(message ?? ""), type: normalizeToastType(type) }); return true; } catch (_) {}
      }
    } catch (_) {}

    try { console.log(`[${normalizeToastType(type)}] ${String(message ?? "")}`); } catch (_) {}
    return false;
  }

  // =========================================================================
  // DEFAULT CONFIG
  // =========================================================================

  const DEFAULT_CONFIG = {
    baseRawUrl: "https://raw.githubusercontent.com/TCStreamGit/TCSGO/main",
    pollIntervalMs: 250,
    ackTimeoutMs: 3000,
    chatReplyMode: "chat",
    feePercent: 10,
    defaultKeyPriceCoins: 3500,
    codeId: "tcsgo-controller",
    winnerDisplayMs: 8000,
    caseIntroMs: 200,
    caseSpinPauseMs: 1000,
    caseSpinMs: 6050,
    caseSpinItems: 60,
    caseWinnerIndex: 50,
    caseKeyImage: "",
    sfxAccept: "Assets/Sounds/TCSGO_Sound_Assets/menu_accept.mp3",
    sfxOpen: "Assets/Sounds/MP3/csgo_ui_crate_open.mp3",
    sfxTick: "Assets/Sounds/TCSGO_Sound_Assets/tick.mp3",
    sfxReveal: "Assets/Sounds/TCSGO_Sound_Assets/reveal.mp3",
    sfxRare: "Assets/Sounds/TCSGO_Sound_Assets/rare.mp3",
    sfxGold: "Assets/Sounds/TCSGO_Sound_Assets/gold-reveal.mp3",
    sfxVolume: 0.65,
    sfxTickVolume: 0.45,
    commandPrefix: "!",
    cmdBuyCase: "buycase",
    cmdBuyKey: "buykey",
    cmdOpen: "open",
    cmdSell: "sell",
    cmdSellConfirm: "sellconfirm",
    commitBuyCase: "tcsgo-commit-buycase",
    commitBuyKey: "tcsgo-commit-buykey",
    commitOpen: "tcsgo-commit-open",
    commitSellStart: "tcsgo-commit-sell-start",
    commitSellConfirm: "tcsgo-commit-sell-confirm",
    debugEnabled: true,
    debugOutput: "toast",
    debugAll: false,
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
  const BOOT_TS = Date.now();
  let pollPrimed = false;

  const SPIN_TIMING_DEFAULT = {
    spinUpMs: 250,
    highSpeedMs: 2800,
    decelMs: 2600,
    finalLockMs: 400,
    overshootPx: 6,
    openSfxDelayMs: 200,
    cruiseBoost: 1.5,
    tickCurve: [
      { t: 0, interval: 83 },
      { t: 1800, interval: 100 },
      { t: 2800, interval: 140 },
      { t: 3800, interval: 220 },
      { t: 4600, interval: 320 },
      { t: 5100, interval: 450 }
    ]
  };
  const SPIN_TIMING_TOTAL_MS =
    SPIN_TIMING_DEFAULT.spinUpMs +
    SPIN_TIMING_DEFAULT.highSpeedMs +
    SPIN_TIMING_DEFAULT.decelMs +
    SPIN_TIMING_DEFAULT.finalLockMs;

  // =========================================================================
  // CACHED DATA
  // =========================================================================

  let aliasCache = null;
  let pricesCache = null;
  const caseJsonCache = new Map();

  const openQueue = [];
  let openBusy = false;

  const UI = {
    root: null,
    caseOpening: null,
    stageIntro: null,
    stageRoulette: null,
    stageReveal: null,
    caseIcon: null,
    caseTitle: null,
    caseKeyCard: null,
    caseKeyImage: null,
    rouletteStrip: null,
    rouletteWindow: null,
    rouletteMarker: null,
    rouletteCase: null,
    rouletteUser: null,
    revealImage: null,
    revealName: null,
    revealStattrak: null,
    revealWear: null,
    revealPrice: null,
    revealUser: null,
    sfxAccept: null,
    sfxOpen: null,
    sfxTick: null,
    sfxReveal: null,
    sfxRare: null,
    sfxGold: null
  };

  const tickPool = [];
  let stripX = 0;

  // =========================================================================
  // EVENT ROUTING STATE
  // =========================================================================

  const pendingEvents = new Map();
  let lastProcessedEventId = null;

  let pollIntervalRef = null;
  let lastPolledRaw = "";

  // =========================================================================
  // LEADER + CHAT DEDUP
  // =========================================================================

  const INSTANCE_ID = `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let IS_LEADER = true;
  const RECENT_CHAT = new Map();

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
  // DEBUG HELPERS
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

    if (out === "toast" || out === "both") {
      studioToast(`[Debug] ${msg}`, toastType);
    }
    if (out === "console" || out === "both") {
      try { console.log(`[Debug] ${msg}`); } catch (_) {}
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
    cacheUi();
    initAudio();
    if (UI.caseOpening) {
      setOverlayState("idle");
      setOverlayActive(false);
    }

    debugEmit(`[Init] Starting | Instance=${INSTANCE_ID}`, "info", "debugInit");

    debugEmit(
      `[Caps] toast=${!!HOST_TOAST} | getPoints=${!!Overlay?.getLoyaltyPoints} | addPoints=${!!Overlay?.addLoyaltyPoints}`,
      "info",
      "debugInit"
    );

    await loadDataFiles();
    await primePollingCache();

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

    CONFIG.baseRawUrl = cfgStrFrom(src, "baseRawUrl", DEFAULT_CONFIG.baseRawUrl);
    CONFIG.codeId = cfgStrFrom(src, "codeId", DEFAULT_CONFIG.codeId);
    CONFIG.chatReplyMode = cfgStrFrom(src, "chatReplyMode", DEFAULT_CONFIG.chatReplyMode).toLowerCase();

    CONFIG.pollIntervalMs = clampNum(cfgNumFrom(src, "pollIntervalMs", DEFAULT_CONFIG.pollIntervalMs), 50, 5000, DEFAULT_CONFIG.pollIntervalMs);
    CONFIG.ackTimeoutMs = clampNum(cfgNumFrom(src, "ackTimeoutMs", DEFAULT_CONFIG.ackTimeoutMs), 250, 30000, DEFAULT_CONFIG.ackTimeoutMs);
    CONFIG.feePercent = clampNum(cfgNumFrom(src, "feePercent", DEFAULT_CONFIG.feePercent), 0, 100, DEFAULT_CONFIG.feePercent);
    CONFIG.defaultKeyPriceCoins = clampNum(cfgNumFrom(src, "defaultKeyPriceCoins", DEFAULT_CONFIG.defaultKeyPriceCoins), 0, 1e12, DEFAULT_CONFIG.defaultKeyPriceCoins);
    CONFIG.winnerDisplayMs = clampNum(cfgNumFrom(src, "winnerDisplayMs", DEFAULT_CONFIG.winnerDisplayMs), 500, 60000, DEFAULT_CONFIG.winnerDisplayMs);
    CONFIG.caseIntroMs = clampNum(cfgNumFrom(src, "caseIntroMs", DEFAULT_CONFIG.caseIntroMs), 0, 10000, DEFAULT_CONFIG.caseIntroMs);
    CONFIG.caseSpinPauseMs = clampNum(cfgNumFrom(src, "caseSpinPauseMs", DEFAULT_CONFIG.caseSpinPauseMs), 0, 10000, DEFAULT_CONFIG.caseSpinPauseMs);
    CONFIG.caseSpinMs = clampNum(cfgNumFrom(src, "caseSpinMs", DEFAULT_CONFIG.caseSpinMs), 800, 20000, DEFAULT_CONFIG.caseSpinMs);
    CONFIG.caseSpinItems = clampNum(cfgNumFrom(src, "caseSpinItems", DEFAULT_CONFIG.caseSpinItems), 12, 120, DEFAULT_CONFIG.caseSpinItems);
    CONFIG.caseWinnerIndex = clampNum(cfgNumFrom(src, "caseWinnerIndex", DEFAULT_CONFIG.caseWinnerIndex), 6, 120, DEFAULT_CONFIG.caseWinnerIndex);
    CONFIG.caseKeyImage = cfgStrFrom(src, "caseKeyImage", DEFAULT_CONFIG.caseKeyImage);
    CONFIG.sfxAccept = cfgStrFrom(src, "sfxAccept", DEFAULT_CONFIG.sfxAccept);
    CONFIG.sfxOpen = cfgStrFrom(src, "sfxOpen", DEFAULT_CONFIG.sfxOpen);
    CONFIG.sfxTick = cfgStrFrom(src, "sfxTick", DEFAULT_CONFIG.sfxTick);
    CONFIG.sfxReveal = cfgStrFrom(src, "sfxReveal", DEFAULT_CONFIG.sfxReveal);
    CONFIG.sfxRare = cfgStrFrom(src, "sfxRare", DEFAULT_CONFIG.sfxRare);
    CONFIG.sfxGold = cfgStrFrom(src, "sfxGold", DEFAULT_CONFIG.sfxGold);
    CONFIG.sfxVolume = clampNum(cfgNumFrom(src, "sfxVolume", DEFAULT_CONFIG.sfxVolume), 0, 1, DEFAULT_CONFIG.sfxVolume);
    CONFIG.sfxTickVolume = clampNum(cfgNumFrom(src, "sfxTickVolume", DEFAULT_CONFIG.sfxTickVolume), 0, 1, DEFAULT_CONFIG.sfxTickVolume);

    CONFIG.commandPrefix = cfgStrFrom(src, "commandPrefix", DEFAULT_CONFIG.commandPrefix);
    CONFIG.cmdBuyCase = cfgStrFrom(src, "cmdBuyCase", DEFAULT_CONFIG.cmdBuyCase);
    CONFIG.cmdBuyKey = cfgStrFrom(src, "cmdBuyKey", DEFAULT_CONFIG.cmdBuyKey);
    CONFIG.cmdOpen = cfgStrFrom(src, "cmdOpen", DEFAULT_CONFIG.cmdOpen);
    CONFIG.cmdSell = cfgStrFrom(src, "cmdSell", DEFAULT_CONFIG.cmdSell);
    CONFIG.cmdSellConfirm = cfgStrFrom(src, "cmdSellConfirm", DEFAULT_CONFIG.cmdSellConfirm);

    CONFIG.commitBuyCase = cfgStrFrom(src, "commitBuyCase", DEFAULT_CONFIG.commitBuyCase);
    CONFIG.commitBuyKey = cfgStrFrom(src, "commitBuyKey", DEFAULT_CONFIG.commitBuyKey);
    CONFIG.commitOpen = cfgStrFrom(src, "commitOpen", DEFAULT_CONFIG.commitOpen);
    CONFIG.commitSellStart = cfgStrFrom(src, "commitSellStart", DEFAULT_CONFIG.commitSellStart);
    CONFIG.commitSellConfirm = cfgStrFrom(src, "commitSellConfirm", DEFAULT_CONFIG.commitSellConfirm);

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

    if (!["toast", "console", "both"].includes(CONFIG.debugOutput)) CONFIG.debugOutput = DEFAULT_CONFIG.debugOutput;
    if (!["off", "toast", "chat", "both"].includes(CONFIG.chatReplyMode)) CONFIG.chatReplyMode = DEFAULT_CONFIG.chatReplyMode;

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

  async function primePollingCache() {
    if (pollPrimed) return;
    pollPrimed = true;
    try {
      const eventJson = await safeGetVariable("tcsgo_last_event_json");
      if (eventJson != null && eventJson !== "") {
        lastPolledRaw = String(eventJson);
        debugEmit("[Polling] Primed Last Payload", "info", "debugEventsPoll");
      }
    } catch (err) {
      debugError("[Polling] Prime Failed", err, "debugErrors");
    }
  }

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

    debugEmit(
      `[Router] In | source=${sourceLabel} | type=${type} | ok=${ok} | eventId=${eventId || "(none)"}`,
      ok ? "info" : "warning",
      "debugRouter"
    );

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

  function getEventTimestamp(eventId) {
    const raw = String(eventId || "");
    const match = /^evt_([0-9a-z]+)_/i.exec(raw);
    if (!match) return null;
    const ts = parseInt(match[1], 36);
    return Number.isFinite(ts) ? ts : null;
  }

  function shouldIgnoreOpenResult(payload) {
    const eventId = payload?.eventId || payload?.data?.eventId || "";
    const ts = getEventTimestamp(eventId);
    if (!ts) return false;
    return ts < (BOOT_TS - 1000);
  }

  function handleUnsolicitedEvent(payload) {
    const type = payload.type;
    debugEmit(`[Router] Unsolicited | type=${String(type || "")}`, "info", "debugUnsolicited");

    switch (type) {
      case "open-result":
        if (payload.ok && payload.data?.winner) {
          if (shouldIgnoreOpenResult(payload)) {
            debugEmit("[Router] Ignored Stale Open Result On Boot", "warning", "debugRouter");
            return;
          }
          showRevealOnly(payload.data, payload.username || "Unknown");
        }
        break;

      case "buycase-result":
      case "buykey-result":
        studioToast(payload.ok ? "Purchase Complete" : (payload?.error?.message || "Purchase Failed"), payload.ok ? "success" : "error");
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
  // LOYALTY POINTS - FIXED (Matching ChosenSlots/ChosenSend Pattern)
  // =========================================================================

  /**
   * Get user's current loyalty points balance
   * Matches working pattern from ChosenSlots/ChosenSend
   */
  async function getLoyaltyPoints(username, platform) {
    const u = String(username || "").trim();
    const p = String(platform || "twitch").toLowerCase();
    
    if (!u || !p) {
      debugEmit(`[Points] Get Skipped | Invalid user/platform`, "warning", "debugPoints");
      return 0;
    }

    if (typeof Overlay !== "undefined" && Overlay.getLoyaltyPoints) {
      try {
        const v = await Overlay.getLoyaltyPoints({ username: u, platform: p });
        const n = Number(v);
        const result = Number.isFinite(n) ? n : 0;
        debugEmit(`[Points] Get | user=${u} | platform=${p} | value=${result}`, "success", "debugPoints");
        return result;
      } catch (err) {
        debugError(`[Points] Get Failed | user=${u} | platform=${p}`, err, "debugPoints");
        return 0;
      }
    }
    debugEmit("[Points] Get Skipped (API Missing)", "warning", "debugPoints");
    return 0;
  }

  /**
   * Add points to user (can be negative to deduct)
   * KEY FIX: Uses { value, username, platform } order (value FIRST)
   * This matches the working ChosenSlots/ChosenSend pattern exactly
   */
  async function addLoyaltyPoints(value, username, platform) {
    const v = Number(value) || 0;
    const u = String(username || "").trim();
    const p = String(platform || "twitch").toLowerCase();
    
    if (!u || !p) {
      debugEmit(`[Points] Add Skipped | Invalid user/platform`, "warning", "debugPoints");
      return null;
    }

    if (typeof Overlay !== "undefined" && Overlay.addLoyaltyPoints) {
      try {
        // KEY FIX: Parameter order is { value, username, platform } - value FIRST
        // This matches the working ChosenSlots/ChosenSend/ChosenSpinWheel pattern
        const result = await Overlay.addLoyaltyPoints({ value: v, username: u, platform: p });
        const n = Number(result);
        if (Number.isFinite(n)) {
          debugEmit(`[Points] Add | value=${v} | user=${u} | platform=${p} | newTotal=${n}`, "success", "debugPoints");
          return n;
        }
        debugEmit(`[Points] Add | value=${v} | user=${u} | platform=${p} | ok=true`, "success", "debugPoints");
        return true;
      } catch (err) {
        debugError(`[Points] Add Failed | value=${v} | user=${u} | platform=${p}`, err, "debugPoints");
        return null;
      }
    }
    debugEmit("[Points] Add Skipped (API Missing)", "warning", "debugPoints");
    return null;
  }

  /**
   * Simplified adjustLoyaltyPoints - directly calls addLoyaltyPoints with delta
   * No complex verification loops, no tryOverlayCall wrapper
   * Trusts that if no exception is thrown, the operation succeeded
   */
  async function adjustLoyaltyPoints(a, b, c, d) {
    // Supports Both Call Styles:
    // 1) adjustLoyaltyPoints(username, platform, delta, label?)
    // 2) adjustLoyaltyPoints({ username, platform, delta, label? })

    let username, platform, delta, label, strict;
    strict = false;
    if (a && typeof a === "object") {
      username = a.username;
      platform = a.platform;
      delta = a.delta;
      label = a.label ?? a.reason ?? "";
      strict = !!a.strict;
    } else {
      username = a;
      platform = b;
      delta = c;
      if (d && typeof d === "object") {
        label = d.label ?? d.reason ?? "";
        strict = !!d.strict;
      } else {
        label = d ?? "";
      }
    }

    const u = String(username || "").trim();
    const p = String(platform || "twitch").toLowerCase().trim();

    const n = Number(delta);
    const dlt = Number.isFinite(n) ? Math.trunc(n) : NaN;

    if (!u || !p || !Number.isFinite(dlt)) {
      debugEmit(
        `[Points] Adjust Skipped | user=${u || "(missing)"} | platform=${p || "(missing)"} | delta=${String(delta)}` +
          (label ? ` | label=${label}` : ""),
        "error",
        "debugPoints"
      );
      return null;
    }

    if (dlt === 0) {
      return await getLoyaltyPoints(u, p);
    }

    // Read Before (Silent; Avoid Toast Spam During Internal Polling)
    let before = 0;
    try {
      const v = await Overlay.getLoyaltyPoints({ username: u, platform: p });
      const cur = Number(v);
      before = Number.isFinite(cur) ? cur : 0;
    } catch (_) {
      before = await getLoyaltyPoints(u, p);
    }

    // Apply Delta (Uses Your Wrapper Which Matches Working Overlays)
    const addResult = await addLoyaltyPoints(dlt, u, p);
    if (addResult == null || addResult === false) {
      debugEmit(
        `[Points] Adjust Failed | delta=${dlt} | before=${before}` + (label ? ` | label=${label}` : ""),
        "error",
        "debugPoints"
      );
      return null;
    }

    const addNumberRaw =
      (typeof addResult === "number" || typeof addResult === "string")
        ? Number(addResult)
        : NaN;
    const addNumber = Number.isFinite(addNumberRaw) ? addNumberRaw : null;

    // Poll Briefly For Persistence (Silent)
    let after = before;
    const deadline = Date.now() + (strict ? 4000 : 1500);

    while (Date.now() < deadline) {
      try {
        const v = await Overlay.getLoyaltyPoints({ username: u, platform: p });
        const cur = Number(v);
        if (Number.isFinite(cur)) after = cur;
      } catch (_) {}

      if (after !== before) break;

      await new Promise((r) => setTimeout(r, 200));
    }

    if (after !== before) {
      debugEmit(
        `[Points] Adjust Ok | delta=${dlt} | before=${before} | after=${after}` + (label ? ` | label=${label}` : ""),
        "success",
        "debugPoints"
      );
      return after;
    }

    if (addNumber != null && addNumber !== before) {
      debugEmit(
        `[Points] Adjust Ok | delta=${dlt} | before=${before} | after=${addNumber} | source=add` +
          (label ? ` | label=${label}` : ""),
        "success",
        "debugPoints"
      );
      return addNumber;
    }

    if (strict) {
      debugEmit(
        `[Points] Adjust Failed | delta=${dlt} | before=${before} | after=${after}` +
          ` | addReturn=${addNumber ?? "n/a"} | strict=true` +
          (label ? ` | label=${label}` : ""),
        "error",
        "debugPoints"
      );
      return null;
    }

    // If Still Unchanged, Fall Back To Optimistic Balance (Avoid False Failures)
    const optimistic = before + dlt;
    debugEmit(
      `[Points] Adjust Stale | delta=${dlt} | before=${before} | after=${after}` +
        ` | addReturn=${addNumber ?? "n/a"} | optimistic=${optimistic}` +
        (label ? ` | label=${label}` : ""),
      "warning",
      "debugPoints"
    );
    return optimistic;
  }



  // =========================================================================
  // CHAT SEND
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
        debugEmit(`[ChatSend] Ok | platform=${platform} | msg="${msg.slice(0, 120)}"`, "success", "debugChatSend");
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

    if (!alias) {
      return void sendChatMessage(`@${username} Usage: ${getCmdFull("cmdBuyCase")} <alias> [qty]`, platform);
    }

    const caseInfo = resolveAlias(alias);
    if (!caseInfo) {
      debugEmit(`[BuyCase] Unknown Alias | alias=${alias}`, "warning", "debugBuyCase");
      return void sendChatMessage(`@${username} Unknown Case: ${alias}`, platform);
    }

    const pricePerCase = getCasePrice(caseInfo.caseId);
    const totalCost = pricePerCase * qty;

    const currentPoints = await getLoyaltyPoints(username, platform);
    debugEmit(`[BuyCase] Balance | have=${currentPoints} | need=${totalCost}`, "info", "debugPoints");

    if (currentPoints < totalCost) {
      return void sendChatMessage(
        `@${username} Insufficient Coins! Need ${formatNumber(totalCost)}, Have ${formatNumber(currentPoints)}.`,
        platform
      );
    }

    debugEmit(`[BuyCase] Deduct Start | cost=${totalCost}`, "info", "debugPoints");

    // Use negative value to deduct points (matching working overlay pattern)
    const deducted = await adjustLoyaltyPoints({
      username,
      platform,
      delta: -totalCost,
      label: "buycase",
      strict: true
    });

    if (deducted == null) {
      const msg = "Points Deduction Failed. Please Try Again.";
      debugEmit(`[BuyCase] Deduct Failed | ${msg}`, "error", "debugPoints");
      studioToast(msg, "error");
      return void sendChatMessage(`@${username} ${msg}`, platform);
    }

    debugEmit(`[BuyCase] Deduct Ok | newBalance=${deducted}`, "success", "debugPoints");

    const eventId = generateEventId();
    try {
      await callCommitCommand(CONFIG.commitBuyCase, { eventId, platform, username, alias, qty }, eventId);

      await sendChatMessage(`@${username} Bought ${qty}x ${caseInfo.displayName}! Balance: ${formatNumber(deducted)}`, platform);
      studioToast(`Case Purchased | ${username} | ${qty}x ${caseInfo.displayName}`, "success");
    } catch (errPayload) {
      // Refund On Commit Failure
      await adjustLoyaltyPoints(username, platform, totalCost);

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
      return void sendChatMessage(
        `@${username} Insufficient Coins! Need ${formatNumber(totalCost)}, Have ${formatNumber(currentPoints)}.`,
        platform
      );
    }

    const deducted = await adjustLoyaltyPoints({
      username,
      platform,
      delta: -totalCost,
      label: "buykey",
      strict: true
    });

    if (deducted == null) {
      const msg = "Points Deduction Failed. Please Try Again.";
      debugEmit(`[BuyKey] Deduct Failed | ${msg}`, "error", "debugPoints");
      studioToast(msg, "error");
      return void sendChatMessage(`@${username} ${msg}`, platform);
    }

    const eventId = generateEventId();
    try {
      await callCommitCommand(CONFIG.commitBuyKey, { eventId, platform, username, qty }, eventId);

      await sendChatMessage(`@${username} Bought ${qty}x Key(s)! Balance: ${formatNumber(deducted)}`, platform);
      studioToast(`Keys Purchased | ${username} | ${qty}x`, "success");
    } catch (errPayload) {
      await adjustLoyaltyPoints(username, platform, totalCost);

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
    if (!caseInfo) return void sendChatMessage(`@${username} Unknown Case: ${alias}`, platform);

    const eventId = generateEventId();

    try {
      const result = await callCommitCommand(CONFIG.commitOpen, { eventId, platform, username, alias }, eventId);
      if (result.ok && result.data) {
        enqueueCaseOpening({ resultData: result.data, username, caseInfo });
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
        await adjustLoyaltyPoints(username, platform, d.creditedCoins);
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
  // CASE OPENING UI
  // =========================================================================

  function cacheUi() {
    UI.root = document.getElementById("tcsgo-controller");
    UI.caseOpening = document.getElementById("case-opening");
    if (!UI.caseOpening) return;

    UI.stageIntro = UI.caseOpening.querySelector(".stage-intro");
    UI.stageRoulette = UI.caseOpening.querySelector(".stage-roulette");
    UI.stageReveal = UI.caseOpening.querySelector(".stage-reveal");

    UI.caseIcon = document.getElementById("case-icon");
    UI.caseTitle = document.getElementById("case-title");
    UI.caseKeyCard = document.getElementById("case-key-card");
    UI.caseKeyImage = document.getElementById("case-key-image");

    UI.rouletteStrip = document.getElementById("roulette-strip");
    UI.rouletteWindow = document.getElementById("roulette-window");
    UI.rouletteMarker = document.getElementById("roulette-center-line");
    UI.rouletteCase = document.getElementById("roulette-case");
    UI.rouletteUser = document.getElementById("roulette-user");

    UI.revealImage = document.getElementById("reveal-image");
    UI.revealName = document.getElementById("reveal-name");
    UI.revealStattrak = document.getElementById("reveal-stattrak");
    UI.revealWear = document.getElementById("reveal-wear");
    UI.revealPrice = document.getElementById("reveal-price");
    UI.revealUser = document.getElementById("reveal-user");

    UI.sfxAccept = document.getElementById("sfx-accept");
    UI.sfxOpen = document.getElementById("sfx-open");
    UI.sfxTick = document.getElementById("sfx-tick");
    UI.sfxReveal = document.getElementById("sfx-reveal");
    UI.sfxRare = document.getElementById("sfx-rare");
    UI.sfxGold = document.getElementById("sfx-gold");
  }

  function initAudio() {
    if (!UI.caseOpening) return;

    setAudioSource(UI.sfxAccept, CONFIG.sfxAccept, CONFIG.sfxVolume);
    setAudioSource(UI.sfxOpen, CONFIG.sfxOpen, CONFIG.sfxVolume);
    setAudioSource(UI.sfxTick, CONFIG.sfxTick, CONFIG.sfxTickVolume);
    setAudioSource(UI.sfxReveal, CONFIG.sfxReveal, CONFIG.sfxVolume);
    setAudioSource(UI.sfxRare, CONFIG.sfxRare, CONFIG.sfxVolume);
    setAudioSource(UI.sfxGold, CONFIG.sfxGold, CONFIG.sfxVolume);

    tickPool.length = 0;
    if (UI.sfxTick) tickPool.push(UI.sfxTick);
  }

  function setAudioSource(el, path, volume) {
    if (!el) return;
    const src = resolveAssetPath(path);
    if (src) el.src = src;
    if (Number.isFinite(volume)) el.volume = volume;
  }

  function playAudio(el, volume) {
    if (!el) return;
    if (Number.isFinite(volume)) el.volume = volume;
    try { el.currentTime = 0; } catch (_) {}
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  function playTick() {
    if (!UI.sfxTick) return;

    let audio = tickPool.find((a) => a && a.paused);
    if (!audio && tickPool.length < 6) {
      audio = UI.sfxTick.cloneNode();
      tickPool.push(audio);
      setAudioSource(audio, CONFIG.sfxTick, CONFIG.sfxTickVolume);
    }
    if (audio) playAudio(audio, CONFIG.sfxTickVolume);
  }

  function setOverlayActive(active) {
    if (!UI.caseOpening) return;
    if (active) {
      UI.caseOpening.classList.remove("hidden");
      requestAnimationFrame(() => UI.caseOpening.classList.add("active"));
    } else {
      UI.caseOpening.classList.remove("active");
      setTimeout(() => UI.caseOpening.classList.add("hidden"), 260);
    }
  }

  function setOverlayState(state) {
    if (!UI.caseOpening) return;
    UI.caseOpening.setAttribute("data-state", state);
  }

  function enqueueCaseOpening(job) {
    openQueue.push(job);
    processOpenQueue();
  }

  async function processOpenQueue() {
    if (openBusy) return;
    const job = openQueue.shift();
    if (!job) return;
    openBusy = true;
    try {
      await playCaseOpening(job);
    } catch (err) {
      debugError("[CaseOpen] Failed", err, "debugWinnerCard");
    } finally {
      openBusy = false;
      if (openQueue.length) processOpenQueue();
    }
  }

  async function playCaseOpening(job) {
    if (!UI.caseOpening) return;

    const resultData = job?.resultData || {};
    const username = job?.username || "Unknown";
    const caseInfo = job?.caseInfo || null;
    const winner = resultData?.winner || {};
    const winnerRarity = normalizeRarity(winner.tier || winner.rarity);

    if (UI.caseOpening) UI.caseOpening.classList.remove("no-roulette");
    applyRarityClass(winnerRarity);
    updateReveal(resultData, username);

    const caseJson = caseInfo ? await loadCaseJson(caseInfo) : null;
    if (!caseJson) {
      await showRevealOnly(resultData, username);
      return;
    }

    updateCaseIntro(caseInfo);
    updateRouletteMeta(caseInfo, username);

    const timing = getSpinTiming();
    const spinBuild = buildSpinSequence(caseJson, winner, resultData?.imagePath || "", timing);
    const winnerTile = renderRouletteItems(spinBuild.items);
    setStripX(0);
    setOverlayActive(true);
    setOverlayState("intro");

    playAudio(UI.sfxAccept, CONFIG.sfxVolume);
    if (timing.openDelayMs > 0) await sleep(timing.openDelayMs);
    playAudio(UI.sfxOpen, CONFIG.sfxVolume);
    const introRemainder = Math.max(0, CONFIG.caseIntroMs - timing.openDelayMs);
    if (introRemainder > 0) await sleep(introRemainder);

    setOverlayState("roulette");
    const pauseMs = Math.max(0, Number(CONFIG.caseSpinPauseMs) || 0);
    if (pauseMs > 0) await sleep(pauseMs);

    const metrics = await ensureRouletteMetrics();
    if (!metrics) {
      await showRevealOnly(resultData, username);
      return;
    }

    const fallbackTargetX = metrics.windowWidth / 2 -
      (metrics.paddingLeft + spinBuild.winnerIndex * metrics.tileStep + metrics.tileWidth / 2);
    const computedTargetX = computeTargetX(metrics, winnerTile);
    const targetX = Number.isFinite(computedTargetX) ? computedTargetX : fallbackTargetX;

    await animateRoulette(targetX, timing, metrics.tileStep);

    if (winnerTile) winnerTile.classList.add("is-winner");

    setOverlayState("reveal");
    playRevealSound(winnerRarity);

    await sleep(CONFIG.winnerDisplayMs);

    setOverlayActive(false);
    setOverlayState("idle");
  }

  async function showRevealOnly(resultData, username) {
    if (!UI.caseOpening) return;

    const winner = resultData?.winner || {};
    const winnerRarity = normalizeRarity(winner.tier || winner.rarity);

    if (UI.caseOpening) UI.caseOpening.classList.add("no-roulette");
    if (UI.rouletteStrip) UI.rouletteStrip.innerHTML = "";
    applyRarityClass(winnerRarity);
    updateReveal(resultData, username);

    setOverlayActive(true);
    setOverlayState("reveal");
    playRevealSound(winnerRarity);

    await sleep(CONFIG.winnerDisplayMs);

    setOverlayActive(false);
    setOverlayState("idle");
  }

  function playRevealSound(rarity) {
    const key = String(rarity || "").toLowerCase();
    if (key === "gold" || key === "extraordinary") return playAudio(UI.sfxGold, CONFIG.sfxVolume);
    if (key === "red" || key === "pink" || key === "covert" || key === "classified") return playAudio(UI.sfxRare, CONFIG.sfxVolume);
    return playAudio(UI.sfxReveal, CONFIG.sfxVolume);
  }

  function updateCaseIntro(caseInfo) {
    if (!caseInfo) return;

    const caseId = String(caseInfo.caseId || "");
    const caseName = String(caseInfo.displayName || caseId || "Unknown Case");
    const iconPath = buildCaseIconPath(caseId);
    const iconSrc = iconPath ? resolveAssetPath(iconPath) : "";

    if (UI.caseTitle) UI.caseTitle.textContent = caseName;
    if (UI.caseIcon) {
      UI.caseIcon.src = iconSrc;
      UI.caseIcon.classList.toggle("hidden", !iconSrc);
    }

    const keySrc = CONFIG.caseKeyImage ? resolveAssetPath(CONFIG.caseKeyImage) : "";
    if (UI.caseKeyImage) {
      UI.caseKeyImage.src = keySrc;
      UI.caseKeyImage.classList.toggle("hidden", !keySrc);
    }
    if (UI.caseKeyCard) {
      UI.caseKeyCard.classList.toggle("placeholder", !keySrc);
      UI.caseKeyCard.classList.toggle("hidden", !keySrc);
    }
  }

  function updateRouletteMeta(caseInfo, username) {
    if (UI.rouletteCase) UI.rouletteCase.textContent = caseInfo?.displayName || caseInfo?.caseId || "Case";
    if (UI.rouletteUser) UI.rouletteUser.textContent = username || "Unknown";
  }

  function updateReveal(resultData, username) {
    const winner = resultData?.winner || {};
    const imageSrc = resolveAssetPath(resultData?.imagePath || "");
    const priceText = formatPrice(resultData?.priceSnapshot);

    if (UI.revealImage) {
      UI.revealImage.src = imageSrc;
      UI.revealImage.classList.toggle("hidden", !imageSrc);
    }
    if (UI.revealName) UI.revealName.textContent = winner.displayName || "Unknown Item";
    if (UI.revealStattrak) UI.revealStattrak.classList.toggle("hidden", !winner.statTrak);
    if (UI.revealWear) {
      UI.revealWear.textContent = winner.wear || "";
      UI.revealWear.classList.toggle("hidden", !winner.wear);
    }
    if (UI.revealPrice) {
      UI.revealPrice.textContent = priceText;
      UI.revealPrice.classList.toggle("hidden", !priceText);
    }
    if (UI.revealUser) UI.revealUser.textContent = username || "";
  }

  function applyRarityClass(rarityKey) {
    if (!UI.caseOpening) return;
    const classes = [
      "rarity-blue",
      "rarity-purple",
      "rarity-pink",
      "rarity-red",
      "rarity-gold",
      "rarity-consumer",
      "rarity-industrial",
      "rarity-milspec",
      "rarity-restricted",
      "rarity-classified",
      "rarity-covert",
      "rarity-extraordinary"
    ];
    for (const c of classes) UI.caseOpening.classList.remove(c);
    if (rarityKey) UI.caseOpening.classList.add(`rarity-${rarityKey}`);
  }

  function resolveAssetPath(path) {
    const raw = String(path || "").trim();
    if (!raw) return "";
    if (/^(https?:)?\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("file:")) return raw;

    const cleaned = raw.replace(/\\/g, "/").replace(/^\/+/, "");
    const base = String(CONFIG.baseRawUrl || "").replace(/\/+$/g, "");
    if (!base) return cleaned;
    return `${base}/${cleaned}`;
  }

  function toCaseFolderName(caseId) {
    return String(caseId || "")
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("-");
  }

  function buildCaseIconPath(caseId) {
    const id = String(caseId || "").trim();
    if (!id) return "";
    const folder = toCaseFolderName(id);
    return `Assets/Cases/${folder}/Icons/${id}--icon.png`;
  }

  async function loadCaseJson(caseInfo) {
    const filename = String(caseInfo?.filename || "").trim();
    const caseId = String(caseInfo?.caseId || "").trim();
    if (!filename) return null;

    const cacheKey = filename.toLowerCase();
    if (caseJsonCache.has(cacheKey)) return caseJsonCache.get(cacheKey);

    const storageKey = `tcsgo_case_${caseId || cacheKey}`;
    let data = null;

    const base = String(CONFIG.baseRawUrl || "").replace(/\/+$/g, "");
    if (base) {
      try {
        const url = `${base}/Case-Odds/${filename}`;
        debugEmit(`[CaseData] Fetch | ${url}`, "info", "debugFetch");
        const resp = await fetch(url, { cache: "no-store" });
        if (resp.ok) data = await resp.json();
      } catch (err) {
        debugError("[CaseData] Fetch Failed", err, "debugFetch");
      }
    }

    if (!data) {
      const raw = await safeGetStorage(storageKey);
      if (raw) {
        try { data = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (err) {
          debugError("[CaseData] Storage Parse Failed", err, "debugData");
        }
      }
    }

    if (data) {
      caseJsonCache.set(cacheKey, data);
      try { await safeSetStorage(storageKey, JSON.stringify(data)); } catch (_) {}
    }

    return data;
  }

  function buildCasePool(caseJson) {
    if (!caseJson || !caseJson.case) return [];
    if (Array.isArray(caseJson._pool)) return caseJson._pool;

    const pool = [];
    const tiers = caseJson.case.tiers || {};
    for (const [tier, items] of Object.entries(tiers)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) pool.push({ item, tier });
    }

    const goldItems = caseJson.case.goldPool?.items;
    if (Array.isArray(goldItems)) {
      for (const item of goldItems) pool.push({ item, tier: "gold" });
    }

    caseJson._pool = pool;
    return pool;
  }

  function findCaseItem(caseJson, itemId) {
    if (!itemId) return null;
    const pool = buildCasePool(caseJson);
    return pool.find((entry) => entry.item?.itemId === itemId) || null;
  }

  function pickTier(caseJson) {
    const weights = caseJson?.case?.oddsWeights;
    const entries = weights ? Object.entries(weights) : [];
    if (!entries.length) {
      const tiers = Object.keys(caseJson?.case?.tiers || {});
      return tiers[0] || "blue";
    }

    const total = entries.reduce((sum, [, weight]) => sum + Number(weight || 0), 0);
    if (total <= 0) return entries[0][0];

    let roll = Math.random() * total;
    for (const [tier, weight] of entries) {
      roll -= Number(weight || 0);
      if (roll <= 0) return tier;
    }
    return entries[0][0];
  }

  function pickCaseItem(caseJson) {
    const tier = pickTier(caseJson);
    const pool = tier === "gold"
      ? caseJson?.case?.goldPool?.items
      : caseJson?.case?.tiers?.[tier];

    if (!Array.isArray(pool) || pool.length === 0) {
      const fallbackPool = buildCasePool(caseJson);
      if (!fallbackPool.length) return null;
      const fallback = fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
      return fallback ? { item: fallback.item, tier: fallback.tier } : null;
    }

    let total = 0;
    for (const item of pool) total += Number(item.weights?.base ?? 1);
    let roll = Math.random() * total;
    for (const item of pool) {
      roll -= Number(item.weights?.base ?? 1);
      if (roll <= 0) return { item, tier };
    }
    return { item: pool[0], tier };
  }

  function selectRandomImage(item) {
    if (!item) return "";
    const images = [item.image, ...(item.imageAlternates || [])].filter(Boolean);
    return images.length ? images[Math.floor(Math.random() * images.length)] : "";
  }

  function buildSpinSequence(caseJson, winner, winnerImagePath, timing) {
    const requestedCount = Math.floor(CONFIG.caseSpinItems) || 0;
    const requestedWinnerIndex = Math.floor(CONFIG.caseWinnerIndex) || 0;
    const spinMs = timing
      ? Math.max(0, Number(timing.spinUpMs) + Number(timing.highSpeedMs) + Number(timing.decelMs))
      : Number(CONFIG.caseSpinMs) || 0;
    const minWinnerIndex = Math.max(30, Math.round(spinMs / 120));

    let winnerIndex = Math.max(requestedWinnerIndex, minWinnerIndex);
    let count = Math.max(12, requestedCount, winnerIndex + 6);
    count = Math.min(120, count);
    const maxWinnerIndex = Math.max(6, count - 6);
    winnerIndex = Math.min(Math.max(winnerIndex, 3), maxWinnerIndex);

    const winnerEntry = findCaseItem(caseJson, winner.itemId);
    const winnerTier = winner.tier || winnerEntry?.tier || winner.rarity || "blue";
    const winnerImage = winnerImagePath || selectRandomImage(winnerEntry?.item) || "";

    const items = [];
    for (let i = 0; i < count; i++) {
      if (i === winnerIndex) {
        items.push({
          displayName: winner.displayName || "Unknown Item",
          image: winnerImage,
          tier: winnerTier,
          rarity: winner.rarity,
          isWinner: true
        });
        continue;
      }

      const pick = pickCaseItem(caseJson);
      if (pick && pick.item) {
        items.push({
          displayName: pick.item.displayName || "Unknown Item",
          image: selectRandomImage(pick.item),
          tier: pick.tier,
          rarity: pick.item.rarity
        });
      } else {
        items.push({
          displayName: winner.displayName || "Unknown Item",
          image: winnerImage,
          tier: winnerTier,
          rarity: winner.rarity
        });
      }
    }

    return { items, winnerIndex };
  }

  function renderRouletteItems(items) {
    if (!UI.rouletteStrip) return null;

    UI.rouletteStrip.innerHTML = "";
    let winnerTile = null;

    for (const item of items) {
      const rarityKey = normalizeRarity(item.tier || item.rarity);
      const tile = document.createElement("div");
      tile.className = `roulette-item rarity-${rarityKey}`;
      if (item.isWinner) winnerTile = tile;

      const img = document.createElement("img");
      img.src = resolveAssetPath(item.image || "");
      img.alt = item.displayName || "Item";
      img.draggable = false;

      const name = document.createElement("div");
      name.className = "item-name";
      name.textContent = item.displayName || "Unknown Item";

      tile.appendChild(img);
      tile.appendChild(name);
      UI.rouletteStrip.appendChild(tile);
    }

    return winnerTile;
  }

  function measureRoulette() {
    if (!UI.rouletteStrip || !UI.rouletteWindow) return null;
    const tile = UI.rouletteStrip.querySelector(".roulette-item");
    if (!tile) return null;

    const tileWidth = tile.getBoundingClientRect().width;
    const windowWidth = UI.rouletteWindow.getBoundingClientRect().width;
    const style = getComputedStyle(UI.rouletteStrip);
    const gap = parseFloat(style.columnGap || style.gap || "0") || 0;
    const paddingLeft = parseFloat(style.paddingLeft || "0") || 0;

    return {
      tileWidth,
      tileStep: tileWidth + gap,
      windowWidth,
      paddingLeft
    };
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function ensureRouletteMetrics(attempts = 5) {
    for (let i = 0; i < attempts; i++) {
      await nextFrame();
      const metrics = measureRoulette();
      if (metrics && metrics.tileWidth > 0 && metrics.windowWidth > 0) return metrics;
    }
    return null;
  }

  function computeTargetX(metrics, winnerTile) {
    if (!metrics || !UI.rouletteWindow || !winnerTile) return null;
    const windowRect = UI.rouletteWindow.getBoundingClientRect();
    const tileRect = winnerTile.getBoundingClientRect();
    if (!windowRect.width || !tileRect.width) return null;

    const markerRect = UI.rouletteMarker ? UI.rouletteMarker.getBoundingClientRect() : null;
    const markerX = markerRect
      ? markerRect.left + markerRect.width * 0.5
      : windowRect.left + windowRect.width * 0.5;

    const currentCenter = tileRect.left + tileRect.width * 0.5;
    return stripX + (markerX - currentCenter);
  }

  function setStripX(x) {
    stripX = x;
    if (UI.rouletteStrip) UI.rouletteStrip.style.transform = `translateX(${x}px)`;
  }

  function getSpinTiming() {
    const baseTotal = Math.max(1, SPIN_TIMING_TOTAL_MS);
    const requestedTotal = Math.max(800, Math.min(20000, Number(CONFIG.caseSpinMs) || DEFAULT_CONFIG.caseSpinMs));
    const scale = requestedTotal / baseTotal;

    const spinUpMs = Math.max(0, Math.round(SPIN_TIMING_DEFAULT.spinUpMs * scale));
    const highSpeedMs = Math.max(0, Math.round(SPIN_TIMING_DEFAULT.highSpeedMs * scale));
    const decelMs = Math.max(0, Math.round(SPIN_TIMING_DEFAULT.decelMs * scale));
    const finalLockMs = Math.max(0, Math.round(SPIN_TIMING_DEFAULT.finalLockMs * scale));
    const tickCurve = SPIN_TIMING_DEFAULT.tickCurve.map((point) => ({
      t: Math.max(0, Math.round(point.t * scale)),
      interval: Math.max(30, Math.round(point.interval * scale))
    }));

    const introBase = Math.max(1, DEFAULT_CONFIG.caseIntroMs);
    const openDelayScaled = Math.round(SPIN_TIMING_DEFAULT.openSfxDelayMs * (CONFIG.caseIntroMs / introBase));
    const openDelayMs = Math.max(0, Math.min(CONFIG.caseIntroMs, openDelayScaled));

    return {
      spinUpMs,
      highSpeedMs,
      decelMs,
      finalLockMs,
      overshootPx: SPIN_TIMING_DEFAULT.overshootPx,
      cruiseBoost: SPIN_TIMING_DEFAULT.cruiseBoost,
      tickCurve,
      tickStartMs: 0,
      tickDurationMs: Math.max(0, highSpeedMs + decelMs),
      openDelayMs
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeInQuad(t) {
    return t * t;
  }

  function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function tickIntervalAt(curve, elapsedMs) {
    if (!Array.isArray(curve) || curve.length === 0) return 120;
    if (elapsedMs <= curve[0].t) return curve[0].interval;
    for (let i = 1; i < curve.length; i++) {
      const prev = curve[i - 1];
      const next = curve[i];
      if (elapsedMs <= next.t) {
        const span = Math.max(1, next.t - prev.t);
        const t = (elapsedMs - prev.t) / span;
        return Math.max(30, Math.round(lerp(prev.interval, next.interval, t)));
      }
    }
    return curve[curve.length - 1].interval;
  }

  function spinProgress(elapsed, spinUpMs, highSpeedMs, decelMs, accelPortion, cruisePortion, decelPortion) {
    if (spinUpMs > 0 && elapsed <= spinUpMs) {
      const t = elapsed / spinUpMs;
      return easeInQuad(t) * accelPortion;
    }
    if (highSpeedMs > 0 && elapsed <= spinUpMs + highSpeedMs) {
      const t = (elapsed - spinUpMs) / highSpeedMs;
      return accelPortion + t * cruisePortion;
    }
    if (decelMs > 0) {
      const t = Math.min(1, (elapsed - spinUpMs - highSpeedMs) / decelMs);
      return accelPortion + cruisePortion + easeOutQuad(t) * decelPortion;
    }
    return 1;
  }

  function animateRoulette(targetX, timing, tileStep) {
    const spinTiming = timing || getSpinTiming();
    const startX = stripX;
    const distance = targetX - startX;
    const direction = distance === 0 ? 1 : Math.sign(distance);
    const overshootPx = Number(spinTiming.overshootPx) || 0;
    const overshootX = distance === 0 ? targetX : targetX + direction * overshootPx;

    const mainMs = Math.max(1, spinTiming.spinUpMs + spinTiming.highSpeedMs + spinTiming.decelMs);
    const lockMs = Math.max(0, spinTiming.finalLockMs);

    const accelDist = 0.5 * spinTiming.spinUpMs;
    const cruiseBoost = Math.max(1, Number(spinTiming.cruiseBoost) || 1);
    const cruiseDist = spinTiming.highSpeedMs * cruiseBoost;
    const decelDist = 0.5 * spinTiming.decelMs;
    const distDenom = Math.max(1, accelDist + cruiseDist + decelDist);
    const accelPortion = accelDist / distDenom;
    const cruisePortion = cruiseDist / distDenom;
    const decelPortion = decelDist / distDenom;

    const step = Number(tileStep) || 0;
    const tickStartMs = Math.max(0, Number(spinTiming.tickStartMs) || 0);
    const tickDurationMs = Math.max(0, Number(spinTiming.tickDurationMs) || 0);
    const tickEndMs = tickStartMs + tickDurationMs;
    const tickCurve = spinTiming.tickCurve || [];
    let lastTickIndex = 0;
    let nextTickAt = tickStartMs;
    const totalMs = mainMs + Math.max(0, lockMs);

    function maybeTick(elapsed, x) {
      if (!step || tickDurationMs <= 0) return;

      const distanceTravelled = Math.abs(x - startX);
      const tickIndex = Math.floor(distanceTravelled / step);

      if (elapsed < tickStartMs) {
        lastTickIndex = tickIndex;
        return;
      }
      if (elapsed > tickEndMs) return;
      if (tickIndex <= lastTickIndex) return;
      if (elapsed < nextTickAt) return;

      playTick();
      lastTickIndex = tickIndex;
      const interval = tickIntervalAt(tickCurve, elapsed - tickStartMs);
      nextTickAt = elapsed + interval;
    }

    return new Promise((resolve) => {
      const start = performance.now();
      function frame(now) {
        const elapsed = now - start;
        if (elapsed < mainMs) {
          const progress = spinProgress(
            elapsed,
            spinTiming.spinUpMs,
            spinTiming.highSpeedMs,
            spinTiming.decelMs,
            accelPortion,
            cruisePortion,
            decelPortion
          );
          const x = lerp(startX, overshootX, progress);
          setStripX(x);
          maybeTick(elapsed, x);
          requestAnimationFrame(frame);
          return;
        }

        if (lockMs > 0 && elapsed < totalMs) {
          const t = Math.min(1, (elapsed - mainMs) / lockMs);
          setStripX(lerp(overshootX, targetX, easeOutCubic(t)));
          requestAnimationFrame(frame);
          return;
        }

        setStripX(targetX);
        resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatPrice(priceSnapshot) {
    if (!priceSnapshot || typeof priceSnapshot !== "object") return "";
    const coins = Number(priceSnapshot.chosenCoins);
    const cad = Number(priceSnapshot.cad);
    const parts = [];
    if (Number.isFinite(coins)) parts.push(`${formatNumber(coins)} Coins`);
    if (Number.isFinite(cad)) parts.push(`$${cad.toFixed(2)} CAD`);
    return parts.join(" | ");
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
