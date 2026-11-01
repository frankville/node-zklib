'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibUDP = require('../zklibudp');
const ZKLibTCP = require('../zklibtcp');
const { COMMANDS } = require('../constants');
const { encodeTime, decodeTime } = require('../utils');

// 2026-10-30 17:00:00 wall time, worked by hand from the packed layout:
// days = ((26 * 12) + 9) * 31 + 29 = 9980; ((9980 * 24 + 17) * 60 + 0) * 60 + 0
const KNOWN_WALL_TIME = () => new Date(2026, 9, 30, 17, 0, 0);
const KNOWN_PACKED = 862333200;

const reply = (command, payload = Buffer.alloc(0)) => {
  const header = Buffer.alloc(8);
  header.writeUInt16LE(command, 0);
  return Buffer.concat([header, payload]);
};

const timeReply = (date) => {
  const payload = Buffer.alloc(4);
  payload.writeUInt32LE(encodeTime(date), 0);
  return reply(COMMANDS.CMD_ACK_OK, payload);
};

describe('device time encoding', () => {
  it('packs wall time the way attendance records carry it', () => {
    expect(encodeTime(KNOWN_WALL_TIME())).to.equal(KNOWN_PACKED);
  });

  it('round-trips through decodeTime to the second', () => {
    const date = new Date(2031, 1, 28, 23, 59, 58);
    expect(decodeTime(encodeTime(date)).getTime()).to.equal(date.getTime());
  });

  it('drops milliseconds, which the device does not store', () => {
    const date = new Date(2026, 9, 30, 17, 0, 0, 999);
    expect(decodeTime(encodeTime(date)).getTime()).to.equal(KNOWN_WALL_TIME().getTime());
  });

  it('refuses a year the two-digit form cannot carry', () => {
    expect(() => encodeTime(new Date(1999, 11, 31))).to.throw(RangeError);
    expect(() => encodeTime(new Date(2100, 0, 1))).to.throw(RangeError);
  });

  it('refuses something that is not a valid Date', () => {
    expect(() => encodeTime(new Date('nope'))).to.throw(TypeError);
    expect(() => encodeTime(KNOWN_PACKED)).to.throw(TypeError);
  });
});

[
  ['UDP', () => new ZKLibUDP('127.0.0.1', 4370, 1000, 5500)],
  ['TCP', () => new ZKLibTCP('127.0.0.1', 4370, 1000)]
].forEach(([transport, create]) => {
  describe(`ZKLib${transport} device time`, () => {
    afterEach(() => {
      sinon.restore();
    });

    it('reads the clock with CMD_GET_TIME', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd').resolves(timeReply(KNOWN_WALL_TIME()));

      const time = await zk.getTime();

      expect(executeStub.calledOnce).to.equal(true);
      expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_GET_TIME);
      expect(time.getTime()).to.equal(KNOWN_WALL_TIME().getTime());
    });

    it('rejects a read the device refused', async () => {
      const zk = create();
      sinon.stub(zk, 'executeCmd').resolves(reply(COMMANDS.CMD_ACK_ERROR));

      const err = await zk.getTime().then(() => null, e => e);

      expect(err).to.be.an('error');
      expect(err.code).to.equal('ERR_GET_TIME_REJECTED');
      expect(err.commandId).to.equal(COMMANDS.CMD_ACK_ERROR);
    });

    it('rejects an ACK whose payload is not one u32, rather than decode another reply', async () => {
      const zk = create();
      sinon.stub(zk, 'executeCmd').resolves(reply(COMMANDS.CMD_ACK_OK, Buffer.alloc(8)));

      const err = await zk.getTime().then(() => null, e => e);

      expect(err).to.be.an('error');
      expect(err.code).to.equal('ERR_GET_TIME_REJECTED');
    });

    it('writes the clock with CMD_SET_TIME and returns the read-back', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd');
      executeStub.onFirstCall().resolves(reply(COMMANDS.CMD_ACK_OK));
      executeStub.onSecondCall().resolves(timeReply(KNOWN_WALL_TIME()));

      const readback = await zk.setTime(KNOWN_WALL_TIME());

      expect(executeStub.firstCall.args[0]).to.equal(COMMANDS.CMD_SET_TIME);
      expect(executeStub.firstCall.args[1].length).to.equal(4);
      expect(executeStub.firstCall.args[1].readUInt32LE(0)).to.equal(KNOWN_PACKED);
      expect(executeStub.secondCall.args[0]).to.equal(COMMANDS.CMD_GET_TIME);
      expect(readback.getTime()).to.equal(KNOWN_WALL_TIME().getTime());
    });

    it('rejects a write the device refused, without reading back', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd').resolves(reply(COMMANDS.CMD_ACK_ERROR));

      const err = await zk.setTime(KNOWN_WALL_TIME()).then(() => null, e => e);

      expect(err).to.be.an('error');
      expect(err.code).to.equal('ERR_SET_TIME_REJECTED');
      expect(executeStub.calledOnce).to.equal(true);
    });

    it('rejects an acknowledged write the clock does not show', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd');
      executeStub.onFirstCall().resolves(reply(COMMANDS.CMD_ACK_OK));
      // The skew of 2026-10-30: the clock still a day ahead after the write.
      executeStub.onSecondCall().resolves(timeReply(new Date(2026, 9, 31, 17, 0, 0)));

      const err = await zk.setTime(KNOWN_WALL_TIME()).then(() => null, e => e);

      expect(err).to.be.an('error');
      expect(err.code).to.equal('ERR_SET_TIME_NOT_PERSISTED');
      expect(err.differenceMs).to.be.closeTo(24 * 3600 * 1000, 5000);
    });

    it('refuses a date it cannot encode before sending anything', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd');

      const err = await zk.setTime(new Date('nope')).then(() => null, e => e);

      expect(err).to.be.instanceOf(TypeError);
      expect(executeStub.called).to.equal(false);
    });
  });
});
