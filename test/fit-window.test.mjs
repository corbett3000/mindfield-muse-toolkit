// The fit check's rolling share and its ready rule (services/training/fit-window.mjs), against
// sequences worked by hand, then against bench-like flicker through the real receiver rule.
import assert from 'node:assert/strict';
import {
  FIT_WINDOW_SECONDS, FIT_SETTLE_SECONDS, FIT_GOOD_SHARE, FIT_FAIR_SHARE, FIT_READY_SHARE, FIT_RESEAT_MARGIN, FIT_SILENT_SECONDS, FIT_RULES,
  FIT_STATES, FIT_ACTIONS, createFitWindow, createFitWindows, earState, headbandVerdict,
} from '../src/fit-window.mjs';

// --- the constants ------------------------------------------------------------------------------
assert.deepEqual([FIT_WINDOW_SECONDS, FIT_SETTLE_SECONDS, FIT_GOOD_SHARE, FIT_FAIR_SHARE, FIT_READY_SHARE, FIT_RESEAT_MARGIN, FIT_SILENT_SECONDS], [20, 10, 0.4, 0.2, 0.3, 0.15, 3]);
assert.deepEqual(FIT_RULES, { windowSeconds: 20, settleSeconds: 10, goodShare: 0.4, fairShare: 0.2, readyShare: 0.3, reseatMargin: 0.15, silentSeconds: 3, minSampleSeconds: 0.25 });
assert.deepEqual(FIT_STATES, ['ready', 'not_ready', 'settling', 'headband_off', 'reconnecting', 'no_signal']);
assert.deepEqual(FIT_ACTIONS, ['reseat_left', 'reseat_right', 'refit', 'headband_off', 'no_signal']);

// --- good, fair, poor; ready -------------------------------------------------------------------
assert.deepEqual([1, 0.4, 0.399, 0.2, 0.199, 0].map((share) => earState(share)), ['good', 'good', 'fair', 'fair', 'poor', 'poor']);
assert.equal(earState(NaN), null);
const verdict = (tp9, tp10) => { const v = headbandVerdict({ tp9, tp10 }); return [v.ready, v.action, v.bestEarShare]; };
assert.deepEqual(verdict(0.55, 0.5), [true, null, 0.55]);
assert.deepEqual(verdict(0.3, 0), [true, null, 0.3], 'The better ear sensor at exactly 30% is ready: the group test rule');
assert.deepEqual(verdict(0.6, 0.1), [true, null, 0.6], 'One good ear sensor is enough');
assert.deepEqual(verdict(0.299, 0.25), [false, 'refit', 0.299], 'Both fair and neither at 30%: refit');
assert.deepEqual(verdict(0.1, 0.25), [false, 'reseat_left', 0.25], 'Only the left ear sensor is poor, and the right is 15 points better');
assert.deepEqual(verdict(0.29, 0.1), [false, 'reseat_right', 0.29], 'Only the right ear sensor is poor, and the left is 19 points better');
assert.deepEqual(verdict(0.275, 0.175), [false, 'refit', 0.275], 'One poor, one fair, ten points apart: under the margin');
assert.deepEqual(verdict(0.25, 0.19), [false, 'refit', 0.25], 'One poor, one fair, six points apart: too close to say which ear');
assert.deepEqual(verdict(0.1, 0.15), [false, 'refit', 0.15], 'Both poor');
assert.deepEqual(verdict(0, 0), [false, 'refit', 0]);

// --- the receiver's object, built by hand -------------------------------------------------------
const sensor = (valid, reasons = ['held', 'is_good_0']) => ({ valid, reasons: valid ? [] : reasons, isGood: valid ? 1 : 0, hsi: 1, ageMs: valid ? 60 : 4000 });
const head = ({ tp9 = true, af7 = true, af8 = true, tp10 = true, headbandOn = true, reasons } = {}) => ({
  headbandOn, headbandOnAgeMs: 40, lastReconnectAgeMs: null,
  tp9: sensor(tp9, reasons), af7: sensor(af7, reasons), af8: sensor(af8, reasons), tp10: sensor(tp10, reasons),
});
/** Feeds `ticks` readings half a second apart, starting at `from`; `at(k)` gives the head at reading k. Returns the last view. */
function feed(window, from, ticks, at) {
  let view = null;
  for (let k = 0; k < ticks; k += 1) view = window.observe(at(k), from + k / 2);
  return view;
}
const shares = (view) => Object.fromEntries(Object.entries(view.sensors).map(([name, s]) => [name, s.share]));
const states = (view) => Object.fromEntries(Object.entries(view.sensors).map(([name, s]) => [name, s.state]));

// A phone that sends no per-sensor data: no fit at all.
{
  const window = createFitWindow();
  assert.equal(window.observe(null, 0), null);
  assert.equal(window.observe(undefined, 1), null);
  assert.equal(window.view(), null);
}

// Settling until the window holds ten seconds, then the share over what it holds, then over twenty seconds.
{
  const window = createFitWindow();
  // TP9 valid on 11 of every 20 readings (55%); TP10 on 5 of every 20 (25%); AF7 always; AF8 never.
  const at = (k) => head({ tp9: k % 20 < 11, tp10: k % 20 < 5, af8: false });
  let view = feed(window, 100, 20, at); // readings at 100.0 … 109.5: 9.5 s held
  assert.equal(view.state, 'settling'); assert.equal(view.ready, null); assert.equal(view.action, null);
  assert.equal(view.observedSeconds, 9.5);
  assert.deepEqual(states(view), { tp9: null, af7: null, af8: null, tp10: null }, 'No sensor is judged while settling');
  view = window.observe(at(20), 110); // the 21st reading: 10.0 s held
  assert.equal(view.state, 'ready'); assert.equal(view.ready, true); assert.equal(view.observedSeconds, 10);
  // 21 readings, k = 0 … 20: TP9 valid for k 0…10 and 20 (12), TP10 for k 0…4 and 20 (6).
  assert.deepEqual(shares(view), { tp9: 0.571, af7: 1, af8: 0, tp10: 0.286 });
  assert.deepEqual(states(view), { tp9: 'good', af7: null, af8: null, tp10: 'fair' }, 'Forehead sensors carry a share and are not judged');
  assert.equal(view.bestEarShare, 0.571);
  // Forty more readings: the window now holds the last 40 (20 s), two whole cycles.
  for (let k = 21; k < 60; k += 1) view = window.observe(at(k), 100 + k / 2);
  assert.deepEqual(shares(view), { tp9: 0.55, af7: 1, af8: 0, tp10: 0.25 });
  assert.equal(view.observedSeconds, 20);
  assert.equal(view.state, 'ready'); assert.equal(view.action, null);
  assert.deepEqual([view.sensors.tp9.reason, view.sensors.tp10.reason, view.sensors.af8.reason, view.sensors.af7.reason], ['is_good_0', 'is_good_0', 'is_good_0', null],
    'The reason a sensor was most often not valid over the window, read in the screen\'s order (poor skin contact before a stuck reading)');
  assert.equal(window.view(), view);
}

// The thresholds on a full window of 40 readings: 16 is good, 15 fair, 8 fair, 7 poor; 12 on the better ear is ready, 11 is not.
{
  const full = (left, right) => feed(createFitWindow(), 0, 80, (k) => head({ tp9: k % 40 < left, tp10: k % 40 < right }));
  const read = (view) => [view.state, view.action, view.sensors.tp9.state, view.sensors.tp10.state, view.sensors.tp9.share, view.sensors.tp10.share];
  assert.deepEqual(read(full(16, 15)), ['ready', null, 'good', 'fair', 0.4, 0.375]);
  assert.deepEqual(read(full(8, 7)), ['not_ready', 'refit', 'fair', 'poor', 0.2, 0.175], 'One reading apart: refit, not one ear');
  assert.deepEqual(read(full(11, 4)), ['not_ready', 'reseat_right', 'fair', 'poor', 0.275, 0.1]);
  assert.deepEqual(read(full(12, 0)), ['ready', null, 'fair', 'poor', 0.3, 0], 'The better ear at 30% is ready, alone');
  assert.deepEqual(read(full(11, 11)), ['not_ready', 'refit', 'fair', 'fair', 0.275, 0.275]);
  assert.deepEqual(read(full(4, 11)), ['not_ready', 'reseat_left', 'poor', 'fair', 0.1, 0.275]);
  assert.deepEqual(read(full(7, 3)), ['not_ready', 'refit', 'poor', 'poor', 0.175, 0.075]);
  assert.deepEqual(read(full(0, 40)), ['ready', null, 'poor', 'good', 0, 1]);
}

// Headband off, back on, the receiver's five seconds after a reconnect, then ten seconds of settling.
{
  const window = createFitWindow();
  const on = () => head();
  let view = feed(window, 0, 41, on); // 0 … 20 s, everything valid
  assert.deepEqual([view.state, view.sensors.tp9.share], ['ready', 1]);
  // Off the head for 20 s: every sensor carries headband_off.
  const off = () => head({ tp9: false, af7: false, af8: false, tp10: false, headbandOn: false, reasons: ['held', 'is_good_0', 'headband_off'] });
  view = feed(window, 20.5, 40, off);
  assert.deepEqual([view.state, view.ready, view.action, view.observedSeconds, view.bestEarShare], ['headband_off', null, 'headband_off', 0, null]);
  assert.deepEqual(shares(view), { tp9: null, af7: null, af8: null, tp10: null });
  // Back on: the receiver marks a reconnect, and for five seconds every sensor carries after_reconnect.
  const back = () => head({ tp9: false, af7: false, af8: false, tp10: false, reasons: ['after_reconnect'] });
  view = feed(window, 40.5, 10, back); // 40.5 … 45.0
  assert.deepEqual([view.state, view.ready, view.action], ['reconnecting', null, null]);
  // From 45.5 the sensors read again, both ears valid on 1 reading in 4. The window starts here.
  const loose = (k) => head({ tp9: k % 4 === 0, tp10: k % 4 === 0 });
  view = feed(window, 45.5, 20, loose); // 45.5 … 55.0: 9.5 s
  assert.deepEqual([view.state, view.observedSeconds], ['settling', 9.5], 'Nothing from before the headband came off counts');
  view = window.observe(loose(20), 55.5);
  assert.deepEqual([view.state, view.action, view.observedSeconds, view.sensors.tp9.share], ['not_ready', 'refit', 10, 0.286], '6 valid of 21 readings since it was put back on');
  // Reseated: both ears valid from here. The verdict follows as the poor stretch leaves the window.
  for (let k = 0; k < 4; k += 1) view = window.observe(head(), 56 + k / 2); // 6 + 4 valid of 25 = 0.4
  assert.deepEqual([view.state, view.sensors.tp9.share, view.sensors.tp9.state], ['ready', 0.4, 'good']);
}

// A reconnect without the headband coming off (band messages resumed, or the heartbeat said so).
{
  const window = createFitWindow();
  feed(window, 0, 41, () => head());
  const view = window.observe({ ...head({ tp9: false, tp10: false, reasons: ['after_reconnect'] }), lastReconnectAgeMs: 400 }, 20.5);
  assert.equal(view.state, 'reconnecting');
  assert.equal(feed(window, 21, 5, () => head()).state, 'settling');
}

// The phone stops sending. A hiccup shorter than three seconds counts as not valid and restarts nothing; three seconds is "no signal".
{
  const window = createFitWindow();
  const stale = () => head({ tp9: false, af7: false, af8: false, tp10: false, reasons: ['stale', 'is_good_0'] });
  let view = feed(window, 0, 41, () => head());
  view = feed(window, 20.5, 2, stale); // 20.5, 21.0: 1 s of silence
  assert.deepEqual([view.state, view.sensors.tp9.share], ['ready', 0.95], '38 valid of the 40 readings in the window');
  view = feed(window, 21.5, 30, () => head());
  assert.deepEqual([view.state, view.sensors.tp9.share], ['ready', 0.95]);
  view = feed(window, 36.5, 6, stale); // silent from 36.5; 39.0 is 2.5 s in
  assert.equal(view.state, 'ready');
  view = window.observe(stale(), 39.5); // 3.0 s
  assert.deepEqual([view.state, view.action, view.ready], ['no_signal', 'no_signal', null]);
  view = window.observe(head(), 40);
  assert.deepEqual([view.state, view.observedSeconds], ['settling', 0], 'When the phone comes back the window starts again');
  // A seat whose phone has sent a version 2 message but no band value yet: no data on every sensor.
  const fresh = createFitWindow(), empty = () => head({ tp9: false, af7: false, af8: false, tp10: false, reasons: ['no_data'] });
  assert.equal(feed(fresh, 0, 6, empty).state, 'settling');
  assert.equal(fresh.observe(empty(), 3).state, 'no_signal');
}

// Readings closer together than a quarter second are one reading; a long gap or a clock that went back starts again.
{
  const window = createFitWindow();
  const first = window.observe(head({ tp9: false }), 0);
  assert.equal(window.observe(head(), 0.1), first, 'A second tab polling faster does not weight the window');
  assert.equal(window.observe(head(), 0.24), first);
  let view = window.observe(head(), 0.5);
  assert.equal(view.sensors.tp9.share, 0.5);
  view = feed(window, 1, 40, () => head());
  assert.equal(view.state, 'ready');
  assert.equal(window.observe(head(), 30).state, 'settling', 'Nothing was read for more than three seconds: the window starts again');
  assert.equal(window.observe(head(), 12).state, 'settling', 'The clock went back');
  assert.equal(window.observe(head(), NaN).state, 'settling');
  // The sensors object disappears (the receiver restarted): no fit, and a fresh window afterwards.
  feed(window, 13, 40, () => head());
  assert.equal(window.observe(null, 33), null);
  assert.equal(window.observe(head(), 33.5).state, 'settling');
}

// One window per seat.
{
  const windows = createFitWindows();
  for (let k = 0; k <= 40; k += 1) { windows.observe('P01', head(), k / 2); windows.observe('P02', head({ tp9: false, tp10: false }), k / 2); }
  assert.deepEqual([windows.view('P01').state, windows.view('P02').state, windows.view('P03')], ['ready', 'not_ready', null]);
  assert.equal(windows.observe('P03', null, 20), null);
}
