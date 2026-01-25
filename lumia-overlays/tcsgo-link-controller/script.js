(() => {
  "use strict";

  const CONFIG = {
    codeId: "tcsgo-link-controller",
    commandLinkStart: "tcsgo-link-start",
    commandUnlinkStart: "tcsgo-unlink-start",
    commandCoins: "tcsgo-coins",
    tiktokCommandName: "tiktok_chat_send",
    commandPrefix: "!",
    ackTimeoutMs: 3000,
    chatAsSelf: false,
    allowUnlink: false,
    allowCoins: false,
    debug: false
  };

  const pending = new Map();
  const seenMessages = new Map();
  const SEEN_TTL_MS = 15000;

  function loadConfig() {
    if (window.overlayConfigs) {
      Object.assign(CONFIG, window.overlayConfigs);
    }
  }

  function logDebug(message) {
    if (!CONFIG.debug) return;
    try { console.log(`[LinkController] ${message}`); } catch (_) {}
  }

  function logWarn(message) {
    if (!CONFIG.debug) return;
    try { console.warn(`[LinkController] ${message}`); } catch (_) {}
  }

  function normalizePlatform(raw) {
    const s = String(raw || "").toLowerCase();
    if (s.includes("tiktok")) return "tiktok";
    if (s.includes("youtube")) return "youtube";
    if (s.includes("twitch")) return "twitch";
    if (s.includes("kick")) return "kick";
    return "";
  }

  function makeEventId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `evt_${ts}_${rand}`;
  }

  function cleanupSeen() {
    const now = Date.now();
    for (const [key, ts] of seenMessages.entries()) {
      if (now - ts > SEEN_TTL_MS) {
        seenMessages.delete(key);
      }
    }
  }

  function shouldIgnoreChat(chatData) {
    if (!chatData) return true;
    if (chatData.userLevels && chatData.userLevels.isSelf) return true;
    const id = String(chatData.id || "");
    if (id) {
      if (seenMessages.has(id)) return true;
      seenMessages.set(id, Date.now());
      cleanupSeen();
    }
    return false;
  }

  function parseCommand(message) {
    const prefix = String(CONFIG.commandPrefix || "!");
    const msg = String(message || "").trim();
    if (!msg.startsWith(prefix)) return null;
    const content = msg.slice(prefix.length).trim();
    if (!content) return null;
    const parts = content.split(/\s+/);
    const command = String(parts[0] || "").toLowerCase();
    const args = parts.slice(1);
    return { command, args };
  }

  function sanitizeTarget(raw) {
    return String(raw || "").trim().replace(/^@+/, "");
  }

  function sendToTikTok(message) {
    const cmd = String(CONFIG.tiktokCommandName || "").trim();
    if (!cmd) return false;
    if (typeof Overlay === "undefined" || !Overlay.callCommand) return false;
    try {
      Overlay.callCommand(cmd, { message });
      return true;
    } catch (err) {
      logWarn(`[ChatSend] TikTok send failed: ${err}`);
      return false;
    }
  }

  async function sendChatMessage(message, platformRaw) {
    const msg = String(message || "").trim();
    if (!msg) return;
    const platform = normalizePlatform(platformRaw);
    if (!platform) return;

    if (platform === "tiktok") {
      const ok = sendToTikTok(msg);
      if (!ok) logWarn(`[ChatSend] TikTok send failed | msg="${msg.slice(0, 80)}"`);
      return;
    }

    if (typeof Overlay !== "undefined" && Overlay.chatbot) {
      try {
        await Overlay.chatbot({ message: msg, platform, chatAsSelf: CONFIG.chatAsSelf });
        return;
      } catch (err) {
        logWarn(`[ChatSend] chatbot failed: ${err}`);
      }
    }
  }

  function callCommandAck(commandName, params, eventId) {
    return new Promise((resolve, reject) => {
      const cmd = String(commandName || "").trim();
      if (!cmd) return reject({ code: "NO_CMD", message: "Command name missing." });
      if (typeof Overlay === "undefined" || !Overlay.callCommand) {
        return reject({ code: "NO_OVERLAY", message: "Overlay API unavailable." });
      }

      const timeoutId = setTimeout(() => {
        if (!pending.has(eventId)) return;
        pending.delete(eventId);
        reject({ code: "TIMEOUT", message: "Command timed out." });
      }, Number(CONFIG.ackTimeoutMs) || 3000);

      pending.set(eventId, { resolve, reject, timeoutId });

      try {
        Overlay.callCommand(cmd, params);
      } catch (err) {
        clearTimeout(timeoutId);
        pending.delete(eventId);
        reject({ code: "CALL_FAILED", message: "Overlay.callCommand failed." });
      }
    });
  }

  function handleOverlayContent(eventData) {
    if (!eventData) return;
    if (!eventData.codeId || String(eventData.codeId) !== String(CONFIG.codeId)) return;

    let payload;
    try {
      payload = typeof eventData.content === "string" ? JSON.parse(eventData.content) : eventData.content;
    } catch (_) {
      return;
    }

    const eventId = payload?.eventId;
    if (!eventId || !pending.has(eventId)) return;

    const pendingEntry = pending.get(eventId);
    clearTimeout(pendingEntry.timeoutId);
    pending.delete(eventId);
    pendingEntry.resolve(payload);
  }

  async function handleLink(chatData, args) {
    const username = chatData?.username || chatData?.displayname || "viewer";
    const platform = normalizePlatform(chatData?.origin || chatData?.platform || chatData?.site || "");
    if (!platform) return;

    const target = sanitizeTarget(args[0]);
    if (!target) {
      await sendChatMessage(`@${username} Usage: ${CONFIG.commandPrefix}link <DiscordUsername>`, platform);
      return;
    }

    const eventId = makeEventId();
    try {
      const payload = await callCommandAck(
        CONFIG.commandLinkStart,
        { eventId, platform, username, targetDiscordUsername: target, codeId: CONFIG.codeId },
        eventId
      );
      const msg = payload?.messageToSend || `@${username} Link request processed.`;
      await sendChatMessage(msg, platform);
    } catch (err) {
      await sendChatMessage(`@${username} Link request failed. Try again.`, platform);
    }
  }

  async function handleUnlink(chatData, args) {
    const username = chatData?.username || chatData?.displayname || "viewer";
    const platform = normalizePlatform(chatData?.origin || chatData?.platform || chatData?.site || "");
    if (!platform) return;

    if (!CONFIG.allowUnlink) {
      await sendChatMessage(`@${username} Unlink is not enabled yet.`, platform);
      return;
    }

    const target = sanitizeTarget(args[0]);
    if (!target) {
      await sendChatMessage(`@${username} Usage: ${CONFIG.commandPrefix}unlink <DiscordUsername>`, platform);
      return;
    }

    const eventId = makeEventId();
    try {
      const payload = await callCommandAck(
        CONFIG.commandUnlinkStart,
        { eventId, platform, username, targetDiscordUsername: target, codeId: CONFIG.codeId },
        eventId
      );
      const msg = payload?.messageToSend || `@${username} Unlink request processed.`;
      await sendChatMessage(msg, platform);
    } catch (err) {
      await sendChatMessage(`@${username} Unlink request failed. Try again.`, platform);
    }
  }

  async function handleCoins(chatData) {
    const username = chatData?.username || chatData?.displayname || "viewer";
    const platform = normalizePlatform(chatData?.origin || chatData?.platform || chatData?.site || "");
    if (!platform) return;
    if (!CONFIG.allowCoins) {
      await sendChatMessage(`@${username} Coins lookup is not enabled.`, platform);
      return;
    }

    const eventId = makeEventId();
    try {
      const payload = await callCommandAck(
        CONFIG.commandCoins,
        { eventId, platform, username, codeId: CONFIG.codeId },
        eventId
      );
      const msg = payload?.messageToSend || `@${username} Coins lookup failed.`;
      await sendChatMessage(msg, platform);
    } catch (err) {
      await sendChatMessage(`@${username} Coins lookup failed.`, platform);
    }
  }

  function handleChat(chatData) {
    if (shouldIgnoreChat(chatData)) return;
    const parsed = parseCommand(chatData?.message);
    if (!parsed) return;

    const command = parsed.command;
    const args = parsed.args;

    logDebug(`[Chat] cmd=${command} args=${JSON.stringify(args)}`);

    if (command === "link") {
      handleLink(chatData, args);
      return;
    }
    if (command === "unlink") {
      handleUnlink(chatData, args);
      return;
    }
    if (command === "coins") {
      handleCoins(chatData);
    }
  }

  function init() {
    loadConfig();
    if (typeof Overlay !== "undefined" && Overlay.on) {
      Overlay.on("chat", handleChat);
      Overlay.on("overlaycontent", handleOverlayContent);
      logDebug("Listeners registered.");
    } else {
      logWarn("Overlay API unavailable.");
    }
  }

  init();
})();
