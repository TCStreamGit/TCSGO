# discord-remove-loyalty

Removes loyalty points for a user via Lumia REST. Intended for Discord bot calls (REST chat-command), not viewer chat.

## Command name and aliases

- Command name: `discord-remove-loyalty`
- Aliases: none

## REST usage (recommended)

Send a `chat-command` with `value: "discord-remove-loyalty"` and provide inputs in `params.extraSettings`.

Example payload:
```json
{
  "type": "chat-command",
  "params": {
    "value": "discord-remove-loyalty",
    "extraSettings": {
      "dcUsername": "TanChosenLive",
      "dcPlatform": "twitch",
      "value": 250,
      "restToken": "YOUR_LUMIA_TOKEN",
      "restBaseUrl": "http://127.0.0.1:39231"
    }
  }
}
```

## Parameters

Inputs can be passed via command variables or `params.extraSettings` (JSON or object). The first non-empty value wins.

Username fields:
- `dcUsername`, `username`, `userName`, `login`, `handle`, `displayName`

Platform fields:
- `dcPlatform`, `platform`, `site`, `origin`
- Normalized to: `twitch`, `youtube`, `tiktok`, `kick`, `facebook`, `trovo`

Value fields:
- `value`, `points`, `coins`, `amount`, `delta`
- Removed as a negative value.

REST auth fields:
- `restToken`, `token`, `lumiaToken`, `authToken`
- If omitted, uses `LUMIA_REST_TOKEN` env var when available.

REST base URL fields:
- `restBaseUrl`, `baseUrl`
- If omitted, uses `LUMIA_REST_BASE_URL` env var when available.
- Default: `http://127.0.0.1:39231`

## Behavior

- Normalizes platform and username.
- Builds a REST request to Lumia `/api/add-loyalty-points` with a negative value.
- Logs a JSON result via `log()`/`addLog()`.

## Output

Success example:
```json
{
  "ok": true,
  "platform": "twitch",
  "username": "tanchosenlive",
  "value": -250
}
```

Error example:
```json
{
  "ok": false,
  "error": { "code": "DISCORD_REMOVE_LOYALTY_ERROR", "message": "Missing Value." }
}
```

## Related files

- `lumia-commands/discord-remove-loyalty.js`
- `lumia-commands/discord-add-loyalty.js`
