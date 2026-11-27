// Mindfield Maze on/off mechanic: turns one player's value into "walk" or "rest".
//
// This is deliberately a game mechanic, not a measurement. The player is compared
// with their own recent level, which keeps adapting, so a typical player is "on"
// about half the time whatever their absolute reading is. Nothing here feeds the
// Mind Field Score, Meditation Impact or any report figure.
//
// Pure: no clocks, no I/O, no module state. The caller owns the plain state object
// (it is checkpointed with the Maze player) and supplies the elapsed running time.
//
// The value is the player's log10 alpha power (or log alpha minus log beta for the
// balance target), so every distance below is in log10 units.

// The first tuning (WS4). Games saved with it, and every new game of a session on the
// earlier flow, play under exactly these rules: a tick without a reading is a rest.
export const GAME_SIGNAL_V1 = Object.freeze({
  // Named so a checkpoint records which tuning produced it. Change a constant
  // below only together with a new version string.
  version: "adaptive_level_v1",

  // Time constant, in seconds, of the short average that steadies the reading
  // before any decision. About five engine ticks: long enough to ride out one
  // odd sample, short enough that the avatar still answers within a few seconds.
  smoothSeconds: 2.5,

  // Time constant, in seconds, of the player's own slowly adapting level. The
  // level starts from the player's starting level (the Maze baseline in an earlier
  // game, an eyes-closed rest in a current one) and then follows the smoothed
  // value, so "on" means "above where you have been for the last minute or so",
  // not "above a fixed target".
  levelSeconds: 75,

  // Smallest spread, in log10 units. The spread is the player's own typical
  // distance between the smoothed value and the level; it adapts at the same pace
  // as the level, starts here, and never falls below this floor. Same figure as
  // the engine's baseline scale floor. It keeps a very flat signal (a synthetic
  // seat at rest, a headset on a table) from switching on its own ripple.
  spreadFloor: 0.05,

  // Hysteresis, in spreads. The player switches on at this far above the level
  // and off only at this far below it. In between, the avatar keeps doing what
  // it was doing, so it does not flicker.
  hysteresisSpreads: 0.25,

  // Leash, in spreads. The level is never left further than this from the
  // smoothed value. A jump larger than a person's own variation is a change in
  // sensor contact, or a starting level taken in a different state (eyes closed
  // against eyes open); without the leash such a jump walks a player for a minute
  // or strands them for one.
  leashSpreads: 2,
});

// Current tuning: the same constants, plus coasting. A well-fitted ear sensor gives
// a valid reading only a little over half the time with eyes open, in bursts of a
// few seconds (bench test, November 15), so resting on every tick without a reading
// halves a player's walking time for reasons that have nothing to do with them.
export const GAME_SIGNAL = Object.freeze({
  ...GAME_SIGNAL_V1,
  version: "adaptive_level_v2",

  // Coasting, in seconds. Through a continuous dropout of up to this long the
  // player keeps doing what they were doing, walking or resting. After that they
  // rest, as under the first tuning. Kept equal to the Maze's own allowance before
  // a seat counts as disrupted (MAZE.disconnectSeconds), so that a character stops
  // carrying on at the moment its seat is marked as having lost its signal.
  coastSeconds: 3,
});

// Every tuning a saved game can name, by its version string.
export const GAME_SIGNALS = Object.freeze({
  [GAME_SIGNAL_V1.version]: GAME_SIGNAL_V1,
  [GAME_SIGNAL.version]: GAME_SIGNAL,
});
// The rules a game plays under: the copy saved with it, else the tuning its stored
// version names, else the first tuning (a game saved before versions were copied).
export const gameSignalRules = (maze) => maze?.gameSignal ?? GAME_SIGNALS[maze?.difficultyVersion] ?? GAME_SIGNAL_V1;

const finite = value => typeof value === "number" && Number.isFinite(value);

// startLevel is where the player's level starts: the measured Maze baseline in an
// earlier game, the eyes-closed rest chosen for the seat in a current one. Pass null
// when there is none: the level then starts from the first smoothed reading.
export function createGameSignal(startLevel = null, rules = GAME_SIGNAL) {
  return {
    smooth: null,
    level: finite(startLevel) ? startLevel : null,
    spread: rules.spreadFloor,
    on: false,
    // Running seconds since the last usable reading, so the first reading after a
    // gap is weighted by the whole gap rather than by one tick.
    gapSeconds: 0,
  };
}

// True when the tick that just ended had no reading and fell inside the coasting
// allowance: the player is carrying on with whatever the latch says.
export const gameSignalCoasting = (signal, rules = GAME_SIGNAL) =>
  (rules.coastSeconds ?? 0) > 0 && signal.gapSeconds > 0 && signal.gapSeconds <= rules.coastSeconds;

// Advance one tick. `value` is the usable reading, or null when the player has no
// usable signal this tick. `seconds` is the running time since the previous tick.
// Returns true while the player should walk.
//
// Without a reading nothing adapts, and the on/off latch is kept, so a dropout
// does not cost a fresh climb through the hysteresis band. Under the first tuning
// the player rests on every such tick. With coasting (`coastSeconds`) the player
// keeps the latch's answer while the dropout has lasted no longer than the
// allowance, counted to the end of the tick, and rests after that. A tick is
// never split: one that ends past the allowance is a rest for its whole length.
export function stepGameSignal(signal, value, seconds, rules = GAME_SIGNAL) {
  const dt = finite(seconds) && seconds > 0 ? seconds : 0;
  if (!finite(value)) {
    signal.gapSeconds += dt;
    return gameSignalCoasting(signal, rules) && signal.on;
  }
  const elapsed = signal.gapSeconds + dt;
  signal.gapSeconds = 0;
  const weight = constant => 1 - Math.exp(-elapsed / constant);

  signal.smooth = signal.smooth === null
    ? value
    : signal.smooth + (value - signal.smooth) * weight(rules.smoothSeconds);
  if (signal.level === null) signal.level = signal.smooth;

  const leash = rules.leashSpreads * signal.spread;
  signal.level = Math.min(Math.max(signal.level, signal.smooth - leash), signal.smooth + leash);

  // Decide against the level as it stood before this reading moves it.
  const distance = signal.smooth - signal.level;
  const band = rules.hysteresisSpreads * signal.spread;
  if (!signal.on && distance >= band) signal.on = true;
  else if (signal.on && distance <= -band) signal.on = false;

  const adapt = weight(rules.levelSeconds);
  signal.level += distance * adapt;
  signal.spread = Math.max(rules.spreadFloor, signal.spread + (Math.abs(distance) - signal.spread) * adapt);
  return signal.on;
}
