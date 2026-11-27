# Private review and release status

Created November 27, 2026 as a fresh repository for Tier 1. The four source modules
are unchanged extractions; new documentation, small synthetic fixtures and tests
make them usable without the original application. The fit regression file retains
the source's self-contained fit cases; its application-specific rehearsal tail was
replaced by the standalone synthetic integration tests.

## License selected — November 27, 2026

The owner selected the same license as [OpenDNA](https://github.com/corbett3000/OpenDNA/blob/main/LICENSE):
Apache License 2.0, with Copyright 2026 Peter Corbett. `LICENSE` copies that license
text and `package.json` uses `Apache-2.0`. Code and text documentation are covered;
[graphics retain their separate terms](assets/README.md). The repository remains
private, and `private: true` continues to prevent npm publication.

## Before a public release

- Decide contribution/support expectations and a security-reporting contact.
- Review the API and field notes, especially provisional validity thresholds,
  stale quality flags, input validation responsibilities and evidence limits.
- Confirm hosted CI passes and have another developer run the README from a clone.
- Approve public visibility separately. No npm publication is configured.

## Optional later scope

Full synthetic assessment sessions, raw capture, spectral analysis, a standalone
UDP receiver and phone-side code are separate extractions. This edition's fixtures
exercise the four modules only; they do not reproduce full Mind Field scoring.

Case study graphics and synthetic Training screenshots were added at the owner’s
request on November 27, 2026;
see [asset sources](assets/README.md). No SDK, participant data, private project
notes or source Git history are included. Additional media requires an explicit
request; preserve the selected graphics’ attribution and licensing status.
