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
    const reply = Buffer.alloc(8 + 8);
    reply.writeUInt16LE(1, 8); // use group flag
    reply.writeUInt16LE(10, 10);
    const executeStub = sinon.stub(zk, 'executeCmd');
    executeStub.onFirstCall().resolves(reply);
    executeStub.onSecondCall().resolves(Buffer.alloc(0));

    const res = await zk.getUserTimezones(268);
    expect(res.useGroupTimezones).to.equal(true);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_USERTZ_RRQ);
    expect(executeStub.firstCall.args[1].readUInt32LE(0)).to.equal(268);

    await zk.setUserTimezones({ uid: 12, timezones: [1, 2, 3], useUserTimezones: true });
    expect(executeStub.secondCall.args[0]).to.equal(COMMANDS.CMD_USERTZ_WRQ);
    expect(executeStub.secondCall.args[1].length).to.equal(20);
  });

  it('reads and writes group timezones', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const reply = Buffer.alloc(8 + 8);
    reply.writeUInt8(4, 8);
    reply.writeUInt16LE(1, 9);
    const executeStub = sinon.stub(zk, 'executeCmd');
    executeStub.onFirstCall().resolves(reply);
    executeStub.onSecondCall().resolves(Buffer.alloc(0));

    const res = await zk.getGroupTimezones(4);
    expect(res.group).to.equal(4);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_GRPTZ_RRQ);
    expect(executeStub.firstCall.args[1].readUInt8(0)).to.equal(4);

    await zk.setGroupTimezones({ group: 4, timezones: [2, 3, 0], verifyStyle: 1, holiday: false });
    expect(executeStub.secondCall.args[0]).to.equal(COMMANDS.CMD_GRPTZ_WRQ);
    expect(executeStub.secondCall.args[1].length).to.equal(8);
  });

  it('reads and writes unlock group combinations', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const reply = Buffer.alloc(8 + 8);
    reply.writeUInt8(7, 8);
    reply.writeUInt8(1, 9);
    reply.writeUInt8(2, 10);
    reply.writeUInt16LE(2, 14);
    const executeStub = sinon.stub(zk, 'executeCmd');
    executeStub.onFirstCall().resolves(reply);
    executeStub.onSecondCall().resolves(Buffer.alloc(0));

    const res = await zk.getUnlockGroup(7);
    expect(res.combination).to.equal(7);
    expect(res.groups).to.deep.equal([1, 2, 0, 0, 0]);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_ULG_RRQ);
    expect(executeStub.firstCall.args[1].readUInt8(0)).to.equal(7);

    await zk.setUnlockGroup({ combination: 7, groups: [1, 2] });
    expect(executeStub.secondCall.args[0]).to.equal(COMMANDS.CMD_ULG_WRQ);
    expect(executeStub.secondCall.args[1].readUInt8(0)).to.equal(7);
    expect(executeStub.secondCall.args[1].readUInt16LE(6)).to.equal(2);
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

  it('writes compact ASCII unlock group configuration', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUnlockGroups({
      combinations: [
        { combination: 1, groups: [1] }
      ]
    });

    expect(executeStub.calledOnce).to.equal(true);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_ULG_WRQ);
    expect(executeStub.firstCall.args[1].toString('ascii')).to.equal('1:::::::::\0');
  });
});
