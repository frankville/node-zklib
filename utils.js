const { USHRT_MAX , COMMANDS } = require('./constants')
const { log } = require('./helpers/errorLog')


const parseTimeToDate = (time)=>{
    const second = time % 60;
    time = (time - second) / 60;
    const minute = time % 60;
    time = (time - minute) / 60;
    const hour = time % 24;
    time = (time - hour) / 24;
    const day = time % 31 + 1;
    time = (time - (day - 1)) / 31;
    const month = time % 12;
    time = (time - month) / 12;
    const year = time + 2000;
    
    return new Date(year, month, day, hour, minute, second);
}

const parseHexToTime = (hex)=>{
    const time =  {
        year: hex.readUIntLE(0,1),
        month:hex.readUIntLE(1,1),
        date: hex.readUIntLE(2,1),
        hour: hex.readUIntLE(3,1),
        minute: hex.readUIntLE(4,1),
        second: hex.readUIntLE(5,1)
      }
    
      return new Date(2000+ time.year, time.month - 1 , time.date, time.hour, time.minute, time.second)
}

const createChkSum = (buf)=>{
    let chksum = 0;
    for (let i = 0; i < buf.length; i += 2) {
      if (i == buf.length - 1) {
        chksum += buf[i];
      } else {
        chksum += buf.readUInt16LE(i);
      }
      chksum %= USHRT_MAX;
    }
    chksum = USHRT_MAX - chksum - 1;
  
    return chksum;
}

module.exports.createUDPHeader = (command , sessionId, replyId, data)=>{
    const dataBuffer = Buffer.from(data);
    const buf = Buffer.alloc(8 + dataBuffer.length);
  
    buf.writeUInt16LE(command, 0);
    buf.writeUInt16LE(0, 2);
  
    buf.writeUInt16LE(sessionId, 4);
    buf.writeUInt16LE(replyId, 6);
    dataBuffer.copy(buf, 8);
    
    const chksum2 = createChkSum(buf);
    buf.writeUInt16LE(chksum2, 2);
      
    replyId = (replyId + 1) % USHRT_MAX;
    buf.writeUInt16LE(replyId, 6);
    
    return buf
}

module.exports.createTCPHeader = (command , sessionId, replyId, data)=>{
    const dataBuffer = Buffer.from(data);
    const buf = Buffer.alloc(8 + dataBuffer.length);
  
    buf.writeUInt16LE(command, 0);
    buf.writeUInt16LE(0, 2);
  
    buf.writeUInt16LE(sessionId, 4);
    buf.writeUInt16LE(replyId, 6);
    dataBuffer.copy(buf, 8);
    
    const chksum2 = createChkSum(buf);
    buf.writeUInt16LE(chksum2, 2);
      
    replyId = (replyId + 1) % USHRT_MAX;
    buf.writeUInt16LE(replyId, 6);
    
  
    const prefixBuf = Buffer.from([0x50, 0x50, 0x82, 0x7d, 0x13, 0x00, 0x00, 0x00])
  
    prefixBuf.writeUInt16LE(buf.length, 4)
  
    return Buffer.concat([prefixBuf, buf]);
}

const removeTcpHeader  = (buf)=>{
  if (buf.length < 8) {
      return buf;
    }
  
    if (buf.compare(Buffer.from([0x50, 0x50, 0x82, 0x7d]), 0, 4, 0, 4) !== 0) {
      return buf;
    }
  
    return buf.slice(8);
}

module.exports.removeTcpHeader = removeTcpHeader

module.exports.decodeUserData28 = (userData)=>{
    const user = {
      uid: userData.readUIntLE(0, 2),
      role: userData.readUIntLE(2, 1),
      name: userData
        .slice(8,8+8)
        .toString('ascii')
        .split('\0')
        .shift(),
      userId: userData.readUIntLE(24,4)
    };
    return user;
}

module.exports.decodeUserData72 = (userData)=>{
    const user = {
        uid: userData.readUIntLE(0, 2),
        role: userData.readUIntLE(2, 1),
        password: userData
          .subarray(3, 3+8)
          .toString('ascii')
          .split('\0')
          .shift(),
        name: userData
          .slice(11)
          .toString('ascii')
          .split('\0')
          .shift(),
        cardno: userData.readUIntLE(35,4),
        userId: userData
          .slice(48, 48+9)
          .toString('ascii')
          .split('\0')
          .shift(),
      };
      return user;
}

const sanitizeAscii = (value) => {
    if (value === undefined || value === null) {
        return '';
    }
    const str = value.toString();
    return str.replace(/[^\x00-\x7F]/g, '');
};

const writeAsciiField = (buf, value, offset, length) => {
    const clean = sanitizeAscii(value);
    const fieldBuf = Buffer.alloc(length);
    fieldBuf.fill(0);
    if (!clean.length) {
        fieldBuf.copy(buf, offset);
        return;
    }
    const asciiBuf = Buffer.from(clean, 'ascii');
    const sliceLength = Math.min(asciiBuf.length, Math.max(length, 0));
    if (sliceLength > 0) {
        asciiBuf.copy(fieldBuf, 0, 0, sliceLength);
    }
    fieldBuf.copy(buf, offset);
};

const buildPermissionToken = (roleValue, enabled) => {
    let token = 0;
    const normalized = Number.isFinite(roleValue) ? roleValue : 0;
    if (normalized & 0x1) {
        token |= 0x02;
    }
    if (normalized & 0x2) {
        token |= 0x04;
    }
    if (normalized & 0x4) {
        token |= 0x08;
    }
    if (enabled === false) {
        token |= 0x01;
    }
    return token & 0xFF;
};

const ROLE_NAME_TO_VALUE = {
    user: 0,
    enroller: 1,
    admin: 3,
    superadmin: 7
};

const toUInt16 = (value, fallback = 0) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) {
        return fallback;
    }
    const num = Number(value);
    if (num < 0) {
        return 0;
    }
    if (num > 0xFFFF) {
        return 0xFFFF;
    }
    return num;
};

const toUInt32 = (value, fallback = 0) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) {
        return fallback >>> 0;
    }
    const num = Number(value);
    if (num < 0) {
        return 0;
    }
    if (num > 0xFFFFFFFF) {
        return 0xFFFFFFFF;
    }
    return num >>> 0;
};

module.exports.encodeUserInfo72 = (options = {}) => {
    const payload = Buffer.alloc(72);
    payload.fill(0);

    if (options.uid === undefined || options.uid === null) {
        throw new Error('encodeUserInfo72: uid is required');
    }

    payload.writeUInt16LE(toUInt16(options.uid), 0);

    let permissionToken;
    if (options.permissionToken !== undefined && options.permissionToken !== null) {
        permissionToken = options.permissionToken & 0xFF;
    } else {
        let roleValue = options.role;
        if (typeof roleValue === 'string') {
            roleValue = ROLE_NAME_TO_VALUE[roleValue.toLowerCase().trim()] ?? 0;
        }
        permissionToken = buildPermissionToken(Number(roleValue) || 0, options.enabled !== false);
    }
    payload.writeUInt8(permissionToken, 2);

    writeAsciiField(payload, options.password || '', 3, 8);
    writeAsciiField(payload, options.name || '', 11, 24);

    payload.writeUInt32LE(toUInt32(options.cardNumber, options.cardno || 0), 35);
    payload.writeUInt8(toUInt16(options.groupNumber ?? options.group ?? 1) & 0xFF, 39);

    const explicitTzFlag = options.userTimezoneFlag;
    const useGroupTimezones = options.useGroupTimezones;
    const tzFlag = explicitTzFlag !== undefined && explicitTzFlag !== null
        ? toUInt16(explicitTzFlag)
        : (useGroupTimezones === false || (options.timezones && options.timezones.length > 0) ? 1 : 0);
    payload.writeUInt16LE(tzFlag, 40);

    const timezones = Array.isArray(options.timezones) ? options.timezones : [];
    payload.writeUInt16LE(toUInt16(timezones[0] ?? 0), 42);
    payload.writeUInt16LE(toUInt16(timezones[1] ?? 0), 44);
    payload.writeUInt16LE(toUInt16(timezones[2] ?? 0), 46);

    writeAsciiField(payload, options.userId ?? options.userid ?? '', 48, 9);

    return payload;
};

module.exports.encodeUserInfo28 = (options = {}) => {
    const payload = Buffer.alloc(28);
    payload.fill(0);

    if (options.uid === undefined || options.uid === null) {
        throw new Error('encodeUserInfo28: uid is required');
    }

    payload.writeUInt16LE(toUInt16(options.uid), 0);

    let permissionToken;
    if (options.permissionToken !== undefined && options.permissionToken !== null) {
        permissionToken = options.permissionToken & 0xFF;
    } else {
        let roleValue = options.role;
        if (typeof roleValue === 'string') {
            roleValue = ROLE_NAME_TO_VALUE[roleValue.toLowerCase().trim()] ?? 0;
        }
        permissionToken = buildPermissionToken(Number(roleValue) || 0, options.enabled !== false);
    }
    payload.writeUInt8(permissionToken, 2);

    writeAsciiField(payload, options.password || '', 3, 5);
    writeAsciiField(payload, options.name || '', 8, 8);

    const userIdValue = toUInt32(
        options.userId ?? options.userid ?? options.uid,
        toUInt32(options.uid)
    );
    payload.writeUInt32LE(userIdValue, 24);

    return payload;
};

module.exports.toUInt16 = toUInt16;
module.exports.toUInt32 = toUInt32;

const clamp = (value, min, max) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) {
        return min;
    }
    return Math.min(Math.max(Number(value), min), max);
};

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const normaliseDayKey = (key) => {
    if (!key) return null;
    const lower = key.toString().toLowerCase();
    if (lower.startsWith('sun')) return 'sunday';
    if (lower.startsWith('mon')) return 'monday';
    if (lower.startsWith('tue')) return 'tuesday';
    if (lower.startsWith('wed')) return 'wednesday';
    if (lower.startsWith('thu')) return 'thursday';
    if (lower.startsWith('fri')) return 'friday';
    if (lower.startsWith('sat')) return 'saturday';
    return null;
};

const encodeDaySegment = (segment = {}) => {
    const buffer = Buffer.alloc(4);
    const startHour = clamp(segment.startHour ?? segment.start_hour ?? 0, 0, 23);
    const startMinute = clamp(segment.startMinute ?? segment.start_minute ?? 0, 0, 59);
    const endHour = clamp(segment.endHour ?? segment.end_hour ?? 0, 0, 23);
    const endMinute = clamp(segment.endMinute ?? segment.end_minute ?? 0, 0, 59);
    buffer.writeUInt8(startHour, 0);
    buffer.writeUInt8(startMinute, 1);
    buffer.writeUInt8(endHour, 2);
    buffer.writeUInt8(endMinute, 3);
    return buffer;
};

module.exports.encodeTimezoneInfo = (options = {}) => {
    const buffer = Buffer.alloc(32);
    buffer.fill(0);

    if (options.index === undefined || options.index === null) {
        throw new Error('encodeTimezoneInfo: index is required');
    }

    buffer.writeUInt32LE(toUInt32(options.index), 0);

    const schedule = options.days || options.schedule || {};
    const defaultSegment = options.defaultSegment || options.default || null;

    DAYS.forEach((day, idx) => {
        let segment = null;
        if (Array.isArray(schedule)) {
            segment = schedule[idx] ?? defaultSegment;
        } else {
            const normalisedKey = normaliseDayKey(day);
            segment = schedule[normalisedKey] ??
                schedule[day] ??
                schedule[idx] ??
                defaultSegment;
        }
        const dayBuffer = encodeDaySegment(segment || {});
        dayBuffer.copy(buffer, 4 + (idx * 4));
    });

    return buffer;
};

module.exports.decodeTimezoneInfo = (data, fallbackIndex = 0) => {
    if (!Buffer.isBuffer(data) || data.length === 0) {
        return {
            index: fallbackIndex,
            days: normaliseTimezoneSchedule([], null)
        };
    }

    const index = data.length >= 4 ? data.readUInt32LE(0) : data.length >= 2 ? data.readUInt16LE(0) : fallbackIndex;
    const days = {};

    DAYS.forEach((day, idx) => {
        const offset = 4 + (idx * 4);
        if (data.length >= offset + 4) {
            days[day] = {
                startHour: data.readUInt8(offset),
                startMinute: data.readUInt8(offset + 1),
                endHour: data.readUInt8(offset + 2),
                endMinute: data.readUInt8(offset + 3)
            };
        } else {
            days[day] = { startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 };
        }
    });

    return { index, days };
};

module.exports.encodeUserGroupInfo = (options = {}) => {
    const buffer = Buffer.alloc(5);
    buffer.fill(0);

    if (options.uid === undefined || options.uid === null) {
        throw new Error('encodeUserGroupInfo: uid is required');
    }

    buffer.writeUInt8(toUInt16(options.uid) & 0xFF, 0);
    buffer.writeUInt8(toUInt16(options.group ?? options.groupNumber ?? 1) & 0xFF, 4);

    return buffer;
};

module.exports.decodeUserGroupInfo = (data) => {
    if (!Buffer.isBuffer(data) || data.length === 0) {
        return { group: 1 };
    }

    const group = data.length >= 1 ? data.readUInt8(0) : 1;
    return { group };
};

module.exports.encodeUserTimezoneInfo = (options = {}) => {
    const buffer = Buffer.alloc(20);
    buffer.fill(0);

    if (options.uid === undefined || options.uid === null) {
        throw new Error('encodeUserTimezoneInfo: uid is required');
    }

    buffer.writeUInt32LE(toUInt32(options.uid), 0);

    const useUserTimezones = options.useUserTimezones !== undefined
        ? !!options.useUserTimezones
        : !(options.useGroupTimezones === true);

    buffer.writeUInt32LE(useUserTimezones ? 1 : 0, 4);

    const tzList = (useUserTimezones && Array.isArray(options.timezones)) ? options.timezones : [];
    for (let i = 0; i < 3; i++) {
        buffer.writeUInt32LE(toUInt32(tzList[i] ?? 0), 8 + (i * 4));
    }

    return buffer;
};

module.exports.decodeUserTimezoneInfo = (data) => {
    if (!Buffer.isBuffer(data) || data.length < 8) {
        throw new Error('decodeUserTimezoneInfo: invalid buffer');
    }

    const flag = data.readUInt16LE(0);
    const tz1 = data.readUInt16LE(2);
    const tz2 = data.readUInt16LE(4);
    const tz3 = data.readUInt16LE(6);

    return {
        useGroupTimezones: flag === 1,
        timezones: [tz1, tz2, tz3]
    };
};

module.exports.encodeGroupTimezoneInfo = (options = {}) => {
    const buffer = Buffer.alloc(8);
    buffer.fill(0);

    if (options.group === undefined || options.group === null) {
        throw new Error('encodeGroupTimezoneInfo: group is required');
    }

    buffer.writeUInt8(toUInt16(options.group) & 0xFF, 0);
    buffer.writeUInt16LE(toUInt16(options.tz1 ?? options.timezones?.[0] ?? 0), 1);
    buffer.writeUInt16LE(toUInt16(options.tz2 ?? options.timezones?.[1] ?? 0), 3);
    buffer.writeUInt16LE(toUInt16(options.tz3 ?? options.timezones?.[2] ?? 0), 5);

    const verify = clamp(options.verifyStyle ?? options.verify ?? 0, 0, 0x7F);
    const holiday = options.holiday ? 0x80 : 0x00;
    buffer.writeUInt8((verify & 0x7F) | holiday, 7);

    return buffer;
};

module.exports.decodeGroupTimezoneInfo = (data) => {
    if (!Buffer.isBuffer(data) || data.length < 8) {
        throw new Error('decodeGroupTimezoneInfo: invalid buffer');
    }

    const verifyByte = data.readUInt8(7);
    return {
        group: data.readUInt8(0),
        timezones: [
            data.readUInt16LE(1),
            data.readUInt16LE(3),
            data.readUInt16LE(5)
        ],
        verifyStyle: verifyByte & 0x7F,
        holiday: (verifyByte & 0x80) === 0x80
    };
};

module.exports.decodeRecordData40 = (recordData)=>{
    const record = {
        userSn: recordData.readUIntLE(0, 2),
        deviceUserId: recordData
        .slice(2, 2+9)
        .toString('ascii')
        .split('\0')
        .shift(),
        recordTime: parseTimeToDate(recordData.readUInt32LE(27)),
      }
      return record
}

module.exports.decodeRecordData16 = (recordData)=>{

    const record = {
        deviceUserId: recordData.readUIntLE(0, 2),
        recordTime: parseTimeToDate(recordData.readUInt32LE(4))
    }

    return record
}

module.exports.decodeRecordRealTimeLog18 = (recordData)=>{
    const userId = recordData.readUIntLE(8,1)
    const attTime = parseHexToTime(recordData.subarray(12,18))
    return {userId , attTime}
}

const processAlarmLog = (buf) => {

  let json = {};

  let bufAsArray = buf.toString("hex").match(/(..?)/g);

  let alarm_type = "";

  switch(bufAsArray[8]){
    case "35": alarm_type = "exit_button";break;
    case "36": alarm_type = "door_state"; break;
    case "37": alarm_type = "tamper";break;
    case "3a": alarm_type = "misoperation";break;
    default: alarm_type = "unknown (0x"+bufAsArray[8]+")";
  }

  json.alarm_type = alarm_type;

  let alarm_event = "";

  if(buf.byteLength === 16){

    switch(bufAsArray[12]){
      case "01": alarm_event = "door_left_open";break;
      case "04": alarm_event = "door_not_closed"; break;
      case "05": alarm_event = "door_closed";break;
      default: alarm_event = "unknown (0x"+bufAsArray[12]+")";
    }

    json.alarm_event = alarm_event;

  }

  

  return json;

}


const processFingerprintVerifyEvent = (buf) => {
  const invalidUserIdBuf = Buffer.from([0xff, 0xff,0xff, 0xff]); //this indicates that the operation failed (wrong user)
  if(!buf.includes(invalidUserIdBuf)) {

    //the verification succeeded...extract the user serial number and return the object
    return {
      user_sn: buf.readUIntLE(8, 4)
    };
  }else{
    //return empty object indicating that this was an invalid attempt
    return {};
  }

}

const processAttendanceLog = (buf) => {

  let json = {};

  json.user_sn = buf.readUIntLE(8, 2);

  json.verif_type = buf.readUIntLE(10, 1);

  json.verif_state = buf.readUIntLE(11, 1);

  const att_year = buf.readUIntLE(12, 1);
  const att_month = buf.readUIntLE(13, 1);
  const att_date = buf.readUIntLE(14, 1);
  const att_hour = buf.readUIntLE(15, 1);
  const att_min = buf.readUIntLE(16, 1);
  const att_sec = buf.readUIntLE(17, 1);

  json.att_date = new Date((2000+att_year),(att_month-1),att_date,att_hour,att_min,att_sec);

  return json;

}



module.exports.decodeRealTimeEvent = (evData)=>{
  const eventType = evData.readUIntLE(4,2);
  let json = null;

  switch(eventType){
    case 128: json = processFingerprintVerifyEvent(evData); break;
    case 1: json = processAttendanceLog(evData); break;
    case 512: json = processAlarmLog(evData);  break;
    default : json = {}; json.event_type = eventType; json.full_data = evData;
  }

  json.event_type = eventType;
  //const attTime = parseHexToTime(recordData.subarray(12,18))
  return json;
  //return {userId , attTime}
}

module.exports.decodeRecordRealTimeLog52 =(recordData)=>{
  const payload = removeTcpHeader(recordData)
        
  const recvData = payload.subarray(8)

  const userId = recvData.slice(0 , 9)
  .toString('ascii')
  .split('\0')
  .shift()
  

  const attTime = parseHexToTime(recvData.subarray(26,26+6))

  return { userId, attTime}

}

module.exports.decodeUDPHeader = (header)=> {
    const commandId = header.readUIntLE(0,2)
    const checkSum = header.readUIntLE(2,2)
    const sessionId = header.readUIntLE(4,2)
    const replyId = header.readUIntLE(6,2)
    return { commandId , checkSum , sessionId , replyId }
}
module.exports.decodeTCPHeader = (header) => {
    const recvData = header.subarray(8)
    const payloadSize = header.readUIntLE(4,2)

    const commandId = recvData.readUIntLE(0,2)
    const checkSum = recvData.readUIntLE(2,2)
    const sessionId = recvData.readUIntLE(4,2)
    const replyId = recvData.readUIntLE(6,2)
    return { commandId , checkSum , sessionId , replyId , payloadSize }

}


module.exports.exportErrorMessage = (commandValue)=>{
    const keys = Object.keys(COMMANDS)
    for(let i =0 ; i< keys.length; i++){
        if (COMMANDS[keys[i]] === commandValue){
            return keys[i].toString()
        }
    }

    return 'AN UNKNOWN ERROR'
}

module.exports.checkNotEventTCP = (data)=> {
  try{
    data = removeTcpHeader(data)
    const commandId = data.readUIntLE(0,2)
    const event = data.readUIntLE(4,2)
    return event === COMMANDS.EF_ATTLOG && commandId === COMMANDS.CMD_REG_EVENT
  }catch(err){
    log(`[228] : ${err.toString()} ,${data.toString('hex')} `)
    return false 
  }
}

module.exports.checkNotEventUDP = (data)=>{
  const commandId = this.decodeUDPHeader(data.subarray(0,8)).commandId
  return commandId === COMMANDS.CMD_REG_EVENT
}
