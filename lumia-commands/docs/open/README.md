# open

Primary chat handler for opening cases. It works without the overlay, but the overlay is needed for the full spin animation.

## Command name and aliases

- Command name: `open`
- Primary chat command: `!open`
- Aliases: `!open-case`, `!open case`, `!open`

## Chat usage (with `!`)

- `!open cs20`
- `!open-case cs20`

## Parameters

- `alias` (required)
  - Case alias from `data/case-aliases.json`.

## How input is parsed

- Reads `message` and `rawMessage`, then extracts the command and args.
- Supports both single-word and two-word command aliases (e.g., `open case`).
- Dedupes duplicate triggers by `messageId` when available.
- Uses a per-command queue to serialize open requests.
- Respects the overlay handshake variable `tcsgo_last_chat_handled_v1` when the overlay handled the command directly.

## Behavior (step-by-step)

1. Resolve platform and display/username.
2. Apply cooldown tiers (streamer/mod/supporter/default).
3. Validate the case alias.
4. Dispatch `tcsgo-commit-open` with a unique `eventId`.
5. Poll for ACK (`tcsgo_last_open_json`, fallback `tcsgo_last_event_json`).
6. Reply in chat with the open result or error.

If the overlay is active:
- The overlay may handle `!open` directly and play the animation.
- `open.js` checks `tcsgo_last_chat_handled_v1` to avoid double-handling.

## Queue and ACK behavior

- ACK variables:
  - Primary: `tcsgo_last_open_json`
  - Fallback: `tcsgo_last_event_json`
- Waits up to 12 seconds for an `open-result` ACK.
- Falls back to matching by user + platform if needed.
- Overlay completion ACK: `tcsgo_open_overlay_done_v1` (type `open-overlay-complete`) is written after the animation finishes.

## Dependencies and data sources

- Command script: `lumia-commands/open.js`
- Commit command: `lumia-commands/tcsgo-commit-open.js`
- Overlay (animation only): `lumia-overlays/case-opening/script.js`
- Overlay handshake var: `tcsgo_last_chat_handled_v1`

## Common error cases

- Missing alias.
- Unknown alias.
- ACK timeout (open dispatched but no result received in time).

## Related files

- `lumia-commands/docs/buy-case/README.md`
- `lumia-commands/docs/buy-key/README.md`
- `lumia-overlays/case-opening/README.md`
