import test from 'node:test';
import assert from 'node:assert/strict';
import { createSensorValidity, heartbeatRecovery, createSeqTracker, SEQ_MODULUS,
  createFitWindow, createGameSignal, stepGameSignal, gameSignalCoasting,
  GAME_SIGNAL, GAME_SIGNAL_V1, gameSignalRules } from '../src/index.mjs';
import { syntheticFrames } from '../fixtures/synthetic.mjs';

const band = '/mindfield/v2/band/alpha';
function fresh() {
  const v = createSensorValidity();
  v.ingest('/mindfield/v2/is_good', [0, 1, 0, 1, 1, 1, 1], 0);
  v.ingest(band, [0, 1, 0, -1, -1.1, -1.2, -0.9], 0);
  return v;
}

test('missing data stays unavailable; quality flags are required', () => {
  const v = createSensorValidity();
  assert.deepEqual(v.snapshot(0).tp9.reasons, ['no_data']);
  assert.equal(v.snapshot(0).tp9.bands.alpha, null);
  v.ingest(band, [0, 1, 0, -1, -1, -1, -1], 0);
  assert.deepEqual(v.snapshot(0).tp9.reasons, ['is_good_0']);
});

test('freshness is local and distinguishes stale from held', () => {
  const v = fresh();
  assert.equal(v.snapshot(300).tp9.valid, true);
  assert.deepEqual(v.snapshot(301).tp9.reasons, ['stale']);
  v.ingest(band, [1, 9000, 0, -1, -1.1, -1.2, -0.9], 400);
  assert.deepEqual(v.snapshot(450).tp9.reasons, ['held']);
  v.ingest(band, [2, 9000, 100000, -0.8, -1, -1, -1], 500);
  assert.equal(v.snapshot(550).tp9.valid, true);
});

test('short packets do not shift sensor positions or manufacture readings', () => {
  const v = fresh();
  const result = v.ingest(band, [1, 1, 100000, -1, -1], 100);
  assert(result.problems.includes('value_count'));
  for (const name of ['tp9', 'af7', 'af8', 'tp10']) {
    assert.equal(v.snapshot(100)[name].bands.alpha, null);
    assert(v.snapshot(100)[name].reasons.includes('non_finite'));
  }
});

test('non-finite and floor values are invalid without rewriting valid neighbors', () => {
  const v = fresh();
  v.ingest(band, [1, 1, 100000, NaN, Infinity, -3, -0.5], 100);
  const s = v.snapshot(100);
  assert.deepEqual(s.tp9.reasons, ['non_finite']);
  assert.deepEqual(s.af7.reasons, ['non_finite']);
  assert.deepEqual(s.af8.reasons, ['below_floor']);
  assert.equal(s.tp10.valid, true);
});

test('duplicate messages cannot refresh data; metadata problems remain visible', () => {
  const v = fresh();
  assert.equal(v.ingest(band, [0, 1, 0, 0, 0, 0, 0], 200).applied, false);
  assert(v.snapshot(301).tp9.reasons.includes('stale'));
  const malformed = v.ingest(band, ['bad', 2, 0, -1.2, -1, -1, -1], 400);
  assert.equal(malformed.applied, true); // Compatibility behavior, not strict wire validation.
  assert(malformed.problems.includes('seq'));
});

test('headband return suppresses readings for the reconnect window', () => {
  const v = fresh();
  v.ingest('/mindfield/v2/artifact', [1, 100000, 0, 0, 0], 100);
  assert(v.snapshot(100).tp9.reasons.includes('headband_off'));
  v.ingest('/mindfield/v2/artifact', [1, 200000, 1, 0, 0], 200);
  assert(v.snapshot(200).tp9.reasons.includes('after_reconnect'));
  for (let i = 1; i <= 52; i++) v.ingest(band, [i, 1 + Math.floor(i / 10), (i % 10) * 100000, -1 + i / 1000, -1, -1, -1], i * 100);
  assert.equal(v.snapshot(5200).tp9.valid, true);
});

test('heartbeat recovery increments are read from the documented positions', () => {
  const v = fresh();
  const values = ['mindfield.streamer.heartbeat.v2', 0, 'synthetic', 'active', 'connected', 0, 'ready', 0, 'demo', 'healthy', 10, 100, 'synthetic', '', ''];
  assert.deepEqual(heartbeatRecovery(values), { recoveryCount: 0, recoveryPhase: 'healthy' });
  v.heartbeat(heartbeatRecovery(values), 0);
  values[7] = 1;
  v.heartbeat(heartbeatRecovery(values), 100);
  assert(v.snapshot(100).tp9.reasons.includes('after_reconnect'));
});

test('instances isolate headset state and raw EEG is outside validity', () => {
  const a = fresh(), b = createSensorValidity();
  assert.equal(a.snapshot(0).tp9.valid, true);
  assert.equal(b.snapshot(0).tp9.valid, false);
  assert.equal(a.ingest('/mindfield/v2/eeg', [0, 1, 0, 1, 0, 0, 0, 0], 0), null);
});

test('loss tracking handles gaps, late packets, duplicates and wrap', () => {
  const s = createSeqTracker();
  assert.equal(s.push(SEQ_MODULUS - 2, 0), 'first');
  assert.equal(s.push(0, 2), 'gap');
  assert.equal(s.missing, 1);
  assert.equal(s.push(SEQ_MODULUS - 1, 1), 'late');
  assert.equal(s.missing, 0);
  assert.equal(s.push(0, 2), 'duplicate');
  assert.equal(s.push(1, 3), 'ok');
  assert.equal(s.push(-1), 'invalid');
});

test('sender restart and restored totals do not invent huge loss', () => {
  const s = createSeqTracker();
  s.push(100, 1000);
  assert.equal(s.push(0, 2000), 'restart');
  assert.equal(s.missing, 0);
  const restored = createSeqTracker();
  restored.restore(s.summary());
  assert.equal(restored.push(800, 3000), 'first');
  assert.equal(restored.summary().restarts, 1);
  restored.reset();
  assert.equal(restored.summary().received, 3);
});

test('a delayed packet splits a missing range correctly', () => {
  const s = createSeqTracker();
  s.push(10, 10); s.push(14, 14);
  assert.equal(s.push(12, 12), 'late');
  assert.equal(s.missing, 2);
  assert.deepEqual(s.summary().missingRanges, [
    { fromSeq: 11, toSeq: 11, count: 1 }, { fromSeq: 13, toSeq: 13, count: 1 }]);
});

test('game coast ends after three seconds without adapting or inventing samples', () => {
  const s = createGameSignal(-1);
  assert.equal(stepGameSignal(s, 0, 0.5), true);
  const saved = { level: s.level, smooth: s.smooth, spread: s.spread };
  assert.equal(stepGameSignal(s, null, 3), true);
  assert.equal(gameSignalCoasting(s), true);
  assert.equal(stepGameSignal(s, null, 0.01), false);
  assert.equal(gameSignalCoasting(s), false);
  assert.deepEqual({ level: s.level, smooth: s.smooth, spread: s.spread }, saved);
  stepGameSignal(s, -2, 0.5);
  assert.equal(s.gapSeconds, 0);
});

test('legacy game has no coast and fallback rules retain legacy behavior', () => {
  const s = createGameSignal(-1, GAME_SIGNAL_V1);
  assert.equal(stepGameSignal(s, 0, 0.5, GAME_SIGNAL_V1), true);
  assert.equal(stepGameSignal(s, null, 0.5, GAME_SIGNAL_V1), false);
  assert.equal(gameSignalRules({}), GAME_SIGNAL_V1);
  assert.equal(gameSignalRules({ difficultyVersion: GAME_SIGNAL.version }), GAME_SIGNAL);
});

test('flat input and a missing initial baseline do not manufacture movement', () => {
  const s = createGameSignal();
  for (let i = 0; i < 100; i++) assert.equal(stepGameSignal(s, -1, 0.5), false);
  assert.equal(s.level, -1);
  assert.equal(stepGameSignal(s, NaN, 0.5), false);
});

function replay(scenario) {
  const v = createSensorValidity(), fit = createFitWindow(), observations = new Map();
  for (const { atMs, messages } of syntheticFrames({ scenario, seconds: 30 })) {
    for (const { address, values } of messages) v.ingest(address, values, atMs);
    if (atMs % 500 === 0) {
      const sensors = v.snapshot(atMs + 50);
      observations.set(atMs, { sensors, fit: fit.observe(sensors, (atMs + 50) / 1000) });
    }
  }
  return observations;
}

test('clean synthetic stream yields stable fit after settling', () => {
  const rows = replay('clean');
  assert.equal(rows.get(0).fit.state, 'settling');
  assert.equal(rows.get(10000).fit.state, 'ready');
  assert.equal(rows.get(30000).fit.bestEarShare, 1);
});

test('held ear does not invalidate the other ear', () => {
  const row = replay('held-ear').get(16000);
  assert(row.sensors.tp9.reasons.includes('held'));
  assert.equal(row.sensors.tp10.valid, true);
  assert.equal(row.fit.state, 'ready');
});

test('contact fault and recovery are visible', () => {
  const rows = replay('bad-contact');
  assert(rows.get(16000).sensors.tp9.reasons.includes('is_good_0'));
  assert.equal(rows.get(20000).sensors.tp9.valid, true);
});

test('headband removal resets fit, then reconnect and settling precede a verdict', () => {
  const rows = replay('headband-off');
  assert.equal(rows.get(15000).fit.state, 'headband_off');
  assert.equal(rows.get(20000).fit.state, 'reconnecting');
  assert.equal(rows.get(25000).fit.state, 'settling');
  assert.equal(rows.get(30000).fit.ready, null);
});

test('silence becomes no signal, then recovery restarts fit', () => {
  const rows = replay('silent');
  assert.equal(rows.get(19000).fit.state, 'no_signal');
  assert.equal(rows.get(20000).fit.state, 'reconnecting');
});

test('fixtures reproduce byte-for-byte and reject unbounded duration', () => {
  assert.deepEqual([...syntheticFrames()], [...syntheticFrames()]);
  assert.throws(() => [...syntheticFrames({ seconds: Infinity })], RangeError);
  assert.throws(() => [...syntheticFrames({ scenario: 'unknown' })]);
});
