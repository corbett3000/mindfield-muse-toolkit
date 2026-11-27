// The fit check's memory (integration F, November 15).
//
// The bench test on a real headset showed that a well-fitted ear sensor is valid only a little
// over half the time with eyes open, in bursts of a few seconds. Anything that looks at one
// instant therefore reads a good fit as a bad one. This module keeps, per headset, the share of
// the last 20 seconds for which each sensor was valid on the receiver's own rule (the C3
// `sensors` object, read at the engine's tick, about twice a second), and judges the headband
// from its two ear sensors.
//
// Pure: no clock and no I/O. The caller passes the receiver's `sensors` object and a time in
// seconds. The Training service holds one window per seat and puts the result in the private
// operator view as `fit`, beside `sensors`, so a reload of the operator page and a second operator
// tab read the same figure. It never enters a participant view, a report, a share page or the wall.
//
// Every figure below is PROVISIONAL: the bench test had one wearer on one headset. The first
// group test decides whether they stand.

export const FIT_SENSORS = Object.freeze(['tp9', 'af7', 'af8', 'tp10']);
export const FIT_EAR_SENSORS = Object.freeze(['tp9', 'tp10']);

/** The share is taken over this many seconds. Provisional. */
export const FIT_WINDOW_SECONDS = 20;
/** "Settling" until the window holds this many seconds since the headset connected or was put back on. Provisional. */
export const FIT_SETTLE_SECONDS = 10;
/** An ear sensor is `good` at this share or more. Provisional. */
export const FIT_GOOD_SHARE = 0.4;
/** An ear sensor is `fair` from this share up to the good line, and `poor` under it. Provisional. */
export const FIT_FAIR_SHARE = 0.2;
/**
 * A headband is ready when its better ear sensor is at this share or more. This is the first group
 * test's pass rule ("the better ear sensor valid for at least 30% of each block"). Provisional.
 */
export const FIT_READY_SHARE = 0.3;
/**
 * A headband that is not ready is told to reseat behind one ear only when that ear sensor is poor and
 * the other is at least this much better; otherwise the whole headband is refitted. Without the
 * margin a headband whose two ear sensors sit near the poor line is told one thing, then the other
 * (with bench-like flicker on a poor fit: 34 changes of instruction in five minutes at 0.10, 4 at 0.15). Provisional.
 */
export const FIT_RESEAT_MARGIN = 0.15;
/** No fresh message on any sensor for this long reads as "no signal from this phone", not as a fit. */
export const FIT_SILENT_SECONDS = 3;
/** Readings closer together than this are one reading, so a caller that polls faster does not weight the window. */
export const FIT_MIN_SAMPLE_SECONDS = 0.25;

export const FIT_RULES = Object.freeze({
  windowSeconds: FIT_WINDOW_SECONDS,
  settleSeconds: FIT_SETTLE_SECONDS,
  goodShare: FIT_GOOD_SHARE,
  fairShare: FIT_FAIR_SHARE,
  readyShare: FIT_READY_SHARE,
  reseatMargin: FIT_RESEAT_MARGIN,
  silentSeconds: FIT_SILENT_SECONDS,
  minSampleSeconds: FIT_MIN_SAMPLE_SECONDS,
});

/** `ready`, `not_ready`: judged. The others say why there is no judgement yet. */
export const FIT_STATES = Object.freeze(['ready', 'not_ready', 'settling', 'headband_off', 'reconnecting', 'no_signal']);
/** What the operator should do, as a code; the screen holds the wording. */
export const FIT_ACTIONS = Object.freeze(['reseat_left', 'reseat_right', 'refit', 'headband_off', 'no_signal']);
// Which reason stands for a sensor that is not valid, most actionable first (the operator screen's order).
const REASON_PRIORITY = Object.freeze(['headband_off', 'no_data', 'stale', 'after_reconnect', 'is_good_0', 'non_finite', 'held', 'below_floor']);

const round = (x) => Math.round(x * 1000) / 1000;

/** good, fair or poor for one ear sensor's share. */
export function earState(share, rules = FIT_RULES) {
  if (!Number.isFinite(share)) return null;
  return share >= rules.goodShare ? 'good' : share >= rules.fairShare ? 'fair' : 'poor';
}

/**
 * The verdict for a headband from its two ear sensors' shares: ready when the better one is at
 * the ready line or above. When it is not, the one instruction: reseat behind an ear when that ear
 * sensor is poor, the other is not, and the other is better by the reseat margin; otherwise (both
 * poor, both fair, or too close to call) refit the headband.
 */
export function headbandVerdict(shares, rules = FIT_RULES) {
  const left = Number.isFinite(shares?.tp9) ? shares.tp9 : 0, right = Number.isFinite(shares?.tp10) ? shares.tp10 : 0;
  const best = Math.max(left, right);
  const ready = best >= rules.readyShare;
  const poor = { tp9: earState(left, rules) === 'poor', tp10: earState(right, rules) === 'poor' };
  const apart = Math.abs(left - right) >= rules.reseatMargin - 1e-9;
  const action = ready ? null : apart && poor.tp9 && !poor.tp10 ? 'reseat_left' : apart && poor.tp10 && !poor.tp9 ? 'reseat_right' : 'refit';
  return { ready, bestEarShare: round(best), action };
}

const reasonsOf = (sensor) => (Array.isArray(sensor?.reasons) ? sensor.reasons : sensor ? [] : ['no_data']);
const primaryReason = (reasons) => REASON_PRIORITY.find((code) => reasons.includes(code)) ?? reasons[0] ?? null;

/**
 * One headset's window.
 *
 * observe(sensors, atSeconds) takes the receiver's C3 `sensors` object as it stands at that time
 * and returns the `fit` view, or null when the receiver has no `sensors` object for the seat (a
 * phone that sends no per-sensor data). view() returns the last one.
 *
 * The window restarts, and the view says why, while the headband is off, in the receiver's
 * after-reconnect window, and when no sensor has had a fresh message for `silentSeconds`. After any
 * of those it reads `settling` until it holds `settleSeconds` again. A sensor counts as valid at a
 * reading exactly when the receiver says so (`valid: true`).
 */
export function createFitWindow(overrides = {}) {
  const rules = { ...FIT_RULES, ...overrides };
  let samples = [];       // { t, valid: [4 booleans], reason: [4 codes or null] }
  let startedAt = null;   // time of the first reading since the window last restarted
  let silentSince = null; // time of the first of an unbroken run of readings with no fresh message
  let lastAt = null, last = null;

  function restart() { samples = []; startedAt = null; }
  const blank = (state, action = null) => ({
    windowSeconds: rules.windowSeconds, settleSeconds: rules.settleSeconds, observedSeconds: 0,
    state, ready: null, bestEarShare: null, action,
    sensors: Object.fromEntries(FIT_SENSORS.map((name) => [name, { share: null, state: null, reason: null }])),
  });

  function observe(sensors, atSeconds) {
    if (!sensors || typeof sensors !== 'object') { restart(); silentSince = null; lastAt = null; last = null; return null; }
    if (!Number.isFinite(atSeconds)) return last;
    if (lastAt !== null && atSeconds >= lastAt && atSeconds - lastAt < rules.minSampleSeconds) return last;
    // Time went backwards, or nothing was read for a while: what the window held is not the last 20 seconds.
    if (lastAt !== null && (atSeconds < lastAt || atSeconds - lastAt > rules.silentSeconds)) { restart(); silentSince = null; }
    lastAt = atSeconds;
    const reasons = FIT_SENSORS.map((name) => reasonsOf(sensors[name]));
    const off = sensors.headbandOn === false || reasons.some((list) => list.includes('headband_off'));
    const reconnecting = reasons.some((list) => list.includes('after_reconnect'));
    const silent = reasons.every((list) => list.includes('no_data') || list.includes('stale'));
    if (off) { restart(); silentSince = null; return (last = blank('headband_off', 'headband_off')); }
    if (reconnecting) { restart(); silentSince = null; return (last = blank('reconnecting')); }
    if (silent) {
      if (silentSince === null) silentSince = atSeconds;
      if (atSeconds - silentSince >= rules.silentSeconds) { restart(); return (last = blank('no_signal', 'no_signal')); }
    } else silentSince = null;

    if (startedAt === null) startedAt = atSeconds;
    samples.push({
      t: atSeconds,
      valid: FIT_SENSORS.map((name) => sensors[name]?.valid === true),
      reason: FIT_SENSORS.map((name, c) => (sensors[name]?.valid === true ? null : primaryReason(reasons[c]))),
    });
    while (samples.length && samples[0].t <= atSeconds - rules.windowSeconds) samples.shift();

    const observedSeconds = Math.min(rules.windowSeconds, atSeconds - startedAt);
    const settling = observedSeconds < rules.settleSeconds;
    const share = FIT_SENSORS.map((_, c) => round(samples.filter((sample) => sample.valid[c]).length / samples.length));
    // The reason a sensor was most often not valid over the window, so the line under a poor sensor holds still.
    const reason = FIT_SENSORS.map((_, c) => {
      const counts = new Map();
      for (const sample of samples) if (sample.reason[c]) counts.set(sample.reason[c], (counts.get(sample.reason[c]) ?? 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1] || REASON_PRIORITY.indexOf(a[0]) - REASON_PRIORITY.indexOf(b[0]))[0]?.[0] ?? null;
    });
    const verdict = headbandVerdict({ tp9: share[0], tp10: share[3] }, rules);
    return (last = {
      windowSeconds: rules.windowSeconds, settleSeconds: rules.settleSeconds, observedSeconds: round(observedSeconds),
      state: settling ? 'settling' : verdict.ready ? 'ready' : 'not_ready',
      ready: settling ? null : verdict.ready,
      bestEarShare: verdict.bestEarShare,
      action: settling ? null : verdict.action,
      // Forehead sensors carry their share and are not judged: `state` is for the ear sensors only.
      sensors: Object.fromEntries(FIT_SENSORS.map((name, c) => [name, {
        share: share[c],
        state: !settling && FIT_EAR_SENSORS.includes(name) ? earState(share[c], rules) : null,
        reason: reason[c],
      }])),
    });
  }

  return { observe, view: () => last, rules };
}

/** One window per seat. */
export function createFitWindows(overrides = {}) {
  const windows = new Map();
  return {
    observe(id, sensors, atSeconds) {
      if (!windows.has(id)) windows.set(id, createFitWindow(overrides));
      return windows.get(id).observe(sensors, atSeconds);
    },
    view: (id) => windows.get(id)?.view() ?? null,
  };
}
