'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibTCP = require('../zklibtcp');
const ZKLibUDP = require('../zklibudp');
const { COMMANDS } = require('../constants');

const ackOkReply = (dataHex = '') => {
  const data = Buffer.from(dataHex, 'hex');
  const reply = Buffer.alloc(8 + data.length);
  reply.writeUInt16LE(COMMANDS.CMD_ACK_OK, 0);
  data.copy(reply, 8);
  return reply;
};

const transports = [
  { name: 'TCP', create: (options) => new ZKLibTCP('127.0.0.1', 4370, 1000, 0, options || {}) },
  { name: 'UDP', create: (options) => new ZKLibUDP('127.0.0.1', 4370, 1000, 5500, options || {}) }
];

transports.forEach(({ name, create }) => {
  describe(`ZKLib${name} verified group timezone writes`, () => {
    afterEach(() => {
      sinon.restore();
    });

    it('fails with ERR_GROUP_TZ_NOT_PERSISTED when readback returns stale values', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd');
      executeStub.onCall(0).resolves(ackOkReply()); // CMD_GRPTZ_WRQ → ACK_OK
      executeStub.onCall(1).resolves(ackOkReply()); // CMD_REFRESHDATA
      // Readback returns the original record — real capture of the silent-persist failure.
      executeStub.onCall(2).resolves(ackOkReply('0100000001000000'));

      let error = null;
      try {
        await zk.setGroupTimezones({ group: 1, timezones: [0, 1, 2] });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(Error);
      expect(error.code).to.equal('ERR_GROUP_TZ_NOT_PERSISTED');
      expect(error.message).to.match(/not persisted/);
      expect(error.attempts).to.have.length(1);
      expect(error.attempts[0].ackOk).to.equal(true);
      expect(error.attempts[0].readback.timezones).to.deep.equal([0, 1, 0]);
      expect(error.expected.timezones).to.deep.equal([0, 1, 2]);
    });

    it('tries formats in order and remembers the one that persists', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd');
      // legacy8 attempt: ACK_OK but readback unchanged.
      executeStub.onCall(0).resolves(ackOkReply());
      executeStub.onCall(1).resolves(ackOkReply());
      executeStub.onCall(2).resolves(ackOkReply('0100000001000000'));
      // uint16 attempt: readback now matches [0, 1, 2].
      executeStub.onCall(3).resolves(ackOkReply());
      executeStub.onCall(4).resolves(ackOkReply());
      executeStub.onCall(5).resolves(ackOkReply('0100000001000200'));

      const result = await zk.setGroupTimezones(
        { group: 1, timezones: [0, 1, 2] },
        { formats: ['legacy8', 'uint16'] }
      );

      expect(result.verified).to.equal(true);
      expect(result.format).to.equal('uint16');
      expect(result.timezones).to.deep.equal([0, 1, 2]);
      expect(zk.groupTimezoneFormat).to.equal('uint16');

      // legacy8 payload uses the documented unaligned offsets.
      expect(executeStub.getCall(0).args[1].toString('hex')).to.equal('0100000100020000');
      // uint16 payload is four aligned little-endian words.
      expect(executeStub.getCall(3).args[1].toString('hex')).to.equal('0100000001000200');

      // Subsequent writes reuse the proven format without being told.
      executeStub.onCall(6).resolves(ackOkReply());
      executeStub.onCall(7).resolves(ackOkReply());
      executeStub.onCall(8).resolves(ackOkReply('0100030000000000'));
      await zk.setGroupTimezones({ group: 1, timezones: [3, 0, 0] });
      expect(executeStub.getCall(6).args[1].toString('hex')).to.equal('0100030000000000');
    });

    it('skips readback when verify is disabled but still refreshes and checks the ACK', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd');
      executeStub.onCall(0).resolves(ackOkReply());
      executeStub.onCall(1).resolves(ackOkReply());

      await zk.setGroupTimezones({ group: 2, timezones: [1, 0, 0] }, { verify: false });

      expect(executeStub.callCount).to.equal(2);
      expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_GRPTZ_WRQ);
      expect(executeStub.secondCall.args[0]).to.equal(COMMANDS.CMD_REFRESHDATA);
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
        await zk.setGroupTimezones({ group: 2, timezones: [1, 0, 0] }, { verify: false });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(Error);
      expect(error.code).to.equal('ERR_GROUP_TZ_WRITE_REJECTED');
    });

    it('honors the groupTimezonePacketFormat constructor option', async () => {
      const zk = create({ groupTimezonePacketFormat: 'uint16' });
      const executeStub = sinon.stub(zk, 'executeCmd');
      executeStub.onCall(0).resolves(ackOkReply());
      executeStub.onCall(1).resolves(ackOkReply());
      executeStub.onCall(2).resolves(ackOkReply('0100000001000200'));

      const result = await zk.setGroupTimezones({ group: 1, timezones: [0, 1, 2] });

      expect(result.format).to.equal('uint16');
      expect(executeStub.getCall(0).args[1].toString('hex')).to.equal('0100000001000200');
    });

    it('verifies compact8 writes against the compact8 reply shape', async () => {
      const zk = create({ groupTimezonePacketFormat: 'compact8' });
      const executeStub = sinon.stub(zk, 'executeCmd');
      executeStub.onCall(0).resolves(ackOkReply());
      executeStub.onCall(1).resolves(ackOkReply());
      // Reply carries found(u32)=1 plus the byte-sized record, not the group.
      executeStub.onCall(2).resolves(ackOkReply('0100000000010200'));

      const result = await zk.setGroupTimezones({ group: 5, timezones: [0, 1, 2] });

      expect(executeStub.getCall(0).args[1].toString('hex')).to.equal('0500000000010200');
      expect(result.verified).to.equal(true);
      expect(result.format).to.equal('compact8');
      expect(result.timezones).to.deep.equal([0, 1, 2]);
      expect(result.readback.found).to.equal(true);
      expect(result.readback.group).to.equal(5);
    });

    it('passes raw buffers through without verification', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd').resolves(ackOkReply());
      const raw = Buffer.from('0100000100020000', 'hex');

      await zk.setGroupTimezones(raw);

      expect(executeStub.callCount).to.equal(1);
      expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_GRPTZ_WRQ);
      expect(executeStub.firstCall.args[1]).to.equal(raw);
    });

    it('requires verification when probing multiple formats', async () => {
      const zk = create();
      sinon.stub(zk, 'executeCmd').resolves(ackOkReply());

      let error = null;
      try {
        await zk.setGroupTimezones(
          { group: 1, timezones: [0, 1, 2] },
          { verify: false, formats: ['legacy8', 'uint16'] }
        );
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(Error);
      expect(error.message).to.match(/requires verify/);
    });
  });
});
