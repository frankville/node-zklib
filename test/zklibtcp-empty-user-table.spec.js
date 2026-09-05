'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibTCP = require('../zklibtcp');
const { COMMANDS } = require('../constants');
const { createTCPHeader } = require('../utils');

// Captured from the terminal at location 5 on 2026-09-06 with its user table
// empty: CMD_DATA_WRRQ is answered with CMD_ACK_ERROR and an 8-byte payload.
// requestData had no terminal case for that, so it waited out the full timeout
// and reported TIMEOUT_ON_RECEIVING_REQUEST_DATA — the pair the BRIEF records
// as a contention symptom, on a terminal that is simply empty.
const ackErrorFrame = () =>
  createTCPHeader(COMMANDS.CMD_ACK_ERROR, 0, 1, Buffer.alloc(0));

const fakeSocket = (reply) => {
  const listeners = { data: [] };
  return {
    on(event, fn) { if (listeners[event]) listeners[event].push(fn); },
    once(event, fn) { if (listeners[event]) listeners[event].push(fn); },
    removeListener(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(each => each !== fn);
    },
    removeAllListeners(event) { if (listeners[event]) listeners[event] = []; },
    write(msg, enc, cb) {
      cb && cb(null);
      setImmediate(() => listeners.data.slice().forEach(fn => fn(reply)));
    },
    end(cb) { cb && cb(); }
  };
};

describe('ZKLibTCP against an empty user table', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('rejects a refused data request at once instead of waiting out the timeout', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 5000);
    zk.socket = fakeSocket(ackErrorFrame());

    const startedAt = Date.now();
    let caught = null;
    try {
      await zk.requestData(Buffer.alloc(16));
    } catch (err) {
      caught = err;
    }

    expect(caught).to.be.instanceOf(Error);
    expect(caught.code).to.equal('CMD_ACK_ERROR');
    expect(Date.now() - startedAt, 'a refusal must not cost the whole timeout').to.be.lessThan(1000);
  });

  it('reads an empty user table as an empty list, not as a failure', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 5000);
    zk.socket = fakeSocket(ackErrorFrame());
    sinon.stub(zk, 'freeData').resolves(Buffer.alloc(0));
    // The device knows the difference between "no users" and "no". Asked only
    // when the data request is refused, so the normal read costs nothing extra.
    const getInfo = sinon.stub(zk, 'getInfo').resolves({ userCounts: 0 });

    const result = await zk.getUsers();

    expect(result.data).to.deep.equal([]);
    expect(getInfo.calledOnce).to.equal(true);
  });

  it('still fails when the device refuses and does have users', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 5000);
    zk.socket = fakeSocket(ackErrorFrame());
    sinon.stub(zk, 'freeData').resolves(Buffer.alloc(0));
    sinon.stub(zk, 'getInfo').resolves({ userCounts: 12 });

    let caught = null;
    try {
      await zk.getUsers();
    } catch (err) {
      caught = err;
    }

    expect(caught, 'a refusal with users present is a real failure').to.be.instanceOf(Error);
    expect(caught.code).to.equal('CMD_ACK_ERROR');
  });

  // R1, and the reason the other cases could not see it: they stub getInfo at the
  // method boundary, so decodeFreeSizes never runs. decodeFreeSizes' word() returns
  // *null* for a field a short reply does not carry, and Number(null) === 0 — so a
  // truncated or stolen reply read as a confident "no users". An empty read makes
  // the apply pass rewrite every credential, so this fails in the expensive
  // direction.
  it('does not read a truncated free-sizes reply as an empty user table', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 5000);
    zk.socket = fakeSocket(ackErrorFrame());
    sinon.stub(zk, 'freeData').resolves(Buffer.alloc(0));
    // Short enough that decodeFreeSizes cannot reach the user-count word — the shape
    // a realtime frame resolving getInfo would produce, since writeMessage has no
    // event filter.
    sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(12));

    let caught = null;
    try {
      await zk.getUsers();
    } catch (err) {
      caught = err;
    }

    expect(caught, 'a missing count is not a zero count').to.be.instanceOf(Error);
    expect(caught.code).to.equal('CMD_ACK_ERROR');
  });

  it('rejects a data request the device refuses for want of authorisation', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 5000);
    zk.socket = fakeSocket(createTCPHeader(COMMANDS.CMD_ACK_UNAUTH, 0, 1, Buffer.alloc(0)));

    const startedAt = Date.now();
    let caught = null;
    try {
      await zk.requestData(Buffer.alloc(16));
    } catch (err) {
      caught = err;
    }

    // A session that lost its authorisation mid-read reported as a timeout too,
    // which is the same misdiagnosis one constant over.
    expect(caught.code).to.equal('CMD_ACK_UNAUTH');
    expect(Date.now() - startedAt).to.be.lessThan(1000);
  });

  it('does not treat an unauthorised refusal as an empty user table', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 5000);
    zk.socket = fakeSocket(createTCPHeader(COMMANDS.CMD_ACK_UNAUTH, 0, 1, Buffer.alloc(0)));
    sinon.stub(zk, 'freeData').resolves(Buffer.alloc(0));
    const getInfo = sinon.stub(zk, 'getInfo').resolves({ userCounts: 0 });

    let caught = null;
    try {
      await zk.getUsers();
    } catch (err) {
      caught = err;
    }

    expect(caught.code).to.equal('CMD_ACK_UNAUTH');
    expect(getInfo.called, 'only a refusal means "maybe empty"').to.equal(false);
  });

  it('reports the original refusal when the device cannot say how many users it has', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 5000);
    zk.socket = fakeSocket(ackErrorFrame());
    sinon.stub(zk, 'freeData').resolves(Buffer.alloc(0));
    sinon.stub(zk, 'getInfo').rejects(new Error('no answer'));

    let caught = null;
    try {
      await zk.getUsers();
    } catch (err) {
      caught = err;
    }

    expect(caught.code, 'the disambiguation failing must not hide what actually failed')
      .to.equal('CMD_ACK_ERROR');
  });
});
