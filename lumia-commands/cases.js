async function () {
  "use strict";

  /*
   * Description: List Available Cases With Paging And Optional Filters.
   * Command Name: !cases
   * Aliases: !cases, !Cases, !CASES, !case list, !Case List, !CASE LIST, !case List, !Case list, !caselist, !CASELIST, !CaseList, !case-list, !Case-List, !CASE-LIST, !case_list, !Case_List, !CASE_LIST, !tcsgo cases, !Tcsgo Cases, !TCSGO CASES, !tcsgo Cases, !Tcsgo cases, !tcsgocases, !TCSGOCASES, !TcsgoCases, !tcsgo-cases, !Tcsgo-Cases, !TCSGO-CASES, !tcsgo_cases, !Tcsgo_Cases, !TCSGO_CASES
   * Usage Examples:
   * - !cases
   * - !cases 2
   */
  const LOG_ENABLED = false;
  const PAGE_SIZE = 5;
  const TIKTOK_SEND_COMMAND = "tiktok_chat_send";
  const TCSGO_BASE = "A:\\Development\\Version Control\\Github\\TCSGO";
  const CASE_ALIASES_PATH = "data\\case-aliases.json";
  const CASE_MANUAL_ALIASES_PATH = "data\\case-aliases.manual.json";

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
    if (!sent) logMsg(`[CASES] Reply failed | site=${site} | msg="${msg.slice(0, 120)}"`);
  }

  const rawMessage = cleanTemplateValue(await getVariable("message") ?? "{{message}}");
  const args = parseArgs(rawMessage);
  const pageFromMsg = parsePage(args[0]);

  const pageVar = await getVariable("page");
  const pageFromVar = parsePage(pageVar);

  let page = Number.isFinite(pageFromVar) ? pageFromVar : 1;
  let tag = "";

  if (!Number.isFinite(pageFromVar)) {
    if (Number.isFinite(pageFromMsg)) {
      page = pageFromMsg;
      tag = args.slice(1).join(" ").trim();
    } else {
      tag = args.join(" ").trim();
    }
  } else {
    const tagVar = await getVariable("tag");
    tag = String(tagVar ?? "").trim();
    if (!tag && !Number.isFinite(pageFromMsg)) tag = args.join(" ").trim();
  }

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

  const aliasesPath = joinPath(TCSGO_BASE, CASE_ALIASES_PATH);
  const manualAliasesPath = joinPath(TCSGO_BASE, CASE_MANUAL_ALIASES_PATH);

  const aliasDb = await safeReadJson(aliasesPath, null);
  if (!aliasDb || !aliasDb.cases) {
    await reply(site, `@${usernameRaw} Case list unavailable. Ask the streamer to rebuild aliases.`);
    done();
    return;
  }

  const manualDb = await safeReadJson(manualAliasesPath, null);
  const manualAliasByCase = new Map();
  if (manualDb && manualDb.aliases) {
    for (const [alias, info] of Object.entries(manualDb.aliases)) {
      const caseId = String(info?.caseId ?? "").trim();
      if (!caseId) continue;
      const existing = manualAliasByCase.get(caseId);
      if (!existing || alias.length < existing.length) manualAliasByCase.set(caseId, alias);
    }
  }

  const rows = Object.values(aliasDb.cases).map((c) => {
    const caseId = String(c.caseId || "").trim();
    const displayName = String(c.displayName || caseId || "Unknown Case");
    const caseType = String(c.caseType || "other");
    const alias = manualAliasByCase.get(caseId) || "";
    const requiresKey = !!c.requiresKey;
    return { caseId, displayName, caseType, alias, requiresKey };
  });

  const tagNorm = lowerTrim(tag);
  const filtered = tagNorm
    ? rows.filter((row) =>
      lowerTrim(row.caseType) === tagNorm ||
      lowerTrim(row.displayName).includes(tagNorm) ||
      lowerTrim(row.caseId).includes(tagNorm) ||
      lowerTrim(row.alias).includes(tagNorm)
    )
    : rows;

  filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));

  if (!filtered.length) {
    const tagMsg = tagNorm ? ` for "${tag}"` : "";
    await reply(site, `@${usernameRaw} No cases found${tagMsg}.`);
    done();
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (!Number.isFinite(page) || page < 1 || page > totalPages) {
    await reply(site, `@${usernameRaw} Invalid page. Use !cases 1-${totalPages}.`);
    done();
    return;
  }

  const start = (page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  const tagLabel = tagNorm ? ` tag="${tag}"` : "";

  const header = `@${usernameRaw} Cases (page ${page}/${totalPages}${tagLabel})`;
  const bullets = formatBullets(pageItems.map((row) => {
    const keyText = row.alias ? `alias: ${row.alias}` : `id: ${row.caseId}`;
    const keyReq = row.requiresKey ? "key" : "no-key";
    return `${row.displayName} [${row.caseType}] (${keyText}, ${keyReq})`;
  }));

  logMsg(`[CASES] page=${page}/${totalPages} | tag=${tagNorm || "none"} | user=${usernameRaw}`);

  await reply(site, header);
  await reply(site, bullets);
  done();
}
