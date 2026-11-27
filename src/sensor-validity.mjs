// Per-sensor validity for capture v2 (plan contracts C1, C3 and C9).
//
// One instance holds the state of one headset: the latest value of every band on every
// sensor, when each sensor's value last changed, the headset's own quality flags, whether
// the headband is on, and when the headset last reconnected. snapshot() turns that into
// the C3 `sensors` object the engine reads.
//
// Pure: no clock and no I/O. Every time is passed in, in milliseconds on the Mac's clock
// (the time a message was received, or the time of the snapshot). The phone's clock is
// never compared with the Mac's. Replaying a journal through this module therefore gives
// the same labels the live receiver published.
//
// Every threshold is a named constant below, because the bench test on a real headset
// decides whether they are right. createSensorValidity({ rules }) overrides any of them.

import { createSeqTracker } from './seq-tracker.mjs';

/** C1 value order inside every per-sensor message. */
export const SENSORS = Object.freeze(['tp9', 'af7', 'af8', 'tp10']);
export const EAR_SENSORS = Object.freeze(['tp9', 'tp10']);
export const BANDS = Object.freeze(['delta', 'theta', 'alpha', 'beta', 'gamma']);
/** C3 fixed reason list. Reasons are always reported in this order. */
export const REASONS = Object.freeze(['no_data', 'stale', 'non_finite', 'held', 'below_floor', 'is_good_0', 'headband_off', 'after_reconnect']);

export const CAPTURE_V2_PREFIX = '/mindfield/v2/';
export const BAND_ADDRESS_PREFIX = '/mindfield/v2/band/';
export const IS_GOOD_ADDRESS = '/mindfield/v2/is_good';
export const HSI_ADDRESS = '/mindfield/v2/hsi';
export const ARTIFACT_ADDRESS = '/mindfield/v2/artifact';
export const RAW_EEG_ADDRESS = '/mindfield/v2/eeg';

// ---------------------------------------------------------------------------
// The validity rule's constants
// ---------------------------------------------------------------------------

/** The band whose value is "the sensor's value" for `ageMs`, `stale`, `held`, `non_finite` and `below_floor`. */
export const VALUE_BAND = 'alpha';
/** `stale`: the newest message for the value band arrived more than this long ago. */
export const STALE_AFTER_MS = 300;
/** `held`: messages are arriving, but the sensor's value last changed more than this long ago. */
export const HELD_AFTER_MS = 300;
/** `below_floor`: a finite value at or below this many log units. A dead sensor reads near −4.5. */
export const FLOOR_LOG = -3;
/** `after_reconnect`: this long after a reconnect, every sensor of the headset is invalid. */
export const AFTER_RECONNECT_MS = 5000;
/** Band messages resuming after a silence longer than this count as a reconnect. */
export const BAND_SILENCE_RECONNECT_MS = 3000;
/**
 * Whether the headset's `is_good` flag is part of the rule at all. The bench test settles whether
 * it is the flag that marks bad data; switching this off removes `is_good_0` from the rule.
 */
export const USE_IS_GOOD = true;
/**
 * On: a sensor whose `is_good` flag has never arrived is not valid (`is_good_0`), as C9 rules.
 * Off: `is_good_0` only when the latest flag that did arrive is not 1.
 */
export const REQUIRE_IS_GOOD = true;
/**
 * Off: `headband_off` only when the headset's latest artifact packet says the headband is off, as
 * C9 rules: the rate of artifact packets on a real headset is unknown, so their absence must not
 * invalidate data. On: also while no artifact packet has arrived at all.
 */
export const REQUIRE_HEADBAND_REPORT = false;
/**
 * The heartbeat recovery phase that means the headset link is up. Once the seat has been
 * connected, any other phase means it is down (C9).
 */
export const HEADSET_LINK_UP_PHASE = 'healthy';

export const VALIDITY_RULES = Object.freeze({
  valueBand: VALUE_BAND,
  staleAfterMs: STALE_AFTER_MS,
  heldAfterMs: HELD_AFTER_MS,
  floorLog: FLOOR_LOG,
  afterReconnectMs: AFTER_RECONNECT_MS,
  bandSilenceReconnectMs: BAND_SILENCE_RECONNECT_MS,
  useIsGood: USE_IS_GOOD,
  requireIsGood: REQUIRE_IS_GOOD,
  requireHeadbandReport: REQUIRE_HEADBAND_REPORT,
  linkUpPhase: HEADSET_LINK_UP_PHASE,
});

// ---------------------------------------------------------------------------
// Reading values by position
// ---------------------------------------------------------------------------

const BAND_VALUE_COUNT = 7; // seq, tsSec, tsMicros, TP9, AF7, AF8, TP10
const IS_GOOD_VALUE_COUNT = 7; // seq, tsSec, tsMicros, four flags
const HSI_VALUE_COUNT = 6; // tsSec, tsMicros, four fit codes
const ARTIFACT_VALUE_COUNT = 5; // tsSec, tsMicros, headbandOn, blink, jawClench
const FIT_CODES = Object.freeze([1, 2, 4]);

const same = (a, b) => a === b || (a !== a && b !== b); // NaN after NaN is not a change
const age = (atMs, thenMs) => (thenMs === null ? null : Math.max(0, Math.round(atMs - thenMs)));
/** The phone's packet time as one number of microseconds, or null. Only ever compared with another packet time. */
const packetStamp = (sec, micros) => (Number.isInteger(sec) && Number.isInteger(micros) ? sec * 1e6 + micros : null);
/** 1, 0 or null. A boolean in a flag position is accepted. */
const flag = (value) => (value === 1 || value === true ? 1 : value === 0 || value === false ? 0 : null);
const add = (problems, problem) => { if (!problems.includes(problem)) problems.push(problem); };

/**
 * State and rule for one headset.
 *
 * ingest(address, values, atMs) takes one version 2 message: `values` is everything after the
 * address, read by position, NaN kept. It returns null for an address this module does not
 * read (the raw signal, or an unknown address), otherwise
 *   { applied, status, problems }
 * `applied` is false for a repeated or late datagram and for a message too short to read.
 * `problems` lists what did not match the C1 layout. A message with problems never throws
 * and never produces a reading from a guess: a band message with fewer than four sensor
 * values is flagged and gives NaN for all four sensors (C9).
 */
export function createSensorValidity({ rules: overrides = {} } = {}) {
  const rules = { ...VALIDITY_RULES, ...overrides };
  if (!BANDS.includes(rules.valueBand)) throw new Error(`Unknown value band: ${rules.valueBand}`);

  const values = Object.fromEntries(BANDS.map((band) => [band, [undefined, undefined, undefined, undefined]]));
  const bandAt = Object.fromEntries(BANDS.map((band) => [band, null])); // newest new message per band
  const seq = Object.fromEntries([...BANDS.map((band) => `band/${band}`), 'is_good'].map((key) => [key, createSeqTracker()]));
  const changedAt = [null, null, null, null]; // when the value band's value last changed, per sensor
  const isGood = [null, null, null, null];
  const hsi = [null, null, null, null];
  let anyBandAt = null; // newest new band message of any band
  let headbandOn = null, headbandAt = null;
  let reconnectAt = null, reconnects = 0;
  let linkEverUp = false, recoveryPending = false, lastHeartbeatUp = false, lastRecoveryCount = null;
  let messages = 0, problemMessages = 0, lastProblem = null;

  // Signs closer together than the window are one reconnect (C9). Each restarts the window.
  function markReconnect(atMs) {
    if (reconnectAt === null || atMs - reconnectAt >= rules.afterReconnectMs) reconnects += 1;
    reconnectAt = atMs;
  }

  function band(name, v, atMs) {
    const problems = [];
    if (v.length !== BAND_VALUE_COUNT) add(problems, 'value_count');
    const status = seq[`band/${name}`].push(v[0], packetStamp(v[1], v[2]));
    if (status === 'invalid') add(problems, 'seq');
    if (status === 'duplicate' || status === 'late') return { applied: false, status, problems };
    if (v.length >= 3 && packetStamp(v[1], v[2]) === null) add(problems, 'timestamp');
    // C9: a message with fewer than four sensor values is flagged and its sensors count as NaN. With values
    // missing, which sensor each remaining value belongs to is not known, so none of them is used.
    const complete = v.length >= BAND_VALUE_COUNT;
    const row = values[name];
    for (let c = 0; c < 4; c += 1) {
      let value = complete ? v[3 + c] : NaN;
      if (typeof value !== 'number') { add(problems, 'value_type'); value = NaN; }
      if (name === rules.valueBand && !same(row[c], value)) changedAt[c] = atMs;
      row[c] = value;
    }
    // Sign 2 of 3: band messages resume after a long silence. The first band message is not a reconnect.
    if (anyBandAt !== null && atMs - anyBandAt > rules.bandSilenceReconnectMs) markReconnect(atMs);
    anyBandAt = atMs;
    bandAt[name] = atMs;
    return { applied: true, status, problems };
  }

  function good(v, atMs) {
    const problems = [];
    if (v.length !== IS_GOOD_VALUE_COUNT) add(problems, 'value_count');
    const status = seq.is_good.push(v[0], packetStamp(v[1], v[2]));
    if (status === 'invalid') add(problems, 'seq');
    if (status === 'duplicate' || status === 'late') return { applied: false, status, problems };
    if (v.length >= 3 && packetStamp(v[1], v[2]) === null) add(problems, 'timestamp');
    const complete = v.length >= IS_GOOD_VALUE_COUNT; // as for a band message: a short one is not read by guesswork
    for (let c = 0; c < 4; c += 1) {
      const value = complete ? flag(v[3 + c]) : null;
      if (complete && value === null) add(problems, 'value_range');
      else if (complete && typeof v[3 + c] !== 'number') add(problems, 'value_type');
      isGood[c] = value === 1 ? 1 : 0; // anything but a clear 1 is "not good"
    }
    return { applied: true, status, problems };
  }

  // `hsi` and `artifact` carry no seq (C1). If a later phone build adds one in front, as WS1 proposed,
  // the count is one higher and the message is read with that offset, and flagged.
  function fit(v) {
    const problems = [];
    let offset = 2;
    if (v.length !== HSI_VALUE_COUNT) {
      add(problems, 'value_count');
      if (v.length < HSI_VALUE_COUNT) return { applied: false, status: 'unreadable', problems };
      if (v.length === HSI_VALUE_COUNT + 1) offset = 3;
    }
    for (let c = 0; c < 4; c += 1) {
      const value = v[offset + c];
      if (typeof value !== 'number') { add(problems, 'value_type'); hsi[c] = null; continue; }
      if (!FIT_CODES.includes(value)) add(problems, 'value_range');
      hsi[c] = Number.isFinite(value) ? value : null;
    }
    return { applied: true, status: 'unsequenced', problems };
  }

  function artifact(v, atMs) {
    const problems = [];
    let offset = 2;
    if (v.length !== ARTIFACT_VALUE_COUNT) {
      add(problems, 'value_count');
      if (v.length < ARTIFACT_VALUE_COUNT) return { applied: false, status: 'unreadable', problems };
      if (v.length === ARTIFACT_VALUE_COUNT + 1) offset = 3;
    }
    const on = flag(v[offset]);
    if (on === null) { add(problems, 'value_range'); return { applied: false, status: 'unreadable', problems }; }
    if (typeof v[offset] !== 'number') add(problems, 'value_type');
    // Sign 1 of 3: the headband returns after being off. A first report of "on" is not a reconnect.
    if (headbandOn === false && on === 1) markReconnect(atMs);
    headbandOn = on === 1;
    headbandAt = atMs;
    return { applied: true, status: 'unsequenced', problems };
  }

  function ingest(address, messageValues, atMs) {
    const v = Array.isArray(messageValues) ? messageValues : [];
    let result;
    if (address.startsWith(BAND_ADDRESS_PREFIX)) {
      const name = address.slice(BAND_ADDRESS_PREFIX.length);
      if (!BANDS.includes(name)) return null;
      result = band(name, v, atMs);
    } else if (address === IS_GOOD_ADDRESS) result = good(v, atMs);
    else if (address === HSI_ADDRESS) result = fit(v);
    else if (address === ARTIFACT_ADDRESS) result = artifact(v, atMs);
    else return null;
    messages += 1;
    if (result.problems.length) {
      problemMessages += 1;
      lastProblem = { address, problems: result.problems, atMs };
    }
    return result;
  }

  /**
   * Sign 3 of 3: one streamer heartbeat. `recoveryPhase` is the phase string as sent (null when the
   * heartbeat carried none) and `recoveryCount` the phone's count of recoveries (null when not a number).
   *
   * The link is up when the phase is `healthy`. Once the seat has been connected (a healthy heartbeat
   * or a band message has been seen), any other phase means the link is down, and the next healthy
   * heartbeat is a reconnect. A rise in the recovery count between two healthy heartbeats is a reconnect
   * too: the recovery happened between them. A headset connecting for the first time is never one.
   */
  function heartbeat({ recoveryPhase = null, recoveryCount = null } = {}, atMs) {
    const up = recoveryPhase === rules.linkUpPhase;
    if (up) {
      const countRose = lastHeartbeatUp && Number.isFinite(recoveryCount) && Number.isFinite(lastRecoveryCount) && recoveryCount > lastRecoveryCount;
      if (recoveryPending || countRose) markReconnect(atMs);
      recoveryPending = false;
      linkEverUp = true;
    } else if (typeof recoveryPhase === 'string' && (linkEverUp || anyBandAt !== null)) recoveryPending = true;
    lastHeartbeatUp = up;
    lastRecoveryCount = recoveryCount;
  }

  /** The C3 `sensors` object at `atMs`. */
  function snapshot(atMs) {
    const valueRow = values[rules.valueBand];
    const valueAt = bandAt[rules.valueBand];
    const stale = valueAt !== null && atMs - valueAt > rules.staleAfterMs;
    const headbandOff = headbandOn === false || (rules.requireHeadbandReport && headbandOn === null);
    const afterReconnect = reconnectAt !== null && atMs - reconnectAt < rules.afterReconnectMs;
    const out = {
      headbandOn,
      headbandOnAgeMs: age(atMs, headbandAt),
      lastReconnectAgeMs: age(atMs, reconnectAt),
    };
    for (let c = 0; c < 4; c += 1) {
      const value = valueRow[c];
      const reasons = [];
      if (value === undefined) reasons.push('no_data');
      else {
        if (stale) reasons.push('stale');
        if (!Number.isFinite(value)) reasons.push('non_finite'); // and never also held (C9)
        else {
          if (!stale && atMs - changedAt[c] > rules.heldAfterMs) reasons.push('held');
          if (!(value > rules.floorLog)) reasons.push('below_floor');
        }
        if (rules.useIsGood && isGood[c] !== 1 && (rules.requireIsGood || isGood[c] !== null)) reasons.push('is_good_0');
        if (headbandOff) reasons.push('headband_off');
        if (afterReconnect) reasons.push('after_reconnect');
      }
      const bands = {};
      for (const name of BANDS) bands[name] = Number.isFinite(values[name][c]) ? values[name][c] : null;
      out[SENSORS[c]] = { bands, ageMs: age(atMs, changedAt[c]), valid: reasons.length === 0, reasons, isGood: isGood[c], hsi: hsi[c] };
    }
    return out;
  }

  /** Counts for the operator's status page and for tests. Not part of C3. */
  function diagnostics() {
    const bySeq = {};
    let missing = 0, restarts = 0;
    for (const [key, tracker] of Object.entries(seq)) {
      const summary = tracker.summary();
      bySeq[key] = summary;
      missing += summary.missing;
      restarts = Math.max(restarts, summary.restarts);
    }
    return { messages, problemMessages, lastProblem, reconnects, missingMessages: missing, counterRestarts: restarts, seq: bySeq };
  }

  return { ingest, heartbeat, snapshot, diagnostics, rules };
}

/** Positions, after the address, of the two heartbeat values the rule reads. */
export const HEARTBEAT_RECOVERY_COUNT_INDEX = 7;
export const HEARTBEAT_RECOVERY_PHASE_INDEX = 9;

/** The two heartbeat values the rule reads, from a heartbeat's values (everything after the address), exactly as sent. */
export function heartbeatRecovery(values) {
  const phase = values?.[HEARTBEAT_RECOVERY_PHASE_INDEX], count = values?.[HEARTBEAT_RECOVERY_COUNT_INDEX];
  return { recoveryPhase: typeof phase === 'string' ? phase : null, recoveryCount: typeof count === 'number' ? count : null };
}
