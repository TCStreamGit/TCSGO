async function () {
  "use strict";

  /*
   * Description: List A Viewer's Inventory With Paging And Lock Status.
   * Command Name: !inventory
   * Aliases: !inventory, !Inventory, !INVENTORY, !inv, !Inv, !INV, !tcsgo inventory, !Tcsgo Inventory, !TCSGO INVENTORY, !tcsgo Inventory, !Tcsgo inventory, !tcsgoinventory, !TCSGOINVENTORY, !TcsgoInventory, !tcsgo-inventory, !Tcsgo-Inventory, !TCSGO-INVENTORY, !tcsgo_inventory, !Tcsgo_Inventory, !TCSGO_INVENTORY
   * Usage Examples:
   * - !inventory
   * - !inventory 2
   */
  const LOG_ENABLED = false;
  const PAGE_SIZE = 5;
  const TIKTOK_SEND_COMMAND = "tiktok_chat_send";
  const TCSGO_BASE = "A:\\Development\\Version Control\\Github\\TCSGO";
  const INVENTORIES_PATH = "data\\inventories.json";

  function logMsg(message) {
    if (!LOG_ENABLED) return;
    try { log(message); } catch (_) {}
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
    return s || "twitch";
  }

  function cleanTemplateValue(raw) {
    const v = String(raw ?? "").trim();
    if (!v) return "";
    if (v.startsWith("{{") && v.endsWith("}}")) return "";
    return v;
  }

  function joinPath(base, rel) {
    const b = String(base ?? "").replace(/[\\/]+$/g, "");
    const r = String(rel ?? "").replace(/^[\\/]+/g, "");
    return `${b}\\${r}`.replace(/\//g, "\\");
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

  function parseArgs(message) {
    const msg = String(message ?? "").trim();
    if (!msg) return [];
    const parts = msg.split(/\s+/);
    return parts.length > 1 ? parts.slice(1) : [];
  }

  function parsePage(value) {
    const n = parseInt(String(value ?? "").trim(), 10);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatBullets(lines) {
    return lines.map((line) => `- ${line}`).join(" | ");
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "0s";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  function lockLabel(lockedUntil) {
    if (!lockedUntil) return "lock unknown";
    const untilMs = new Date(lockedUntil).getTime();
    if (!Number.isFinite(untilMs)) return "lock unknown";
    const remaining = Math.max(0, untilMs - Date.now());
    if (remaining <= 0) return "unlocked";
    return `locked ${formatDuration(remaining)}`;
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
    if (!sent) logMsg(`[INVENTORY] Reply failed | site=${site} | msg="${msg.slice(0, 120)}"`);
  }

  const rawMessage = cleanTemplateValue(await getVariable("message") ?? "{{message}}");
  const args = parseArgs(rawMessage);
  const pageFromMsg = parsePage(args[0]);

  const pageVar = await getVariable("page");
  const pageFromVar = parsePage(pageVar);
  const page = Number.isFinite(pageFromVar) ? pageFromVar
    : (Number.isFinite(pageFromMsg) ? pageFromMsg : 1);

  const siteRaw =
    (await getVariable("site")) ||
    (await getVariable("platform")) ||
    (await getVariable("origin")) ||
    "{{site}}";
  const site = normSite(siteRaw);

  const usernameRaw =
    cleanTemplateValue(await getVariable("displayname")) ||
    cleanTemplateValue(await getVariable("displayName")) ||
    cleanTemplateValue(await getVariable("username")) ||
    cleanTemplateValue(await getVariable("user")) ||
    "viewer";

  const inventoriesPath = joinPath(TCSGO_BASE, INVENTORIES_PATH);
  const inv = await safeReadJson(inventoriesPath, null);
  if (!inv || !inv.users) {
    await reply(site, `@${usernameRaw} Inventory data unavailable.`);
    done();
    return;
  }

  const userKey = `${lowerTrim(usernameRaw)}:${lowerTrim(site)}`;
  const user = inv.users[userKey];
  const items = Array.isArray(user?.items) ? user.items.slice() : [];

  if (!items.length) {
    await reply(site, `@${usernameRaw} No items in your inventory yet.`);
    done();
    return;
  }

  items.sort((a, b) => {
    const at = new Date(a.acquiredAt || 0).getTime();
    const bt = new Date(b.acquiredAt || 0).getTime();
    return bt - at;
  });

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (!Number.isFinite(page) || page < 1 || page > totalPages) {
    await reply(site, `@${usernameRaw} Invalid page. Use !inventory 1-${totalPages}.`);
    done();
    return;
  }

  const start = (page - 1) * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);

  const header = `@${usernameRaw} Inventory (page ${page}/${totalPages}, items ${items.length})`;
  const bullets = formatBullets(pageItems.map((item) => {
    const name = String(item.displayName || item.itemId || "Unknown Item");
    const variant = item.variant && item.variant !== "None" ? ` ${item.variant}` : "";
    const st = item.statTrak ? " StatTrak" : "";
    const wear = item.wear ? ` (${item.wear})` : "";
    const lock = lockLabel(item.lockedUntil);
    return `oid: ${item.oid} | ${name}${variant}${st}${wear} | ${lock}`;
  }));

  logMsg(`[INVENTORY] page=${page}/${totalPages} | items=${items.length} | user=${usernameRaw}`);

  await reply(site, header);
  await reply(site, bullets);
  done();
}
