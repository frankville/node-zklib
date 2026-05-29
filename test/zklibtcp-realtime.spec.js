'use strict';

const { expect } = require('chai');
const { EventEmitter } = require('events');

const ZKLibTCP = require('../zklibtcp');
const { COMMANDS } = require('../constants');
const {
  createTCPHeader,
  classifyTCPRealTimeEvent,
  checkNotEventTCP,
  decodeTCPRealTimeEvent
} = require('../utils');

const makeRealtimeFrame = (eventType, payload = Buffer.alloc(0), replyId = 1) => {
  return createTCPHeader(COMMANDS.CMD_REG_EVENT, eventType, replyId, payload);
};

describe('ZKLibTCP realtime helpers', () => {
  it('normalizes TCP realtime attendance frames while preserving legacy fields', () => {
    const payload = Buffer.alloc(32);
    payload.write('123', 0, 'ascii');
    payload.writeUInt16LE(15, 24);
    Buffer.from([24, 5, 28, 10, 11, 12]).copy(payload, 26);

    const frame = makeRealtimeFrame(COMMANDS.EF_ATTLOG, payload);
    const event = decodeTCPRealTimeEvent(frame);

    expect(event.event_type).to.equal(COMMANDS.EF_ATTLOG);
    expect(event.userId).to.equal('123');
    expect(event.user_sn).to.equal(123);
    expect(event.attTime).to.be.instanceOf(Date);
    expect(event.att_date).to.equal(event.attTime);
    expect(event.verif_type).to.equal(15);
    expect(event.attTime.getFullYear()).to.equal(2024);
    expect(event.attTime.getMonth()).to.equal(4);
    expect(event.attTime.getDate()).to.equal(28);
  });

  it('decodes compact TCP realtime attendance frames captured from devices', () => {
    const frame = Buffer.from(
      '5050827d14000000f401d0cb010000000100000000001a051c150318',
      'hex'
    );
    const event = decodeTCPRealTimeEvent(frame);

    expect(event.event_type).to.equal(COMMANDS.EF_ATTLOG);
    expect(event.user_sn).to.equal(1);
    expect(event.userId).to.equal('1');
    expect(event.verif_type).to.equal(0);
    expect(event.verif_state).to.equal(0);
    expect(event.attTime).to.be.instanceOf(Date);
    expect(event.att_date).to.equal(event.attTime);
    expect(event.attTime.getFullYear()).to.equal(2026);
    expect(event.attTime.getMonth()).to.equal(4);
    expect(event.attTime.getDate()).to.equal(28);
    expect(event.attTime.getHours()).to.equal(21);
    expect(event.attTime.getMinutes()).to.equal(3);
    expect(event.attTime.getSeconds()).to.equal(24);
  });

  it('classifies CMD_REG_EVENT frames beyond EF_ATTLOG as realtime', () => {
    const verifyFrame = makeRealtimeFrame(COMMANDS.EF_VERIFY, Buffer.alloc(4));
    const alarmFrame = makeRealtimeFrame(COMMANDS.EF_ALARM, Buffer.alloc(4));

    expect(classifyTCPRealTimeEvent(verifyFrame)).to.include({
      isRealtime: true,
      commandId: COMMANDS.CMD_REG_EVENT,
      eventType: COMMANDS.EF_VERIFY
    });
    expect(classifyTCPRealTimeEvent(alarmFrame)).to.include({
      isRealtime: true,
      commandId: COMMANDS.CMD_REG_EVENT,
      eventType: COMMANDS.EF_ALARM
    });
    expect(checkNotEventTCP(verifyFrame)).to.equal(true);
    expect(checkNotEventTCP(alarmFrame)).to.equal(true);
  });

  it('decodes TCP verify events using the shared realtime shape where possible', () => {
    const payload = Buffer.alloc(4);
    payload.writeUInt32LE(77, 0);

    const event = decodeTCPRealTimeEvent(makeRealtimeFrame(COMMANDS.EF_VERIFY, payload));

    expect(event.event_type).to.equal(COMMANDS.EF_VERIFY);
    expect(event.user_sn).to.equal(77);
  });

  it('preserves unknown TCP realtime events without throwing', () => {
    const frame = makeRealtimeFrame(999, Buffer.from([0xaa, 0xbb]));

    const event = decodeTCPRealTimeEvent(frame);

    expect(event.event_type).to.equal(999);
    expect(event.full_data).to.equal(frame);
  });
});

describe('ZKLibTCP listener cleanup', () => {
  it('registers the protocol realtime payload and installs its listener beside existing data listeners', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const socket = new EventEmitter();
    let written = null;
    socket.write = (msg, encoding, cb) => {
      written = msg;
      cb && cb();
    };
    socket.on('data', () => {});
    zk.socket = socket;
    zk.sessionId = 12;

    await zk.getRealTimeLogs(() => {});

    expect(socket.listenerCount('data')).to.equal(2);
    expect(written.subarray(16, 20)).to.deep.equal(Buffer.from([0xff, 0xff, 0x00, 0x00]));
  });

  it('allows custom TCP realtime registration flags', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const socket = new EventEmitter();
    let written = null;
    socket.write = (msg, encoding, cb) => {
      written = msg;
      cb && cb();
    };
    zk.socket = socket;
    zk.sessionId = 12;

    await zk.getRealTimeLogs(() => {}, { flags: COMMANDS.EF_ATTLOG | COMMANDS.EF_ALARM });

    expect(written.readUInt32LE(16)).to.equal(COMMANDS.EF_ATTLOG | COMMANDS.EF_ALARM);
  });

  it('removes requestData data listeners on timeout', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 5);
    const socket = new EventEmitter();
    socket.write = (msg, encoding, cb) => cb && cb();
    zk.socket = socket;

    let error = null;
    try {
      await zk.requestData(Buffer.alloc(0));
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(Error);
    expect(socket.listenerCount('data')).to.equal(0);
  });
});
