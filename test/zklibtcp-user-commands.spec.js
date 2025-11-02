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

  it('reads and writes user group membership', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const readReply = Buffer.alloc(8 + 1);
    readReply.writeUInt8(4, 8);
    const executeStub = sinon.stub(zk, 'executeCmd');
    executeStub.onCall(0).resolves(readReply);
    executeStub.onCall(1).resolves(Buffer.alloc(0));

    const res = await zk.getUserGroup(15);
    expect(res.group).to.equal(4);
    expect(executeStub.getCall(0).args[0]).to.equal(COMMANDS.CMD_USERGRP_RRQ);
    expect(executeStub.getCall(0).args[1].readUInt32LE(0)).to.equal(15);

    await zk.setUserGroup({ uid: 15, group: 6 });
    expect(executeStub.getCall(1).args[0]).to.equal(COMMANDS.CMD_USERGRP_WRQ);
    expect(executeStub.getCall(1).args[1].readUInt8(0)).to.equal(15 & 0xFF);
    expect(executeStub.getCall(1).args[1].readUInt8(4)).to.equal(6);
  });
});
