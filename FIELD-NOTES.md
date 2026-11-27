# Field notes

These are engineering lessons behind the extracted code, not a study of meditation
or a clinical claim. Initial tuning drew on limited bench observations, including
one wearer and one headset; this repository does not establish the full source
project's later participant-testing history. All examples here are synthetic.

1. **Look at a window, not one instant.** Contact validity can flicker. The fit
   module counts valid observations over 20 seconds, with a 10-second settling
   period. Its 30% better-ear threshold is provisional and should be evaluated
   against your hardware, sampling cadence and use case.
2. **Repeated data can look alive.** Fresh packets may carry unchanged values.
   Detect stale packets and held values separately. A constant synthetic input
   can legitimately trigger the held-value rule; change your test signal explicitly.
3. **Keep missing data missing.** An unavailable reading is not zero. Preserve gaps
   through ingestion and keep data quality distinct from any visual fallback.
4. **Use comparable reference conditions.** Personal reference levels can be more
   useful than a universal target, but eyes-open and eyes-closed conditions differ.
   The game can start without a reference; that is not an assessment baseline.
5. **Make play forgiving without claiming extra measurements.** Smoothing,
   hysteresis and a short coast reduce jerky movement. The adaptive level defines
   a game rule, not a measured change in mental state or a guaranteed on-time share.
6. **Count losses explicitly.** Sequence counters help distinguish a quiet sender
   from lost datagrams. Handle wraps and restarts, and retain sender timestamps
   without assuming synchronized device clocks.
7. **Make fit advice actionable.** A suggested left/right reseat or refit is easier
   to act on than raw bands. This toolkit reports advisory state; its caller decides
   whether to permit an experience to start.
8. **Preserve the rules with the result.** A threshold or smoothing change can
   change replay behavior. Record the configuration and game version with any
   downstream result rather than relying on future defaults.

Before drawing claims from a deployment, evaluate it on the actual headsets and
people, with consent and explicit evidence of signal quality. This toolkit's
automated tests establish software contracts only.
