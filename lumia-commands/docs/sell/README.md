# sell

Primary chat handler for selling items, including sell-all, without requiring the overlay.

## Command name and aliases

- Command name: `sell`
- Primary chat command: `!sell`
- Aliases: `!sell-item`, `!sell item`, `!sell-all`, `!sell all`

## Chat usage (with `!`)

- Single item start: `!sell oid_abc123`
- Single item start by name/id: `!sell ak-47-redline`
- Sell all start: `!sell all`
- Sell all confirm: `!sell all sellall_xxxxx`
- Single item confirm (separate command): `!sell-confirm <token>`

## Parameters

- Single item: `oid|itemId|itemName`
- Sell all: `all [token]`

## How input is parsed

- Reads `message` and `rawMessage`, then extracts the command and args.
- Dedupes duplicate triggers by `messageId` when available.
- Falls back to a short raw-message dedupe window when `messageId` is missing.
- Uses a per-command queue to serialize sell actions.

## Behavior (step-by-step)

Single item flow:
1. Resolve target item by `oid`, `itemId`, or fuzzy name.
2. Dispatch `tcsgo-commit-sell-start` with a unique `eventId`.
3. Poll ACK (`tcsgo_last_sell_start_json`, fallback `tcsgo_last_event_json`).
4. Reply with a confirm token.
5. Confirmation is handled by `!sell-confirm` (see its README).

Sell all flow:
1. `!sell all` dispatches `tcsgo-commit-sell-all-start`.
2. ACK returns `token`, `eligibleCount`, and `creditAmount`.
3. `!sell all <token>` dispatches `tcsgo-commit-sell-all-confirm`.
4. On confirm, coins are credited via REST `add-loyalty-points`.

## Queue and ACK handling

- Uses a per-command queue to avoid ACK collisions.
- ACK variables by action:
  - Sell start: `tcsgo_last_sell_start_json`
  - Sell all start: `tcsgo_last_sell_all_start_json`
  - Sell all confirm: `tcsgo_last_sell_all_confirm_json`
  - Fallback: `tcsgo_last_event_json`

## Discord linking behavior

For Discord requests, the command resolves the linked stream identity:
- Reads from `discord-user-index.json` and `user-links.json`.
- Applies inventory and coin changes to the linked identity.

## Dependencies and data sources

- Command script: `lumia-commands/sell.js`
- Commit commands:
  - `lumia-commands/tcsgo-commit-sell-start.js`
  - `lumia-commands/tcsgo-commit-sell-all-start.js`
  - `lumia-commands/tcsgo-commit-sell-all-confirm.js`
- Linking: `discord-user-index.json`, `user-links.json`
- Overlay handshake var: `tcsgo_last_chat_handled_v1`

## Common error cases

- Missing target item or invalid token.
- Pending sell already exists (token not expired).
- Item locked or has no price snapshot.
- ACK timeout or commit failure.

## Related files

- `lumia-commands/docs/sell-confirm/README.md`
- `lumia-commands/docs/tcsgo-commit-sell-all-start/README.md`
- `lumia-commands/docs/tcsgo-commit-sell-all-confirm/README.md`
