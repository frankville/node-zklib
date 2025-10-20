'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibUDP = require('../zklibudp');
const { COMMANDS } = require('../constants');

describe('ZKLibUDP user management helpers', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('serialises user objects before invoking CMD_USER_WRQ', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 99, userId: 'U99', name: 'Spec Test' });

    expect(executeStub.calledOnce).to.equal(true);
    const [command, data] = executeStub.firstCall.args;
    expect(command).to.equal(COMMANDS.CMD_USER_WRQ);
    expect(Buffer.isBuffer(data)).to.equal(true);
    expect(data.length).to.equal(72);
    expect(data.readUInt16LE(0)).to.equal(99);
  });

  it('passes buffers through setUser unchanged', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));
    const buffer = Buffer.alloc(72);
    buffer.writeUInt16LE(5, 0);

    await zk.setUser(buffer);

    expect(executeStub.calledOnce).to.equal(true);
    const [command, data] = executeStub.firstCall.args;
    expect(command).to.equal(COMMANDS.CMD_USER_WRQ);
    expect(data).to.equal(buffer);
  });

  it('writes the numeric uid using CMD_DELETE_USER', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.deleteUser(321);

    expect(executeStub.calledOnce).to.equal(true);
    const [command, data] = executeStub.firstCall.args;
    expect(command).to.equal(COMMANDS.CMD_DELETE_USER);
    expect(data.readUInt16LE(0)).to.equal(321);
  });

  it('throws when uid is invalid', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    let error = null;
    try {
      await zk.deleteUser(-1);
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.match(/uid must be a non-negative integer/);
  });

  it('invokes CMD_REFRESHDATA for refreshData()', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.refreshData();

    expect(executeStub.calledOnce).to.equal(true);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_REFRESHDATA);
  });
});
