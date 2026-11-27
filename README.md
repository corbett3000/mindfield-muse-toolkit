# Mind Field Muse Toolkit: JavaScript EEG Tools

[**Read the Mind Field case study →**](https://corbett.vc/mindfield/)

JavaScript tools for Muse EEG data quality, headband fit checks, OSC packet-loss
tracking and experimental neurofeedback games. Four small, dependency-free modules
extracted from Mind Field, a local shared meditation experience.

Use them to flag stale or poor-contact sensor readings, summarize fit over time,
track missing packets, and turn a usable EEG-derived value into game movement.
Synthetic EEG test data lets you try the toolkit without a headset.

**Version 0.1.0 · Node.js 22+ · No runtime dependencies.** Code and text documentation are licensed under
[Apache License 2.0](LICENSE).
This is not the full Mind Field app, a Muse driver, or a medical device. The
thresholds are provisional engineering choices, not validated clinical criteria.
Muse is a trademark of Interaxon; this project is not affiliated with or endorsed
by Interaxon.

## Quick start

Requires Node.js 22 or newer. There are no third-party dependencies and no build step.

```sh
git clone https://github.com/corbett3000/mindfield-muse-toolkit.git
cd mindfield-muse-toolkit
npm test
npm run demo
```

The demo generates an artificial 30-second stream in memory and prints fit and game
state. It needs no headset, credentials, network connection, clock or local files.
An internet connection is needed to clone the repository; the demo runs offline.

```js
import { createSensorValidity, createFitWindow } from './src/index.mjs';

const validity = createSensorValidity(); // one instance per headset
const fit = createFitWindow();
validity.ingest('/mindfield/v2/is_good', [0, 10, 0, 1, 1, 1, 1], 1000);
validity.ingest('/mindfield/v2/band/alpha', [0, 10, 0, -1, -1.1, -1.2, -0.9], 1000);
const sensors = validity.snapshot(1050); // local receipt time, milliseconds
console.log(fit.observe(sensors, 1.05).state); // settling; fit uses seconds
```

Continue ingesting fresh data, sample snapshots at a regular cadence (normally twice
a second), and call `fit.observe()` with the same local clock converted to seconds.
See [API](docs/api.md) for the required units, return values and important limits.

## Modules

| Module | Purpose |
| --- | --- |
| `sensor-validity` | Labels each sensor with missing, stale, held, poor-contact, non-finite, below-floor, headband-off and reconnect reasons. |
| `fit-window` | Evaluates the better ear over a rolling window and returns an advisory fit state and action code. |
| `seq-tracker` | Counts missing, duplicate and late packets, with wrap and restart handling. |
| `game-signal` | Smooths a usable scalar into an adaptive walk/rest decision with hysteresis and bounded dropout coasting. |

Modules use standard ES modules, accept caller-supplied time and perform no I/O.
The caller validates input, decodes OSC, identifies each headset and owns state.
Do not send untrusted datagrams directly into these APIs without validation.

## Muse EEG input and compatibility

The sensor-validity module expects decoded JavaScript values in the
[Mind Field OSC message format](docs/message-format.md), including sensor quality
and derived EEG bands for TP9, AF7, AF8 and TP10. Adapt your data source to that
format and keep separate state for each headset. This repository does not connect
to a Muse headband over Bluetooth, provide a Muse SDK, or receive OSC packets.

The sequence tracker and adaptive game signal can also be used independently.
See the [API reference](docs/api.md) for input units and the
[synthetic fixtures](fixtures/README.md) for packet gaps, poor contact, stale data
and reconnect examples. Hardware compatibility is not established by these tests.

## The experience behind the toolkit

[![Mind Field temple gate with red maple trees and a red ensō](docs/assets/temple-gate.webp)](https://corbett.vc/mindfield/)

| Silent practice | Mindfield Maze |
| --- | --- |
| [![Silent-practice wall with eight numbered seats during a synthetic rehearsal](docs/assets/wall-poster.jpg)](https://corbett.vc/mindfield/) | [![Eight monk characters in the Mindfield Maze during a synthetic rehearsal](docs/assets/maze-poster.jpg)](https://corbett.vc/mindfield/) |

These synthetic rehearsal previews show the original experience. Visit the
[case study](https://corbett.vc/mindfield/) for the story and videos. Graphics are
credited in [asset sources](docs/assets/README.md); this repository contains the
reusable signal modules, not the full application.

## Training screen walkthrough

[**See every Training step, from setup through the Maze →**](docs/training-walkthrough.md)

The gallery includes 11 screenshots of the actual `/training` interface, using
synthetic session views and invented names. It shows setup, fit, Baseline, all
three practices, the intervening breaks and the Maze.

[![Training setup and complete journey sidebar](docs/assets/training/01-training-setup.png)](docs/training-walkthrough.md)

### Headband fit and sensor connections

[![Fit board showing good and poor ear connections, all four sensor lights, headband-off and reconnecting states](docs/assets/training/03-fit-sensors-detail.png)](docs/training-walkthrough.md#fit-test-good-and-poor-sensor-connections)

TP9/TP10 are the ear sensors; AF7/AF8 are forehead sensors. Green pills show
usable readings at this instant; red dashed pills show unusable readings.
The ear meters summarize the rolling fit window. These are **synthetic UI
examples**, not participant data or evidence of hardware validation.

## Guides

- [Phone message format](docs/message-format.md): derived bands, quality, heartbeat and raw EEG layouts.
- [Field notes](FIELD-NOTES.md): design lessons and evidence limits.
- [Synthetic fixtures](fixtures/README.md): deliberate faults, expected behavior and reproducibility.
- [Extraction record](docs/extraction.json): source revision and SHA-256 for each unchanged module.
- [Release status](docs/review.md): publication scope and possible future work.

## Scope and limitations

This edition implements Tier 1 of the toolkit plan. It contains no participant
recordings, source Git history, private reports, SDK, phone application,
network receiver, cloud hosting or lighting. Approved case study graphics and synthetic Training screenshots
are included for documentation. The raw EEG format is documented;
raw recording and spectral analysis are not implemented here. Full-session scoring
fixtures and the Mind Field scoring engine are also outside this edition.

Validity defaults inspect alpha for freshness and held values, not every band's
freshness. Quality flags persist until replaced. Blink/jaw events do not gate this
rule and there is no motion-artifact detector. A fit verdict cannot certify EEG
quality, and the adaptive game output is not a meditation score. Keep missing
measurements missing, and do not interpret coasting as a new valid observation.

Tests establish deterministic software behavior on synthetic inputs. They do not
establish hardware compatibility, clinical effectiveness or multi-person reliability.
Original source comments refer to historical bench work; they are not claims about
the current extent of validation. See [field notes](FIELD-NOTES.md).

## License

Copyright 2026 Peter Corbett. Code and text documentation are licensed under the
[Apache License, Version 2.0](LICENSE). Case study artwork and screenshots retain
the separate terms in [asset sources](docs/assets/README.md). Third-party trademarks
are not licensed by this project. The repository is public; `private: true` in the
package metadata prevents npm publication. Clone the repository to use this edition.
