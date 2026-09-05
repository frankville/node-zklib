'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('events');

const ZKLibUDP = require('../zklibudp');
const { COMMANDS } = require('../constants');
const { createUDPHeader } = require('../utils');

// The UDP mirror of test/zklibtcp-empty-user-table.spec.js. UDP is the desktop's
// default transport, so a stall fixed only on TCP is a stall for most installs.
const ackFrame = command => createUDPHeader(command, 0, 1, Buffer.alloc(0));

const fakeSocket = (reply) => {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return {
    on: (event, fn) => emitter.on(event, fn),
    once: (event, fn) => emitter.once(event, fn),
    removeListener: (event, fn) => emitter.removeListener(event, fn),
    removeAllListeners: event => emitter.removeAllListeners(event),
    send(msg, offset, length, port, ip, cb) {
      cb && cb(null);
      setImmediate(() => emitter.emit('message', reply));
    },
    close(cb) { cb && cb(); }
  };
};

describe('ZKLibUDP against an empty user table', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('rejects a refused data request at once instead of waiting out the timeout', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 5000, 5500);
    zk.socket = fakeSocket(ackFrame(COMMANDS.CMD_ACK_ERROR));

    const startedAt = Date.now();
    let caught = null;
    try {
      await zk.requestData(Buffer.alloc(8));
    } catch (err) {
      caught = err;
    }

    expect(caught.code).to.equal('CMD_ACK_ERROR');
    expect(Date.now() - startedAt, 'a refusal must not cost the whole timeout').to.be.lessThan(1000);
  });

  it('rejects an unauthorised refusal with its own code', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 5000, 5500);
    zk.socket = fakeSocket(ackFrame(COMMANDS.CMD_ACK_UNAUTH));

    let caught = null;
    try {
      await zk.requestData(Buffer.alloc(8));
    } catch (err) {
      caught = err;
    }

    expect(caught.code).to.equal('CMD_ACK_UNAUTH');
  });

  it('reads an empty user table as an empty list, not as a failure', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 5000, 5500);
    zk.socket = fakeSocket(ackFrame(COMMANDS.CMD_ACK_ERROR));
    sinon.stub(zk, 'freeData').resolves(Buffer.alloc(0));
    sinon.stub(zk, 'getInfo').resolves({ userCounts: 0 });

    const result = await zk.getUsers();

    expect(result.data).to.deep.equal([]);
  });

  it('still fails when the device refuses and does have users', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 5000, 5500);
    zk.socket = fakeSocket(ackFrame(COMMANDS.CMD_ACK_ERROR));
    sinon.stub(zk, 'freeData').resolves(Buffer.alloc(0));
    sinon.stub(zk, 'getInfo').resolves({ userCounts: 12 });

    let caught = null;
    try {
      await zk.getUsers();
    } catch (err) {
      caught = err;
    }

    expect(caught.code).to.equal('CMD_ACK_ERROR');
  });

  it('does not read a missing free-sizes count as an empty user table', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 5000, 5500);
    zk.socket = fakeSocket(ackFrame(COMMANDS.CMD_ACK_ERROR));
    sinon.stub(zk, 'freeData').resolves(Buffer.alloc(0));
    // decodeFreeSizes returns null for a field a short reply cannot carry, and
    // Number(null) === 0. Strict equality is what keeps that from reading as "no
    // users" — the direction that makes the apply pass rewrite every credential.
    sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(12));

    let caught = null;
    try {
      await zk.getUsers();
    } catch (err) {
      caught = err;
    }

    expect(caught.code).to.equal('CMD_ACK_ERROR');
  });
});
