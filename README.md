# TCSGO Lumia Stream Case Opening System

## Overview

TCSGO is a CS:GO/CS2-style case opening system built for Lumia Stream. It combines:
- A custom overlay that handles chat commands and animation
- Lumia custom JavaScript commands that mutate local JSON data
- Deterministic case odds using local Case-Odds data
- Inventory, pricing, and trade-lock handling

This repository is designed for local, low-latency use during stream. All data is stored in JSON files under the repo.

## How the system works

1) Viewer types a chat command (for example: !open cs20)
2) Overlay listens to chat and parses the command
3) Overlay checks and adjusts loyalty points (buy/open/sell flows)
4) Overlay calls a backend Lumia command (tcsgo-commit-*)
5) Command updates local JSON and returns a payload
6) Overlay receives the payload via overlaycontent and/or variable polling
7) Overlay animates the case opening and shows the winner

The overlay is the controller. The commit commands only mutate data and never touch points.

## Case opening flow (visual)

Click -> Pause -> Fast Spin -> Slowdown -> Lock -> Reveal

Default timing (from configs and script):
- Intro: 200 ms
- Pause before spin: 1000 ms
- Spin up: 250 ms
- High speed: 2800 ms
- Slowdown: 2600 ms
- Final lock: 400 ms
- Reveal display: 8000 ms

Total click to reveal (excluding reveal display): ~7250 ms

## Sound cues (default)

- 0 ms: menu_accept.mp3 (sfxAccept)
- ~200 ms: csgo_ui_crate_open.mp3 (sfxOpen)
- Spin start: tick.mp3 begins and slows with the reel
- After final lock: reveal.mp3, rare.mp3, or gold-reveal.mp3

Sound files are configurable in `lumia-overlays/case-opening/configs.json`.

## How the overlay is triggered from Lumia

The overlay listens to chat events and reacts to these commands (configurable):
- buycase, buykey, open, sell, sellconfirm

The overlay calls backend commands using `Overlay.callCommand`:
- tcsgo-commit-buycase
- tcsgo-commit-buykey
- tcsgo-commit-open
- tcsgo-commit-sell-start
- tcsgo-commit-sell-confirm

Results are returned through two channels:
- `overlaySendCustomContent` (overlaycontent event)
- `tcsgo_last_event_json` global variable (polling fallback)

The overlay uses `codeId = tcsgo-controller` to route responses.

## File layout

Key folders and files:
- `lumia-overlays/case-opening/overlay.html`: DOM for the overlay
- `lumia-overlays/case-opening/style.css`: visuals, marker line, tile sizing
- `lumia-overlays/case-opening/script.js`: controller, animation, audio, chat parsing
- `lumia-overlays/case-opening/configs.json`: overlay config schema and defaults
- `lumia-overlays/case-opening/data.json`: overlay metadata and notes
- `lumia-commands/`: Lumia custom JavaScript command scripts
- `data/`: inventories, prices, case aliases
- `Case-Odds/`: case JSON definitions with odds and item pools
- `Assets/`: images and sounds used by the overlay

## Install and run in OBS

1) Build case aliases:
   - Run `python tools/build_case_aliases.py`
   - This generates `data/case-aliases.json`

2) Create Lumia commands:
   - In Lumia Stream, create custom JavaScript commands and paste each file
   - Required commit commands:
     - `lumia-commands/tcsgo-commit-buycase.js`
     - `lumia-commands/tcsgo-commit-buykey.js`
     - `lumia-commands/tcsgo-commit-open.js`
     - `lumia-commands/tcsgo-commit-sell-start.js`
     - `lumia-commands/tcsgo-commit-sell-confirm.js`
   - Optional chat commands:
     - `lumia-commands/tcsgo-help.js`
     - `lumia-commands/tcsgo-cases.js`
     - `lumia-commands/tcsgo-inventory.js`
     - `lumia-commands/tcsgo-checkprice.js`
   - Make sure `TCSGO_BASE` in each command file points to your repo path

3) Import overlay into Lumia:
   - Create a custom overlay layer named `case-opening`
   - Copy HTML/CSS/JS/Configs/Data from `lumia-overlays/case-opening/`

4) Add to OBS:
   - Use the Lumia overlay browser source URL for this overlay layer
   - Add a Browser Source in OBS and paste the URL
   - Set width/height to match your overlay layout

## How random outcomes are selected

The open command reads the case JSON from `Case-Odds/<filename>` and:
- Selects a rarity tier using `case.oddsWeights`
- Selects an item within that tier using `item.weights.base`
- Rolls wear using a weighted wear table
- Rolls StatTrak when eligible

The result is stored in `data/inventories.json` with:
- `oid`, `displayName`, `wear`, `statTrak`, `rarity`, `fromCaseId`
- `lockedUntil` for trade-lock enforcement
- `priceSnapshot` derived from `data/prices.json`

## Final item alignment

The overlay aligns the winning tile by matching its center to the marker line:
- `computeTargetX` measures the marker center and winning tile center
- It computes the translateX delta so centers align
- The reel overshoots by `overshootPx` and snaps back during `finalLockMs`

The marker line is `#roulette-center-line` in `lumia-overlays/case-opening/style.css`.

## Tuning and customization

Speed and timing:
- `caseIntroMs` (configs.json): intro duration
- `caseSpinPauseMs` (configs.json): pause before spin
- `caseSpinMs` (configs.json): total spin time
- `winnerDisplayMs` (configs.json): reveal display duration
- `cruiseBoost` (script.js): increases distance in the high-speed phase

Tick rate:
- `SPIN_TIMING_DEFAULT.tickCurve` (script.js) controls tick intervals over time
- Tick cadence is synced to item spacing using tile width + gap

Reel density (pixels per item):
- `--tile-width`, `--tile-gap` (style.css) affect items-per-second feel
- Smaller tiles and gaps make the reel feel faster

Sounds:
- `sfxAccept`, `sfxOpen`, `sfxTick`, `sfxReveal`, `sfxRare`, `sfxGold` (configs.json)
- `sfxVolume`, `sfxTickVolume` (configs.json)

Marker position:
- `#roulette-center-line { left: 50%; }` (style.css)
- Move the marker line and the reel will align to it automatically

## Command documentation and overlay details

- Command specs: `lumia-commands/README.md`
- Overlay deep-dive (timing tables, alignment math, debug): `lumia-overlays/case-opening/README.md`
