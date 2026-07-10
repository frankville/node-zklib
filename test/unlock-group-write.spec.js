'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibTCP = require('../zklibtcp');
const ZKLibUDP = require('../zklibudp');
const { COMMANDS } = require('../constants');

const ackOkReply = (asciiBody) => {
  const body = asciiBody !== undefined ? Buffer.from(`${asciiBody}\0`, 'ascii') : Buffer.alloc(0);
  const reply = Buffer.alloc(8 + body.length);
  reply.writeUInt16LE(COMMANDS.CMD_ACK_OK, 0);
  body.copy(reply, 8);
  return reply;
};

const transports = [
  { name: 'TCP', create: () => new ZKLibTCP('127.0.0.1', 4370, 1000) },
  { name: 'UDP', create: () => new ZKLibUDP('127.0.0.1', 4370, 1000, 5500) }
];

transports.forEach(({ name, create }) => {
  describe(`ZKLib${name} verified unlock group writes`, () => {
    afterEach(() => {
      sinon.restore();
    });

    it('fails with ERR_UNLOCK_GROUPS_NOT_PERSISTED when readback misses the group', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd');
      executeStub.onCall(0).resolves(ackOkReply()); // CMD_ULG_WRQ → ACK_OK
      executeStub.onCall(1).resolves(ackOkReply()); // CMD_REFRESHDATA
      // Readback still shows the old config without group 2.
      executeStub.onCall(2).resolves(ackOkReply('1:::::::::'));

      let error = null;
      try {
        await zk.setUnlockGroup({ combination: 2, groups: [2] });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(Error);
      expect(error.code).to.equal('ERR_UNLOCK_GROUPS_NOT_PERSISTED');
      expect(error.mismatches).to.deep.equal([
        { combination: 2, expected: [2], actual: [] }
      ]);
      expect(error.readback.raw).to.equal('1:::::::::');
    });

    it('verifies a single-combination write against the readback', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd');
      executeStub.onCall(0).resolves(ackOkReply());
      executeStub.onCall(1).resolves(ackOkReply());
      executeStub.onCall(2).resolves(ackOkReply('1:2::::::::'));

      const result = await zk.setUnlockGroup({ combination: 2, groups: [2] });

      expect(result.verified).to.equal(true);
      expect(result.combination).to.equal(2);
      expect(result.groups).to.deep.equal([2]);
      expect(result.raw).to.equal('1:2::::::::');
    });

    it('verifies that combinations omitted from a full write were cleared', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd');
      executeStub.onCall(0).resolves(ackOkReply());
      executeStub.onCall(1).resolves(ackOkReply());
      // Device kept combination 2 even though the write should have cleared it.
      executeStub.onCall(2).resolves(ackOkReply('1:2::::::::'));

      let error = null;
      try {
        await zk.setUnlockGroups({ combinations: [{ combination: 1, groups: [1] }] });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(Error);
      expect(error.code).to.equal('ERR_UNLOCK_GROUPS_NOT_PERSISTED');
      expect(error.mismatches).to.deep.equal([
        { combination: 2, expected: [], actual: [2] }
      ]);
    });

    it('rejects unacknowledged writes when verify is disabled', async () => {
      const zk = create();
      const nack = Buffer.alloc(8);
      nack.writeUInt16LE(COMMANDS.CMD_ACK_ERROR, 0);
      const executeStub = sinon.stub(zk, 'executeCmd');
      executeStub.onCall(0).resolves(nack);
      executeStub.onCall(1).resolves(ackOkReply());

      let error = null;
      try {
        await zk.setUnlockGroup({ combination: 2, groups: [2] }, { verify: false });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(Error);
      expect(error.code).to.equal('ERR_UNLOCK_GROUPS_WRITE_REJECTED');
    });

    it('passes raw buffers and ASCII strings through without verification', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd').resolves(ackOkReply());

      const raw = Buffer.from('1:::::::::\0', 'ascii');
      await zk.setUnlockGroup(raw);
      expect(executeStub.callCount).to.equal(1);
      expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_ULG_WRQ);
      expect(executeStub.firstCall.args[1]).to.equal(raw);

      await zk.setUnlockGroups('1:2::::::::');
      expect(executeStub.callCount).to.equal(2);
      expect(executeStub.secondCall.args[1].toString('ascii')).to.equal('1:2::::::::\0');
    });

    it('routes combination-shaped setUnlockGroups input through verified setUnlockGroup', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd');
      executeStub.onCall(0).resolves(ackOkReply());
      executeStub.onCall(1).resolves(ackOkReply());
      executeStub.onCall(2).resolves(ackOkReply('1:2::::::::'));

      const result = await zk.setUnlockGroups({ combination: 2, groups: [2] });

      expect(result.verified).to.equal(true);
      expect(result.combination).to.equal(2);
    });
  });
});
