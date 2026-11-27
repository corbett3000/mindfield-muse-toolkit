# Private review and release status

Created November 27, 2026 as a fresh repository for Tier 1. The four source modules
are unchanged extractions; new documentation, small synthetic fixtures and tests
make them usable without the original application. The fit regression file retains
the source's self-contained fit cases; its application-specific rehearsal tail was
replaced by the standalone synthetic integration tests.

## Before a public release

- Select a code license and copyright attribution. `LICENSE` currently reserves
  rights and `package.json` uses `UNLICENSED` and `private: true`.
- Decide contribution/support expectations and a security-reporting contact.
- Review the API and field notes, especially provisional validity thresholds,
  stale quality flags, input validation responsibilities and evidence limits.
- Confirm hosted CI passes and have another developer run the README from a clone.
- Approve public visibility separately. No npm publication is configured.

## Optional later scope

Full synthetic assessment sessions, raw capture, spectral analysis, a standalone
UDP receiver and phone-side code are separate extractions. This edition's fixtures
exercise the four modules only; they do not reproduce full Mind Field scoring.

Three case study graphics were added at the owner’s request on November 27, 2026;
see [asset sources](assets/README.md). No SDK, participant data, private project
notes or source Git history are included. Additional media requires an explicit
request; preserve the selected graphics’ attribution and licensing status.
