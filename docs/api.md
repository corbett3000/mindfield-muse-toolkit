# API reference

Import from `src/index.mjs` or an individual module. All inputs are decoded JavaScript
values, not OSC bytes or typed OSC argument objects. Use separate state per headset.

## Sensor validity

`createSensorValidity({ rules = {} })` returns:

- `ingest(address, values, atMs)`: a recognized message produces
  `{ applied, status, problems }`; unknown addresses, heartbeat and raw EEG return
  `null`. `values` is an array in wire order. `atMs` is the local receive time.
- `heartbeat({ recoveryPhase, recoveryCount }, atMs)`: updates reconnect tracking.
  `heartbeatRecovery(values)` extracts those fields from the heartbeat value array.
- `snapshot(atMs)`: returns `headbandOn`, associated ages and `tp9`, `af7`, `af8`,
  `tp10`. Each sensor includes `{ bands, ageMs, valid, reasons, isGood, hsi }`.
  Unavailable band values become `null`. `ageMs` measures time since the selected
  band's value changed, not time since the latest datagram.
- `diagnostics()`: message/problem counters, reconnects and per-address loss summaries.
- `rules`: the resolved settings, for inspection.

Defaults: alpha value band; stale and held after **more than 300 ms**; floor at or
below **−3 log10 units**; 5,000 ms settling after reconnect; band silence over 3,000 ms
signals reconnection. An explicit `is_good=1` is required. An absent headband report
alone does not invalidate a reading. HSI codes are informational.

Only duplicate and late sequenced messages are rejected as old. Some malformed
metadata is flagged while sensor values are still applied; `valid` is not a wire
format validation verdict. A short band message makes all four readings non-finite.
Inspect `problems` and enforce your own strict ingress policy if needed. The module
expects a string address and finite, consistently ordered local times.

## Rolling fit

`createFitWindow(overrides = {})` exposes `observe(sensors, atSeconds)`, `view()` and
`rules`. Pass the full validity snapshot, or `null` for no per-sensor data. It returns
`null` for that missing object; otherwise it reports:

```text
{ state, ready, action, bestEarShare, observedSeconds,
  windowSeconds, settleSeconds, sensors: { tp9, af7, af8, tp10 } }
```

Sensor entries hold `share`, ear `state` and predominant invalid `reason`. States:
`settling`, `ready`, `not_ready`, `headband_off`, `reconnecting`, `no_signal`.
`ready` is `null` while no fit judgment can be made. Actions include `reseat_left`,
`reseat_right`, `refit`, `headband_off`, `no_signal`, or `null`.

Defaults: 20-second window, 10-second settling, better ear ready at 0.30 valid share;
good at 0.40, fair at 0.20. Samples less than 0.25 seconds apart are ignored.
Shares are **counts of accepted observations**, not duration-weighted integration:
use a regular cadence. Headband removal, reconnection, prolonged silence, backward
time and long polling gaps reset the window. `createFitWindows()` wraps independent
windows with `observe(id, sensors, atSeconds)` and `view(id)`.

`headbandVerdict({ tp9, tp10 }, rules?)` and `earState(share, rules?)` expose the pure
threshold decisions. Use `FIT_RULES` when providing a complete custom rules object.

## Sequence tracking

`createSeqTracker(options = {})` exposes `push(seq, stamp?)`, `summary()`, `reset()`,
`resume(seq)`, `restore(summary)` and `last`/`missing` getters. Sequence numbers are
integers from 0 to 2³¹−1, wrapping to zero; one tracker is needed per address and seat.
The optional stamp is a sender timestamp, compared only to other sender timestamps.

`push` returns `first`, `ok`, `gap`, `late`, `duplicate`, `restart` or `invalid`.
A late arrival can reduce the missing count without replacing the newest sample.
`summary()` reports counts and missing ranges. `reset()` preserves totals;
`restore()` restores totals but starts a new comparison stretch. Restart recognition
is heuristic, especially without stamps. Only recent retained ranges are searched
for late packets; extremely delayed packets need not reconcile every historical gap.

## Adaptive game signal

`createGameSignal(startLevel = null, rules = GAME_SIGNAL)` creates mutable state.
`stepGameSignal(state, value, seconds, rules = GAME_SIGNAL)` mutates it and returns
whether the player should walk on this tick. Use a finite log10 alpha value (or
log-alpha minus log-beta), `null` for an unusable sample, and positive elapsed
**running seconds**, excluding pauses.

Current `GAME_SIGNAL`: smoothing 2.5 s, adaptive level 75 s, spread floor 0.05 log10,
hysteresis 0.25 spreads, leash 2 spreads, coasting up to 3 s. Use the same rules at
creation and each step. Missing data does not adapt the level. A tick ending past
the coasting allowance is entirely at rest. `gameSignalCoasting(state, rules?)`
indicates a missing-data interval within the allowance; it can be true while the
player is resting. Use the returned boolean for motion, not the retained `on` latch.

`GAME_SIGNAL_V1` retains the older no-coasting behavior. `GAME_SIGNALS` maps version
strings; `gameSignalRules(saved)` resolves legacy saved-game rules. Save your rules
with state for reproducible replay. These functions do not calculate clinical or
meditation outcomes.
