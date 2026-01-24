async function () {
  "use strict";

  const LOG_ENABLED = true;
  const COMMAND_PREFIX = "!";
  const PAGE_SIZE = 5;
  const TIKTOK_SEND_COMMAND = "tiktok_chat_send";

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

  function parseArgs(message) {
    const msg = String(message ?? "").trim();
    if (!msg) return [];
    const parts = msg.split(/\s+/);
    return parts.length > 1 ? parts.slice(1) : [];
  }

  function formatBullets(lines) {
    return lines.map((line) => `- ${line}`).join(" | ");
  }

  function parsePage(value) {
    const n = parseInt(String(value ?? "").trim(), 10);
    return Number.isFinite(n) ? n : NaN;
  }

  async function reply(site, message) {
    const msg = String(message ?? "").trim();
    if (!msg) return;
    if (site === "tiktok") {
      try { callCommand({ name: TIKTOK_SEND_COMMAND, variableValues: { message: msg } }); return; } catch (_) {}
    }
    try { chatbot({ message: msg, platform: site, site }); } catch (_) {}
  }

  const rawMessage = cleanTemplateValue(await getVariable("message") ?? "{{message}}");
  const args = parseArgs(rawMessage);

  const pageVar = await getVariable("page");
  const pageFromVar = parsePage(pageVar);
  const pageFromMsg = parsePage(args[0]);
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

  const commands = [
    { usage: `${COMMAND_PREFIX}help [page]`, desc: "Show command list (5 per page)." },
    { usage: `${COMMAND_PREFIX}cases [page] [tag]`, desc: "List available cases (paged, optional filter)." },
    { usage: `${COMMAND_PREFIX}inventory [page]`, desc: "List your owned items (paged)." },
    { usage: `${COMMAND_PREFIX}checkprice [oid|itemId]`, desc: "Check item value and source case." },
    { usage: `${COMMAND_PREFIX}buycase <alias> [qty]`, desc: "Buy cases with coins." },
    { usage: `${COMMAND_PREFIX}buykey [qty]`, desc: "Buy keys with coins." },
    { usage: `${COMMAND_PREFIX}open <alias>`, desc: "Open a case you own." },
    { usage: `${COMMAND_PREFIX}sell <oid>`, desc: "Start selling an item." },
    { usage: `${COMMAND_PREFIX}sellconfirm <token>`, desc: "Confirm a sale token." }
  ];

  const totalPages = Math.max(1, Math.ceil(commands.length / PAGE_SIZE));
  if (!Number.isFinite(page) || page < 1 || page > totalPages) {
    await reply(site, `@${usernameRaw} Invalid page. Use ${COMMAND_PREFIX}help 1-${totalPages}.`);
    done();
    return;
  }

  const start = (page - 1) * PAGE_SIZE;
  const pageItems = commands.slice(start, start + PAGE_SIZE);
  const header = `@${usernameRaw} Commands (page ${page}/${totalPages})`;
  const bullets = formatBullets(pageItems.map((cmd) => `${cmd.usage} - ${cmd.desc}`));

  logMsg(`[HELP] page=${page}/${totalPages} | user=${usernameRaw} | site=${site}`);

  await reply(site, header);
  await reply(site, bullets);
  done();
}
