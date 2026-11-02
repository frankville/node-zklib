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

// In the repeated autumn hour a decoded wall time resolves to the first offset, so the read-back
// of a write that persisted reads an hour off as an instant. Run in a child with
// TZ=Europe/Madrid: this process's zone is whatever the host has.
describe('device time across the repeated autumn hour', () => {
  it('accepts the read-back of a write made during the second 02:30 in Madrid', () => {
    const { execFileSync } = require('child_process');
    const script = `
      const sinon = require(${JSON.stringify(require.resolve('sinon'))});
      const ZKLibUDP = require(${JSON.stringify(require.resolve('../zklibudp'))});
      const { COMMANDS } = require(${JSON.stringify(require.resolve('../constants'))});
      const { encodeTime } = require(${JSON.stringify(require.resolve('../utils'))});
      const written = new Date(Date.parse('2026-10-25T01:30:00.000Z')); // the second 02:30 (CET)
      const header = (command) => { const b = Buffer.alloc(8); b.writeUInt16LE(command, 0); return b; };
      const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
      let stored = null;
      sinon.stub(zk, 'executeCmd').callsFake(async (command, payload) => {
        if (command === COMMANDS.CMD_SET_TIME) { stored = payload.readUInt32LE(0); return header(COMMANDS.CMD_ACK_OK); }
        const p = Buffer.alloc(4); p.writeUInt32LE(stored, 0);
        return Buffer.concat([header(COMMANDS.CMD_ACK_OK), p]);
      });
      zk.setTime(written).then(
        readback => process.stdout.write(JSON.stringify({ ok: true, hours: written.getHours(), readback: readback.getHours() })),
        err => process.stdout.write(JSON.stringify({ ok: false, code: err.code }))
      );
    `;
    const out = JSON.parse(execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: 'Europe/Madrid' }
    }).toString());
    expect(out).to.deep.equal({ ok: true, hours: 2, readback: 2 });
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
      // A clock still a day ahead after the write.
      executeStub.onSecondCall().resolves(timeReply(new Date(2026, 9, 31, 17, 0, 0)));

      const err = await zk.setTime(KNOWN_WALL_TIME()).then(() => null, e => e);

      expect(err).to.be.an('error');
      expect(err.code).to.equal('ERR_SET_TIME_NOT_PERSISTED');
      expect(err.differenceMs).to.be.closeTo(24 * 3600 * 1000, 5000);
    });

    it('rejects an acknowledged write the clock shows behind, as well as ahead', async () => {
      const zk = create();
      const executeStub = sinon.stub(zk, 'executeCmd');
      executeStub.onFirstCall().resolves(reply(COMMANDS.CMD_ACK_OK));
      // A write the terminal ignored, on a clock that was behind.
      executeStub.onSecondCall().resolves(timeReply(new Date(2026, 9, 29, 17, 0, 0)));

      const err = await zk.setTime(KNOWN_WALL_TIME()).then(() => null, e => e);

      expect(err).to.be.an('error');
      expect(err.code).to.equal('ERR_SET_TIME_NOT_PERSISTED');
      expect(err.differenceMs).to.be.closeTo(-24 * 3600 * 1000, 5000);
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
