# buy-key

Primary chat handler for buying keys. It runs entirely as a Lumia chat command and does not require the overlay.

## Command name and aliases

- Command name: `buy-key`
- Primary chat command: `!buy-key`
- Aliases: `!buykey`, `!buy key`, `!buy-key`

## Chat usage (with `!`)

- `!buy-key`
- `!buy-key 2`

## Parameters

- `qty` (optional)
  - Number of keys to buy.
  - Default: `1`.

## How input is parsed

- Reads `message` and `rawMessage`, then extracts the command and args.
- Dedupes duplicate triggers by `messageId` when available.
- Falls back to a short raw-message dedupe window when `messageId` is missing.
- Respects the overlay handshake variable `tcsgo_last_chat_handled_v1` if the overlay handled the command.

## Behavior (step-by-step)

1. Resolve platform and display/username.
2. Apply cooldown tiers (streamer/mod/supporter/default).
3. Load key price from `data/prices.json` or use default fallback.
4. Precheck points via `{{get_user_loyalty_points={{username}},{{platform}}}}` when available.
5. Adjust points using:
   - Native `addLoyaltyPoints` if available.
   - REST `add-loyalty-points` otherwise.
6. Dispatch commit command `tcsgo-commit-buykey` with an `eventId`.
7. Poll for ACK (`tcsgo_last_buykey_json`, fallback `tcsgo_last_event_json`).
8. On failure, refund points and reply with an error.

## Queue and ACK handling

- Uses a per-command queue (`tcsgo_buy_key_queue_v1`) to prevent ACK collisions.
- Uses a separate cooldown store (`tcsgo_buy_key_cooldowns_v1`).
- ACK variables:
  - Primary: `tcsgo_last_buykey_json`
  - Fallback: `tcsgo_last_event_json`

## Discord linking behavior

For Discord requests, the command resolves the linked stream identity:
- Reads from `discord-user-index.json` and `user-links.json`.
- Applies coin changes and inventory updates to the linked identity.
- The points precheck may be unavailable for linked Discord requests, but deductions still run against the linked identity.

## Dependencies and data sources

- Command script: `lumia-commands/buy-key.js`
- Commit command: `lumia-commands/tcsgo-commit-buykey.js`
- Data: `data/prices.json`
- Linking: `discord-user-index.json`, `user-links.json`
- Overlay handshake: `tcsgo_last_chat_handled_v1`

## Common error cases

- Invalid quantity.
- Insufficient coins.
- ACK timeout or commit failure (refunds coins).

## Related files

- `lumia-commands/docs/buy-case/README.md`
- `lumia-commands/docs/open/README.md`
