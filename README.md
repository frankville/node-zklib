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


    let zkInstance = new ZKLib('10.20.0.7', 4370, 10000, 4000);
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
```

Each helper wraps the low-level commands (`CMD_TZ_WRQ`, `CMD_TZ_RRQ`, `CMD_USERTZ_WRQ`, `CMD_GRPTZ_WRQ`), handling byte encoding for you. Use `getUserTimezones` / `getGroupTimezones` to inspect current assignments.

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
| `getUserTimezones(uid)` | `CMD_USERTZ_RRQ` | Returns `{ useGroupTimezones, timezones:[tz1,tz2,tz3] }`. |
| `setUserTimezones(info)` | `CMD_USERTZ_WRQ` | 3 fixed slots; `flag=1` to use user TZ, `0` group TZ. |
| `getGroupTimezones(group)` | `CMD_GRPTZ_RRQ` | Returns `{ group, timezones, verifyStyle, holiday }`. |
| `setGroupTimezones(info)` | `CMD_GRPTZ_WRQ` | 3 fixed slots; `verifyStyle` + holiday bit. |
| `getUserGroup(uid)` | `CMD_USERGRP_RRQ` | Reads the user’s group (1–100). |
| `setUserGroup(info)` | `CMD_USERGRP_WRQ` | Writes user→group membership. |
| `getRealTimeLogs(cb)` | `CMD_REG_EVENT` | Emits realtime frames; see EF_* flags below. |

Event flags used in realtime:
- `EF_ATTLOG` (1): attendance/log event.
- `EF_VERIFY` (128): verify events (biometric/card; failures often appear here).
- `EF_ALARM` (512): alarms (e.g., misoperation/illegal verify if enabled in device settings).

Timezone notes:
- Devices have fixed 3 timezone slots per user/group; unused slots must be zero. Some firmwares return values like `256` for tz `1` (endianness quirk) — callers may normalize.
- Closed days may read back as 23→0 on some models; treat as “no access”.

## Tests

- Unit tests live under `test/*.spec.js` and exercise user CRUD plus the new timezone helper methods (`setTimezone`, `setUserTimezones`, `setGroupTimezones`).
- There is an optional end-to-end spec (`test/e2e-user-lifecycle.spec.js`) that drives a create → update → delete cycle against a physical device.  
  It is skipped automatically unless the required environment variables are provided.

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

**Warning:** the end-to-end scenario mutates real users on the device. Use a dedicated UID or a lab unit.

**User ID note:** legacy commands (notably `CMD_USERGRP_WRQ/RRQ`) only transmit the low byte of the UID. Keep test/account UIDs ≤ 255 whenever you intend to manage group membership programmatically.
