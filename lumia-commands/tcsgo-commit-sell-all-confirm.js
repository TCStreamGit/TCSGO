async function () {
  "use strict";

  /*
   * Description: Confirm A Sell-All Request And Credit Coins.
   * Command Name: tcsgo-commit-sell-all-confirm
   * Aliases: None
   * Usage Examples:
   * - tcsgo-commit-sell-all-confirm
   */
  const LOG_ENABLED = false;

  const CODE_ID = "tcsgo-controller";
  const ACK_VAR = "tcsgo_last_event_json";
  const ACK_VAR_SELL_ALL_CONFIRM = "tcsgo_last_sell_all_confirm_json";
  const DEFAULT_LINKING_BASE = "Z:\\home\\nike\\Streaming\\TCSGO\\Linking";
  const DISCORD_INDEX_FILE = "discord-user-index.json";
  const USER_LINKS_FILE = "user-links.json";
  const LINK_PLATFORM_PREFERENCE = ["twitch", "youtube", "tiktok"];

  // ============================================================
  // HELPERS
  // ============================================================

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
    if (s.includes("discord")) return "discord";
    return s || "twitch";
  }

  async function resolveBasePath() {
    const base = String(await getVariable("TCSGO_BASE") ?? "").trim();
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

  function mkError(code, message, details = null) {
    const err = { code: String(code || "ERROR"), message: String(message || "Unknown Error") };
    if (details && typeof details === "object") err.details = details;
    return err;
  }

  function uuidv4() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function createEmptyInventories() {
    return {
      schemaVersion: "2.0-inventories",
      lastModified: new Date().toISOString(),
      inventoriesById: {},
      identityIndex: {},
      discordIndex: {}
    };
  }

  function ensureInventoryRoot(inv) {
    if (!inv || typeof inv !== "object") return createEmptyInventories();
    const schema = String(inv.schemaVersion ?? "");
    if (schema && !schema.startsWith("2.0-")) {
      throw mkError("SCHEMA_MISMATCH", "Inventories schema 2.0 required.");
    }
    if (!inv.schemaVersion) inv.schemaVersion = "2.0-inventories";
    if (!inv.inventoriesById || typeof inv.inventoriesById !== "object") inv.inventoriesById = {};
    if (!inv.identityIndex || typeof inv.identityIndex !== "object") inv.identityIndex = {};
    if (!inv.discordIndex || typeof inv.discordIndex !== "object") inv.discordIndex = {};
    return inv;
  }

  function getOrCreateInventory(inv, identityKey, nowIso) {
    let inventoryId = inv.identityIndex[identityKey];
    if (!inventoryId) {
      inventoryId = `inv_${uuidv4()}`;
      inv.identityIndex[identityKey] = inventoryId;
      inv.inventoriesById[inventoryId] = {
        createdAt: nowIso,
        cases: {},
        keys: {},
        items: [],
        identities: [identityKey],
        mergedInto: null,
        mergedAt: null
      };
    }
    const inventory = inv.inventoriesById[inventoryId];
    if (!inventory || typeof inventory !== "object") {
      throw mkError("INVENTORY_NOT_FOUND", `Missing inventory ${inventoryId}`);
    }
    if (!Array.isArray(inventory.identities)) inventory.identities = [];
    if (!inventory.identities.includes(identityKey)) inventory.identities.push(identityKey);
    if (!inventory.cases || typeof inventory.cases !== "object") inventory.cases = {};
    if (!inventory.keys || typeof inventory.keys !== "object") inventory.keys = {};
    if (!Array.isArray(inventory.items)) inventory.items = [];
    return { inventory, inventoryId };
  }

  function dualAck(payloadObj) {
    const payloadStr = JSON.stringify(payloadObj);

    try {
      overlaySendCustomContent({ codeId: CODE_ID, content: payloadStr });
    } catch (_) {}

    try {
      setVariable({ name: ACK_VAR, value: payloadStr, global: true });
    } catch (_) {}

    try {
      setVariable({ name: ACK_VAR_SELL_ALL_CONFIRM, value: payloadStr, global: true });
    } catch (_) {}

    logMsg(payloadStr);
  }

  async function safeReadJson(fullPath, fallbackObj = null) {
    try {
      const raw = await readFile(fullPath);
      const txt = String(raw ?? "");
      return JSON.parse(txt);
    } catch (e) {
      return fallbackObj;
    }
  }

  function cleanUser(raw) {
    return lowerTrim(raw).replace(/^@+/, "");
  }

  async function resolveLinkingBase() {
    const base = String(await getVariable("TCSGO_LINKING_BASE") ?? "").trim();
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

    if (!requestedUsername) {
      return {
        requestedPlatform,
        requestedUsername,
        effectivePlatform: requestedPlatform,
        effectiveUsername: requestedUsername,
        linkedFromDiscord: false,
        linkStatus: "missing-username"
      };
    }

    if (requestedPlatform !== "discord") {
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
      logMsg(`[SELLALLCONFIRM] Discord link resolve failed | ${err?.message || err}`);
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

  function checkLock(lu) {
    const r = Math.max(0, new Date(lu).getTime() - Date.now());
    return { locked: r > 0, remainingMs: r, remainingFormatted: formatDuration(r) };
  }

  function formatDuration(ms) {
    if (ms <= 0) return "0s";
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  function calculateCreditAfterFee(coins, fee) {
    return Math.floor(coins * (1 - fee / 100));
  }

  // ============================================================
  // INPUTS (From Overlay.callCommand)
  // ============================================================

  const t0 = Date.now();

  const basePath = await resolveBasePath();
  const eventId = String(await getVariable("eventId") ?? "");
  const platform = normSite(String(await getVariable("platform") ?? "twitch"));
  const username = String(await getVariable("username") ?? "");
  const token = String(await getVariable("token") ?? "");

  const identity = await resolveLinkedIdentity(platform, username);
  const effectivePlatform = identity.effectivePlatform;
  const effectiveUsername = identity.effectiveUsername;

  if (identity.linkedFromDiscord) {
    logMsg(
      `[SELLALLCONFIRM] Discord mapped | ${identity.requestedPlatform}:${identity.requestedUsername} -> ` +
      `${effectivePlatform}:${effectiveUsername}`
    );
  }

  logMsg(
    `[SELLALLCONFIRM] Vars | eventId=${eventId} | platform=${platform} | username=${username} | ` +
    `effective=${effectivePlatform}:${effectiveUsername} | token=${token}`
  );

  let result;

  try {
    if (!eventId) throw mkError("MISSING_EVENT_ID", "Missing eventId.");
    if (!username) throw mkError("MISSING_USERNAME", "Missing username.");
    if (!token) throw mkError("MISSING_TOKEN", "Missing token.");

    const invPath = joinPath(basePath, "data/inventories.json");
    const pricesPath = joinPath(basePath, "data/prices.json");

    const [inv, prices] = await Promise.all([
      safeReadJson(invPath, null),
      safeReadJson(pricesPath, null)
    ]);

    if (!inv || !prices) {
      throw mkError(
        basePath ? "LOAD_ERROR" : "MISSING_TCSGO_BASE",
        basePath ? "Failed to load data." : "Missing TCSGO_BASE or working directory is not TCSGO."
      );
    }

    const invRoot = ensureInventoryRoot(inv);
    const identityKey = `${lowerTrim(effectivePlatform)}:${lowerTrim(effectiveUsername)}`;
    const nowIso = new Date().toISOString();
    const { inventory: user } = getOrCreateInventory(invRoot, identityKey, nowIso);

    if (!user.pendingSell) throw mkError("NO_PENDING_SELL", "No pending sell.");

    const pending = user.pendingSell;

    if (lowerTrim(pending.token) !== lowerTrim(token)) {
      throw mkError("INVALID_TOKEN", "Invalid token.");
    }

    if (Date.now() >= new Date(pending.expiresAt).getTime()) {
      user.pendingSell = null;
      invRoot.lastModified = new Date().toISOString();
      await safeWriteJson(invPath, invRoot);
      throw mkError("TOKEN_EXPIRED", "Token expired.");
    }

    if (pending.mode !== "all") {
      throw mkError("PENDING_MODE_MISMATCH", "Pending sell is not sell-all.");
    }

    if (!Array.isArray(user.items)) user.items = [];

    const fee = prices?.marketFeePercent || pending.feePercent || 10;
    const pendingOids = Array.isArray(pending.oids) ? pending.oids.map((o) => String(o || "")) : [];
    if (pendingOids.length === 0) {
      user.pendingSell = null;
      invRoot.lastModified = new Date().toISOString();
      await safeWriteJson(invPath, invRoot);
      throw mkError("NO_PENDING_ITEMS", "No items were pending for sell-all.");
    }

    const pendingSet = new Set(pendingOids.map((o) => lowerTrim(o)).filter(Boolean));

    let matchedCount = 0;
    let soldCount = 0;
    let lockedCount = 0;
    let unsellableCount = 0;
    let creditedCoins = 0;

    const remainingItems = [];

    for (const item of user.items) {
      const oid = lowerTrim(item?.oid);
      if (!oid || !pendingSet.has(oid)) {
        remainingItems.push(item);
        continue;
      }

      matchedCount += 1;

      const lockStatus = checkLock(item?.lockedUntil);
      if (lockStatus.locked) {
        lockedCount += 1;
        remainingItems.push(item);
        continue;
      }

      const coinsRaw = Number(item?.priceSnapshot?.chosenCoins ?? 0);
      const coins = Number.isFinite(coinsRaw) ? coinsRaw : 0;
      const credit = calculateCreditAfterFee(coins, fee);
      if (!Number.isFinite(credit) || credit <= 0) {
        unsellableCount += 1;
        remainingItems.push(item);
        continue;
      }

      soldCount += 1;
      creditedCoins += credit;
      // Item is sold: do not push into remainingItems.
    }

    const missingCount = Math.max(0, pendingSet.size - matchedCount);

    if (soldCount <= 0) {
      user.pendingSell = null;
      invRoot.lastModified = new Date().toISOString();
      await safeWriteJson(invPath, invRoot);
      throw mkError(
        "NO_ITEMS_SOLD",
        "No eligible items were sold.",
        { matchedCount, lockedCount, unsellableCount, missingCount }
      );
    }

    user.items = remainingItems;
    user.chosenCoins = (user.chosenCoins || 0) + creditedCoins;
    user.pendingSell = null;
    invRoot.lastModified = new Date().toISOString();

    await safeWriteJson(invPath, invRoot);

    result = {
      type: "sell-all-confirm-result",
      ok: true,
      eventId,
      platform,
      username,
      data: {
        eventId,
        effectivePlatform,
        effectiveUsername,
        linkedFromDiscord: identity.linkedFromDiscord,
        soldCount,
        lockedCount,
        unsellableCount,
        missingCount,
        creditedCoins,
        newBalance: user.chosenCoins,
        marketFeePercent: fee,
        timings: { msTotal: Date.now() - t0 }
      }
    };

    const successSuffix = identity.linkedFromDiscord
      ? ` | effective=${effectivePlatform}:${effectiveUsername}`
      : "";
    logMsg(`[SELLALLCONFIRM] Success | ${username} sold=${soldCount} | +${creditedCoins}${successSuffix}`);

  } catch (err) {
    const e =
      (err && typeof err === "object" && ("code" in err) && ("message" in err))
        ? err
        : mkError("SELL_ALL_CONFIRM_FAILED", (err && err.message) ? err.message : String(err));

    result = {
      type: "sell-all-confirm-result",
      ok: false,
      eventId,
      platform,
      username,
      error: {
        code: e.code,
        message: e.message,
        details: e.details || null
      },
      data: {
        eventId,
        timings: { msTotal: Date.now() - t0 }
      }
    };

    logMsg(`[SELLALLCONFIRM] Error | ${e.code} | ${e.message}`);
  }

  dualAck(result);
}
