'use strict';
const { expect } = require('chai');
const { EventEmitter } = require('events');
const ZKLibUDP = require('../zklibudp');
const { COMMANDS } = require('../constants');
const { createUDPHeader } = require('../utils');

describe('ZKLibUDP tolerates a runt datagram', () => {
  it('ignores a datagram too short to hold a header instead of crashing', async () => {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    const zk = new ZKLibUDP('127.0.0.1', 4370, 5000, 5500);
    zk.socket = {
      on: (e, fn) => emitter.on(e, fn),
      once: (e, fn) => emitter.once(e, fn),
      removeListener: (e, fn) => emitter.removeListener(e, fn),
      removeAllListeners: e => emitter.removeAllListeners(e),
      send(msg, o, l, p, ip, cb) {
        cb && cb(null);
        setImmediate(() => {
          // Anyone on the network can send this. No session, no auth.
          emitter.emit('message', Buffer.alloc(4));
          emitter.emit('message', createUDPHeader(COMMANDS.CMD_ACK_ERROR, 0, 1, Buffer.alloc(0)));
        });
      },
      close(cb) { cb && cb(); }
    };

    let caught = null;
    try {
      await zk.requestData(Buffer.alloc(8));
    } catch (err) {
      caught = err;
    }

    expect(caught).to.be.instanceOf(Error);
    expect(caught).to.not.be.instanceOf(RangeError);
    expect(caught.code, 'the runt must be ignored, not fatal').to.equal('CMD_ACK_ERROR');
  });
});
