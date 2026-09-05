'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibUDP = require('../zklibudp');

// The UDP mirror of test/zklibtcp-read-with-buffer.spec.js. UDP is the desktop's
// *default* transport (`normalizeZkConnectionType(value, fallback = "udp")`), so
// this is the path the crash risk actually rides on for an unswitched install.
const withUnhandledRejections = async (fn) => {
  const seen = [];
  const onUnhandled = reason => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await fn();
    await new Promise(resolve => setTimeout(resolve, 20));
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
  return seen;
};

describe('ZKLibUDP.readWithBuffer error handling', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('rejects with the request error rather than a null dereference', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const requestError = new Error('socket closed mid-command');
    sinon.stub(zk, 'requestData').rejects(requestError);

    let caught = null;
    const unhandled = await withUnhandledRejections(async () => {
      try {
        await zk.readWithBuffer(Buffer.alloc(8));
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).to.equal(requestError);
    expect(unhandled).to.deep.equal([]);
  });

  it('stops after rejecting instead of decoding a header from a null reply', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    sinon.stub(zk, 'requestData').rejects(new Error('ECONNRESET'));

    let caught = null;
    const unhandled = await withUnhandledRejections(async () => {
      try {
        await zk.readWithBuffer(Buffer.alloc(8));
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).to.be.instanceOf(Error);
    expect(caught).to.not.be.instanceOf(TypeError);
    expect(unhandled).to.deep.equal([]);
  });
});
