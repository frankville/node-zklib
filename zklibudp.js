const dgram = require('dgram')
const { createLogger } = require('./helpers/logger')
const {
  createUDPHeader,
  decodeUserData28,
  decodeRecordData16,
  decodeRecordRealTimeLog18,
  decodeRealTimeEvent,
  decodeUDPHeader,
  exportErrorMessage,
  checkNotEventUDP,
  encodeUserInfo72,
  encodeUserInfo28,
  encodeTimezoneInfo,
  decodeTimezoneInfo,
  encodeUserTimezoneInfo,
  decodeUserTimezoneInfo,
  decodeGroupTimezoneInfo,
  normalizeGroupTimezoneFormat,
  decodeFreeSizes,
  toUInt32,
  encodeUserGroupInfo,
  decodeUserGroupInfo,
  encodeUnlockGroupInfo,
  decodeUnlockGroupInfo,
  encodeUnlockGroupsInfo,
  decodeUnlockGroupsInfo,
  toUInt16
} = require('./utils')

const { MAX_CHUNK, REQUEST_DATA, COMMANDS } = require('./constants')

const { log } = require('./helpers/errorLog')
const groupTimezonesHelper = require('./helpers/groupTimezones')

class ZKLibUDP {
  constructor(ip, port, timeout, inport, options = {}) {
    this.ip = ip
    this.port = port
    this.timeout = timeout
    this.socket = null
    this.sessionId = null
    this.replyId = 0
    this.inport = inport
    this.keepAlive = false;
    this.keepAliveTO = 10000;
    this.openDoorDelaySec = 3;
    this.timeoutCounter = 0;
    this.groupTimezoneFormat = normalizeGroupTimezoneFormat(
      options.groupTimezonePacketFormat ?? options.groupTimezoneFormat
    );
    this.logger = options.logger || createLogger({
      namespace: 'node-zklib:udp',
      baseMeta: { ip: this.ip, port: this.port, inport: this.inport, transport: 'udp' },
    })
    
  }

  setLogLevel(level) {
    this.logger.setLevel(level)
    return this
  }

  setLogger(logger) {
    this.logger.setLogger(logger)
    return this
  }

  createSocket(cbError, cbClose) {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket('udp4');
      this.socket.setMaxListeners(Infinity)
      this.socket.once('error', err => {
        this.logger.error('socket error', { error: err && err.message ? err.message : err })
        reject(err)
        cbError && cbError(err)
      })

      this.socket.on('close', (err) => {
        this.logger.info('socket closed', { hadError: !!err })
        this.socket = null;
        cbClose && cbClose('udp')
      })

      this.socket.once('listening', () => {
        this.logger.info('socket listening', { ip: this.ip, port: this.port, inport: this.inport, timeout: this.timeout })
        resolve(this.socket)
      })
      try {
        this.socket.bind(this.inport)
      } catch (err) {
        
      }

    })
  }

  connect() {
    return new Promise(async (resolve, reject) => {
      try {
        this.logger.debug('sending connect command')
        const reply = await this.executeCmd(COMMANDS.CMD_CONNECT, '')
        if (reply) {
          this.logger.info('connect acknowledged', { sessionId: this.sessionId })
          resolve(true)
        } else {
          this.logger.error('no valid connect reply')
          reject(new Error('NO_REPLY_ON_CMD_CONNECT'))
        }
      } catch (err) {
        this.logger.error('connect command failed', { error: err && err.message ? err.message : err })
        reject(err)
      }
    })
  }


  closeSocket() {
    return new Promise((resolve, reject) => {
      this.socket.removeAllListeners('message')
      this.socket.close(() => {
        clearTimeout(timer)
        resolve(true)
      })
      
      /**
       * When socket isn't connected so this.socket.end will never resolve
       * we use settimeout for handling this case
       */
      const timer = setTimeout(() => {
        resolve(true)
      }, 2000);
    })
  }

  writeMessage(msg, connect) {
    return new Promise((resolve, reject) => {
      let sendTimeoutId;
      this.socket.once('message', (data) => {
        this.logger.trace('socket message received for writeMessage', this.logger.formatBuffer(data))
        sendTimeoutId && clearTimeout(sendTimeoutId)
        resolve(data)
      })

      this.logger.trace('socket send', this.logger.formatBuffer(msg))
      this.socket.send(msg, 0, msg.length, this.port, this.ip, (err) => {
        if (err) {
          this.logger.error('socket send failed', { error: err && err.message ? err.message : err })
          reject(err)
        }
        if (this.timeout) {
          sendTimeoutId = setTimeout(() => {
            clearTimeout(sendTimeoutId)
            reject(new Error('TIMEOUT_ON_WRITING_MESSAGE'))
          }, connect ? 2000 : this.timeout)
        }
      })
    })
  }

  requestData(msg) {
    return new Promise((resolve, reject) => {
      let sendTimeoutId
      const internalCallback = (data) => {
        sendTimeoutId && clearTimeout(sendTimeoutId)
        this.socket.removeListener('message', handleOnData)
        resolve(data)
      }

      const handleOnData = (data) => {
        this.logger.trace('request data message received', this.logger.formatBuffer(data))
        if (checkNotEventUDP(data)) {
          this.logger.debug('request data ignored realtime event')
          return;
        }
        clearTimeout(sendTimeoutId)
        sendTimeoutId = setTimeout(() => {
          reject(new Error('TIMEOUT_ON_RECEIVING_REQUEST_DATA'))
        }, this.timeout)

        if (data.length >= 13) {
          internalCallback(data)
        }

      }

      this.socket.on('message', handleOnData)

      this.socket.send(msg, 0, msg.length, this.port, this.ip, (err) => {
        if (err) {
          this.logger.error('request data send failed', { error: err && err.message ? err.message : err })
          reject(err)
        }
        sendTimeoutId = setTimeout(() => {
          reject(Error('TIMEOUT_IN_RECEIVING_RESPONSE_AFTER_REQUESTING_DATA'))
        }, this.timeout)

      })
    })

  }

  /**
  * 
  * @param {*} command 
  * @param {*} data 
  * 
  * 
  * reject error when command fail and resolve data when success
  */
  executeCmd(command, data) {
    return new Promise(async (resolve, reject) => {
      try {
        if (command === COMMANDS.CMD_CONNECT) {
          this.sessionId = 0
          this.replyId = 0
        } else {
          this.replyId++
        }


        const buf = createUDPHeader(command, this.sessionId, this.replyId, data)
        this.logger.debug('execute command', {
          command: exportErrorMessage(command),
          commandId: command,
          sessionId: this.sessionId,
          replyId: this.replyId,
          payloadLength: Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data || '')),
        })
        this.logger.trace('execute command packet', this.logger.formatBuffer(buf))
        const reply = await this.writeMessage(buf, command === COMMANDS.CMD_CONNECT || command === COMMANDS.CMD_EXIT)
        this.logger.trace('execute command reply packet', this.logger.formatBuffer(reply))

        if (reply && reply.length && reply.length >= 0) {
          const replyCommand = reply.readUInt16LE(0)
          this.logger.debug('execute command reply', {
            command: exportErrorMessage(replyCommand),
            commandId: replyCommand,
            sessionId: reply.readUInt16LE(4),
            replyId: reply.readUInt16LE(6),
            payloadLength: reply.length,
          })
          if (command === COMMANDS.CMD_CONNECT) {
            this.sessionId = reply.readUInt16LE(4);
          }
        }
        resolve(reply)
      } catch (err) {
        this.logger.error('execute command failed', {
          command: exportErrorMessage(command),
          commandId: command,
          error: err && err.message ? err.message : err,
        })
        reject(err)
      }
    })
  }


  sendChunkRequest(start, size) {
    this.replyId++;
    const reqData = Buffer.alloc(8)
    reqData.writeUInt32LE(start, 0)
    reqData.writeUInt32LE(size, 4)
    const buf = createUDPHeader(COMMANDS.CMD_DATA_RDY, this.sessionId, this.replyId, reqData)

    this.socket.send(buf, 0, buf.length, this.port, this.ip, (err) => {
      if (err) {
        if (err) {
          this.logger.error('send chunk request failed', { error: err && err.message ? err.message : err })
          log(`[UDP][SEND_CHUNK_REQUEST]` + err.toString())
        }
      }
    })
  }



  /**
   * 
   * @param {*} reqData - indicate the type of data that need to receive ( user or attLog)
   * @param {*} cb - callback is triggered when receiving packets
   * 
   * readWithBuffer will reject error if it'wrong when starting request data 
   * readWithBuffer will return { data: replyData , err: Error } when receiving requested data
   */
  readWithBuffer(reqData, cb = null) {
    return new Promise(async (resolve, reject) => {
      this.replyId++;
      const buf = createUDPHeader(COMMANDS.CMD_DATA_WRRQ, this.sessionId, this.replyId, reqData)


      let reply = null
      try {
        reply = await this.requestData(buf)
      } catch (err) {
        reject(err)
      }

      const header = decodeUDPHeader(reply.subarray(0, 8))

      switch (header.commandId) {
        case COMMANDS.CMD_DATA: {
          resolve({ data: reply.subarray(8), mode: 8, err: null })
          break;
        }
        case COMMANDS.CMD_ACK_OK:
        case COMMANDS.CMD_PREPARE_DATA: {
          // this case show that data is prepared => send command to get these data 
          // reply variable includes information about the size of following data 
          const recvData = reply.subarray(8)
          const size = recvData.readUIntLE(1, 4)

          // We need to split the data to many chunks to receive , because it's to large
          // After receiving all chunk data , we concat it to TotalBuffer variable , that 's the data we want
          let remain = size % MAX_CHUNK
          let numberChunks = Math.round(size - remain) / MAX_CHUNK

          let totalBuffer = Buffer.from([])


          const timeout = 3000
          let timer = setTimeout(() => {
            internalCallback(totalBuffer, new Error('TIMEOUT WHEN RECEIVING PACKET'))
          }, timeout)


          const internalCallback = (replyData, err = null) => {
            this.socket.removeListener('message', handleOnData)
            timer && clearTimeout(timer)
            if (err) {
              resolve({ err, data: replyData })
            } else {
              resolve({ err: null, data: replyData })
            }
          }


          const handleOnData = (reply) => {
            if (checkNotEventUDP(reply)) return;
            clearTimeout(timer)
            timer = setTimeout(() => {
              internalCallback(totalBuffer,
                new Error(`TIMEOUT !! ${(size - totalBuffer.length) / size} % REMAIN !  `))
            }, timeout)
            const header = decodeUDPHeader(reply)

            switch (header.commandId) {
              case COMMANDS.CMD_PREPARE_DATA: {
                break;
              }
              case COMMANDS.CMD_DATA: {
                totalBuffer = Buffer.concat([totalBuffer, reply.subarray(8)])
                cb && cb(totalBuffer.length, size)
                break;
              }
              case COMMANDS.CMD_ACK_OK: {
                if (totalBuffer.length === size) {
                  internalCallback(totalBuffer)
                }
                break;
              }
              default: {
                internalCallback([], new Error('ERROR_IN_UNHANDLE_CMD ' + exportErrorMessage(header.commandId)))
              }
            }
          }

          this.socket.on('message', handleOnData);

          for (let i = 0; i <= numberChunks; i++) {
            if (i === numberChunks) {
              this.sendChunkRequest(numberChunks * MAX_CHUNK, remain)
            } else {
              this.sendChunkRequest(i * MAX_CHUNK, MAX_CHUNK)
            }
          }

          break;
        }
        default: {
          reject(new Error('ERROR_IN_UNHANDLE_CMD ' + exportErrorMessage(header.commandId)))
        }
      }
    })
  }


  async getUsers() {

    // Free Buffer Data to request Data
    if (this.socket) {
      try {
        await this.freeData()
      } catch (err) {
        return Promise.reject(err)
      }
    }


    let data = null
    try {
      data = await this.readWithBuffer(REQUEST_DATA.GET_USERS)
    } catch (err) {
      return Promise.reject(err)
    }

    // Free Buffer Data after requesting data
    if (this.socket) {
      try {
        await this.freeData()
      } catch (err) {
        return Promise.reject(err)
      }
    }

    const USER_PACKET_SIZE = 28
    let userData = data.data.subarray(4)
    let users = []

    while (userData.length >= USER_PACKET_SIZE) {
      const user = decodeUserData28(userData.subarray(0, USER_PACKET_SIZE))
      users.push(user)
      userData = userData.subarray(USER_PACKET_SIZE)
    }

    return { data: users, err: data.err }

  }


  /**
   * 
   * @param {*} ip 
   * @param {*} callbackInProcess  
   *  reject error when starting request data
   *  return { data: records, err: Error } when receiving requested data
   */


  async getAttendances(callbackInProcess = () => { }) {
    if (this.socket) {
      try {
        await this.freeData()
      } catch (err) {
        return Promise.reject(err)
      }
    }

    let data = null
    try{
      data = await this.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS, callbackInProcess)
    }catch(err){
      return Promise.reject(err)
    }
    
    if (this.socket) {
      try {
        await this.freeData()
      } catch (err) {
        return Promise.reject(err)
      }
    }

    if (data.mode) {
      // Data too small to decode in a normal way  => we need a parameter to indicate this case 
      const RECORD_PACKET_SIZE = 8
      let recordData = data.data.subarray(4)

      let records = []
      while (recordData.length >= RECORD_PACKET_SIZE) {
        const record = decodeRecordData16(recordData.subarray(0, RECORD_PACKET_SIZE))
        records.push({ ...record, ip: this.ip })
        recordData = recordData.subarray(RECORD_PACKET_SIZE)
      }

      return { data: records, err: data.err }

    } else {
      const RECORD_PACKET_SIZE = 16
      let recordData = data.data.subarray(4)

      let records = []
      while (recordData.length >= RECORD_PACKET_SIZE) {
        const record = decodeRecordData16(recordData.subarray(0, RECORD_PACKET_SIZE))
        records.push({ ...record, ip: this.ip })
        recordData = recordData.subarray(RECORD_PACKET_SIZE)
      }

      return { data: records, err: data.err }
    }

  }

  execKeepAlive(toutErrorCb) {

    //send a door state request every x seconds to maintain the session alive
    if(this.keepAlive){

      this.executeCmd(COMMANDS.CMD_DOORSTATE_RRQ, '').then(()=>{
        this.timeoutCounter = 0;
        setTimeout(()=>{
          this.execKeepAlive(toutErrorCb);
        },this.keepAliveTO);

      }).catch(err => {

        console.log((new Date()).toISOString()+" -- zklibudp.js -- Error executing keep alive: "+JSON.stringify(err)+" "+err.toString()+" -- timeoutCounter: "+this.timeoutCounter);
        this.timeoutCounter++;

        if(this.timeoutCounter > 1){
          this.timeoutCounter = 0;
          toutErrorCb(this.ip);
        }else{
          setTimeout(()=>{
            this.execKeepAlive(toutErrorCb);
          },this.keepAliveTO);
        }

        

      });


    }
  }

  async freeData() {
    return await this.executeCmd(COMMANDS.CMD_FREE_DATA, '')
  }


  async getInfo() {
    const data = await this.executeCmd(COMMANDS.CMD_GET_FREE_SIZES, '')
    try {
      return decodeFreeSizes(data)
    } catch (err) {
      return Promise.reject(err)
    }
  }

  async clearAttendanceLog (){
    return await this.executeCmd(COMMANDS.CMD_CLEAR_ATTLOG, '')
  }

  async setUser(userInfo = {}) {
    const encoder = (
      userInfo &&
      (userInfo.packetSize === 72 || userInfo.format === 'ssr')
    ) ? encodeUserInfo72 : encodeUserInfo28;
    const payload = Buffer.isBuffer(userInfo) ? userInfo : encoder(userInfo);
    return await this.executeCmd(COMMANDS.CMD_USER_WRQ, payload);
  }

  async getTimezone(index) {
    const req = Buffer.alloc(4);
    req.writeUInt32LE(toUInt32(index), 0);
    const reply = await this.executeCmd(COMMANDS.CMD_TZ_RRQ, req);
    const data = reply && reply.length > 8 ? reply.subarray(8) : Buffer.alloc(0);
    return decodeTimezoneInfo(data, toUInt32(index));
  }

  async setTimezone(info = {}) {
    const payload = Buffer.isBuffer(info) ? info : encodeTimezoneInfo(info);
    return await this.executeCmd(COMMANDS.CMD_TZ_WRQ, payload);
  }

  async getUserTimezones(uid) {
    const req = Buffer.alloc(4);
    req.writeUInt32LE(toUInt32(uid), 0);
    const reply = await this.executeCmd(COMMANDS.CMD_USERTZ_RRQ, req);
    const data = reply && reply.length > 8 ? reply.subarray(8) : Buffer.alloc(0);
    return decodeUserTimezoneInfo(data);
  }

  async setUserTimezones(info = {}) {
    const payload = Buffer.isBuffer(info) ? info : encodeUserTimezoneInfo(info);
    return await this.executeCmd(COMMANDS.CMD_USERTZ_WRQ, payload);
  }

  async getGroupTimezones(group, options = {}) {
    const req = Buffer.alloc(8);
    req.writeUInt8(toUInt32(group) & 0xFF, 0);
    const reply = await this.executeCmd(COMMANDS.CMD_GRPTZ_RRQ, req);
    const data = reply && reply.length > 8 ? reply.subarray(8) : Buffer.alloc(0);
    const decoded = decodeGroupTimezoneInfo(data, {
      format: options.format ?? this.groupTimezoneFormat,
      fallbackGroup: toUInt32(group)
    });
    if (!options.format && !this.groupTimezoneFormat && decoded.format === 'compact32') {
      this.groupTimezoneFormat = 'compact32';
    }
    return decoded;
  }

  async setGroupTimezones(info = {}, options = {}) {
    return await groupTimezonesHelper.setGroupTimezones(this, info, options);
  }

  async getDeviceOption(name) {
    const reply = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, Buffer.from(`${name}\0`, 'ascii'));
    const data = reply && reply.length > 8 ? reply.subarray(8) : Buffer.alloc(0);
    const text = data.toString('ascii').replace(/\0+$/, '');
    const separator = text.indexOf('=');
    return separator >= 0 ? text.slice(separator + 1) : text;
  }

  async setDeviceOption(name, value) {
    return await this.executeCmd(COMMANDS.CMD_OPTIONS_WRQ, Buffer.from(`${name}=${value}\0`, 'ascii'));
  }

  async getUserGroup(uid) {
    const req = Buffer.alloc(4);
    req.writeUInt32LE(toUInt32(uid), 0);
    const reply = await this.executeCmd(COMMANDS.CMD_USERGRP_RRQ, req);
    const data = reply && reply.length > 8 ? reply.subarray(8) : Buffer.alloc(0);
    return decodeUserGroupInfo(data);
  }

  async setUserGroup(info = {}) {
    const payload = Buffer.isBuffer(info) ? info : encodeUserGroupInfo(info);
    return await this.executeCmd(COMMANDS.CMD_USERGRP_WRQ, payload);
  }

	  async getUnlockGroup(combination = 1) {
	    const req = Buffer.alloc(8);
	    req.writeUInt8(toUInt32(combination) & 0xFF, 0);
	    const reply = await this.executeCmd(COMMANDS.CMD_ULG_RRQ, req);
	    const data = reply && reply.length > 8 ? reply.subarray(8) : Buffer.alloc(0);
	    const decoded = decodeUnlockGroupInfo(data, toUInt32(combination));
	    if (decoded.format === 'ascii') {
	      this.unlockGroupsFormat = 'ascii';
	    }
	    return decoded;
	  }

	  async setUnlockGroup(info = {}) {
	    if (!Buffer.isBuffer(info) && this.unlockGroupsFormat === 'ascii') {
	      const current = await this.getUnlockGroups();
	      const combinations = current.combinations.map((combination) => ({
	        combination: combination.combination,
	        groups: combination.groups.filter(group => Number(group) > 0)
	      }));
	      const target = Number(info.combination ?? info.combinationNumber ?? info.combNo ?? info.index);
	      if (!Number.isInteger(target) || target < 1 || target > 10) {
	        throw new Error('setUnlockGroup: combination must be between 1 and 10');
	      }
	      combinations[target - 1] = {
	        combination: target,
	        groups: info.groups !== undefined ? info.groups : [info.group1, info.group2, info.group3, info.group4, info.group5]
	      };
	      return await this.setUnlockGroups({ combinations });
	    }
	    const payload = Buffer.isBuffer(info) ? info : encodeUnlockGroupInfo(info);
	    return await this.executeCmd(COMMANDS.CMD_ULG_WRQ, payload);
	  }

	  async getUnlockGroups() {
	    const first = await this.getUnlockGroup(1);
	    if (first.format === 'ascii' && first.raw) {
	      this.unlockGroupsFormat = 'ascii';
	      return decodeUnlockGroupsInfo(Buffer.from(`${first.raw}\0`, 'ascii'));
	    }

    const combinations = [first];
    for (let combination = 2; combination <= 10; combination++) {
      combinations.push(await this.getUnlockGroup(combination));
    }

	    this.unlockGroupsFormat = 'binary';
	    return { format: 'binary', combinations };
	  }

	  async setUnlockGroups(info = {}) {
	    if (
	      !Buffer.isBuffer(info) &&
	      ['combination', 'combinationNumber', 'combNo', 'index'].some(key => Object.prototype.hasOwnProperty.call(info, key))
	    ) {
	      return await this.setUnlockGroup(info);
	    }
    const payload = Buffer.isBuffer(info) ? info : encodeUnlockGroupsInfo(info);
    return await this.executeCmd(COMMANDS.CMD_ULG_WRQ, payload);
  }

  async deleteUser(uid) {
    if (Buffer.isBuffer(uid)) {
      return await this.executeCmd(COMMANDS.CMD_DELETE_USER, uid);
    }

    const numericUid = Number(uid);
    if (!Number.isInteger(numericUid) || numericUid < 0) {
      throw new Error('deleteUser: uid must be a non-negative integer');
    }

    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(numericUid, 0);
    return await this.executeCmd(COMMANDS.CMD_DELETE_USER, buf);
  }

  async refreshData() {
    return await this.executeCmd(COMMANDS.CMD_REFRESHDATA, '')
  }


  async disableDevice() {
    return await this.executeCmd(COMMANDS.CMD_DISABLEDEVICE, REQUEST_DATA.DISABLE_DEVICE)
  }

  async enableDevice() {
    return await this.executeCmd(COMMANDS.CMD_ENABLEDEVICE, '')
  }

  async restartDevice() {
    return await this.executeCmd(COMMANDS.CMD_RESTART, '')
  }

  async openDoor() {
    return await this.executeCmd(COMMANDS.CMD_UNLOCK, this.openDoorDelaySec.toString());
  }

  async disconnect() {
    try {
      this.keepAlive = false;
      await this.executeCmd(COMMANDS.CMD_EXIT, '')
      
    } catch (err) {
    }
    return await this.closeSocket()
  }



  async getRealTimeLogs(cb = () => { }) {
    this.replyId++;
    
    const buf = createUDPHeader(COMMANDS.CMD_REG_EVENT, this.sessionId, this.replyId, REQUEST_DATA.GET_REAL_TIME_EVENT)
    this.logger.info('registering realtime events', { flags: 'GET_REAL_TIME_EVENT', replyId: this.replyId })
    this.logger.trace('realtime register packet', this.logger.formatBuffer(buf))

    this.socket.send(buf, 0, buf.length, this.port, this.ip, (err) => {
      if (err) {
        this.logger.error('realtime register send failed', { error: err && err.message ? err.message : err })
      } else {
        this.logger.debug('realtime register sent')
      }
      // if(err){
      //   console.log("error en send packet to socket...");
      //   console.log(err);
      // }
      
    });

    this.socket.on('message', (data) => {
      this.logger.trace('realtime raw message', this.logger.formatBuffer(data))

      if (!checkNotEventUDP(data)) {
        this.logger.debug('realtime message filtered')
        return;
      }

      //console.log((new Date()).toLocaleString()+" -- "+"el mensaje UDP que viene "+data.toString("hex").match(/(..?)/g).join(" "))



      try {
        const event = decodeRealTimeEvent(data)
        this.logger.debug('realtime event parsed', event)
        cb(event);
      } catch (err) {
        this.logger.error('realtime event decode failed', { error: err && err.message ? err.message : err })
      }
      

      // if (data.length === 18) {
      //   cb(decodeRecordRealTimeLog18(data))
      // }

    })

  }
}




module.exports = ZKLibUDP
