# node-zklib

> For contributors and coding agents: please read `AGENTS.md` in this folder for a concise overview of transports, encoders/decoders, realtime events, testing, and integration expectations when working on this fork.



this is a fork that is intended to read real time attendance events from this device:
Firmware Version : Ver 6.60 Nov 7 2014
Platform : ZEM560
DeviceName : rxC9

- install 

```
 npm install --save node-zklib
or yarn add node-zklib
```

```javascript

const ZKLib = require('./zklib')
const test = async () => {


    let zkInstance = new ZKLib('10.20.0.7', 4370, 10000, 'udp', 4000);
    try {
        // Create socket to machine 
        await zkInstance.createSocket()


        // Get general info like logCapacity, user counts, logs count
        // It's really useful to check the status of device 
        console.log(await zkInstance.getInfo())
    } catch (e) {
        console.log(e)
        if (e.code === 'EADDRINUSE') {
        }
    }


    // Get users in machine 
    const users = await zkInstance.getUsers()
    console.log(users)


    // Get all logs in the machine 
    // Currently, there is no filter to take data, it just takes all !!
    const logs = await zkInstance.getAttendances()
    console.log(logs)


    const attendances = await zkInstance.getAttendances('10.20.0.7', (percent, total)=>{
        // this callbacks take params is the percent of data downloaded and total data need to download 
    })

     // YOu can also read realtime log by getRealTimelogs function
  
    // console.log('check users', users)

    zkInstance.getRealTimeLogs((data)=>{
        // do something when some checkin 
        console.log(data)
    })



    // delete the data in machine
    // You should do this when there are too many data in the machine, this issue can slow down machine 
    zkInstance.clearAttendanceLog();


    // Disconnect the machine ( don't do this when you need realtime update :))) 
    await zkInstance.disconnect()

}

test()

 
```

- There are many function you can do just visit zk protocol to see the command and put it in executeCmd function already exist in the ZKLIB 

- Protocol reference: https://github.com/adrobinoga/zk-protocol/blob/master/protocol.md

```javascript
    async executeCmd(command, data=''){
        return await this.functionWrapper(
            ()=> this.zklibTcp.executeCmd(command, data),
            ()=> this.zklibUdp.executeCmd(command , data)
        )
    }

    // unlock the door  
    executeCmd(CMD.CMD_UNLOCK, '')

```

## User Management

Applications can create, edit, and delete device users directly through the public facade. `setUser(info)` is an upsert: passing an existing `uid` updates that user, and passing a new `uid` creates it. Call `refreshData()` after writes so the device persists and applies the change.

```js
const ZKLib = require('node-zklib');

const zk = new ZKLib('192.168.1.75', 4370, 10000, 'udp', 5500);
await zk.createSocket();

await zk.setUser({
  uid: 123,
  userId: 123,
  name: 'Alice',
  password: '4321',
  role: 'user',
  enabled: true
});
await zk.refreshData();

// Editing is the same command with the same uid. Fields returned by getUsers()
// include permissionToken/password data so a read-modify-write does not reset them.
const users = (await zk.getUsers()).data;
const current = users.find(user => Number(user.uid) === 123);
await zk.setUser({ ...current, name: 'Alice B' });
await zk.refreshData();

await zk.deleteUser(123);
await zk.refreshData();
await zk.disconnect();
```

For door access, user CRUD is only one part of the configuration. A PIN/password user must also be allowed by the current access rules: assign the user to a group with `setUserGroup`, ensure that group has valid timezones with `setGroupTimezones`, and ensure the group is present in at least one unlock combination with `setUnlockGroups` or `setUnlockGroup`.

Users can either inherit their schedule from the assigned group or use their own user-level schedule:

```js
await zk.setUserGroup({ uid: 123, group: 1 });
await zk.setUserTimezones({ uid: 123, useGroupTimezones: true });

const inherited = await zk.getUserTimezones(123);
// => { useGroupTimezones: true, useUserTimezones: false, timezones: [...] }

await zk.setUserTimezones({ uid: 123, useUserTimezones: true, timezones: [1, 0, 0] });

const direct = await zk.getUserTimezones(123);
// => { useGroupTimezones: false, useUserTimezones: true, timezones: [1, 0, 0] }
```

Compact access-control devices may read back user timezone mode as a 32-bit flag. `1` means user-level timezones, while values such as `0xfffffffe` mean group-inherited timezones. The decoder normalizes those variants and hides sentinel timezone slots like `0xffff`.

TCP devices may use either 72-byte SSR user records or compact 28-byte records. `getUsers()` detects the record size and reuses it for later writes. If an application needs to create a user over TCP before listing users, pass `{ userPacketSize: 28 }` for compact devices:

```js
const zk = new ZKLib('192.168.1.75', 4370, 10000, 'tcp', undefined, 0, {
  userPacketSize: 28
});
```

## Timezone Helpers

This fork now exposes convenience methods to manage timezones and assignments:

```js
await zkInstance.setTimezone({
  index: 5,
  days: {
    monday: { startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }
  }
});

const tz = await zkInstance.getTimezone(5); // => { index, days }

await zkInstance.setUserTimezones({ uid: 123, timezones: [5], useUserTimezones: true });
await zkInstance.setGroupTimezones({ group: 2, timezones: [5, 0, 0], verifyStyle: 0 });

await zkInstance.setUserGroup({ uid: 123, group: 2 });
const groupInfo = await zkInstance.getUserGroup(123);

await zkInstance.setUnlockGroup({ combination: 1, groups: [2] });
const unlockGroups = await zkInstance.getUnlockGroups();
```

Each helper wraps the low-level commands (`CMD_TZ_WRQ`, `CMD_TZ_RRQ`, `CMD_USERTZ_WRQ`, `CMD_GRPTZ_WRQ`, `CMD_ULG_WRQ`, `CMD_ULG_RRQ`), handling byte encoding for you. Use `getUserTimezones` / `getGroupTimezones` / `getUnlockGroups` to inspect current assignments.

## Diagnostic Logging

Logging is disabled by default. Applications can enable structured logs when diagnosing device communication:

```js
const zk = new ZKLib(ip, 4370, 10000, 'tcp', undefined, commCode, {
  logLevel: 'debug',
  logger: console
});

zk.setLogLevel('trace'); // includes raw packet hex
```

Supported levels are `silent`, `error`, `warn`, `info`, `debug`, and `trace`.

Use `debug` for connection/authentication/command flow and `trace` only for deep protocol diagnostics because it logs raw TCP/UDP packet hex:

```js
zk.setLogger({
  error: line => writeLog(line),
  warn: line => writeLog(line),
  info: line => writeLog(line),
  debug: line => writeLog(line),
  trace: line => writeLog(line)
});
```

For TCP realtime troubleshooting, `trace` shows whether the device sends any bytes after `CMD_REG_EVENT`, the TCP frame boundaries, filtered events, and decoded attendance payloads.

## Protocol Mapping

The high‑level API maps to zk‑protocol commands as follows:

| Method | Command(s) | Notes |
| --- | --- | --- |
| `getInfo()` | `CMD_GET_FREE_SIZES` | Returns user/log counts and capacities. |
| `getUsers()` | `CMD_DATA_WRRQ` + `REQUEST_DATA.GET_USERS` | Streams user records; decoder handles 28B (UDP) or 72B (TCP). |
| `setUser(info)` | `CMD_USER_WRQ` | Uses `encodeUserInfo28` (UDP) or `encodeUserInfo72` (SSR/TCP) based on payload. |
| `deleteUser(uid)` | `CMD_DELETE_USER` | 16‑bit uid. |
| `getAttendances()` | `CMD_DATA_WRRQ` + `REQUEST_DATA.GET_ATTENDANCE_LOGS` | Streams attendance logs (16B/40B variants). |
| `clearAttendanceLog()` | `CMD_CLEAR_ATTLOG` | Clears stored logs. |
| `openDoor()` | `CMD_UNLOCK` | Uses device door‑open delay. |
| `enableDevice()` | `CMD_ENABLEDEVICE` |  |
| `disableDevice()` | `CMD_DISABLEDEVICE` |  |
| `refreshData()` | `CMD_REFRESHDATA` | Recommended after writes. |
| `getTimezone(index)` | `CMD_TZ_RRQ` | Decoder handles 2‑byte+footer and 4‑byte index formats. |
| `setTimezone(info)` | `CMD_TZ_WRQ` | `encodeTimezoneInfo` packs 7×(start,end) day segments. |
| `getUserTimezones(uid)` | `CMD_USERTZ_RRQ` | Returns `{ timezoneFlag, useUserTimezones, useGroupTimezones, timezones:[tz1,tz2,tz3] }`. |
| `setUserTimezones(info)` | `CMD_USERTZ_WRQ` | 3 fixed slots; `flag=1` to use user TZ, `0` group TZ. |
| `getGroupTimezones(group, options?)` | `CMD_GRPTZ_RRQ` | Returns `{ group, timezones, verifyStyle, holiday, format, raw, found, plausible }`. `options.format` selects the packet layout (`legacy8` \| `uint16` \| `compact8` \| `compact32` \| `compact20`; ZEM760 fw 6.60 uses `compact20`). |
| `getDeviceOption(name)` / `setDeviceOption(name, value)` | `CMD_OPTIONS_RRQ` / `CMD_OPTIONS_WRQ` | ASCII device options (`~Platform`, `GVS<group>` verify style on compact panels, …). |
| `setGroupTimezones(info, options?)` | `CMD_GRPTZ_WRQ` | 3 fixed slots; `verifyStyle` + holiday bit. Verified write by default: refreshes, reads back, and throws `ERR_GROUP_TZ_NOT_PERSISTED` if the device ACKed without persisting (some compact firmwares do). `options.verify=false` opts out; `options.format`/`options.formats` select or probe packet layouts; the persisting format is cached for the connection. Constructor option `groupTimezonePacketFormat` pins it up front. |
| `getUserGroup(uid)` | `CMD_USERGRP_RRQ` | Reads the user’s group (1–100). |
| `setUserGroup(info)` | `CMD_USERGRP_WRQ` | Writes user→group membership. |
| `getUnlockGroup(combination)` | `CMD_ULG_RRQ` | Reads one unlock combination, with up to 5 groups. |
| `setUnlockGroup(info)` | `CMD_ULG_WRQ` | Writes one binary unlock combination. |
| `getUnlockGroups()` | `CMD_ULG_RRQ` | Reads all combinations; supports compact ASCII replies like `1:::::::::`. |
| `setUnlockGroups(info)` | `CMD_ULG_WRQ` | Writes compact ASCII unlock-group config from `combinations`. |
| `getRealTimeLogs(cb)` | `CMD_REG_EVENT` | Emits realtime frames; see EF_* flags below. |

Event flags used in realtime:
- `EF_ATTLOG` (1): attendance/log event.
- `EF_VERIFY` (128): verify events (biometric/card; failures often appear here).
- `EF_ALARM` (512): alarms (e.g., misoperation/illegal verify if enabled in device settings).

Timezone notes:
- Devices have fixed 3 timezone slots per user/group; unused slots must be zero. Some firmwares return values like `256` for tz `1` (endianness quirk) — callers may normalize.
- Closed days may read back as 23→0 on some models; treat as “no access”.

Unlock group notes:
- A user can belong to one group, that group can have timezones, and unlock combinations decide which groups can actually release the door.
- Binary unlock combinations have 5 group slots plus `validGroups`. Compact devices may return one ASCII string for all 10 combinations, such as `1:::::::::` for “combination 1 uses group 1”.
- `setUnlockGroups({ combinations })` requires a non-empty `combinations` array. Empty or malformed objects are rejected so apps do not accidentally write `:::::::::` and clear all unlock combinations. To intentionally write raw compact ASCII, pass the string explicitly.

## Tests

- Unit tests live under `test/*.spec.js` and exercise user CRUD plus the new timezone helper methods (`setTimezone`, `setUserTimezones`, `setGroupTimezones`).
- There are optional end-to-end specs for physical devices:
  - `test/e2e-user-lifecycle.spec.js` drives a create → update → delete user cycle.
  - `test/e2e-user-access-groups.spec.js` creates a temporary user, assigns a group, toggles group/user timezone mode, and deletes the user.
  - `test/e2e-unlock-groups.spec.js` writes one temporary unlock combination, verifies readback, and restores the original config.
  They are skipped automatically unless the required environment variables are provided.

### Run unit tests

```bash
npx mocha test/*.spec.js
```

### Run the end-to-end test

```bash
export ZKLIB_E2E_IP=192.168.1.100   # Device IP address
export ZKLIB_E2E_PORT=4370          # Optional, device port
npx mocha test/*.spec.js
```

Additional environment variables:

- `ZKLIB_E2E_INPORT` to change the UDP listening port (default 5500).
- `ZKLIB_E2E_SOCKET_TIMEOUT` to tweak the connection timeout (default 10000 ms).
- `ZKLIB_E2E_TIMEOUT` to override Mocha’s timeout for the e2e suite (default 45000 ms).
- `ZKLIB_E2E_CONNECTION_TYPE` to use `udp` or `tcp` for e2e specs (default `udp`).
- `ZKLIB_E2E_USER_PACKET_SIZE=28` to force compact user writes during the user lifecycle e2e, useful for compact TCP devices.
- `ZKLIB_E2E_USER_ACCESS_GROUPS=1` to enable the user group/timezone mutation e2e.
- `ZKLIB_E2E_ACCESS_UID`, `ZKLIB_E2E_ACCESS_GROUP`, and `ZKLIB_E2E_ACCESS_TIMEZONE` to choose the temporary user/group/timezone for that e2e (defaults: uid 242, group 1, timezone 1).
- `ZKLIB_E2E_UNLOCK_GROUPS=1` to enable the unlock-groups mutation e2e.
- `ZKLIB_E2E_UNLOCK_COMBINATION` and `ZKLIB_E2E_UNLOCK_GROUP` to choose the temporary unlock combination/group (defaults: combination 2, group 1).

**Warning:** the end-to-end scenario mutates real users on the device. Use a dedicated UID or a lab unit.

**Unlock group warning:** the unlock-groups e2e mutates door access rules briefly, then restores the original config in `finally`. Run it only on a lab device or a supervised test door.

**User ID note:** legacy commands (notably `CMD_USERGRP_WRQ/RRQ`) only transmit the low byte of the UID. Keep test/account UIDs ≤ 255 whenever you intend to manage group membership programmatically.
