# sell-confirm

Primary chat handler for confirming single-item sells without requiring the overlay.

## Command name and aliases

- Command name: `sell-confirm`
- Primary chat command: `!sell-confirm`
- Aliases: `!sellconfirm`, `!sell confirm`, `!sell-confirm`

## Chat usage (with `!`)

- `!sell-confirm sell_xxxxx`

## Parameters

- `token` (required)
  - Token returned by `!sell`.

## How input is parsed

- Reads `message` and `rawMessage`, then extracts the command and args.
- Dedupes duplicate triggers by `messageId` when available.
- Uses a per-command queue to serialize confirmations.

## Behavior (step-by-step)

1. Validate the confirm token.
2. Dispatch `tcsgo-commit-sell-confirm` with a unique `eventId`.
3. Poll ACK (`tcsgo_last_sell_confirm_json`, fallback `tcsgo_last_event_json`).
4. On success, credit coins via REST `add-loyalty-points`.
5. Reply with the final result or error message.

## ACK variables

- Primary: `tcsgo_last_sell_confirm_json`
- Fallback: `tcsgo_last_event_json`

## Discord linking behavior

For Discord requests, the command resolves the linked stream identity:
- Reads from `discord-user-index.json` and `user-links.json`.
- Applies inventory and coin changes to the linked identity.

## Dependencies and data sources

- Command script: `lumia-commands/sell-confirm.js`
- Commit command: `lumia-commands/tcsgo-commit-sell-confirm.js`
- Linking: `discord-user-index.json`, `user-links.json`
- Overlay handshake var: `tcsgo_last_chat_handled_v1`

## Common error cases

- Missing or expired token.
- Pending sell not found or item no longer eligible.
- ACK timeout or commit failure.

## Related files

- `lumia-commands/docs/sell/README.md`
- `lumia-commands/docs/tcsgo-commit-sell-all-start/README.md`
