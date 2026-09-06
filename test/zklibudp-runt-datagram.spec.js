'use strict';
const { expect } = require('chai');
const { EventEmitter } = require('events');
const ZKLibUDP = require('../zklibudp');
const { COMMANDS } = require('../constants');
const { createUDPHeader } = require('../utils');

const dgram = require('dgram');
const { isWellFormedUDPFrame } = require('../utils');

describe('ZKLibUDP tolerates a runt datagram', () => {
  // The realtime handler is the one that matters most: requestData's lives for the
  // duration of one read, this one is attached for the whole session, on every
  // install with a listening device. Driven over a real socket because the crash is
  // an *uncaught* exception in a 'message' listener — a fake that calls the handler
  // synchronously would let mocha catch what production cannot.
  it('survives a runt datagram on the realtime handler, over a real socket', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 0);
    const socket = dgram.createSocket('udp4');
    await new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
    zk.socket = socket;
    zk.sessionId = 1;
    zk.replyId = 0;

    const uncaught = [];
    const onUncaught = err => uncaught.push(err);
    process.on('uncaughtException', onUncaught);

    try {
      await zk.getRealTimeLogs(() => {}).catch(() => {});
      const port = socket.address().port;
      const sender = dgram.createSocket('udp4');
      // Four bytes. No session, no auth, no address check on the receiving socket.
      await new Promise(resolve => sender.send(Buffer.alloc(4), port, '127.0.0.1', resolve));
      await new Promise(resolve => setTimeout(resolve, 100));
      sender.close();
    } finally {
      process.removeListener('uncaughtException', onUncaught);
      socket.removeAllListeners();
      await new Promise(resolve => socket.close(resolve));
    }

    expect(uncaught.map(err => err && err.message), 'four bytes must not take the process down')
      .to.deep.equal([]);
  });

  it('accepts a payload-less terminal ACK, so the floor is not too high', () => {
    // A refusal is exactly 8 bytes. A floor of 13 — the length gate further down —
    // would silently undo the empty-table fix.
    expect(isWellFormedUDPFrame(createUDPHeader(COMMANDS.CMD_ACK_ERROR, 0, 1, Buffer.alloc(0))))
      .to.equal(true);
    expect(isWellFormedUDPFrame(Buffer.alloc(7))).to.equal(false);
    expect(isWellFormedUDPFrame(null)).to.equal(false);
  });

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
