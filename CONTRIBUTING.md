# Contributing

Thanks for your interest in this fork of node-zklib. It is a Node.js client for
ZKTeco access/attendance devices, hardened against the quirks of real (often
compact/legacy) firmware.

## Where things are documented

- **`AGENTS.md`** is the source of truth for the protocol: packet formats,
  firmware quirks, per-command conventions, and everything confirmed on
  hardware. Read the relevant section before touching a command.
- **`README.md`** has the public API and usage.

## Tracking work

- Actionable tasks live in **GitHub Issues**. Browse the
  [`good first issue`](https://github.com/frankville/node-zklib/labels/good%20first%20issue)
  and [`needs-hardware`](https://github.com/frankville/node-zklib/labels/needs-hardware)
  labels to find something to pick up.
- `ROADMAP.md` holds only the high-level direction and links back to issues; it
  does not list individual tasks.
- Open an issue before a non-trivial PR so we can agree on the approach.

## Branching

- Never commit directly to `master`. Branch first:
  - `fix/<short-slug>` for fixes
  - `feat/<short-slug>` for features
  - `chore/<short-slug>` for maintenance/docs/refactors

## Tests

- Unit tests use Mocha + Chai + Sinon and live in `test/*.spec.js`:
  ```
  npx mocha test/*.spec.js
  ```
- Add unit tests for any new encode/decode path. When a finding comes from a
  real device, pin the **actual captured bytes** as a fixture (see
  `test/attendance-records.spec.js` and `test/timezone-utils.spec.js`).
- Hardware end-to-end specs are opt-in and gated by env vars (e.g.
  `ZKLIB_E2E_IP`, `ZKLIB_E2E_GROUP_TZ=1`). They read the original state, make a
  temporary change, verify persistence, and restore. Never leave a device
  mutated by a test.

## Conventions worth knowing

- **Verified writes.** Some firmwares reply `ACK_OK` without persisting. Write
  helpers (group timezones, unlock groups) refresh, read back, and throw a
  typed error (`ERR_*_NOT_PERSISTED` / `ERR_*_WRITE_REJECTED`) on mismatch
  rather than trusting the ACK. New mutating commands on quirky data should
  follow the same pattern.
- **Defensive decoders.** Tolerate short buffers and variant headers; several
  compact firmwares use different packet layouts than the documented ones.
  Auto-detect the layout (and score candidates) rather than hardcoding a size —
  see `decodeAttendanceData` and the group-timezone format detection.
- **Keep the public API stable.** Prefer adding methods/options over breaking
  changes.
- **Document quirks** in `AGENTS.md` (and `README.md` where user-facing) as part
  of the same PR.

## PR checklist

- [ ] Transport(s) touched (UDP/TCP) and command ids noted in the description.
- [ ] Unit tests for new encode/decode paths, with real bytes when available.
- [ ] Verified on hardware when changing IO (note device model / firmware).
- [ ] Quirks documented in `AGENTS.md` / `README.md`.
