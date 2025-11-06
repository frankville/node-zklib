# AGENTS.md — node-zklib

Purpose
- node-zklib is a Node.js client for ZKTeco access/attendance devices.
- It provides user CRUD, timezone CRUD, user/group timezone assignment, user→group assignment, door control, and realtime event decoding, plus tests.

Scope & Ownership
- This repository is meant to be consumed as a library and integrated into applications (e.g., Electron apps, services, CLIs).

Key Files
- `zklib.js` — public facade; chooses UDP/TCP implementation.
- `zklibudp.js` — UDP transport; user/timezone/group commands; realtime logs.
- `zklibtcp.js` — TCP transport; feature parity for most commands; different realtime framing.
- `utils.js` — binary encoders/decoders for all protocol payloads.
- `constants.js` — command codes, event flags, request templates.
- `helpers/errorLog.js` — minimal logging utilities.
- `test/*.spec.js` — Mocha unit and wrapper tests.

Protocol Reference
- ZKTeco protocol reference: https://github.com/adrobinoga/zk-protocol/blob/master/protocol.md
- Frequently used commands in this repo:
  - Timezones: `CMD_TZ_RRQ`, `CMD_TZ_WRQ`
  - User timezones: `CMD_USERTZ_RRQ`, `CMD_USERTZ_WRQ`
  - Group timezones: `CMD_GRPTZ_RRQ`, `CMD_GRPTZ_WRQ`
  - User group: `CMD_USERGRP_RRQ`, `CMD_USERGRP_WRQ`
  - Door control: `CMD_UNLOCK`, `CMD_DOORSTATE_RRQ`
  - Realtime events: `CMD_REG_EVENT`, event flags `EF_ATTLOG`, `EF_VERIFY`, `EF_ALARM`

Transport Model
- Both UDP and TCP are supported. The facade picks implementation via `zk.connectionType` (`'udp'` default, `'tcp'` optional).
- Most public methods are identical across transports: `getUsers`, `setUser`, `deleteUser`, `getTimezone`, `setTimezone`, `getUserTimezones`, `setUserTimezones`, `getGroupTimezones`, `setGroupTimezones`, `getUserGroup`, `setUserGroup`, `openDoor`, `refreshData`, `enableDevice`, `disableDevice`.

User Encoding
- 28-byte (UDP) vs 72-byte (SSR/TCP) payloads.
- Encoders: `encodeUserInfo28` and `encodeUserInfo72`.
  - `name`: ASCII only, padded with `\0`; UDP 8 chars; TCP 24 chars.
  - `password`: ASCII; UDP 5 chars; TCP 8 chars.
  - `userId` (device user-id): UDP path is 32-bit numeric (falls back to `uid`), TCP is 9-byte ASCII.
  - `uid`: 16-bit LE. Some models only honor the low byte for group-related ops; prefer `uid <= 255` when setting/getting group.
  - `groupNumber` (1–100), `cardNumber` (u32), `enabled` and `role` encoded into a `permissionToken`.
  - Timezone flags for SSR (72B): `userTimezoneFlag`, `useGroupTimezones`, and per-user `timezones` (3 slots).
- Decoders: `decodeUserData28`, `decodeUserData72`.

Timezone Encoding
- `encodeTimezoneInfo({ index, days|schedule, default })` → 32 bytes
  - First 4 bytes: timezone index (u32 LE).
  - 7 day segments × 4 bytes each: `[startHour, startMinute, endHour, endMinute]` (0–23/0–59).
  - Closed days: many firmwares normalize to 23→0 on readback when closed; this is acceptable.
- `decodeTimezoneInfo(data, fallbackIndex)`
  - Handles both shapes: 2-byte index with `0x1ca7` trailer, or 4-byte index header.
  - Skips any leading 8-byte ACK when present.
  - If payload is blank or index is 0, returns the requested `fallbackIndex` and a zeroed schedule.

User/Group Timezones
- Exactly 3 timezone slots are supported by devices. We model them as a fixed array of length 3: `[tz1, tz2, tz3]` where `0` means unused.
- `encodeUserTimezoneInfo({ uid, useUserTimezones|useGroupTimezones, timezones })`
  - 20 bytes: `uid(u32)`, `flag(u32)`, `tz1(u32)`, `tz2(u32)`, `tz3(u32)`.
  - `flag=1` means use per-user timezones; `0` means use group timezones.
- `decodeUserTimezoneInfo(data)` returns `{ useGroupTimezones, timezones }` with 16-bit semantics.
- `encodeGroupTimezoneInfo({ group, timezones|tz1..tz3, verifyStyle, holiday })`
  - 8 bytes: `group(u8)`, `tz1(u16)`, `tz2(u16)`, `tz3(u16)`, `verify+holiday(u8)` (B7=holiday, B6..B0=verify style).
  - Quirk: some firmwares return `256` for tz `1` (endianness artifact). Consumers can normalize (e.g., map exact multiples of 256 to value/256) if needed.
- `decodeGroupTimezoneInfo(data)` tolerates short buffers and returns sensible defaults.

User→Group Assignment
- `encodeUserGroupInfo({ uid, group })` → 5 bytes: `uid(u32)`, `group(u8)`.
- Many models materialize a group only after at least one user belongs to it. Reads for an unused group may return zeros until a user is assigned.

Realtime Events
- UDP: `getRealTimeLogs(cb)` registers for realtime frames.
- Event types: `EF_ATTLOG=1`, `EF_VERIFY=128`, `EF_ALARM=512` (see `constants.js`).
- Decoder: `decodeRealTimeEvent(buffer)`
  - Normalizes TCP/UDP framing, probes multiple offsets for event code, and returns a typed JSON.
  - Success attendance: `event_type=1` and `att_date` etc.
  - Biometric/card verify failure: `event_type=128` often with an invalid user signature (0xFFFFFFFF). We return an empty payload to signal failure.
  - Wrong PIN/password: many devices don’t emit `EF_VERIFY` for wrong passwords; instead, if “Illegal Verify/Misoperation” is enabled, they emit `EF_ALARM` (512) with `alarm_type="misoperation"`. Otherwise no frame may be sent.

Public API (Facade)
- Usage pattern:
  - `const ZKLib = require('node-zklib');`
  - `const zk = new ZKLib(ip, 4370, timeoutMs, inportForUDP);`
  - `zk.connectionType = 'udp' | 'tcp';`
  - `await zk.createSocket(onError, onClose, onTimeout);`
  - Calls: `zk.getUsers()`, `zk.setUser()`, `zk.deleteUser()`, `zk.getTimezone(i)`, `zk.setTimezone(info)`, `zk.getUserTimezones(uid)`, `zk.setUserTimezones(info)`, `zk.getGroupTimezones(g)`, `zk.setGroupTimezones(info)`, `zk.getUserGroup(uid)`, `zk.setUserGroup(info)`, `zk.openDoor()`.
  - For writes, callers often follow with `zk.refreshData()` to ensure persistence.

Integration Patterns
- Typical flow in apps:
  - Use the public facade (`zklib.js`) with your preferred transport (UDP/TCP).
  - For mutating operations, many apps temporarily disable the device, perform the operation, call `refreshData`, then re‑enable.
  - In Electron apps, expose a minimal IPC surface for users, timezones, groups, and door control.
- Example (as used in zkhome): IPC routes implement user CRUD and timezone/group assignment by delegating to node-zklib methods.

Testing
- Unit tests:
  - `npx mocha node_modules/node-zklib/test/*.spec.js`
  - Suites cover: user encoders (28/72), timezone/group/user-TZ encoders/decoders, UDP/TCP command wrappers.
- E2E (optional; requires hardware):
  - Set env: `ZKLIB_E2E_IP`, `ZKLIB_E2E_PORT`, `ZKLIB_E2E_TIMEOUT`, `ZKLIB_E2E_UID` … (see repo README for specifics), then run selected e2e specs.

Debugging Tips
- Realtime event tracing (UDP): zklibudp logs `[ZK RT RAW]`, `[ZK EVT DETECT]`, `[ZK RT PARSED]` to help classify frames. This is useful when tuning event parsing across models.
- Timezone decoding quirks:
  - Devices may prepend an 8-byte ACK; `decodeTimezoneInfo` auto-skips.
  - Some devices only return a 2-byte index with `0x1ca7` footer; others return a 4-byte header; both are handled.
  - When a slot is blank, the decoder returns the requested index and a zeroed schedule.
- Group readback:
  - If `group-get` returns `group:0`, assign a user to that group and try again.
  - Some firmwares return tz values as 256×index; normalize in callers if needed.

Contribution Guidelines (for Agents)
- Keep the public API surface stable; prefer adding methods over breaking changes.
- For new protocol commands:
  - Confirm structure against `zk-protocol` docs.
  - Add encode/decoder helpers in `utils.js` with unit tests.
  - Add thin wrappers in `zklibudp.js` and `zklibtcp.js`.
  - Prefer defensive decoders: tolerate short buffers and variant headers.
- For writes, ensure callers can trigger `CMD_REFRESHDATA` (either inside wrapper or exposed so higher layers can call it).
- Logging: keep structured logs light and gated; remove noisy debug before releasing unless explicitly requested.

PR Checklist
- [ ] Describe transport(s) touched (UDP/TCP) and command ids.
- [ ] Include unit tests for new encode/decode paths.
- [ ] Verify on hardware when adding/modifying IO (note model/firmware if possible).
- [ ] Document quirks (endianness, index fallback, header offsets) in README and/or this AGENTS.md.
- [ ] Confirm zkhome IPC still works end-to-end for touched flows (users/timezones/groups/realtime).

Known Quirks
- Group materialization: reads for groups without members often return zeros.
- Wrong password attempts: commonly produce EF_ALARM `misoperation` (if enabled) rather than EF_VERIFY.
- UDP name/password truncation: 8/5 characters; TCP SSR allows longer fields.
- Some models honor only the low byte of `uid` for group ops.

Contact/Safety
- Changes here affect device IO. Favor minimal, well‑tested patches and add tests. Consider pinning by commit in consumers for reproducibility.
