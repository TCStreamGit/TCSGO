# TCSGO Lumia Stream Case Opening System

## Overview

TCSGO is a CS:GO/CS2-style case opening system built for Lumia Stream. It combines:
- A custom overlay that plays the roulette spin and winner reveal.
- Lumia custom JavaScript chat commands for buy/open/sell, inventory, pricing, and coins.
- Commit commands that mutate local JSON data (inventories, prices, pending sells).
- Deterministic case odds stored locally in `Case-Odds/`.
- Optional Discord bot (`TheChosenBot/`) for Discord-side linking, inventory, and coins.

Everything runs locally for low latency. All persistent state is JSON under this repo (or the linking folder described below).

## Repository layout

Key folders and files:
- `lumia-overlays/case-opening/` — overlay HTML/CSS/JS/configs/data for the open animation.
- `lumia-commands/` — Lumia custom JavaScript commands (chat + commit + Discord helper).
- `data/` — inventories, prices, case aliases.
- `Case-Odds/` — case JSON definitions and odds.
- `Assets/` — images and audio used by the overlay and inventory renderer.
- `TheChosenBot/` — Discord bot for account linking, inventory, and coins (optional, ignored by git).

## System architecture (high level)

There are two distinct layers:
- Chat commands (viewer-facing) handle parsing, cooldowns, queues, and coin adjustments.
- Commit commands (backend) mutate local JSON and return a structured ACK payload.

The overlay is **only required for the open animation**. Buy and sell flows run entirely from chat commands.

## Open flow (chat + overlay)

When the overlay is active:
1. Viewer runs `!open <alias>` in chat.
2. The overlay listens for chat messages and handles **open** only.
3. Overlay calls `tcsgo-commit-open` with an `eventId`.
4. Commit command writes inventory updates and returns an `open-result` payload.
5. Overlay animates the roulette and reveal using that payload.
6. Overlay writes `tcsgo_open_overlay_done_v1` when the animation finishes (for Lumia queues).

When the overlay is not active:
- `lumia-commands/open.js` still handles `!open`, calls the commit command, and replies in chat.
- It uses `tcsgo_last_chat_handled_v1` to avoid double-handling when the overlay did handle the command.

ACK channels used by open:
- `overlaySendCustomContent` (primary route; codeId `tcsgo-controller`).
- `tcsgo_last_open_json` and `tcsgo_last_event_json` (polling fallback).
- `tcsgo_open_overlay_done_v1` (overlay completion marker).

## Buy flow (chat only)

`!buy-case` and `!buy-key` are handled by chat commands:
1. Parse args + apply cooldown tiers.
2. Precheck points via `{{get_user_loyalty_points=...}}` when possible.
3. Adjust points using `addLoyaltyPoints` or REST `add-loyalty-points`.
4. Dispatch commit command (`tcsgo-commit-buycase` / `tcsgo-commit-buykey`).
5. Poll for ACK (`tcsgo_last_buycase_json` / `tcsgo_last_buykey_json`).
6. Refund points on failure.

## Sell flow (chat only)

`!sell` has two paths:
- Single item: `!sell <oid|itemId|itemName>` → commit start → token returned → `!sell-confirm <token>` to finalize.
- Sell all: `!sell all` → token returned → `!sell all <token>` to finalize.

Sell confirmations credit coins via REST `add-loyalty-points` and update inventory state.

## Data files and schemas

Core data files:
- `data/inventories.json` — schema `2.0-inventories`.
- `data/prices.json` — case and item pricing + `marketFeePercent`.
- `data/case-aliases.json` — case aliases and metadata (generated).
- `Case-Odds/<case>.json` — case odds, item pools, wear weights.

Linking data (for Discord → stream identity mapping):
- `discord-user-index.json`
- `user-links.json`
- `link-sessions.json`

## Setup

1. Build case aliases:
   - Run `python tools/build_case_aliases.py`.
   - This generates `data/case-aliases.json`.

2. Create Lumia commands:
   - In Lumia Stream, create custom JavaScript commands and paste each file.
   - Required commit commands:
     - `lumia-commands/tcsgo-commit-buycase.js`
     - `lumia-commands/tcsgo-commit-buykey.js`
     - `lumia-commands/tcsgo-commit-open.js`
     - `lumia-commands/tcsgo-commit-sell-start.js`
     - `lumia-commands/tcsgo-commit-sell-confirm.js`
     - `lumia-commands/tcsgo-commit-sell-all-start.js`
     - `lumia-commands/tcsgo-commit-sell-all-confirm.js`
   - Common chat commands:
     - `lumia-commands/buy-case.js`, `buy-key.js`, `open.js`, `sell.js`, `sell-confirm.js`
     - Optional: `help.js`, `cases.js`, `inventory.js`, `check-price.js`, `coins.js`

3. Set command base paths:
   - Most commands require a base repo path. Set `TCSGO_BASE` in Lumia variables or environment variables.
   - Linking commands use `TCSGO_LINKING_BASE` to locate `user-links.json` and `link-sessions.json`.
   - REST-based point adjustments use `LUMIA_REST_BASE_URL` and `LUMIA_REST_TOKEN` when needed.

4. Import overlay into Lumia:
   - Create a custom overlay layer named `case-opening`.
   - Copy HTML/CSS/JS/Configs/Data from `lumia-overlays/case-opening/`.
   - Ensure the overlay `codeId` remains `tcsgo-controller` unless you update the commands.

5. Add to OBS:
   - Use the Lumia overlay browser source URL for this overlay layer.
   - Add a Browser Source in OBS and paste the URL.
   - Set width/height to match your overlay layout.

## Open animation timing (default)

Click → Pause → Spin → Slowdown → Lock → Reveal

Default timing from `configs.json` and `script.js`:
- Intro: 200 ms
- Pause before spin: 1000 ms
- Spin up: 250 ms
- High speed: 2800 ms
- Slowdown: 2600 ms
- Final lock: 400 ms
- Reveal display: 8000 ms

Total click-to-reveal (excluding reveal display): ~7250 ms.

## Sound cues (default)

- 0 ms: `menu_accept.mp3` (`sfxAccept`)
- ~200 ms: `csgo_ui_crate_open.mp3` (`sfxOpen`)
- Spin: `tick.mp3` (`sfxTick`, timed to reel movement)
- Reveal: `reveal.mp3`, `rare.mp3`, or `gold-reveal.mp3`

## Customization quick list

Overlay configs (`lumia-overlays/case-opening/configs.json`) cover:
- Command names (`cmdOpen`, `cmdSell`, etc.)
- Commit command names (`commitOpen`, `commitBuyCase`, etc.)
- Timing and spin duration (`caseSpinMs`, `caseSpinItems`, `caseWinnerIndex`)
- Sound files and volumes
- Debug flags for routing, storage, and UI

Inventory rendering (Discord bot):
- `TheChosenBot/inventory_render.json` controls grid, text, rarity line, and colors.

## Troubleshooting

Common issues:
- Overlay does not spin: confirm `tcsgo-commit-open` exists and the overlay is active.
- Duplicate open responses: ensure `tcsgo_last_chat_handled_v1` is being set by the overlay.
- ACK timeouts: verify `tcsgo_last_event_json` is being written by commit commands.
- Missing cases: rebuild `data/case-aliases.json` and confirm `Case-Odds/` files exist.

## Further documentation

- Command specs: `lumia-commands/README.md`
- Overlay deep-dive: `lumia-overlays/case-opening/README.md`
- Discord bot: `TheChosenBot/README.md`
