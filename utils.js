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