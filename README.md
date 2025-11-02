# node-zklib



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

- [This repo contain the cmd of many machine ] (https://github.com/adrobinoga/zk-protocol/blob/master/protocol.md)

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
```

Each helper wraps the low-level commands (`CMD_TZ_WRQ`, `CMD_TZ_RRQ`, `CMD_USERTZ_WRQ`, `CMD_GRPTZ_WRQ`), handling byte encoding for you. Use `getUserTimezones` / `getGroupTimezones` to inspect current assignments.

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
