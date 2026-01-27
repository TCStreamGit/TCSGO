# TCSGO Lumia Commands

This folder contains Lumia custom JavaScript command scripts for the TCSGO system. The overlay is only required for the **open animation**; buy/sell and coin adjustments run as chat commands without the overlay.

## Command categories

Viewer chat commands:
- `help.js` — help summary.
- `cases.js` — list available case aliases.
- `inventory.js` — list inventory items (paged).
- `check-price.js` — price lookup for cases/items.
- `coins.js` — show coins for linked platforms.
- `buy-case.js` — buy cases with coins.
- `buy-key.js` — buy keys with coins.
- `open.js` — open a case (overlay animation optional).
- `sell.js` — sell items or sell all.
- `sell-confirm.js` — confirm single-item sells.

Commit commands (backend inventory mutations):
- `tcsgo-commit-buycase.js` — add cases to inventory.
- `tcsgo-commit-buykey.js` — add keys to inventory.
- `tcsgo-commit-open.js` — consume case/key and add item.
- `tcsgo-commit-sell-start.js` — start single-item sell (token).
- `tcsgo-commit-sell-confirm.js` — finalize single-item sell.
- `tcsgo-commit-sell-all-start.js` — start sell-all (token).
- `tcsgo-commit-sell-all-confirm.js` — finalize sell-all.

Discord helper commands (REST chat-command):
- `discord-coins.js` — query coin balances.
- `discord-add-loyalty.js` — add loyalty points via REST.
- `discord-remove-loyalty.js` — remove loyalty points via REST.
- `discord-sell-all.js` — start/confirm sell-all via REST.

Linking commands:
- `link.js` — start link from stream account to Discord.
- `unlink.js` — remove a link.
- `tcsgo-link-start.js` — REST start link (Discord bot).
- `tcsgo-unlink-start.js` — REST start unlink (Discord bot).

Helper (not a command):
- `tcsgo-core.js` — shared helpers for pricing and inventory.

## Overlay dependency

- The overlay (`lumia-overlays/case-opening/script.js`) handles **open only**.
- The open chat command still works without the overlay, but the overlay is required for the full roulette spin animation.
- Buy and sell commands are intentionally off-overlay.
- The overlay writes `tcsgo_open_overlay_done_v1` when the animation finishes so Lumia can wait before running the next queued command.

## Required variables and paths

Most commands require the repo base path:
- Set a Lumia variable named `TCSGO_BASE` to the repo root.
- Or set the environment variable `TCSGO_BASE` for Lumia.

Linking commands use a separate base path:
- `TCSGO_LINKING_BASE` points to the folder containing `user-links.json` and `link-sessions.json`.

REST coin adjustments:
- `LUMIA_REST_BASE_URL` and `LUMIA_REST_TOKEN` are used when native loyalty helpers are unavailable.

## ACK routing (commit results)

Each commit command writes both a type-specific ACK and a fallback ACK:
- Open: `tcsgo_last_open_json`
- Buy case: `tcsgo_last_buycase_json`
- Buy key: `tcsgo_last_buykey_json`
- Sell start: `tcsgo_last_sell_start_json`
- Sell confirm: `tcsgo_last_sell_confirm_json`
- Sell all start: `tcsgo_last_sell_all_start_json`
- Sell all confirm: `tcsgo_last_sell_all_confirm_json`
- Fallback: `tcsgo_last_event_json`

Chat commands poll the type-specific ACK first, then fall back to `tcsgo_last_event_json`.

## Cooldowns and queues

- Buy/open/sell commands apply cooldown tiers: 60s regular, 45s mod, 30s supporter, 0s streamer.
- Each command uses a per-command queue to avoid ACK collisions when multiple users run commands.

## Discord linking behavior

Discord requests can map to a linked stream identity:
- Both chat commands and commit commands resolve Discord → linked stream account.
- Linking files:
  - `discord-user-index.json`
  - `user-links.json`
- Linking base path variable: `TCSGO_LINKING_BASE`
- Default linking base: `Z:\home\nike\Streaming\TCSGO\Linking`

## Per-command docs

See:
- `lumia-commands/docs/buy-case/README.md`
- `lumia-commands/docs/buy-key/README.md`
- `lumia-commands/docs/open/README.md`
- `lumia-commands/docs/sell/README.md`
- `lumia-commands/docs/sell-confirm/README.md`
- `lumia-commands/docs/discord-add-loyalty/README.md`
- `lumia-commands/docs/discord-remove-loyalty/README.md`
- `lumia-commands/docs/discord-sell-all/README.md`
- `lumia-commands/docs/tcsgo-commit-sell-all-start/README.md`
- `lumia-commands/docs/tcsgo-commit-sell-all-confirm/README.md`
