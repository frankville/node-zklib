


const ERROR_TYPES = {
    ECONNRESET : 'ECONNRESET',
    ECONNREFUSED : 'ECONNREFUSED',
    EADDRINUSE: 'EADDRINUSE',
    ETIMEDOUT: 'ETIMEDOUT'
}

class ZKError {

    constructor(err , command , ip){
        this.err = err
        this.ip = ip
        this.command = command
    }


    toast(){
        if(this.err.code === ERROR_TYPES.ECONNRESET ){
            return 'Another device is connecting to the device so the connection is interrupted'
        }else if (this.err.code === ERROR_TYPES.ECONNREFUSED){
            return 'IP of the device is refused'
        }else {
            return this.err.message
        }
    }

    getError(){
        // `this.err` is whatever the transport threw. It is normally an Error, but a
        // nullish one must not turn a serialisation into a throw — toJSON() runs on
        // paths whose whole job is reporting a failure that already happened.
        const err = this.err || {}
        return {
            err: {
                message: err.message,
                code: err.code
            },
            ip: this.ip,
            command : this.command
        }
    }

    // ZKError is not an Error subclass, and `this.err.message`/`.code` are
    // non-enumerable — so JSON.stringify(zkError) yielded `{"err":{}, ...}` and
    // dropped the cause at every consumer that logs or rethrows a stringified
    // error. Naming the command that failed is only half the legibility fix;
    // this is the other half, and it needs no change on the consumer side.
    toJSON(){
        return this.getError()
    }
}


module.exports = {
    ZKError,
    ERROR_TYPES
}