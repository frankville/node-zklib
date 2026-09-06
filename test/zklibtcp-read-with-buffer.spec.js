'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibTCP = require('../zklibtcp');

// Collect unhandled rejections raised while `fn` runs. Mocha installs its own
// process listener, so ours is additive: it observes without changing the run.
const withUnhandledRejections = async (fn) => {
  const seen = [];
  const onUnhandled = reason => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await fn();
    // The TypeError is thrown after an await inside an already-settled promise
    // executor, so it only surfaces once the microtask queue has drained.
    await new Promise(resolve => setTimeout(resolve, 20));
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
  return seen;
};

describe('ZKLibTCP.readWithBuffer error handling', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('rejects with the request error rather than a null dereference', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
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
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    sinon.stub(zk, 'requestData').rejects(new Error('ECONNRESET'));
    const sendChunk = sinon.stub(zk, 'sendChunkRequest');

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
    expect(sendChunk.called).to.equal(false);
  });
});
