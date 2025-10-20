'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibTCP = require('../zklibtcp');
const { COMMANDS } = require('../constants');

describe('ZKLibTCP user management helpers', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('delegates setUser to CMD_USER_WRQ with a 72-byte payload', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 17, userId: 'T17', name: 'TCP Test' });

    expect(executeStub.calledOnce).to.equal(true);
    const [command, data] = executeStub.firstCall.args;
    expect(command).to.equal(COMMANDS.CMD_USER_WRQ);
    expect(data.length).to.equal(72);
    expect(data.readUInt16LE(0)).to.equal(17);
  });

  it('delegates deleteUser to CMD_DELETE_USER with the uid payload', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.deleteUser(222);

    expect(executeStub.calledOnce).to.equal(true);
    const [command, data] = executeStub.firstCall.args;
    expect(command).to.equal(COMMANDS.CMD_DELETE_USER);
    expect(data.length).to.equal(2);
    expect(data.readUInt16LE(0)).to.equal(222);
  });

  it('throws on invalid uid when using deleteUser', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    let error = null;
    try {
      await zk.deleteUser('NaN');
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.match(/uid must be a non-negative integer/);
  });

  it('issues CMD_REFRESHDATA via refreshData()', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.refreshData();

    expect(executeStub.calledOnce).to.equal(true);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_REFRESHDATA);
  });
});
