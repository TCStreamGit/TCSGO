# buy-case

Primary chat handler for buying cases. It runs entirely as a Lumia chat command and does not require the overlay.

## Command name and aliases

- Command name: `buy-case`
- Primary chat command: `!buy-case`
- Aliases: `!buycase`, `!buy case`, `!buy-case`

## Chat usage (with `!`)

- `!buy-case cs20`
- `!buy-case cs20 3`

## Parameters

- `alias` (required)
  - Case alias from `data/case-aliases.json`.
- `qty` (optional)
  - Number of cases to buy.
  - Default: `1`.

## How input is parsed

- Reads `message` and `rawMessage`, then extracts the command and args.
- Normalizes aliases and supports both `!buycase` and `!buy case` styles.
- Dedupes duplicate triggers by `messageId` when available.
- Falls back to a short raw-message dedupe window when `messageId` is missing.
- Respects the overlay handshake variable `tcsgo_last_chat_handled_v1` if the overlay handled the command.

## Behavior (step-by-step)

1. Resolve platform and display/username.
2. Apply cooldown tiers (streamer/mod/supporter/default).
3. Load case aliases and pricing (`data/case-aliases.json`, `data/prices.json`).
4. Validate alias and quantity; suggest similar aliases when possible.
5. Precheck points via `{{get_user_loyalty_points={{username}},{{platform}}}}` when available.
6. Adjust points using:
   - Native `addLoyaltyPoints` if available.
   - REST `add-loyalty-points` otherwise.
7. Dispatch commit command `tcsgo-commit-buycase` with an `eventId`.
8. Poll for ACK (`tcsgo_last_buycase_json`, fallback `tcsgo_last_event_json`).
9. On failure, refund points and reply with an error.

## Queue and ACK handling

- Uses a per-command queue (`tcsgo_buy_case_queue_v1`) to prevent ACK collisions.
- Uses a separate cooldown store (`tcsgo_buy_case_cooldowns_v1`).
- ACK variables:
  - Primary: `tcsgo_last_buycase_json`
  - Fallback: `tcsgo_last_event_json`

## Discord linking behavior

For Discord requests, the command resolves the linked stream identity:
- Reads from `discord-user-index.json` and `user-links.json`.
- Applies coin changes and inventory updates to the linked identity.
- The points precheck may be unavailable for linked Discord requests, but deductions still run against the linked identity.

## Dependencies and data sources

- Command script: `lumia-commands/buy-case.js`
- Commit command: `lumia-commands/tcsgo-commit-buycase.js`
- Data: `data/case-aliases.json`, `data/prices.json`
- Linking: `discord-user-index.json`, `user-links.json`
- Overlay handshake: `tcsgo_last_chat_handled_v1`

## Common error cases

- Missing alias or quantity.
- Unknown alias (includes suggestions when possible).
- Insufficient coins.
- ACK timeout or commit failure (refunds coins).

## Related files

- `lumia-commands/docs/buy-key/README.md`
- `lumia-commands/docs/open/README.md`
