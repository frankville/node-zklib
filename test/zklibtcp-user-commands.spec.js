'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibTCP = require('../zklibtcp');
const { COMMANDS } = require('../constants');
const { encodeUserInfo28 } = require('../utils');

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

  it('uses compact user payloads after detecting 28-byte TCP records', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    sinon.stub(zk, 'freeData').resolves(Buffer.alloc(0));
    sinon.stub(zk, 'readWithBuffer').resolves({
      data: Buffer.concat([
        Buffer.alloc(4),
        encodeUserInfo28({ uid: 123, userId: 123, name: 'Compact' })
      ]),
      err: null
    });

    await zk.getUsers();

    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));
    await zk.setUser({ uid: 124, userId: 124, name: 'Next' });

    expect(executeStub.calledOnce).to.equal(true);
    const [command, data] = executeStub.firstCall.args;
    expect(command).to.equal(COMMANDS.CMD_USER_WRQ);
    expect(data.length).to.equal(28);
    expect(data.readUInt16LE(0)).to.equal(124);
  });

  it('uses compact user payloads from constructor options', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000, {
      userPacketSize: 28
    });
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 125, userId: 125, name: 'Compact' });

    const [command, data] = executeStub.firstCall.args;
    expect(command).to.equal(COMMANDS.CMD_USER_WRQ);
    expect(data.length).to.equal(28);
    expect(data.readUInt16LE(0)).to.equal(125);
  });

  it('allows per-call SSR payload override after compact mode is detected', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000, {
      userPacketSize: 28
    });
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 126, userId: '126', name: 'SSR', packetSize: 72 });

    const [, data] = executeStub.firstCall.args;
    expect(data.length).to.equal(72);
  });

  it('preserves configured compact mode when getUsers reads an empty table', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000, {
      userPacketSize: 28
    });
    sinon.stub(zk, 'freeData').resolves(Buffer.alloc(0));
    sinon.stub(zk, 'readWithBuffer').resolves({
      data: Buffer.alloc(4),
      err: null
    });

    const result = await zk.getUsers();

    expect(result.data).to.deep.equal([]);
    expect(zk.userPacketSize).to.equal(28);
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

    const res = await zk.getUserGroup(271);
    expect(res.group).to.equal(4);
    expect(executeStub.getCall(0).args[0]).to.equal(COMMANDS.CMD_USERGRP_RRQ);
    expect(executeStub.getCall(0).args[1].readUInt8(0)).to.equal(15);
    expect(executeStub.getCall(0).args[1].readUInt8(1)).to.equal(0);

    await zk.setUserGroup({ uid: 15, group: 6 });
    expect(executeStub.getCall(1).args[0]).to.equal(COMMANDS.CMD_USERGRP_WRQ);
    expect(executeStub.getCall(1).args[1].readUInt8(0)).to.equal(15 & 0xFF);
    expect(executeStub.getCall(1).args[1].readUInt8(4)).to.equal(6);
  });

  it('reads user timezones with the full uid payload', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const readReply = Buffer.concat([
      Buffer.alloc(8),
      Buffer.from('0100000001000000', 'hex')
    ]);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(readReply);

    const res = await zk.getUserTimezones(1111);
    expect(res.useUserTimezones).to.equal(true);
    expect(res.useGroupTimezones).to.equal(false);
    expect(res.timezones).to.deep.equal([1, 0, 0]);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_USERTZ_RRQ);
    expect(executeStub.firstCall.args[1].readUInt32LE(0)).to.equal(1111);
  });

  it('reads and writes unlock group combinations', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const readReply = Buffer.alloc(8 + 8);
    readReply.writeUInt8(3, 8);
    readReply.writeUInt8(1, 9);
    readReply.writeUInt16LE(1, 14);
    const executeStub = sinon.stub(zk, 'executeCmd');
    executeStub.onCall(0).resolves(readReply);
    executeStub.onCall(1).resolves(Buffer.alloc(0));

    const res = await zk.getUnlockGroup(3);
    expect(res.combination).to.equal(3);
    expect(res.groups).to.deep.equal([1, 0, 0, 0, 0]);
    expect(executeStub.getCall(0).args[0]).to.equal(COMMANDS.CMD_ULG_RRQ);
    expect(executeStub.getCall(0).args[1].readUInt8(0)).to.equal(3);

    await zk.setUnlockGroup({ combination: 3, groups: [1] });
    expect(executeStub.getCall(1).args[0]).to.equal(COMMANDS.CMD_ULG_WRQ);
    expect(executeStub.getCall(1).args[1].readUInt8(0)).to.equal(3);
  });

  it('routes explicit combination keys with falsy values through setUnlockGroup validation', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    let error = null;

    try {
      await zk.setUnlockGroups({ combination: 0, groups: [1] });
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.match(/combination/);
  });
});
