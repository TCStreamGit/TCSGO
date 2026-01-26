# discord-remove-loyalty

Removes loyalty points for a user via Lumia REST. Intended for Discord bot calls (REST chat-command), not viewer chat.

## Command name and aliases
- Command name: `discord-remove-loyalty`
- Aliases: none

## Chat usage (viewer)
Not intended for viewer chat. If you *do* bind it, the chat trigger would be:
- `!discord-remove-loyalty`

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
Inputs can be passed via command variables or `params.extraSettings`.

- `dcUsername` / `username` / `userName` / `login` / `handle` / `displayName`
  - string, required
  - First non-empty value is used.
- `dcPlatform` / `platform` / `site` / `origin`
  - string, required
  - Normalized to one of: `twitch`, `youtube`, `tiktok`, `kick`, `facebook`, `trovo`.
- `value` / `points` / `coins` / `amount` / `delta`
  - number, required
  - Removed as a negative value.
- `restToken` / `token` / `lumiaToken` / `authToken`
  - string, optional
  - If omitted, uses `LUMIA_REST_TOKEN` env var when available.
- `restBaseUrl` / `baseUrl`
  - string, optional
  - Default: `http://127.0.0.1:39231`

## Output
Writes a JSON result to Lumia logs via `log()`/`addLog()`.

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

