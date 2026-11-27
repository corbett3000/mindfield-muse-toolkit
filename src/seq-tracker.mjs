// Loss accounting from the `seq` counter of capture v2 messages (contracts C1 and C9).
//
// The phone keeps one counter per address. It starts at 0 when the app launches, counts
// up by one per message, goes from 2,147,483,647 back to 0, and carries on across
// Stop/Start and headset reconnects. A gap is a lost message. This tracker also
// recognises a repeated datagram, a late arrival that fills an earlier gap, and a
// counter that started again because the app was relaunched, so a relaunch is never
// reported as millions of lost messages.
//
// Pure: no clock, no I/O. Used by the per-sensor validity state (freshness is "time
// since a new seq arrived") and by the raw-signal recorder.

/** The counter lives in 0 … 2^31 − 1. */
export const SEQ_MODULUS = 2 ** 31;
/** A forward jump of more than this many messages is read as a restarted counter, not as loss. */
export const SEQ_MAX_PLAUSIBLE_GAP = 100_000;
/** A number below this that arrives behind a newest number at or above it is read as a restarted counter. */
export const SEQ_RESTART_BELOW = 16;
/** This many numbers in a row that climb by one while behind the newest one are a restarted counter. */
export const SEQ_RESTART_RUN = 3;
/** Most missing ranges kept per counter. Further gaps are still counted, in `rangesNotListed`. */
export const SEQ_MAX_RANGES = 2000;
/** A late arrival is matched against this many of the most recent missing ranges. */
export const SEQ_LATE_SEARCH_RANGES = 64;

const valid = (seq) => Number.isInteger(seq) && seq >= 0 && seq < SEQ_MODULUS;
/** How far `to` is ahead of `from`, counting round the wrap: 0 … 2^31 − 1. */
const forward = (from, to) => (((to - from) % SEQ_MODULUS) + SEQ_MODULUS) % SEQ_MODULUS;
const after = (seq) => (seq + 1) % SEQ_MODULUS;
const before = (seq) => (seq - 1 + SEQ_MODULUS) % SEQ_MODULUS;

/**
 * push(seq, stamp) returns one of:
 *   first      nothing to compare with (also the first number after reset())
 *   ok         one more than the previous number
 *   gap        ahead of the previous number; the numbers between are missing
 *   late       behind the newest number and inside a known missing range, which it fills
 *   duplicate  behind or equal to the newest number and not missing
 *   restart    the counter started again (app relaunch)
 *   invalid    not a whole number in range
 * A message is new when the result is first, ok, gap or restart.
 *
 * `stamp` is optional: the phone's packet time as one number. When both the newest
 * message and this one carry it, a number behind the newest one with a later stamp is a
 * restart, and with an earlier or equal stamp a duplicate. Without it the two are told
 * apart by SEQ_RESTART_BELOW and SEQ_RESTART_RUN.
 */
export function createSeqTracker({
  maxPlausibleGap = SEQ_MAX_PLAUSIBLE_GAP,
  restartBelow = SEQ_RESTART_BELOW,
  restartRun = SEQ_RESTART_RUN,
  maxRanges = SEQ_MAX_RANGES,
} = {}) {
  let last = null, lastStamp = null; // what the next number is compared with; cleared by reset()
  let first = null, newest = null; // the first and the most recent number accepted, for reporting
  let received = 0, missing = 0, gaps = 0, duplicates = 0, late = 0, restarts = 0, invalid = 0, rangesNotListed = 0;
  let ranges = []; // { fromSeq, toSeq, count }, in arrival order; a range may straddle the wrap
  let behindRun = 0, behindPrevious = null;

  const accept = (seq, stamp) => {
    last = seq;
    newest = seq;
    if (Number.isFinite(stamp)) lastStamp = stamp;
    behindRun = 0;
    behindPrevious = null;
  };
  const restart = (seq, stamp) => {
    restarts += 1;
    lastStamp = null;
    accept(seq, stamp);
    return 'restart';
  };
  function fill(seq) {
    const stop = Math.max(0, ranges.length - SEQ_LATE_SEARCH_RANGES);
    for (let index = ranges.length - 1; index >= stop; index -= 1) {
      const range = ranges[index];
      const offset = forward(range.fromSeq, seq);
      if (offset >= range.count) continue;
      if (range.count === 1) ranges.splice(index, 1);
      else if (offset === 0) { range.fromSeq = after(range.fromSeq); range.count -= 1; }
      else if (offset === range.count - 1) { range.toSeq = before(range.toSeq); range.count -= 1; }
      else {
        const tail = { fromSeq: after(seq), toSeq: range.toSeq, count: range.count - offset - 1 };
        range.toSeq = before(seq);
        range.count = offset;
        ranges.splice(index + 1, 0, tail);
      }
      return true;
    }
    return false;
  }

  function push(seq, stamp = null) {
    if (!valid(seq)) { invalid += 1; return 'invalid'; }
    received += 1;
    if (last === null) {
      if (first === null) first = seq;
      accept(seq, stamp);
      return 'first';
    }
    const ahead = forward(last, seq);
    if (ahead === 1) { accept(seq, stamp); return 'ok'; }
    if (ahead > 1 && ahead <= maxPlausibleGap + 1) {
      const count = ahead - 1;
      missing += count;
      gaps += 1;
      if (ranges.length < maxRanges) ranges.push({ fromSeq: after(last), toSeq: before(seq), count });
      else rangesNotListed += 1;
      accept(seq, stamp);
      return 'gap';
    }
    if (ahead !== 0 && forward(seq, last) > maxPlausibleGap) return restart(seq, stamp); // nowhere near the newest number
    // Equal to the newest number, or behind it and close to it.
    const stamped = Number.isFinite(stamp) && Number.isFinite(lastStamp);
    if (stamped && stamp > lastStamp) return restart(seq, stamp); // a later packet with an earlier number
    if (ahead !== 0 && fill(seq)) { late += 1; missing -= 1; return 'late'; }
    if (stamped || ahead === 0) { duplicates += 1; return 'duplicate'; }
    if (seq < restartBelow && last >= restartBelow) return restart(seq, stamp);
    behindRun = behindPrevious !== null && forward(behindPrevious, seq) === 1 ? behindRun + 1 : 1;
    behindPrevious = seq;
    if (behindRun >= restartRun) {
      duplicates -= behindRun - 1;
      return restart(seq, stamp);
    }
    duplicates += 1;
    return 'duplicate';
  }

  return {
    push,
    /** Forget where the counter was, so the next number is not compared with the last one. Totals are kept. */
    reset() { last = null; lastStamp = null; behindRun = 0; behindPrevious = null; },
    /** Compare the next number with `seq`, as if it had just been received. */
    resume(seq) { if (valid(seq)) { last = seq; lastStamp = null; behindRun = 0; behindPrevious = null; } },
    get last() { return newest; },
    get missing() { return missing; },
    summary() {
      return { received, missing, gaps, duplicates, late, restarts, invalid, firstSeq: first, lastSeq: newest,
        missingRanges: ranges.map((range) => ({ ...range })), rangesNotListed };
    },
    /** Continue from a summary() saved earlier. The next number starts a new stretch (see reset()). */
    restore(saved = {}) {
      received = saved.received ?? 0; missing = saved.missing ?? 0; gaps = saved.gaps ?? 0;
      duplicates = saved.duplicates ?? 0; late = saved.late ?? 0; restarts = saved.restarts ?? 0;
      invalid = saved.invalid ?? 0; rangesNotListed = saved.rangesNotListed ?? 0;
      first = saved.firstSeq ?? null; newest = saved.lastSeq ?? null;
      ranges = (saved.missingRanges ?? []).map((range) => ({ ...range }));
      last = null; lastStamp = null; behindRun = 0; behindPrevious = null;
    },
  };
}
