# Roadmap

High-level direction only. Individual tasks live in
[GitHub Issues](https://github.com/frankville/node-zklib/issues) — this file
does not duplicate them.

## What this fork is for

Making node-zklib reliable against **real, often compact/legacy ZKTeco
firmware**, where documented packet layouts frequently don't match what the
device actually does. Primary integration target: desktop apps managing users,
groups, schedules, and door access without ZKAccess.

## Focus areas

- **Compact-firmware packet formats.** Keep decoders auto-detecting layouts
  (group timezones, attendance records, user records) instead of assuming the
  SSR/documented shapes. Confirmed formats are recorded in `AGENTS.md`.
- **Verified writes.** Extend the "write → refresh → read back → throw on
  mismatch" pattern to any command where firmware can `ACK_OK` without
  persisting.
- **Realtime event decoding.** Correctly decode realtime attendance/verify/alarm
  frames across firmware variants, including the meaning of verify/state fields.

## How to see current work

- All open tasks: the [Issues tab](https://github.com/frankville/node-zklib/issues).
- Tasks blocked on a physical device:
  [`needs-hardware`](https://github.com/frankville/node-zklib/labels/needs-hardware).
- Newcomer-friendly:
  [`good first issue`](https://github.com/frankville/node-zklib/labels/good%20first%20issue).

## Reference device

Most findings so far were confirmed against a **ZEM760, firmware Ver 6.60**, over
TCP. New device/firmware confirmations are very welcome — open a
"Protocol / hardware finding" issue with the raw bytes.
