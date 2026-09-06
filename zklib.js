const ZKLibTCP = require('./zklibtcp')
const ZKLibUDP = require('./zklibudp')

const { ZKError , ERROR_TYPES } = require('./zkerror')
const { createLogger } = require('./helpers/logger')

class ZKLib {
    constructor(ip, port, timeout, connType, inport, comm_code = 0, options = {}){
        if (typeof connType === 'number' && inport === undefined) {
            inport = connType
            connType = 'udp'
        }

        if (comm_code && typeof comm_code === 'object' && !Buffer.isBuffer(comm_code)) {
            options = comm_code
            comm_code = 0
        }

        const normalizedConnectionType = connType === undefined || connType === null
            ? 'udp'
            : connType.toString().toLowerCase();
        if (normalizedConnectionType !== 'tcp' && normalizedConnectionType !== 'udp') {
            throw new Error('connectionType must be either "udp" or "tcp"');
        }
        this.connectionType = normalizedConnectionType;
        this.logger = createLogger({
            level: options.logLevel,
            logger: options.logger,
            namespace: 'node-zklib',
            maxBytes: options.logMaxBytes,
            baseMeta: { ip },
        })

        this.zklibTcp = new ZKLibTCP(ip, port, timeout, comm_code, {
            ...options,
            logger: this.logger.child('tcp', { port, transport: 'tcp' })
        })
        this.zklibUdp = new ZKLibUDP(ip,port,timeout , inport, {
            ...options,
            logger: this.logger.child('udp', { port, inport, transport: 'udp' })
        })
        this.interval = null 
        this.timer = null
        this.isBusy = false
        this.ip = ip,
        this.keepAlive = false;
        this.keepAliveTO = 10000;
        this.openDoorDelaySec = 3;
    }

    setLogLevel(level){
        this.logger.setLevel(level)
        this.zklibTcp.setLogLevel(level)
        this.zklibUdp.setLogLevel(level)
        return this
    }

    setLogger(logger){
        this.logger.setLogger(logger)
        this.zklibTcp.setLogger(logger)
        this.zklibUdp.setLogger(logger)
        return this
    }

    async functionWrapper (tcpCallback, udpCallback , command ){
        try{

            switch(this.connectionType){
                case 'tcp':
                    if(this.zklibTcp.socket){
                        try{
                            const res =  await tcpCallback()
                            return res
                        }catch(err){
                            //return Promise.reject()
                            throw new ZKError(
                                err,
                                `[TCP] ${command}`,
                                this.ip
                            );
                        }
                           
                    }else{
                        //return Promise.reject()
                        throw new ZKError(
                            new Error( `Socket isn't connected !`),
                            `[TCP]`,
                            this.ip
                        );
                    }
                case 'udp':
                    if(this.zklibUdp.socket){
                        try{
                            const res =  await udpCallback()
                            return res
                        }catch(err){
                            //return Promise.reject()
                            throw new ZKError(
                                err,
                                `[UDP] ${command}`,
                                this.ip
                            );
                        }    
                    }else{
                        //return Promise.reject()
                        throw new ZKError(
                            new Error( `Socket isn't connected !`),
                            `[UDP]`,
                            this.ip
                        );
                    }
                default:
                    //return Promise.reject()
                    throw new ZKError(
                        new Error( `Socket isn't connected !`),
                        '',
                        this.ip
                    );
            }

        }catch(err){
            throw err;
        }
        
    }

    /**
     * **In-flight guard.** A dozen callers share one instance and none of them is serialised,
     * so two that ask at the same moment used to open two sockets: the second caller's check
     * for an existing socket runs while the first is still connecting. One of them is then
     * orphaned — connected, unreferenced, never sent CMD_EXIT — which is a leaked session slot
     * on a terminal that has very few.
     *
     * A guard and not a memo. The promise is dropped as soon as it settles, in both directions:
     * a refused connect is a bad moment, not a permanent verdict, and pinning one would leave
     * the connection closed for the life of the instance.
     */
    async createSocket(cbErr, cbClose, toutCb){
        if(this.socketCreation){
            return await this.socketCreation
        }

        let creation = null
        creation = this._createSocketOnce(cbErr, cbClose, toutCb).finally(() => {
            // Only if nobody has started a newer one, so a late settle cannot clear it.
            if(this.socketCreation === creation){
                this.socketCreation = null
            }
        })
        this.socketCreation = creation

        return await creation
    }

    async _createSocketOnce(cbErr, cbClose,toutCb){
            //toutCb is a callback that is called when the keep alive function resulted in 3 timeouts. 
            //This indicates that it has to reconnect again to the device.
            if(this.connectionType === 'tcp'){

                try{
                    this.logger.info('creating tcp socket', { ip: this.ip })

                    if(!this.zklibTcp.socket){
                        try{
                            await this.zklibTcp.createSocket(cbErr,cbClose);
                            this.zklibTcp.openDoorDelaySec = this.openDoorDelaySec;
                           
        
                        }catch(err){
                            throw err;
                        }
                      
                        try{
                            await this.zklibTcp.connect();
                            
                        }catch(err){
                            throw err;
                        }
                    }

                    return true;

                }catch(err){
                    this.logger.error('tcp connect failed', { error: err && err.message ? err.message : err })
                    // Captured *before* the teardown, and compared after. The close event
                    // nulls the socket a tick later, leaving a window where a destroyed
                    // socket still reads as connected — which is exactly what callers use
                    // to decide they need not reconnect, so the failure path has to clear
                    // it itself. But disconnect() below can take ~4 s (CMD_EXIT's 2000 ms
                    // timeout plus closeSocket's 2000 ms fallback), createSocket has no
                    // in-flight guard, and a dozen unserialised callers share one instance:
                    // in that window another caller opens and connects a *new* socket.
                    // Nulling blindly would orphan it — connected, unreferenced, never sent
                    // CMD_EXIT — which is a leaked session slot on the terminal.
                    const failedSocket = this.zklibTcp.socket
                    try{
                        await this.zklibTcp.disconnect()
                    }catch(err){}

                    if(this.zklibTcp.socket === failedSocket){
                        this.zklibTcp.socket = null
                    }
        
                    // ECONNREFUSED used to be swallowed here: the function returned
                    // undefined, so callers saw a successful connect with no socket
                    // and every later command failed as `[TCP] <command>` with an
                    // empty error. A terminal out of session slots must be reported
                    // as a connection failure, not as a downstream one.
                    return Promise.reject(new ZKError(err, 'TCP CONNECT' , this.ip))

                }
                
            }else{

                try {
                    this.logger.info('creating udp socket', { ip: this.ip })

                    if(!this.zklibUdp.socket){
                        await this.zklibUdp.createSocket(cbErr, cbClose)
                        await this.zklibUdp.connect()

                    }   
                    
                    this.zklibUdp.keepAlive = this.keepAlive;
                    this.zklibUdp.keepAliveTO = this.keepAliveTO;
                    this.zklibUdp.openDoorDelaySec = this.openDoorDelaySec;
                    this.execKeepAlive(toutCb);
                   
                    return true;
                }catch(err){
    
                    if(err.code !== 'EADDRINUSE'){
                       
                        try{
                            await this.zklibUdp.disconnect()
                            this.zklibUdp.socket = null
                            this.zklibTcp.socket = null
                        }catch(err){
                            //console.log(err);
                        }
    
    
                        return Promise.reject(new ZKError(err, 'UDP CONNECT' , this.ip))
                    }else{
                        return Promise.reject(new ZKError(err, 'UDP EADDRINUSE' , this.ip))
                    }
                    
                }

            }

    }

    execKeepAlive(toutCb){
        this.zklibUdp.execKeepAlive(toutCb);
        return true;
    }

    async getUsers(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getUsers(),
            ()=> this.zklibUdp.getUsers(),
            'getUsers'
        )
    }

    async getAttendances(cb){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getAttendances(cb),
            ()=> this.zklibUdp.getAttendances(cb),
            'getAttendances'
        )
    }

    async setUser(userInfo){
        return await this.functionWrapper(
            ()=> this.zklibTcp.setUser(userInfo),
            ()=> this.zklibUdp.setUser(userInfo),
            'setUser'
        )
    }

    async getTimezone(index){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getTimezone(index),
            ()=> this.zklibUdp.getTimezone(index),
            'getTimezone'
        )
    }

    async setTimezone(info){
        return await this.functionWrapper(
            ()=> this.zklibTcp.setTimezone(info),
            ()=> this.zklibUdp.setTimezone(info),
            'setTimezone'
        )
    }

    async getUserTimezones(uid){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getUserTimezones(uid),
            ()=> this.zklibUdp.getUserTimezones(uid),
            'getUserTimezones'
        )
    }

    async setUserTimezones(info){
        return await this.functionWrapper(
            ()=> this.zklibTcp.setUserTimezones(info),
            ()=> this.zklibUdp.setUserTimezones(info),
            'setUserTimezones'
        )
    }

    async getGroupTimezones(group, options){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getGroupTimezones(group, options),
            ()=> this.zklibUdp.getGroupTimezones(group, options),
            'getGroupTimezones'
        )
    }

    async setGroupTimezones(info, options){
        return await this.functionWrapper(
            ()=> this.zklibTcp.setGroupTimezones(info, options),
            ()=> this.zklibUdp.setGroupTimezones(info, options),
            'setGroupTimezones'
        )
    }

    async getDeviceOption(name){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getDeviceOption(name),
            ()=> this.zklibUdp.getDeviceOption(name),
            'getDeviceOption'
        )
    }

    async setDeviceOption(name, value){
        return await this.functionWrapper(
            ()=> this.zklibTcp.setDeviceOption(name, value),
            ()=> this.zklibUdp.setDeviceOption(name, value),
            'setDeviceOption'
        )
    }

    async getUserGroup(uid){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getUserGroup(uid),
            ()=> this.zklibUdp.getUserGroup(uid),
            'getUserGroup'
        )
    }

    async setUserGroup(info){
        return await this.functionWrapper(
            ()=> this.zklibTcp.setUserGroup(info),
            ()=> this.zklibUdp.setUserGroup(info),
            'setUserGroup'
        )
    }

    async getUnlockGroup(combination){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getUnlockGroup(combination),
            ()=> this.zklibUdp.getUnlockGroup(combination),
            'getUnlockGroup'
        )
    }

    async setUnlockGroup(info, options){
        return await this.functionWrapper(
            ()=> this.zklibTcp.setUnlockGroup(info, options),
            ()=> this.zklibUdp.setUnlockGroup(info, options),
            'setUnlockGroup'
        )
    }

    async getUnlockGroups(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getUnlockGroups(),
            ()=> this.zklibUdp.getUnlockGroups(),
            'getUnlockGroups'
        )
    }

    async setUnlockGroups(info, options){
        return await this.functionWrapper(
            ()=> this.zklibTcp.setUnlockGroups(info, options),
            ()=> this.zklibUdp.setUnlockGroups(info, options),
            'setUnlockGroups'
        )
    }

    async deleteUser(uid){
        return await this.functionWrapper(
            ()=> this.zklibTcp.deleteUser(uid),
            ()=> this.zklibUdp.deleteUser(uid),
            'deleteUser'
        )
    }

    async refreshData(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.refreshData(),
            ()=> this.zklibUdp.refreshData(),
            'refreshData'
        )
    }

    async getRealTimeLogs(cb){
        try{

            await this.functionWrapper(
                ()=> this.zklibTcp.getRealTimeLogs(cb),
                ()=> this.zklibUdp.getRealTimeLogs(cb),
                'getRealTimeLogs'
            )
            return true;

        }catch(err){
            console.log("hubo un error en getrealtimelogs... ");

            console.log(err);
            return false;
        }
        
    }

    async openDoor(){
        return await this. functionWrapper(
            ()=> this.zklibTcp.openDoor(),
            ()=> this.zklibUdp.openDoor(),
            'openDoor'
        )
    }

    async restartDevice(){
        return await this. functionWrapper(
            ()=> this.zklibTcp.restartDevice(),
            ()=> this.zklibUdp.restartDevice(),
            'restartDevice'
        )
    }

    async disconnect(){
        this.keepAlive = false;
        try{

            await this.functionWrapper(
                ()=> this.zklibTcp.disconnect(),
                ()=> this.zklibUdp.disconnect(),
                'disconnect'
            );

        }catch(err){
            throw err;
        }
         
    }

    async freeData(){
        return await this. functionWrapper(
            ()=> this.zklibTcp.freeData(),
            ()=> this.zklibUdp.freeData(),
            'freeData'
        )
    }


    async disableDevice(){
        return await this. functionWrapper(
            ()=>this.zklibTcp.disableDevice(),
            ()=>this.zklibUdp.disableDevice(),
            'disableDevice'
        )
    }


    async enableDevice(){
        return await this.functionWrapper(
            ()=>this.zklibTcp.enableDevice(),
            ()=> this.zklibUdp.enableDevice(),
            'enableDevice'
        )
    }


    async getInfo(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getInfo(),
            ()=>this.zklibUdp.getInfo(),
            'getInfo'
        )
    }


    async getSocketStatus(){
        return await this.functionWrapper(
            ()=>this.zklibTcp.getSocketStatus(),
            ()=> this.zklibUdp.getSocketStatus(),
            'getSocketStatus'
        )
    }

    async clearAttendanceLog(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.clearAttendanceLog(),
            ()=> this.zklibUdp.clearAttendanceLog(),
            'clearAttendanceLog'
        )
    }

    async executeCmd(command, data=''){
        return await this.functionWrapper(
            ()=> this.zklibTcp.executeCmd(command, data),
            ()=> this.zklibUdp.executeCmd(command , data),
            'executeCmd'
        )
    }

    setIntervalSchedule(cb , timer){
        this.interval = setInterval(cb, timer)
    }


    setTimerSchedule(cb, timer){
        this.timer = setTimeout(cb,timer)
    }

    

}


module.exports = ZKLib
