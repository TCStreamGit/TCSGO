# Case Opening Overlay (TCSGO)

This document describes the case-opening overlay only. It is meant for layout, timing, and animation tuning.

## Visual states

- idle: overlay hidden, no winner card shown
- intro: case intro card and key card visible
- roulette: reel visible (pause, spin, slowdown, lock)
- reveal: winner card and glow visible

State is controlled via `data-state` on `#case-opening`.

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

The reel is driven by a single `requestAnimationFrame` loop in `animateRoulette`:
- Elapsed time determines progress through spin-up, cruise, and decel phases
- Distance allocation uses `spinUpMs`, `highSpeedMs`, `decelMs`, and `cruiseBoost`
- Final lock applies an overshoot and a snap-back using `finalLockMs`

This keeps the movement deterministic and in sync with audio.

## Reel position calculation

The final translateX is computed from live DOM measurements:
- Measure winner tile center and marker center
- Compute delta: `targetX = stripX + (markerX - winnerCenter)`
- Overshoot: `overshootX = targetX + direction * overshootPx`
- Snap back to `targetX` during the lock phase

The marker line is `#roulette-center-line` in `style.css`.

## Overshoot and snap

Overshoot and snap are controlled by:
- `SPIN_TIMING_DEFAULT.overshootPx` (script.js)
- `SPIN_TIMING_DEFAULT.finalLockMs` (script.js)

Increase overshoot for a more dramatic snap, or reduce for a tighter lock.

## Debugging alignment issues

If the winner stops in the wrong place:
- Confirm `#roulette-center-line` exists in `overlay.html` and is visible
- Check `#roulette-center-line { left: 50%; }` in `style.css`
- Verify tile size and spacing: `--tile-width`, `--tile-gap`, `#roulette-strip` padding
- Ensure OBS/browser scaling is not distorting layout
- Confirm `caseSpinItems` and `caseWinnerIndex` are not forcing too-short reels
- Enable `debugWinnerCard` and `debugRouter` in configs to see timing and routing info

If ticks feel out of sync:
- Adjust `SPIN_TIMING_DEFAULT.tickCurve` in `script.js`
- Verify `--tile-width` and `--tile-gap` so ticks align with item passes
