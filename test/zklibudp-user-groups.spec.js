'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibUDP = require('../zklibudp');
const { COMMANDS } = require('../constants');

describe('ZKLibUDP user group helpers', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('reads user group with CMD_USERGRP_RRQ', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const reply = Buffer.alloc(8 + 1);
    reply.writeUInt8(6, 8);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(reply);

    const res = await zk.getUserGroup(42);
    expect(executeStub.calledOnce).to.equal(true);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_USERGRP_RRQ);
    expect(executeStub.firstCall.args[1].readUInt32LE(0)).to.equal(42);
    expect(res.group).to.equal(6);
  });

  it('writes user group with CMD_USERGRP_WRQ', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const executeStub = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUserGroup({ uid: 23, group: 4 });
    expect(executeStub.calledOnce).to.equal(true);
    expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_USERGRP_WRQ);
    expect(executeStub.firstCall.args[1].readUInt8(0)).to.equal(23 & 0xFF);
    expect(executeStub.firstCall.args[1].readUInt8(4)).to.equal(4);
  });
});
