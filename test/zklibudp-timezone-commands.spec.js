'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibUDP = require('../zklibudp');
const { COMMANDS } = require('../constants');

describe('ZKLibUDP timezone and access helpers', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('requests timezone definitions with CMD_TZ_RRQ', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const reply = Buffer.alloc(8 + 32);
    // minimal header mock
    reply.writeUInt32LE(0, 0);
    reply.writeUInt32LE(0, 4);
    reply.writeUInt32LE(5, 8);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(reply);

    const result = await zk.getTimezone(5);

    expect(executeStub.calledOnce).to.equal(true);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_TZ_RRQ);
    expect(executeStub.firstCall.args[1].readUInt32LE(0)).to.equal(5);
    expect(result.index).to.equal(5);
  });

  it('writes timezone definitions with CMD_TZ_WRQ', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setTimezone({
      index: 2,
      days: {
        sunday: { startHour: 8, startMinute: 0, endHour: 17, endMinute: 0 }
      }
    });

    expect(executeStub.calledOnce).to.equal(true);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_TZ_WRQ);
    expect(executeStub.firstCall.args[1].length).to.equal(32);
    expect(executeStub.firstCall.args[1].readUInt32LE(0)).to.equal(2);
  });

  it('reads and writes user timezones', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const reply = Buffer.concat([
      Buffer.alloc(8),
      Buffer.from('010000000a000000', 'hex')
    ]);
    const executeStub = sinon.stub(zk, 'executeCmd');
    executeStub.onFirstCall().resolves(reply);
    executeStub.onSecondCall().resolves(Buffer.alloc(0));

    const res = await zk.getUserTimezones(268);
    expect(res.useUserTimezones).to.equal(true);
    expect(res.useGroupTimezones).to.equal(false);
    expect(res.timezones).to.deep.equal([10, 0, 0]);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_USERTZ_RRQ);
    expect(executeStub.firstCall.args[1].readUInt32LE(0)).to.equal(268);

    await zk.setUserTimezones({ uid: 12, timezones: [1, 2, 3], useUserTimezones: true });
    expect(executeStub.secondCall.args[0]).to.equal(COMMANDS.CMD_USERTZ_WRQ);
    expect(executeStub.secondCall.args[1].length).to.equal(20);
  });

  it('reads and writes group timezones with readback verification', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const reply = Buffer.alloc(8 + 8);
    reply.writeUInt8(4, 8);
    reply.writeUInt16LE(1, 9);
    const ackOk = Buffer.alloc(8);
    ackOk.writeUInt16LE(COMMANDS.CMD_ACK_OK, 0);
    const readback = Buffer.alloc(8 + 8);
    readback.writeUInt16LE(COMMANDS.CMD_ACK_OK, 0);
    readback.writeUInt8(4, 8);
    readback.writeUInt16LE(2, 9);
    readback.writeUInt16LE(3, 11);
    readback.writeUInt16LE(0, 13);
    const executeStub = sinon.stub(zk, 'executeCmd');
    executeStub.onCall(0).resolves(reply);
    executeStub.onCall(1).resolves(ackOk); // CMD_GRPTZ_WRQ
    executeStub.onCall(2).resolves(ackOk); // CMD_REFRESHDATA
    executeStub.onCall(3).resolves(readback); // CMD_GRPTZ_RRQ readback

    const res = await zk.getGroupTimezones(4);
    expect(res.group).to.equal(4);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_GRPTZ_RRQ);
    expect(executeStub.firstCall.args[1].readUInt8(0)).to.equal(4);

    const written = await zk.setGroupTimezones({ group: 4, timezones: [2, 3, 0], verifyStyle: 1, holiday: false });
    expect(executeStub.secondCall.args[0]).to.equal(COMMANDS.CMD_GRPTZ_WRQ);
    expect(executeStub.secondCall.args[1].length).to.equal(8);
    expect(executeStub.thirdCall.args[0]).to.equal(COMMANDS.CMD_REFRESHDATA);
    expect(executeStub.getCall(3).args[0]).to.equal(COMMANDS.CMD_GRPTZ_RRQ);
    expect(written.verified).to.equal(true);
    expect(written.timezones).to.deep.equal([2, 3, 0]);
  });

  it('reads and writes unlock group combinations', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const reply = Buffer.alloc(8 + 8);
    reply.writeUInt8(7, 8);
    reply.writeUInt8(1, 9);
    reply.writeUInt8(2, 10);
    reply.writeUInt16LE(2, 14);
    const ackOk = Buffer.alloc(8);
    ackOk.writeUInt16LE(COMMANDS.CMD_ACK_OK, 0);
    const executeStub = sinon.stub(zk, 'executeCmd');
    executeStub.onCall(0).resolves(reply);
    executeStub.onCall(1).resolves(ackOk); // CMD_ULG_WRQ
    executeStub.onCall(2).resolves(ackOk); // CMD_REFRESHDATA

    const res = await zk.getUnlockGroup(7);
    expect(res.combination).to.equal(7);
    expect(res.groups).to.deep.equal([1, 2, 0, 0, 0]);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_ULG_RRQ);
    expect(executeStub.firstCall.args[1].readUInt8(0)).to.equal(7);

    await zk.setUnlockGroup({ combination: 7, groups: [1, 2] }, { verify: false });
    expect(executeStub.secondCall.args[0]).to.equal(COMMANDS.CMD_ULG_WRQ);
    expect(executeStub.secondCall.args[1].readUInt8(0)).to.equal(7);
    expect(executeStub.secondCall.args[1].readUInt16LE(6)).to.equal(2);
    expect(executeStub.thirdCall.args[0]).to.equal(COMMANDS.CMD_REFRESHDATA);
  });

  it('reads compact ASCII unlock group configuration', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const reply = Buffer.concat([
      Buffer.alloc(8),
      Buffer.from('1:::::::::\0', 'ascii')
    ]);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(reply);

    const res = await zk.getUnlockGroups();
    expect(res.format).to.equal('ascii');
    expect(res.combinations[0].groups).to.deep.equal([1, 0, 0, 0, 0]);
    expect(res.combinations[1].validGroups).to.equal(0);
    expect(executeStub.calledOnce).to.equal(true);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_ULG_RRQ);
  });

  it('writes compact ASCII unlock group configuration with readback verification', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const ackOk = Buffer.alloc(8);
    ackOk.writeUInt16LE(COMMANDS.CMD_ACK_OK, 0);
    const readback = Buffer.concat([
      ackOk,
      Buffer.from('1:::::::::\0', 'ascii')
    ]);
    const executeStub = sinon.stub(zk, 'executeCmd');
    executeStub.onCall(0).resolves(ackOk); // CMD_ULG_WRQ
    executeStub.onCall(1).resolves(ackOk); // CMD_REFRESHDATA
    executeStub.onCall(2).resolves(readback); // CMD_ULG_RRQ readback

    const result = await zk.setUnlockGroups({
      combinations: [
        { combination: 1, groups: [1] }
      ]
    });

    expect(executeStub.callCount).to.equal(3);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_ULG_WRQ);
    expect(executeStub.firstCall.args[1].toString('ascii')).to.equal('1:::::::::\0');
    expect(result.verified).to.equal(true);
    expect(result.raw).to.equal('1:::::::::');
  });

  it('rejects empty unlock group collection writes', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    let error = null;

    try {
      await zk.setUnlockGroups({});
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.match(/non-empty array/);
  });

  it('updates ASCII unlock group configuration after detecting compact format', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const ackOk = Buffer.alloc(8);
    ackOk.writeUInt16LE(COMMANDS.CMD_ACK_OK, 0);
    const readReply = Buffer.concat([Buffer.alloc(8), Buffer.from('1:::::::::\0', 'ascii')]);
    const readbackReply = Buffer.concat([ackOk, Buffer.from('1:1::::::::\0', 'ascii')]);
    const executeStub = sinon.stub(zk, 'executeCmd');
    executeStub.onCall(0).resolves(readReply); // explicit getUnlockGroups
    executeStub.onCall(1).resolves(readReply); // read inside the ascii rewrite
    executeStub.onCall(2).resolves(ackOk); // CMD_ULG_WRQ
    executeStub.onCall(3).resolves(ackOk); // CMD_REFRESHDATA
    executeStub.onCall(4).resolves(readbackReply); // verification readback

    await zk.getUnlockGroups();
    const result = await zk.setUnlockGroup({ combination: 2, groups: [1] });

    expect(executeStub.getCall(2).args[0]).to.equal(COMMANDS.CMD_ULG_WRQ);
    expect(executeStub.getCall(2).args[1].toString('ascii')).to.equal('1:1::::::::\0');
    expect(result.verified).to.equal(true);
    expect(result.combination).to.equal(2);
    expect(result.groups).to.deep.equal([1]);
    expect(result.raw).to.equal('1:1::::::::');
  });
});
