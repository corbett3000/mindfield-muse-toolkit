# Synthetic fixtures

`syntheticFrames({ scenario, seconds })` generates plain decoded message arrays in
memory at 100 ms intervals. It never reads the clock, files, random numbers or a
headset. Alpha values are explicitly invented sine waves, rounded to float32.
The sender timestamp is offset by 1,250 ms to expose clock-mixing mistakes.

| Scenario | Designed fault from 15 to 20 seconds | Expected behavior |
| --- | --- | --- |
| `clean` | None | Ears remain valid; fit settles, then is ready. |
| `held-ear` | TP9 value stops changing | TP9 becomes held after 300 ms; TP10 remains valid. |
| `bad-contact` | Ear `is_good` flags are zero | Both ears invalid until flags recover. |
| `headband-off` | Explicit headband-off flag | Fit reports off; return triggers reconnect settling. |
| `silent` | Five seconds of messages omitted | Stale data, no-signal fit, then reconnect settling. |

These are module-level examples, not full assessment sessions or models of a
particular person's EEG. The standalone tests assert designed behaviors at fixed
times. Raw EEG and assessment-score fixtures are outside this first edition.
