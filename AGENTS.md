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
- `helpers/logger.js` — structured logger with `silent`→`trace` levels.
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
  - Unlock groups/combinations: `CMD_ULG_RRQ`, `CMD_ULG_WRQ`
  - Door control: `CMD_UNLOCK`, `CMD_DOORSTATE_RRQ`
  - Realtime events: `CMD_REG_EVENT`, event flags `EF_ATTLOG`, `EF_VERIFY`, `EF_ALARM`

Transport Model
- Both UDP and TCP are supported. The facade picks implementation via `zk.connectionType` (`'udp'` default, `'tcp'` optional).
- Most public methods are identical across transports: `getUsers`, `setUser`, `deleteUser`, `getTimezone`, `setTimezone`, `getUserTimezones`, `setUserTimezones`, `getGroupTimezones`, `setGroupTimezones`, `getUserGroup`, `setUserGroup`, `getUnlockGroup`, `setUnlockGroup`, `getUnlockGroups`, `setUnlockGroups`, `getDeviceOption`, `setDeviceOption`, `openDoor`, `refreshData`, `enableDevice`, `disableDevice`.
- `getDeviceOption(name)` / `setDeviceOption(name, value)` wrap `CMD_OPTIONS_RRQ`/`CMD_OPTIONS_WRQ` (ASCII `Name\0` request, `Name=value\0` write) — used for firmware capability probing (`~Platform`, `~SerialNumber`, …) and for per-group verify style on compact panels (`GVS<group>`).

User Encoding
- 28-byte (UDP) vs 72-byte (SSR/TCP) payloads.
- TCP defaults to SSR/72B unless `getUsers()` has detected compact 28B records, or the caller passes `{ userPacketSize: 28 }` / `userPacketFormat: 'legacy'` in constructor options, or `packetSize: 28` / `format: 'legacy'` in `setUser(info)`.
- Encoders: `encodeUserInfo28` and `encodeUserInfo72`.
  - `name`: ASCII only, padded with `\0`; UDP 8 chars; TCP 24 chars.
  - `password`: ASCII; UDP 5 chars; TCP 8 chars.
  - `userId` (device user-id): UDP path is 32-bit numeric (falls back to `uid`), TCP is 9-byte ASCII.
  - `uid`: 16-bit LE (1–65534 usable). Group ops (`CMD_USERGRP_RRQ/WRQ`) carry the **full uid as u32** — a ZKAccess capture on ZEM760 fw 6.60 shows `d2040000 02` for uid 1234 → group 2, and full-uid reads were verified on hardware. (An earlier encoder bug truncated the uid to one byte here; the old "keep uid ≤ 255 for group ops" advice stemmed from that bug, not from the protocol.)
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
- `decodeUserTimezoneInfo(data)` returns `{ timezoneFlag, useUserTimezones, useGroupTimezones, timezones }`.
  - It supports legacy 16-bit replies and compact 32-bit replies.
  - `flag=1` means user-level timezones; `0`, `0xfffffffe`, and similar non-1 values mean group-inherited timezones.
  - Sentinel slots like `0xffff` / `0xfffffffe` are normalized to `0`.
- `encodeGroupTimezoneInfo({ group, timezones|tz1..tz3, verifyStyle, holiday, format })`
  - Packet formats (`format`, default `legacy8`):
    - `legacy8` — documented zk-protocol layout, 8 bytes: `group(u8)`, `tz1(u16)@1`, `tz2(u16)@3`, `tz3(u16)@5`, `verify+holiday(u8)@7` (B7=holiday, B6..B0=verify style).
    - `uint16` — aligned-word variant, 8 bytes: `group(u16)`, `tz1(u16)`, `tz2(u16)`, `tz3(u16)`; no verify/holiday byte. **Caution:** writing this layout corrupted a group record on at least one compact TCP panel; probe it last.
    - `compact8` — compact firmware variant. Write: `group(u32)`, `tz1(u8)`, `tz2(u8)`, `tz3(u8)`, `verify+holiday(u8)` = 8 bytes. Replies do **not** echo the group: first u32 is a found/valid flag (`1` = record follows), then the 4 record bytes; groups without a record answer just 4 zero bytes. Mirrors how the same firmware answers `CMD_USERTZ_RRQ` (flag u32 + record, uid not echoed).
    - `compact32` — 32-bit variant, 16 bytes: `group(u32)`, `tz1(u32)`, `tz2(u32)`, `tz3(u32)`; no verify/holiday byte.
    - `compact20` — **confirmed on ZEM760 fw Ver 6.60 (captured from a real ZKAccess sync and verified end-to-end)**. Write: `group(u32)`, `valid(u32)` (1 = record active; **0 deletes the record** — pass `valid: false` deliberately, holiday does NOT map here), `tz1(u32)`, `tz2(u32)`, `tz3(u32)` = 20 bytes. Replies: `found(u32)` + tz slots as u32 words (zero-truncated); group/valid are not echoed. Verify style is stored separately in the `GVS<group>` device option (`setDeviceOption('GVS2', 0)`), not in this record. The **holiday flag is NOT in this record and is not synced to the standalone device at all**: toggling ZKAccess "Válido en días festivos" on vs off produced byte-identical `CMD_GRPTZ_WRQ`, identical `GVS<group>`, and no holiday-specific command (the only diff was a redundant, unchanged `CMD_TZ_WRQ` schedule re-push). It appears to be a ZKAccess networked/access-level concept (or a no-op unless holidays are defined under "Días Festivos"). So the `holiday` field is correctly omitted from compact20 encode/decode.
  - Quirk: some firmwares return `256` for tz `1` (endianness artifact); the decoder normalizes exact multiples of 256 (≤50 after division) back to the index. The real compact reply `01 00 00 00 01 00 00 00` decodes to `[0,1,0]` under both `legacy8` (via that normalization) and `uint16`, but to `[1,0,0]` under `compact8`. ZKAccess ground truth on the observed panel was TZ2=1, i.e. `[0,1,0]` — so on that firmware the reply is best read as `found(u16/u32)=1` followed by `tz1(u16) tz2(u16) tz3(u16)`, and the `compact8` byte-record interpretation does not apply to reads there.
- `decodeGroupTimezoneInfo(data, { format, fallbackGroup })` tolerates short buffers; auto-detects `compact32` from 16-byte replies, otherwise defaults to `legacy8` unless `format` is given. Returns `{ group, timezones, verifyStyle, holiday, format, raw, found, plausible }` — `raw` is the hex of the data bytes, `found=false` marks missing records, `plausible=false` flags corrupted records (group outside 1–100 or tz > 50). `compact8` replies use `fallbackGroup` as `group`.
- `setGroupTimezones(info, options)` (both transports and the facade) performs a **verified write** by default because some firmwares reply `ACK_OK` without persisting anything:
  - Flow: `CMD_GRPTZ_WRQ` → `CMD_REFRESHDATA` → `CMD_GRPTZ_RRQ` readback → compare timezones. On mismatch it throws `ERR_GROUP_TZ_NOT_PERSISTED` (with `.attempts` and `.expected` attached). Non-ACK write replies throw `ERR_GROUP_TZ_WRITE_REJECTED`.
  - `options.verify=false` restores fire-and-forget (still refreshes and checks the ACK). `options.refresh=false` skips `CMD_REFRESHDATA`.
  - `options.format` selects the packet format; `options.formats: [...]` probes several in order until one verifies (requires verify). The format that persists is cached on the transport (`groupTimezoneFormat`) and reused for later writes and decode hints.
  - Constructor option `groupTimezonePacketFormat` (`legacy8` | `uint16` | `compact32`) pins the format up front for devices whose variant is known.
  - Raw `Buffer` payloads pass through unverified (escape hatch).

User→Group Assignment
- `encodeUserGroupInfo({ uid, group })` → 5 bytes: `uid(u32)`, `group(u8)`.
- Many models materialize a group only after at least one user belongs to it. Reads for an unused group may return zeros until a user is assigned.

Unlock Groups / Combinations
- `encodeUnlockGroupInfo({ combination, groups, validGroups })` → 8 bytes: `combination(u8)`, 5 group slots (`u8`), `validGroups(u16)`.
- `decodeUnlockGroupInfo(data, fallbackCombination)` handles the binary 8-byte form and compact ASCII forms.
- `decodeUnlockGroupsInfo(data)` returns `{ format, combinations }`; compact devices may return ASCII like `1:::::::::` representing all 10 combinations in one string (ten `:`-separated slots, one per combination 1–10).
- **Multi-group (AND / multi-user) combinations** — a single combination requiring members of several groups (ZKAccess "Verificación Multi-Usuario") — are stored as **concatenated single-digit group numbers** in that slot, with each group's digit **repeated once per required user**. Confirmed on ZEM760 fw 6.60 from two ZKAccess multi-user syncs:
  - 1 user from group 2 + 1 user from group 3 → `CMD_ULG_WRQ` = `1:23::::::::` (token `"23"`).
  - 1 user from group 2 + 2 users from group 3 → `1:233::::::::` (token `"233"` — group 3 repeated).
  - So the token is a multiset of group digits; a group's **user count = how many times its digit appears**, and `validGroups` = the total quorum (token length). Max 5 total users per combination (5 group slots).
  - `decodeUnlockGroupsInfo` splits each digit into `groups` (with duplicates preserved) and adds `groupCounts` (`{ "2": 1, "3": 2 }` for `"233"`). The encoder concatenates `groups` (pass a group number N times to require N users) and **rejects group numbers > 9** (the ASCII form can't disambiguate 2-digit groups). Commas are still tolerated on decode for backward compatibility.
  - The token carries **device** group numbers, which need not match ZKAccess's group names/numbers, and the referenced groups must actually have users assigned (`CMD_USERGRP`) or the AND rule can never be satisfied.
  - Still unconfirmed: the AND behavior at the physical panel (packet format is fully decoded), and how a 2-digit group would be encoded.
- `setUnlockGroups({ combinations }, options?)` writes the compact ASCII form and rejects empty/malformed collection writes to avoid accidental wipe-all payloads; raw ASCII strings/Buffers remain an explicit unverified escape hatch.
- `setUnlockGroup(info, options?)` writes one binary combination unless a prior read detected compact ASCII unlock groups; in that case it updates the full ASCII configuration.
- Both unlock-group writes are **verified by default** (shared helper `helpers/unlockGroups.js`, same pattern as group timezones): write → `CMD_REFRESHDATA` → `getUnlockGroups()` readback → compare. On mismatch they throw `ERR_UNLOCK_GROUPS_NOT_PERSISTED` with `.mismatches` (`[{ combination, expected, actual }]`) and `.readback` attached; non-ACK writes throw `ERR_UNLOCK_GROUPS_WRITE_REJECTED`. `options.verify=false` / `options.refresh=false` opt out. `setUnlockGroups` verification also asserts that combinations omitted from the collection were cleared (the ASCII form always writes all ten slots). Verified end-to-end on the ZEM760.

Stored Attendance Logs
- `getAttendances(cb)` (both transports) reads all stored attendance records via `CMD_DATA_WRRQ` + `REQUEST_DATA.GET_ATTENDANCE_LOGS`. The buffer starts with a 4-byte record-region size, then fixed-size records.
- Record size is firmware-dependent and **auto-detected** by `decodeAttendanceData(body)` — it tries 40/16/8-byte framings, decodes each, and scores by plausible date (year 2000–2099) and uid, since several sizes can divide the buffer evenly. Returns `{ recordSize, records }`. Do not hardcode a size.
  - 40B (SSR): `uid(u16)@0`, `userId(24 ascii)@2`, `status(u8)@26`, `time(u32)@27`, `punch(u8)@31`.
  - 16B (compact, e.g. ZEM760 fw 6.60): `uid(u32)@0`, `time(u32)@4`, `status(u8)@8`, rest zero. No separate ASCII PIN — `deviceUserId` is the numeric uid as a string.
  - 8B (legacy): `uid(u16)@0`, `status(u8)@2`, `time(u32)@3`, `punch(u8)@7`.
- Normalized record shape: `{ userSn, deviceUserId, recordTime (Date), status, punch, denied, ip }`. The old code hardcoded 40B for TCP and 16B/8B for UDP, so `getAttendances()` returned garbage (impossible dates, empty user IDs) on compact firmware.
- On the **16B compact** format the `status` byte is an **access-result code**, not the SSR "verify method": `0` = access granted, `7` = access denied. Confirmed on ZEM760 fw 6.60 by an A/B capture of the same user (denied punch stored `status=7`, granted `status=0`, matching the realtime frames below). `denied` is derived (`status !== 0`) for compact records; for 40B SSR `status`/`punch` keep their standard verify-method / in-out meaning and `denied` is left `false` (not inferred).

Realtime Events
- UDP: `getRealTimeLogs(cb)` registers for realtime frames.
- Event types: `EF_ATTLOG=1`, `EF_VERIFY=128`, `EF_ALARM=512` (see `constants.js`).
- Decoder: `decodeRealTimeEvent(buffer)`
  - Normalizes TCP/UDP framing, probes multiple offsets for event code, and returns a typed JSON.
  - Success attendance: `event_type=1` and `att_date` etc.
  - Access denied vs granted (attendance events, `event_type=1`): the `verif_state` byte carries the result — `0x00` = granted, `0x87` = denied (bit `0x80` = denied flag, low 7 bits = reason; `7` observed for unauthorized-group / "invalid group"). Confirmed on ZEM760 fw 6.60 by capturing the same user (UID 1) denied then granted: the two frames were byte-identical except `verif_state` (`0x87` vs `0x00`) and the timestamp. The decoders expose a derived `denied` boolean (`(verif_state & 0x80) !== 0`). Denied punches ARE logged (both as a realtime `EF_ATTLOG` and in the stored log with `status=7`), so `event_type=1` alone does not mean access was granted — check `denied`.
  - **The low-7-bit "reason" is a generic denied code, not a per-reason code — the device does NOT report *why* it denied over the protocol.** Confirmed on ZEM760 fw 6.60 (2026-07-17) by registering for **all** realtime flags (`0xffff`) and denying user 4 two different ways: a **closed group timezone** produced `verif_state=135 (0x87)`, byte-identical to the **group-not-in-any-unlock-combination** ("grupo inválido") denial, and the stored log `status=7` matched both. No companion frame carried the reason — the only other traffic was `EF_BUTTON` (16) keypad events. The panel screen distinguishes reasons ("grupo inválido" vs timezone) via firmware logic that never reaches the wire. To surface a specific reason to callers, infer it client-side after a `denied` event by walking the device's decision order: group in an unlock combination? (`getUnlockGroups`) → else "invalid group"; group timezone record valid and its schedule covers the punch time? (`getGroupTimezones` + `getTimezone`) → else "outside allowed schedule"; combination requires a multi-user quorum? → "waiting for multi-user".
  - Biometric/card verify failure: `event_type=128` often with an invalid user signature (0xFFFFFFFF). We return an empty payload to signal failure.
  - Wrong PIN/password: many devices don’t emit `EF_VERIFY` for wrong passwords; instead, if “Illegal Verify/Misoperation” is enabled, they emit `EF_ALARM` (512) with `alarm_type="misoperation"`. Otherwise no frame may be sent.

Public API (Facade)
- Usage pattern:
  - `const ZKLib = require('node-zklib');`
  - `const zk = new ZKLib(ip, 4370, timeoutMs, inportForUDP);`
  - `zk.connectionType = 'udp' | 'tcp';`
  - `await zk.createSocket(onError, onClose, onTimeout);`
  - Calls: `zk.getUsers()`, `zk.setUser()`, `zk.deleteUser()`, `zk.getTimezone(i)`, `zk.setTimezone(info)`, `zk.getUserTimezones(uid)`, `zk.setUserTimezones(info)`, `zk.getGroupTimezones(g)`, `zk.setGroupTimezones(info)`, `zk.getUserGroup(uid)`, `zk.setUserGroup(info)`, `zk.getUnlockGroups()`, `zk.setUnlockGroup(info)`, `zk.setUnlockGroups(info)`, `zk.openDoor()`.
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
  - Unlock-groups e2e is mutation-gated by `ZKLIB_E2E_UNLOCK_GROUPS=1`; it writes one temporary combination and restores the original config.
  - Group-timezones e2e is mutation-gated by `ZKLIB_E2E_GROUP_TZ=1`; it probes the packet formats listed in `ZKLIB_E2E_GROUP_TZ_FORMATS` against the spare group `ZKLIB_E2E_GROUP_TZ_GROUP` (default 5), verifies persistence via readback, and restores the original values. It fails when the device ACKs but does not persist. Point it at a group with no members.

Debugging Tips
- Diagnostic logging:
  - Logging is off by default (`silent`).
  - Use `zk.setLogLevel('debug')` for connection/auth/command flow.
  - Use `zk.setLogLevel('trace')` for raw TCP/UDP packet hex and realtime framing details.
  - Apps can redirect logs with `zk.setLogger(logger)` where `logger` exposes `error`, `warn`, `info`, `debug`, and/or `trace`.
  - TCP/UDP realtime paths log registration, raw packets, frame filtering, and parsed events when `trace` is enabled.
- Timezone decoding quirks:
  - Devices may prepend an 8-byte ACK; `decodeTimezoneInfo` auto-skips.
  - Some devices only return a 2-byte index with `0x1ca7` footer; others return a 4-byte header; both are handled.
  - When a slot is blank, the decoder returns the requested index and a zeroed schedule.
- Group readback:
  - If `group-get` returns `group:0`, assign a user to that group and try again.
  - Some firmwares return tz values as 256×index; normalize in callers if needed.

Branching policy (agents)
- Before editing, check: `git status -sb`.
- If you're on `main` or `master`, **do not edit files**. Create a branch first.
- Branch naming convention:
  - `fix/<short-slug>` for fixes
  - `feat/<short-slug>` for features
  - `chore/<short-slug>` for maintenance/docs/refactors

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
- ZKAccess sync flow (captured against a ZEM760, fw Ver 6.60 Oct 16 2019): options handshake (`CMD_OPTIONS_RRQ` for `~Platform`, `~UserExtFmt`, …), then `CMD_DISABLEDEVICE` → write → `CMD_ENABLEDEVICE`, no `CMD_REFRESHDATA`. Schedule upload uses `CMD_TZ_WRQ` with the standard 32-byte layout (index u32 + 7×[startH,startM,endH,endM]) — identical to `encodeTimezoneInfo`.
- Compact TCP panels (ZEM760, fw Ver 6.60 — all confirmed on hardware): `CMD_GRPTZ_WRQ` replies `ACK_OK` without persisting when the payload layout is wrong — never trust the ACK alone (hence verified writes). The working layout is `compact20` (see above); a `ZKLib` constructed with `{ groupTimezonePacketFormat: 'compact20' }` reads and writes group timezones correctly on this panel.
  - `CMD_GRPTZ_RRQ` replies are 4 zero bytes for groups without a record, and `found(u32)=1` + u32 tz slots otherwise; the group number is not echoed (decode uses `fallbackGroup`).
  - Wrong layouts misbehave in three distinct ways: 8-byte payloads are rejected (no ACK_OK) for record-less groups but accepted for existing records, where `legacy8` persists nothing and `uint16` corrupts the record (produced readback `01 00 00 00 70 87 65 00`, `plausible=false`; repaired by rewriting with `compact20`); 16-byte `compact32` gets ACK_OK everywhere but never persists.
  - ZKAccess sync order for a group: `CMD_TZ_WRQ` (schedule), `CMD_GRPTZ_WRQ` (compact20), `CMD_OPTIONS_WRQ GVS<group>=<style>`, then `CMD_USERGRP_WRQ` per member — each bracketed by disable/enable, no `CMD_REFRESHDATA`.
  - **A group's members are denied at the panel ("invalid group") unless the group appears in at least one unlock/opening combination** — verified on hardware: a user in group 2 with a valid group TZ record and correct membership was rejected until `CMD_ULG_WRQ` added group 2, then access was granted immediately. Full access-rule sequence apps must implement: (1) write the schedule (`setTimezone`), (2) write the group timezone record (`setGroupTimezones`, `compact20` on this firmware), (3) optionally set verify style (`setDeviceOption('GVS<group>', style)`), (4) assign users (`setUserGroup`), (5) ensure the group is in an unlock combination (`setUnlockGroup`/`setUnlockGroups`; ASCII form on this firmware, e.g. `1:2::::::::` gives groups 1 and 2 independent single-group access — groups listed **within the same** combination form a multi-user AND, separate combinations are OR).
  - Reads can return a stale copy of the previous reply for a different group (a missing group echoed the prior group's record until a disable/enable + refresh cycle); re-read in a different order before trusting a surprising value.
- Empty user table: `CMD_DATA_WRRQ` is answered with `CMD_ACK_ERROR` and an 8-byte payload (confirmed on a ZEM760, both transports). `requestData` treats `CMD_ACK_ERROR`/`CMD_ACK_UNAUTH` as terminal replies and rejects with `err.code` set; `getUsers()` then confirms via `getInfo()` and returns `{ data: [], err: null }` only when `userCounts` is strictly `0` — `decodeFreeSizes` returns `null` for a field a short reply cannot carry, so a coercing check would read a truncated reply as an empty device.
- UDP sockets accept datagrams from any source. Anything shorter than the 8-byte header must be dropped before a field is read (`isWellFormedUDPFrame`); every `'message'` handler does this first, above its own logging.
- Wrong password attempts: commonly produce EF_ALARM `misoperation` (if enabled) rather than EF_VERIFY.
- UDP name/password truncation: 8/5 characters; TCP SSR allows longer fields.
- Device capacity limits: read live via `getInfo()` (`CMD_GET_FREE_SIZES`) — returns counts, capacities, and available slots for users, fingerprints, and attendance records (the observed ZEM760 reports 10,000 users / 3,000 fingerprints / 50,000 records). Groups (1–100) and timezones (1–50) are fixed protocol ranges not reported by the device; enforce them in callers.

Contact/Safety
- Changes here affect device IO. Favor minimal, well‑tested patches and add tests. Consider pinning by commit in consumers for reproducibility.
