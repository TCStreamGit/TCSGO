# discord-sell-all

Starts or confirms the sell-all flow for a linked viewer account via Lumia REST. Intended for Discord bot calls (REST chat-command), not viewer chat.

## Command name and aliases

- Command name: `discord-sell-all`
- Aliases: none

## REST usage (recommended)

Send a `chat-command` with `value: "discord-sell-all"` and provide inputs in `params.extraSettings`.

Start sell-all (no token):
```json
{
  "type": "chat-command",
  "params": {
    "value": "discord-sell-all",
    "extraSettings": {
      "dcUsername": "TanChosenLive",
      "dcPlatform": "twitch",
      "restToken": "YOUR_LUMIA_TOKEN",
      "restBaseUrl": "http://127.0.0.1:39231"
    }
  }
}
```

Confirm sell-all (with token/code):
```json
{
  "type": "chat-command",
  "params": {
    "value": "discord-sell-all",
    "extraSettings": {
      "dcUsername": "TanChosenLive",
      "dcPlatform": "twitch",
      "token": "sellall_ab12cd34",
      "restToken": "YOUR_LUMIA_TOKEN",
      "restBaseUrl": "http://127.0.0.1:39231"
    }
  }
}
```

## Parameters

Inputs can be passed via command variables or `params.extraSettings`.

- `dcUsername` / `username` / `login` / `handle` / `displayName`
  - Required. First non-empty value is used.
- `dcPlatform` / `platform` / `site` / `origin`
  - Required. Normalized to: `twitch`, `youtube`, `tiktok`, `kick`, `facebook`, `trovo`.
- `token` / `sellAllToken` / `sellAllCode` / `code`
  - Optional. If provided, the command confirms sell-all. If omitted, it starts sell-all and returns a token.
- `restToken` / `lumiaToken` / `authToken`
  - Optional. If omitted, uses `LUMIA_REST_TOKEN` env var when available.
- `restBaseUrl` / `baseUrl`
  - Optional. If omitted, uses `LUMIA_REST_BASE_URL` env var when available.
  - Default: `http://127.0.0.1:39231`

## Behavior (summary)

Start flow:
1. Dispatch `tcsgo-commit-sell-all-start` with a unique `eventId`.
2. Poll for ACK (`sell-all-start-result`).
3. Return a token + preview message.

Confirm flow:
1. Dispatch `tcsgo-commit-sell-all-confirm` with the token.
2. Poll for ACK (`sell-all-confirm-result`).
3. Credit coins via REST `add-loyalty-points`.
4. Persist a local recovery record so the credit can be retried if REST fails.

## Output

The command returns structured JSON via `done(...)`.

Start success example:
```json
{
  "ok": true,
  "platform": "twitch",
  "username": "tanchosenlive",
  "token": "sellall_ab12cd34",
  "message": "Sell-all ready: 12 item(s) for +54000 coins (10% fee). Confirm with !sell all sellall_ab12cd34 within 60s."
}
```

Confirm success example:
```json
{
  "ok": true,
  "platform": "twitch",
  "username": "tanchosenlive",
  "token": "sellall_ab12cd34",
  "data": {
    "soldCount": 12,
    "creditedCoins": 54000,
    "loyaltySync": { "attempted": true, "ok": true }
  }
}
```

## Related files

- `lumia-commands/discord-sell-all.js`
- `lumia-commands/tcsgo-commit-sell-all-start.js`
- `lumia-commands/tcsgo-commit-sell-all-confirm.js`
- `lumia-overlays/case-opening/script.js`
