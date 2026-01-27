# Case Opening Overlay (TCSGO)

This document describes the case-opening overlay only. It covers the animation, routing, and configuration used by `lumia-overlays/case-opening/`.

## Purpose

The overlay provides the visual roulette spin and winner reveal for `!open`. It is not required for buying or selling; those flows run in chat commands. When the overlay is active, it can handle `!open` directly and play the animation.

## Files in this overlay

- `overlay.html` — DOM structure and element IDs.
- `style.css` — layout, colors, animations, and marker line styles.
- `script.js` — controller, chat parsing, commit calls, animation timing, audio.
- `configs.json` — configurable settings (Lumia UI fields).
- `data.json` — metadata, variables, and routing notes.

## Visual states

State is controlled via `data-state` on `#case-opening`:
- `idle` — overlay hidden.
- `intro` — case intro card and key card visible.
- `roulette` — reel visible (pause, spin, slowdown, lock).
- `reveal` — winner card and glow visible.

## Chat handling (open only)

- The overlay only handles the **open** command from chat.
- It ignores buy/sell commands in chat.
- It marks handled chat using `tcsgo_last_chat_handled_v1` so `lumia-commands/open.js` can avoid double-handling.

## Routing and ACKs

Primary routing:
- Commit commands send results to the overlay via `overlaySendCustomContent` with `codeId: "tcsgo-controller"`.

Fallback routing:
- Commit commands also write `tcsgo_last_event_json`, which the overlay polls and deduplicates.

Overlay completion ACK:
- After an open animation completes, the overlay writes `tcsgo_open_overlay_done_v1`.
- Payload shape:
  - `type`: `"open-overlay-complete"`
  - `id` and `eventId` when available
  - `platform`, `username`, `ts`, `ok`

This is used by Lumia queues so the next command can wait until the animation finishes.

## Timing table (default)

All times are relative to the moment the overlay starts the open flow.

| Phase | Start (ms) | Duration (ms) | Notes |
| --- | --- | --- | --- |
| Accept click | 0 | 0 | Plays sfxAccept |
| Case open whoosh | ~200 | 0 | Plays sfxOpen |
| Intro | 0 | 200 | Case intro on screen |
| Pause before spin | 200 | 1000 | Items visible, no movement |
| Spin up | 1200 | 250 | Accelerate to speed |
| High speed | 1450 | 2800 | Fast, nearly unreadable |
| Slowdown | 4250 | 2600 | Ease out |
| Final lock | 6850 | 400 | Overshoot then snap to center |
| Reveal | 7250 | 8000 | Winner card display |

Total click to reveal (excluding reveal display): ~7250 ms.

## Sound mapping

| Time | File | Trigger |
| --- | --- | --- |
| 0 ms | menu_accept.mp3 | `sfxAccept` |
| ~200 ms | csgo_ui_crate_open.mp3 | `sfxOpen` |
| Spin start | tick.mp3 | `sfxTick` (synced to item passes) |
| End lock | reveal.mp3 / rare.mp3 / gold-reveal.mp3 | `sfxReveal` / `sfxRare` / `sfxGold` |

Tick timing slows with the reel using `SPIN_TIMING_DEFAULT.tickCurve` in `script.js`.

## Master timer behavior

The reel uses a single `requestAnimationFrame` loop in `animateRoulette`:
- Elapsed time determines progress through spin-up, cruise, and decel phases.
- Distance allocation uses `spinUpMs`, `highSpeedMs`, `decelMs`, and `cruiseBoost`.
- Final lock applies an overshoot and a snap-back using `finalLockMs`.

## Reel position calculation

The final translateX is computed from live DOM measurements:
- Measure winner tile center and marker center.
- Compute delta: `targetX = stripX + (markerX - winnerCenter)`.
- Overshoot: `overshootX = targetX + direction * overshootPx`.
- Snap back to `targetX` during the lock phase.

The marker line is `#roulette-center-line` in `style.css`.

## Config highlights (`configs.json`)

Important categories:
- **Routing**: `codeId`, `pollIntervalMs`, `ackTimeoutMs`.
- **Commands**: `cmdOpen`, `cmdSell`, `cmdBuyCase`, `cmdBuyKey`, `commandPrefix`.
- **Commit names**: `commitOpen`, `commitBuyCase`, `commitBuyKey`, `commitSellStart`, `commitSellConfirm`, `commitSellAllStart`, `commitSellAllConfirm`.
- **Timing**: `caseIntroMs`, `caseSpinPauseMs`, `caseSpinMs`, `caseSpinItems`, `caseWinnerIndex`.
- **Sound**: `sfxAccept`, `sfxOpen`, `sfxTick`, `sfxReveal`, `sfxRare`, `sfxGold`, `sfxVolume`, `sfxTickVolume`.
- **Debug**: `debugEnabled`, `debugOutput`, and per-feature toggles like `debugRouter`, `debugOpen`, `debugEventsPoll`.

## Leader election

The overlay uses a lightweight leader election to avoid duplicate chat handling across multiple browser sources.
- Variable: `tcsgo_controller_leader_v1`
- TTL: 6 seconds
- Only the leader processes chat.

## Debugging alignment issues

If the winner stops in the wrong place:
- Confirm `#roulette-center-line` exists in `overlay.html` and is visible.
- Check `#roulette-center-line { left: 50%; }` in `style.css`.
- Verify tile size and spacing: `--tile-width`, `--tile-gap`, `#roulette-strip` padding.
- Ensure OBS/browser scaling is not distorting layout.
- Confirm `caseSpinItems` and `caseWinnerIndex` are not forcing too-short reels.
- Enable `debugWinnerCard` and `debugRouter` in configs to see timing and routing info.

If ticks feel out of sync:
- Adjust `SPIN_TIMING_DEFAULT.tickCurve` in `script.js`.
- Verify `--tile-width` and `--tile-gap` so ticks align with item passes.

## Fallback spin behavior

- If case JSON cannot be loaded, the overlay builds a fallback roulette strip and still spins instead of instantly revealing.
- Keeping `baseRawUrl` valid is recommended so the roulette can use real case data.
