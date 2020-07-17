const ZKLibTCP = require('./zklibtcp')
const ZKLibUDP = require('./zklibudp')

const { ZKError , ERROR_TYPES } = require('./zkerror')

class ZKLib {
    constructor(ip, port, timeout ,connType, inport){
        this.connectionType = connType;

        this.zklibTcp = new ZKLibTCP(ip,port,timeout) 
        this.zklibUdp = new ZKLibUDP(ip,port,timeout , inport) 
        this.interval = null 
        this.timer = null
        this.isBusy = false
        this.ip = ip,
        this.keepAlive = false;
        this.keepAliveTO = 10000;
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

    async createSocket(cbErr, cbClose,toutCb){
            //toutCb is a callback that is called when the keep alive function resulted in 3 timeouts. 
            //This indicates that it has to reconnect again to the device.
            if(this.connectionType === 'tcp'){

                try{

                    if(!this.zklibTcp.socket){
                        try{
                            await this.zklibTcp.createSocket(cbErr,cbClose)
                           
        
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
                    try{
                        await this.zklibTcp.disconnect()
                    }catch(err){}
        
                    if(err.code !== ERROR_TYPES.ECONNREFUSED){
                        return Promise.reject(new ZKError(err, 'TCP CONNECT' , this.ip))
                    }

                }
                
            }else{

                try {

                    if(!this.zklibUdp.socket){
                        await this.zklibUdp.createSocket(cbErr, cbClose)
                        await this.zklibUdp.connect()

                    }   
                    
                    this.zklibUdp.keepAlive = this.keepAlive;
                    this.zklibUdp.keepAliveTO = this.keepAliveTO;
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
            ()=> this.zklibUdp.getUsers()
        )
    }

    async getAttendances(cb){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getAttendances(cb),
            ()=> this.zklibUdp.getAttendances(cb),
        )
    }

    async getRealTimeLogs(cb){
        try{

            await this.functionWrapper(
                ()=> this.zklibTcp.getRealTimeLogs(cb),
                ()=> this.zklibUdp.getRealTimeLogs(cb)
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
            ()=> this.zklibUdp.openDoor()
        )
    }

    async restartDevice(){
        return await this. functionWrapper(
            ()=> this.zklibTcp.restartDevice(),
            ()=> this.zklibUdp.restartDevice()
        )
    }

    async disconnect(){
        this.keepAlive = false;
        try{

            await this.functionWrapper(
                ()=> this.zklibTcp.disconnect(),
                ()=> this.zklibUdp.disconnect()
            );

        }catch(err){
            throw err;
        }
         
    }

    async freeData(){
        return await this. functionWrapper(
            ()=> this.zklibTcp.freeData(),
            ()=> this.zklibUdp.freeData()
        )
    }


    async disableDevice(){
        return await this. functionWrapper(
            ()=>this.zklibTcp.disableDevice(),
            ()=>this.zklibUdp.disableDevice()
        )
    }


    async enableDevice(){
        return await this.functionWrapper(
            ()=>this.zklibTcp.enableDevice(),
            ()=> this.zklibUdp.enableDevice()
        )
    }


    async getInfo(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getInfo(),
            ()=>this.zklibUdp.getInfo()
        )
    }


    async getSocketStatus(){
        return await this.functionWrapper(
            ()=>this.zklibTcp.getSocketStatus(),
            ()=> this.zklibUdp.getSocketStatus()
        )
    }

    async clearAttendanceLog(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.clearAttendanceLog(),
            ()=> this.zklibUdp.clearAttendanceLog()
        )
    }

    async executeCmd(command, data=''){
        return await this.functionWrapper(
            ()=> this.zklibTcp.executeCmd(command, data),
            ()=> this.zklibUdp.executeCmd(command , data)
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