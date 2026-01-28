async function () {
  "use strict";

  /*
   * Description: Start Or Confirm Sell-All For Discord Requests.
   * Command Name: discord-sell-all
   * Aliases: None
   * Usage Examples:
   * - discord-sell-all
   */
  const LOG_ENABLED = false;
  const DEFAULT_REST_BASE_URL = "http://127.0.0.1:39231";

  const COMMIT_SELL_ALL_START = "tcsgo-commit-sell-all-start";
  const COMMIT_SELL_ALL_CONFIRM = "tcsgo-commit-sell-all-confirm";

  const ACK_VAR = "tcsgo_last_event_json";
  const ACK_POLL_MS = 200;
  const MAX_WAIT_MS = 12000;

  // Prevent double-crediting when Discord retries the same token.
  const STORE_KEY = "tcsgo_discord_sellall_dedupe_v1";
  const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

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

  function isTemplated(value) {
    const v = String(value ?? "").trim();
    return !!v && v.startsWith("{{") && v.endsWith("}}");
  }

  function pickFirstNonEmpty(...values) {
    for (const value of values) {
      const v = String(value ?? "").trim();
      if (!v) continue;
      if (isTemplated(v)) continue;
      return v;
    }
    return "";
  }

  function pickFirstNonEmptyRaw(...values) {
    for (const value of values) {
      const v = String(value ?? "").trim();
      if (!v) continue;
      return v;
    }
    return "";
  }

  function safeJsonParse(raw) {
    try { return JSON.parse(String(raw)); } catch (_) { return null; }
  }

  function makeEventId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `evt_${ts}_${rand}`;
  }

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeStore(store) {
    const shaped = store && typeof store === "object" ? store : {};
    shaped.confirmByToken =
      shaped.confirmByToken && typeof shaped.confirmByToken === "object"
        ? shaped.confirmByToken
        : {};

    const now = Date.now();
    for (const [key, entry] of Object.entries(shaped.confirmByToken)) {
      const ts = Number(entry?.ts || 0);
      if (!Number.isFinite(ts) || (now - ts) > DEDUPE_WINDOW_MS) {
        delete shaped.confirmByToken[key];
      }
    }

    return shaped;
  }

  async function readStore() {
    return normalizeStore(await getStoreItem(STORE_KEY));
  }

  async function writeStore(store) {
    await setStore({ name: STORE_KEY, value: store });
  }

  function makeTokenKey(platform, username, token) {
    return `${lowerTrim(platform)}:${lowerTrim(username)}:${lowerTrim(token)}`;
  }

  function ackMatches(payload, expectedType, eventId) {
    if (!payload || typeof payload !== "object") return false;
    if (lowerTrim(payload.type) !== lowerTrim(expectedType)) return false;
    const payloadEventId = String(payload.eventId || payload.data?.eventId || "");
    return !!payloadEventId && payloadEventId === eventId;
  }

  async function pollAck(expectedType, eventId) {
    const deadline = Date.now() + MAX_WAIT_MS;

    while (Date.now() < deadline) {
      const raw = await safeGetVar(ACK_VAR);
      if (raw) {
        const payload = safeJsonParse(raw);
        if (ackMatches(payload, expectedType, eventId)) return payload;
      }
      await sleep(ACK_POLL_MS);
    }

    return null;
  }

  async function dispatchCommit(commandName, variableValues) {
    await callCommand({ name: commandName, variableValues });
  }

  async function addLoyaltyPointsViaRest({ baseUrl, token, username, platform, value }) {
    const urlBase = String(baseUrl || "").trim().replace(/\/+$/g, "");
    const url = token
      ? `${urlBase}/api/send?token=${encodeURIComponent(token)}`
      : `${urlBase}/api/send`;

    const payload = {
      type: "add-loyalty-points",
      params: { value, username, platform }
    };

    const response = await request({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload
    });

    const status = Number(response?.status || response?.statusCode || 0);
    const ok = response?.ok === true || response?.success === true || status === 200;

    if (!ok) {
      throw new Error(`add-loyalty-points failed | status=${status} | resp=${JSON.stringify(response ?? {})}`);
    }

    return { ok: true, response, status };
  }

  const extraSettingsRaw =
    (await safeGetVar("extraSettings")) ??
    (await safeGetVar("extra_settings")) ??
    "";

  let extraSettings = null;
  if (extraSettingsRaw && typeof extraSettingsRaw === "object") {
    extraSettings = extraSettingsRaw;
  } else if (typeof extraSettingsRaw === "string" && extraSettingsRaw.trim()) {
    try { extraSettings = JSON.parse(extraSettingsRaw); } catch (_) { extraSettings = null; }
  }
  if (!extraSettings || typeof extraSettings !== "object") extraSettings = null;

  const platformRaw = pickFirstNonEmpty(
    await safeGetVar("restDcPlatform"),
    await safeGetVar("restPlatform"),
    await safeGetVar("rest_platform"),
    extraSettings?.dcPlatform,
    extraSettings?.dc_platform,
    extraSettings?.platform,
    extraSettings?.site,
    extraSettings?.origin,
    extraSettings?.customPlatform,
    extraSettings?.custom_platform,
    extraSettings?.coinsPlatform,
    await safeGetVar("dcPlatform"),
    await safeGetVar("dc_platform"),
    await safeGetVar("customPlatform"),
    await safeGetVar("custom_platform"),
    await safeGetVar("coinsPlatform"),
    await safeGetVar("platform"),
    await safeGetVar("site"),
    await safeGetVar("origin"),
    "{{platform}}",
    "{{site}}",
    "{{origin}}",
    "{{dcPlatform}}",
    "{{dc_platform}}",
    "{{customPlatform}}",
    "{{custom_platform}}",
    "{{coinsPlatform}}",
    ""
  );
  const platform = normSite(platformRaw);

  const username = pickFirstNonEmpty(
    await safeGetVar("restDcUsername"),
    await safeGetVar("restUsername"),
    await safeGetVar("rest_username"),
    extraSettings?.dcUsername,
    extraSettings?.dc_username,
    extraSettings?.username,
    extraSettings?.login,
    extraSettings?.user,
    extraSettings?.userName,
    extraSettings?.handle,
    extraSettings?.displayname,
    extraSettings?.displayName,
    extraSettings?.coinsUsername,
    extraSettings?.customVariable,
    await safeGetVar("dcUsername"),
    await safeGetVar("dc_username"),
    await safeGetVar("customVariable"),
    await safeGetVar("coinsUsername"),
    await safeGetVar("username"),
    await safeGetVar("login"),
    await safeGetVar("user"),
    await safeGetVar("userName"),
    await safeGetVar("handle"),
    await safeGetVar("displayname"),
    await safeGetVar("displayName"),
    "{{username}}",
    "{{login}}",
    "{{user}}",
    "{{userName}}",
    "{{handle}}",
    "{{displayname}}",
    "{{displayName}}",
    ""
  );

  const tokenRaw = pickFirstNonEmpty(
    extraSettings?.token,
    extraSettings?.sellAllToken,
    extraSettings?.sellAllCode,
    extraSettings?.sell_all_token,
    extraSettings?.sell_all_code,
    extraSettings?.code,
    extraSettings?.confirmCode,
    await safeGetVar("token"),
    await safeGetVar("sellAllToken"),
    await safeGetVar("sellAllCode"),
    await safeGetVar("code"),
    ""
  );
  const sellAllToken = String(tokenRaw || "").trim();

  const isConfirm = !!sellAllToken;

  let restToken = pickFirstNonEmptyRaw(
    extraSettings?.restToken,
    extraSettings?.token,
    extraSettings?.lumiaToken,
    extraSettings?.authToken,
    await safeGetVar("restToken"),
    await safeGetVar("rest_token"),
    await safeGetVar("lumiaToken"),
    await safeGetVar("token"),
    (typeof process !== "undefined" && process && process.env && process.env.LUMIA_REST_TOKEN)
      ? String(process.env.LUMIA_REST_TOKEN).trim()
      : "",
    ""
  );

  // If the caller used "token" for the sell-all code, do not treat it as the REST token.
  if (isConfirm && restToken && lowerTrim(restToken) === lowerTrim(sellAllToken)) {
    logDbg(`[DISCORD-SELLALL:${RUN_ID}] restToken matched sellAllToken; ignoring as REST token.`);
    restToken = "";
  }

  const restBaseUrl = pickFirstNonEmptyRaw(
    extraSettings?.restBaseUrl,
    extraSettings?.baseUrl,
    extraSettings?.base_url,
    await safeGetVar("restBaseUrl"),
    await safeGetVar("rest_base_url"),
    await safeGetVar("baseUrl"),
    await safeGetVar("base_url"),
    (typeof process !== "undefined" && process && process.env && process.env.LUMIA_REST_BASE_URL)
      ? String(process.env.LUMIA_REST_BASE_URL).trim()
      : "",
    DEFAULT_REST_BASE_URL
  );

  const expectedType = isConfirm ? "sell-all-confirm-result" : "sell-all-start-result";
  const commitCommand = isConfirm ? COMMIT_SELL_ALL_CONFIRM : COMMIT_SELL_ALL_START;

  logExec(`[DISCORD-SELLALL:${RUN_ID}] Start | confirm=${isConfirm} | platform=${platform} | username=${username}`);

  try {
    if (!platform) throw new Error("Missing Platform.");
    if (!username) {
      throw new Error(
        "Missing Username. Provide extraSettings { dcUsername, dcPlatform }. " +
        "Example: { dcUsername: \"TanChosenLive\", dcPlatform: \"twitch\" }"
      );
    }

    const store = await readStore();
    const tokenKeyInitial = isConfirm ? makeTokenKey(platform, username, sellAllToken) : "";

    // If we already processed this token, do not run the commit again.
    if (isConfirm && tokenKeyInitial) {
      const prior = store.confirmByToken[tokenKeyInitial];
      if (prior && prior.restApplied) {
        finish({
          ok: true,
          deduped: true,
          platform,
          username,
          token: sellAllToken,
          data: prior,
          message: `Sell-all already confirmed for token ${sellAllToken}.`,
          ts: new Date().toISOString(),
          runId: RUN_ID
        });
        return;
      }

      // If prior exists but rest failed earlier, try to apply the stored credit now.
      if (prior && !prior.restApplied && Number(prior.creditedCoins) > 0) {
        try {
          const restRes = await addLoyaltyPointsViaRest({
            baseUrl: restBaseUrl,
            token: restToken,
            username,
            platform,
            value: Number(prior.creditedCoins)
          });

          prior.restApplied = true;
          prior.restAppliedAt = new Date().toISOString();
          prior.restResponse = restRes.response;
          store.confirmByToken[tokenKeyInitial] = prior;
          await writeStore(store);

          finish({
            ok: true,
            recoveredFromStore: true,
            platform,
            username,
            token: sellAllToken,
            data: prior,
            message: `Recovered sell-all credit for token ${sellAllToken}.`,
            ts: new Date().toISOString(),
            runId: RUN_ID
          });
          return;
        } catch (restErr) {
          const restMsg = restErr?.message ? String(restErr.message) : String(restErr);
          logExec(`[DISCORD-SELLALL:${RUN_ID}] Store recovery failed | ${restMsg}`);
          // Continue into normal confirm flow.
        }
      }
    }

    const eventId = makeEventId();
    const variableValues = isConfirm
      ? { eventId, platform, username, token: sellAllToken }
      : { eventId, platform, username };

    await dispatchCommit(commitCommand, variableValues);

    const ack = await pollAck(expectedType, eventId);

    if (!ack) {
      finish({
        ok: false,
        platform,
        username,
        token: sellAllToken || null,
        error: { code: "ACK_TIMEOUT", message: `Timed out waiting for ${expectedType}.` },
        ts: new Date().toISOString(),
        runId: RUN_ID
      });
      return;
    }

    if (!ack.ok) {
      const errMsg = ack?.error?.message || "Sell-all failed.";
      finish({
        ok: false,
        platform,
        username,
        token: sellAllToken || null,
        error: {
          code: ack?.error?.code || "SELL_ALL_ERROR",
          message: errMsg,
          details: ack?.error?.details || null
        },
        ack,
        ts: new Date().toISOString(),
        runId: RUN_ID
      });
      return;
    }

    const data = ack.data || {};

    // START FLOW: just return the confirmation token and preview.
    if (!isConfirm) {
      const token = String(data.token || "");
      const eligibleCount = Number(data.eligibleCount || 0);
      const creditAmount = Number(data.creditAmount || 0);
      const fee = Number(data.marketFeePercent || 0);
      const expiresIn = Number(data.expiresInSeconds || 60);

      finish({
        ok: true,
        platform,
        username,
        token,
        data,
        message:
          `Sell-all ready: ${eligibleCount} item(s) for +${creditAmount} coins (${fee}% fee). ` +
          `Confirm with !sell all ${token} within ${expiresIn}s.`,
        ack,
        ts: new Date().toISOString(),
        runId: RUN_ID
      });
      return;
    }

    // CONFIRM FLOW: sync loyalty points via REST.
    const creditedCoins = Math.max(0, Math.trunc(Number(data.creditedCoins || 0)));
    const soldCount = Math.max(0, Math.trunc(Number(data.soldCount || 0)));
    const tokenKey = makeTokenKey(platform, username, sellAllToken);

    const storeConfirmEntry = {
      ts: Date.now(),
      platform,
      username,
      token: sellAllToken,
      eventId,
      soldCount,
      creditedCoins,
      restApplied: false,
      restAppliedAt: null,
      restResponse: null
    };

    const storeAfter = await readStore();
    storeAfter.confirmByToken[tokenKey] = storeConfirmEntry;
    await writeStore(storeAfter);

    let restResult = null;
    let restError = null;

    if (creditedCoins > 0) {
      try {
        restResult = await addLoyaltyPointsViaRest({
          baseUrl: restBaseUrl,
          token: restToken,
          username,
          platform,
          value: creditedCoins
        });

        const storeFinal = await readStore();
        const entry = storeFinal.confirmByToken[tokenKey] || storeConfirmEntry;
        entry.restApplied = true;
        entry.restAppliedAt = new Date().toISOString();
        entry.restResponse = restResult.response;
        storeFinal.confirmByToken[tokenKey] = entry;
        await writeStore(storeFinal);
      } catch (err) {
        const msg = err?.message ? String(err.message) : String(err);
        restError = { code: "REST_ADD_LOYALTY_FAILED", message: msg };
        logExec(`[DISCORD-SELLALL:${RUN_ID}] REST add-loyalty-points failed | ${msg}`);
      }
    }

    const restApplied = !!restResult?.ok;
    const message =
      restApplied
        ? `Sold ${soldCount} item(s) for +${creditedCoins} coins.`
        : `Sold ${soldCount} item(s) for +${creditedCoins} coins, but loyalty sync failed.`;

    finish({
      ok: restApplied || creditedCoins === 0,
      platform,
      username,
      token: sellAllToken,
      data: {
        ...data,
        loyaltySync: {
          attempted: creditedCoins > 0,
          ok: restApplied,
          error: restError
        }
      },
      message,
      ack,
      ts: new Date().toISOString(),
      runId: RUN_ID
    });
  } catch (err) {
    const message = err?.message ? String(err.message) : String(err);
    logExec(`[DISCORD-SELLALL:${RUN_ID}] Error | ${message}`);

    finish({
      ok: false,
      error: { code: "DISCORD_SELL_ALL_ERROR", message },
      ts: new Date().toISOString(),
      runId: RUN_ID
    });
  }
}
