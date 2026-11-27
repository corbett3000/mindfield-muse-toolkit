# Release status

Created November 27, 2026 as a fresh repository for Tier 1. The four source modules
are unchanged extractions; new documentation, small synthetic fixtures and tests
make them usable without the original application. The fit regression file retains
the source's self-contained fit cases; its application-specific rehearsal tail was
replaced by the standalone synthetic integration tests.

## License selected — November 27, 2026

The owner selected the same license as [OpenDNA](https://github.com/corbett3000/OpenDNA/blob/main/LICENSE):
Apache License 2.0, with Copyright 2026 Peter Corbett. `LICENSE` copies that license
text and `package.json` uses `Apache-2.0`. Code and text documentation are covered;
[graphics retain their separate terms](assets/README.md). `private: true` in
package.json continues to prevent npm publication.

## Public repository — November 27, 2026

The owner authorized public visibility and search-discoverability improvements.
The README introduces Muse EEG signal quality, headband fit checks, OSC packet-loss
tracking and experimental neurofeedback games, with the quick start before the
illustrated walkthrough. Repository topics describe the same supported scope.
The case study remains linked at https://corbett.vc/mindfield/.

This is a source repository, not an npm release or a release of the full Mind Field
application. Code and text use Apache-2.0; graphics keep their separate terms.
Tests use synthetic inputs. Consult the API and field notes for provisional
thresholds, stale quality flags, input-validation responsibilities and evidence limits.

## Maintenance follow-ups

- Document contribution/support expectations and a security-reporting contact.
- Collect independent developer feedback on the quick start and API.
- Expand validation only when corresponding evidence is available.

## Optional later scope

Full synthetic assessment sessions, raw capture, spectral analysis, a standalone
UDP receiver and phone-side code are separate extractions. This edition's fixtures
exercise the four modules only; they do not reproduce full Mind Field scoring.

Case study graphics and synthetic Training screenshots were added at the owner’s
request on November 27, 2026;
see [asset sources](assets/README.md). No SDK, participant data, private project
notes or source Git history are included. Additional media requires an explicit
request; preserve the selected graphics’ attribution and licensing status.
