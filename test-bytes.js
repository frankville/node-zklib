

const fingerPrintEventOk = Buffer.from([0xf4, 0x01, 0x88, 0xfd, 0x80, 0x00,0x00, 0x00,0x02, 0x00,0x00, 0x00,0x01]);

const fingerPrintEventFail = Buffer.from([0xf4, 0x01, 0x88, 0xfd, 0x80, 0x00,0x00, 0x00,0xff, 0xff,0xff, 0xff,0x01]);


const invalidUserIdBuf = Buffer.from([0xff, 0xff,0xff, 0xff]);
//  f4:01:a0:4e:01:00:00:00:02:00:00:87:14:04:1d:12:37:12:00:00:00:00
const fingerPrintAttLogEvent = Buffer.from([0xf4, 0x01, 0x88, 0xfd, 0x01, 0x00,
    0x00, 0x00,0x02, 0x00,0x00, 0x87,0x14,0x04,0x1d,0x12, 0x37,0x12, 0x00,0x00,0x00,0x00]);

    


const buf = fingerPrintAttLogEvent;


const userId = buf.readUIntLE(8, 2);
// Prints: 1234567890ab
console.log("event type: "+buf.readUIntLE(4, 2));

console.log("has user id ? "+!buf.includes(invalidUserIdBuf));

console.log("user id: "+userId);

const att_year = buf.readUIntLE(12, 1);
const att_month = buf.readUIntLE(13, 1);
const att_date = buf.readUIntLE(14, 1);
const att_hour = buf.readUIntLE(15, 1);
const att_min = buf.readUIntLE(16, 1);
const att_sec = buf.readUIntLE(17, 1);
console.log("att date: "+att_year+" "+att_month+" "+att_date+" "+att_hour+" "+att_min+" "+att_sec);