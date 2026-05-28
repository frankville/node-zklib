const net = require('net')
const { MAX_CHUNK, COMMANDS, REQUEST_DATA } = require('./constants')
const { createLogger } = require('./helpers/logger')
const { createTCPHeader,
  exportErrorMessage,
  removeTcpHeader,
  decodeUserData72,
  decodeRecordData40,
  checkNotEventTCP,
  classifyTCPRealTimeEvent,
  decodeTCPRealTimeEvent,
  decodeTCPHeader,
  encodeUserInfo72,
  encodeTimezoneInfo,
  decodeTimezoneInfo,
  encodeUserTimezoneInfo,
  decodeUserTimezoneInfo,
  encodeGroupTimezoneInfo,
  decodeGroupTimezoneInfo,
  toUInt32,
  encodeUserGroupInfo,
  decodeUserGroupInfo,
  makeCommKey } = require('./utils')

const { log } = require('./helpers/errorLog')

class ZKLibTCP {
  constructor(ip, port, timeout, comm_code = 0, options = {}) {
    if (comm_code && typeof comm_code === 'object' && !Buffer.isBuffer(comm_code)) {
      options = comm_code
      comm_code = 0
    }

    this.ip = ip
    this.port = port
    this.timeout = timeout
    this.comm_code = comm_code
    this.sessionId = null
    this.replyId = 0
    this.socket = null;
    this.openDoorDelaySec = 3;
    this._rtBuffer = Buffer.alloc(0);
    this._realtimeDataHandler = null;
    this.logger = options.logger || createLogger({
      namespace: 'node-zklib:tcp',
      baseMeta: { ip: this.ip, port: this.port, transport: 'tcp' },
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
      this.socket = new net.Socket()

      this.socket.once('error', err => {
        this.logger.error('socket error', { error: err && err.message ? err.message : err })
        reject(err)
        cbError && cbError(err)
      })

      this.socket.once('connect', () => {
        this.logger.info('socket connected', { ip: this.ip, port: this.port, timeout: this.timeout })
        resolve(this.socket)
      })

      this.socket.once('close', (err) => {
        this.logger.info('socket closed', { hadError: !!err })
        this.socket = null;
        cbClose && cbClose('tcp')
      })


      if (this.timeout) {
        this.socket.setTimeout(this.timeout)
      }

      this.socket.connect(this.port, this.ip)
    })
  }


  connect() {
    return new Promise(async (resolve, reject) => {
      try {
        this.logger.debug('sending connect command')
        let reply = await this.executeCmd(COMMANDS.CMD_CONNECT, '')
        this.logger.debug('connect reply received', {
          command: exportErrorMessage(reply.readUInt16LE(0)),
          commandId: reply.readUInt16LE(0),
        })

        if (reply.readUInt16LE(0) === COMMANDS.CMD_ACK_OK) {
          this.logger.info('connect acknowledged', { sessionId: this.sessionId })
          return resolve(true)
        }

        if (reply.readUInt16LE(0) === COMMANDS.CMD_ACK_UNAUTH) {
          this.logger.info('auth required', { sessionId: this.sessionId })
          const hashedCommKey = makeCommKey(this.comm_code, this.sessionId)
          this.logger.trace('auth key generated', this.logger.formatBuffer(hashedCommKey))
          reply = await this.executeCmd(COMMANDS.CMD_AUTH, hashedCommKey)
          this.logger.debug('auth reply received', {
            command: exportErrorMessage(reply.readUInt16LE(0)),
            commandId: reply.readUInt16LE(0),
          })
          if (reply.readUInt16LE(0) === COMMANDS.CMD_ACK_OK) {
            this.logger.info('auth acknowledged', { sessionId: this.sessionId })
            return resolve(true)
          } else {
            this.logger.error('auth failed', { commandId: reply.readUInt16LE(0) })
            return reject(new Error('AUTH_FAILED: 0x' + reply.readUInt16LE(0).toString(16)))
          }
        }

        this.logger.error('no valid connect reply')
        reject(new Error('NO_REPLY_ON_CMD_CONNECT'))
      } catch (err) {
        this.logger.error('connect command failed', { error: err && err.message ? err.message : err })
        reject(err)
      }
    })
  }


  closeSocket() {
    return new Promise((resolve, reject) => {
      this._rtBuffer = Buffer.alloc(0);
      this._realtimeDataHandler = null;
      this.socket.removeAllListeners('data')
      this.socket.end(() => {
        clearTimeout(timer)
        resolve(true)
      })
      /**
       * When socket isn't connected so this.socket.end will never resolve
       * we use settimeout for handling this case
       */
      const timer = setTimeout(() => {
        resolve(true)
      }, 2000)
    })
  }

  writeMessage(msg, connect) {
    return new Promise((resolve, reject) => {

      let timer = null
      this.socket.once('data', (data) => {
        this.logger.trace('socket data received for writeMessage', this.logger.formatBuffer(data))
        timer && clearTimeout(timer)
        resolve(data)
      })

      this.logger.trace('socket write', this.logger.formatBuffer(msg))
      this.socket.write(msg, null, async (err) => {
        if (err) {
          this.logger.error('socket write failed', { error: err && err.message ? err.message : err })
          reject(err)
        } else if (this.timeout) {
          timer = await setTimeout(() => {
            clearTimeout(timer)
            reject(new Error('TIMEOUT_ON_WRITING_MESSAGE'))
          }, connect ? 2000 : this.timeout)
        }
      })
    })
  }

  requestData(msg) {
    return new Promise((resolve, reject) => {
      let timer = null
      let replyBuffer = Buffer.from([])
      let settled = false
      const cleanup = () => {
        this.socket.removeListener('data', handleOnData)
        timer && clearTimeout(timer)
      }
      const internalCallback = (data) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(data)
      }
      const internalReject = (err) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err)
      }

      const handleOnData = (data) => {
        this.logger.trace('request data chunk received', this.logger.formatBuffer(data))
        if (checkNotEventTCP(data)) {
          this.logger.debug('request data ignored realtime event')
          return;
        }
        replyBuffer = Buffer.concat([replyBuffer, data])
        clearTimeout(timer)   
        const header = decodeTCPHeader(replyBuffer.subarray(0,16));
        this.logger.debug('request data header', {
          command: exportErrorMessage(header.commandId),
          commandId: header.commandId,
          payloadSize: header.payloadSize,
        })

        if(header.commandId === COMMANDS.CMD_DATA){
          timer = setTimeout(()=>{
            internalCallback(replyBuffer)
          }, 1000)
        }else{
          timer = setTimeout(() => {
            internalReject(new Error('TIMEOUT_ON_RECEIVING_REQUEST_DATA'))
          }, this.timeout)

          const packetLength = data.readUIntLE(4, 2)
          if (packetLength > 8) {
            internalCallback(data)
          }
        }
      }


      
      this.socket.on('data', handleOnData)

      this.socket.write(msg, null, err => {
        if (err) {
          this.logger.error('request data write failed', { error: err && err.message ? err.message : err })
          return internalReject(err)
        }

        timer = setTimeout(() => {
          internalReject(Error('TIMEOUT_IN_RECEIVING_RESPONSE_AFTER_REQUESTING_DATA'))
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

      if (command === COMMANDS.CMD_CONNECT) {
        this.sessionId = 0
        this.replyId = 0
      } else {
        this.replyId++
      }
      const buf = createTCPHeader(command, this.sessionId, this.replyId, data)
      this.logger.debug('execute command', {
        command: exportErrorMessage(command),
        commandId: command,
        sessionId: this.sessionId,
        replyId: this.replyId,
        payloadLength: Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data || '')),
      })
      this.logger.trace('execute command packet', this.logger.formatBuffer(buf))
      let reply = null

      try{
        reply = await this.writeMessage(buf, command === COMMANDS.CMD_CONNECT || command === COMMANDS.CMD_EXIT)
        this.logger.trace('execute command reply packet', this.logger.formatBuffer(reply))

        const rReply = removeTcpHeader(reply);
        if (rReply && rReply.length >= 8) {
          const replyCommand = rReply.readUInt16LE(0)
          this.logger.debug('execute command reply', {
            command: exportErrorMessage(replyCommand),
            commandId: replyCommand,
            sessionId: rReply.readUInt16LE(4),
            replyId: rReply.readUInt16LE(6),
            payloadLength: rReply.length,
          })
        }
        if (rReply && rReply.length && rReply.length >= 0) {
          if (command === COMMANDS.CMD_CONNECT) {
            this.sessionId = rReply.readUInt16LE(4);
          }
        }
        resolve(rReply)
      }catch(err){
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
    const buf = createTCPHeader(COMMANDS.CMD_DATA_RDY, this.sessionId, this.replyId, reqData)

    this.socket.write(buf, null, err => {
      if (err) {
        this.logger.error('send chunk request failed', { error: err && err.message ? err.message : err })
        log(`[TCP][SEND_CHUNK_REQUEST]` + err.toString())
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
      const buf = createTCPHeader(COMMANDS.CMD_DATA_WRRQ, this.sessionId, this.replyId, reqData)
      let reply = null

      try {
        reply = await this.requestData(buf)

      } catch (err) {
        reject(err)
      }

      const header = decodeTCPHeader(reply.subarray(0, 16))
      switch (header.commandId) {
        case COMMANDS.CMD_DATA: {
          resolve({ data: reply.subarray(16), mode: 8 })
          break;
        }
        case COMMANDS.CMD_ACK_OK:
        case COMMANDS.CMD_PREPARE_DATA: {
          // this case show that data is prepared => send command to get these data 
          // reply variable includes information about the size of following data
          const recvData = reply.subarray(16)
          const size = recvData.readUIntLE(1, 4)


          // We need to split the data to many chunks to receive , because it's to large
          // After receiving all chunk data , we concat it to TotalBuffer variable , that 's the data we want
          let remain = size % MAX_CHUNK
          let numberChunks = Math.round(size - remain) / MAX_CHUNK
          let totalPackets = numberChunks + (remain > 0 ? 1 : 0)
          let replyData = Buffer.from([])


          let totalBuffer = Buffer.from([])
          let realTotalBuffer = Buffer.from([])


          const timeout = 10000
          let timer = setTimeout(() => {
            internalCallback(replyData, new Error('TIMEOUT WHEN RECEIVING PACKET'))
          }, timeout)
          let closeHandler = null


          const internalCallback = (replyData, err = null) => {
            this.socket && this.socket.removeListener('data', handleOnData)
            closeHandler && this.socket && this.socket.removeListener('close', closeHandler)
            timer && clearTimeout(timer)
            resolve({ data: replyData, err })

          }


          const handleOnData = (reply) => {

            if (checkNotEventTCP(reply)) return;
            clearTimeout(timer)
            timer = setTimeout(() => {
              internalCallback(replyData,
                new Error(`TIME OUT !! ${totalPackets} PACKETS REMAIN !`))
            }, timeout)

            totalBuffer = Buffer.concat([totalBuffer, reply])
            const packetLength = totalBuffer.readUIntLE(4, 2)
            if (totalBuffer.length >= 8 + packetLength) {

              realTotalBuffer = Buffer.concat([realTotalBuffer, totalBuffer.subarray(16, 8 + packetLength)])
              totalBuffer = totalBuffer.subarray(8 + packetLength)

              if ((totalPackets > 1 && realTotalBuffer.length === MAX_CHUNK + 8)
                || (totalPackets === 1 && realTotalBuffer.length === remain + 8)) {

                replyData = Buffer.concat([replyData, realTotalBuffer.subarray(8)])
                totalBuffer = Buffer.from([])
                realTotalBuffer = Buffer.from([])

                totalPackets -= 1
                cb && cb(replyData.length, size)

                if (totalPackets <= 0) {
                  internalCallback(replyData)
                }
              }
            }
          }

          closeHandler = () => {
            internalCallback(replyData, new Error('Socket is disconnected unexpectedly'))
          }
          this.socket.once('close', closeHandler)

          this.socket.on('data', handleOnData);

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


  async getSmallAttendanceLogs(){

  }

  /**
   *  reject error when starting request data
   *  return { data: users, err: Error } when receiving requested data
   */
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


    const USER_PACKET_SIZE = 72

    let userData = data.data.subarray(4)

    let users = []

    while (userData.length >= USER_PACKET_SIZE) {
      const user = decodeUserData72(userData.subarray(0, USER_PACKET_SIZE))
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
    try {
      data = await this.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS, callbackInProcess)
    } catch (err) {
      return Promise.reject(err)
    }

    if (this.socket) {
      try {
        await this.freeData()
      } catch (err) {
        return Promise.reject(err)
      }
    }


    const RECORD_PACKET_SIZE = 40

    let recordData = data.data.subarray(4)
    let records = []
    while (recordData.length >= RECORD_PACKET_SIZE) {
      const record = decodeRecordData40(recordData.subarray(0, RECORD_PACKET_SIZE))
      records.push({ ...record, ip: this.ip })
      recordData = recordData.subarray(RECORD_PACKET_SIZE)
    }

    return { data: records, err: data.err }

  }

  async freeData() {
    return await this.executeCmd(COMMANDS.CMD_FREE_DATA, '')
  }

  async disableDevice() {
    return await this.executeCmd(COMMANDS.CMD_DISABLEDEVICE, REQUEST_DATA.DISABLE_DEVICE)
  }

  async enableDevice() {
    return await this.executeCmd(COMMANDS.CMD_ENABLEDEVICE, '')
  }

  async openDoor() {
    return await this.executeCmd(COMMANDS.CMD_UNLOCK, this.openDoorDelaySec.toString());
  }

  async restartDevice() {
    try {
      await this.executeCmd(COMMANDS.CMD_RESTART, '')
    } catch (err) {

    }
    return await this.closeSocket()
  }

  async disconnect() {
    try {
      await this.executeCmd(COMMANDS.CMD_EXIT, '')
    } catch (err) {

    }
    return await this.closeSocket()
  }

  async getInfo() {
    try {
      const data = await this.executeCmd(COMMANDS.CMD_GET_FREE_SIZES, '')

      return {
        userCounts: data.readUIntLE(24, 4),
        logCounts: data.readUIntLE(40, 4),
        logCapacity: data.readUIntLE(72, 4)
      }
    } catch (err) {
      return Promise.reject(err)
    }
  }

  async clearAttendanceLog (){
    return await this.executeCmd(COMMANDS.CMD_CLEAR_ATTLOG, '')
  }

  async setUser(userInfo = {}) {
    const payload = Buffer.isBuffer(userInfo) ? userInfo : encodeUserInfo72(userInfo);
    return await this.executeCmd(COMMANDS.CMD_USER_WRQ, payload);
  }

  async getTimezone(index) {
    const req = Buffer.alloc(4);
    req.writeUInt32LE(toUInt32(index), 0);
    const reply = await this.executeCmd(COMMANDS.CMD_TZ_RRQ, req);
    const data = reply && reply.length > 8 ? reply.subarray(8) : Buffer.alloc(0);
    return decodeTimezoneInfo(data);
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

  async getGroupTimezones(group) {
    const req = Buffer.alloc(8);
    req.writeUInt8(toUInt32(group) & 0xFF, 0);
    const reply = await this.executeCmd(COMMANDS.CMD_GRPTZ_RRQ, req);
    const data = reply && reply.length > 8 ? reply.subarray(8) : Buffer.alloc(0);
    return decodeGroupTimezoneInfo(data);
  }

  async setGroupTimezones(info = {}) {
    const payload = Buffer.isBuffer(info) ? info : encodeGroupTimezoneInfo(info);
    return await this.executeCmd(COMMANDS.CMD_GRPTZ_WRQ, payload);
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

  async getRealTimeLogs(cb = () => { }, options = {}) {
    if (typeof cb !== 'function') {
      options = cb || {}
      cb = () => {}
    }

    this.replyId++;
    this._rtBuffer = Buffer.alloc(0);

    const flags = options.flags
    const eventPayload = flags === undefined
      ? REQUEST_DATA.GET_REAL_TIME_EVENT
      : Buffer.alloc(4)
    if (flags !== undefined) {
      eventPayload.writeUInt32LE(flags, 0)
    }
    const buf = createTCPHeader(COMMANDS.CMD_REG_EVENT, this.sessionId, this.replyId, eventPayload)
    this.logger.info('registering realtime events', {
      flags: flags === undefined ? 'GET_REAL_TIME_EVENT' : flags,
      replyId: this.replyId
    })
    this.logger.trace('realtime register packet', this.logger.formatBuffer(buf))

    this.socket.write(buf, null, err => {
      if (err) {
        this.logger.error('realtime register write failed', { error: err && err.message ? err.message : err })
      } else {
        this.logger.debug('realtime register sent')
      }
    })

    const TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);
    // Minimum bytes needed: 8 (TCP prefix) + 8 (ZK inner header) + 26 (fields before timestamp) + 6 (timestamp) = 48
    const MIN_REALTIME_PACKET = 48;

    if (this._realtimeDataHandler) {
      this.socket.removeListener('data', this._realtimeDataHandler)
    }

    this._realtimeDataHandler = (data) => {
      this.logger.trace('realtime raw chunk', this.logger.formatBuffer(data))
      this._rtBuffer = Buffer.concat([this._rtBuffer, data]);
      this.logger.debug('realtime buffer updated', { bufferLength: this._rtBuffer.length })

      while (this._rtBuffer.length >= 8) {
        if (this._rtBuffer.compare(TCP_MAGIC, 0, 4, 0, 4) !== 0) {
          // Lost sync on the stream, discard everything
          this.logger.warn('realtime stream lost sync, discarding buffer', this.logger.formatBuffer(this._rtBuffer))
          this._rtBuffer = Buffer.alloc(0);
          break;
        }

        const payloadLength = this._rtBuffer.readUIntLE(4, 2);
        const totalLength = 8 + payloadLength;
        this.logger.debug('realtime frame header', { payloadLength, totalLength, bufferLength: this._rtBuffer.length })

        if (this._rtBuffer.length < totalLength) break; // incomplete packet, wait for more data

        const message = this._rtBuffer.slice(0, totalLength);
        this._rtBuffer = this._rtBuffer.slice(totalLength);
        this.logger.trace('realtime frame', this.logger.formatBuffer(message))

        const classification = classifyTCPRealTimeEvent(message)
        this.logger.debug('realtime frame classified', {
          isRealtime: classification.isRealtime,
          commandId: classification.commandId,
          eventType: classification.eventType,
        })

        if (!classification.isRealtime) {
          try {
            const header = decodeTCPHeader(message.subarray(0, 16))
            const payload = removeTcpHeader(message)
            this.logger.warn('realtime frame filtered', {
              command: exportErrorMessage(header.commandId),
              commandId: header.commandId,
              event: payload.length >= 6 ? payload.readUInt16LE(4) : 'unknown',
            })
          } catch (err) {
            this.logger.warn('realtime frame filtered with undecodable header', { error: err && err.message ? err.message : err })
          }
          continue;
        }
        if (message.length >= MIN_REALTIME_PACKET || classification.eventType !== COMMANDS.EF_ATTLOG) {
          try {
            const event = decodeTCPRealTimeEvent(message)
            this.logger.debug('realtime event parsed', event)
            if (event && event.full_data) {
              this.logger.trace('realtime unknown event data', this.logger.formatBuffer(event.full_data))
            }
            cb(event);
          } catch (err) {
            this.logger.error('realtime event decode failed', { error: err && err.message ? err.message : err })
          }
        } else {
          this.logger.warn('realtime frame too short', { length: message.length, minLength: MIN_REALTIME_PACKET })
        }
      }
    }

    this.socket.on('data', this._realtimeDataHandler)

  }

}




module.exports = ZKLibTCP
