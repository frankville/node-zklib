'use strict';

const net = require('net');
const { EventEmitter } = require('events');
const { expect } = require('chai');
const sinon = require('sinon');

const ZKLib = require('../zklib');
const ZKLibTCP = require('../zklibtcp');
const { COMMANDS } = require('../constants');

const TCP_PREFIX = [0x50, 0x50, 0x82, 0x7d];

// A device frame: TCP prefix + 8-byte ZK header + payload.
const deviceFrame = (commandId, sessionId, replyId, payload = Buffer.alloc(0)) => {
  const inner = Buffer.alloc(8 + payload.length);
  inner.writeUInt16LE(commandId, 0);
  inner.writeUInt16LE(sessionId, 4);
  inner.writeUInt16LE(replyId, 6);
  payload.copy(inner, 8);
  const prefix = Buffer.from([...TCP_PREFIX, 0, 0, 0, 0]);
  prefix.writeUInt16LE(inner.length, 4);
  return Buffer.concat([prefix, inner]);
};

const ackFrame = (replyId, sessionId = 12) => deviceFrame(COMMANDS.CMD_ACK_OK, sessionId, replyId);

// A compact realtime attendance frame captured from a device.
const realtimeEventFrame = () => Buffer.from('5050827d14000000f401d0cb010000000100000000001a051c150318', 'hex');

const commandOf = (frame) => frame.readUInt16LE(8);
const replyIdOf = (frame) => frame.readUInt16LE(14);

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.onWrite = null;
    // When true, end() never completes and never emits 'close', like a peer that
    // stops answering.
    this.silentEnd = false;
    this.destroyed = false;
  }

  setTimeout() {}

  connect() {
    process.nextTick(() => this.emit('connect'));
  }

  write(msg, encoding, cb) {
    this.writes.push(msg);
    if (this.onWrite) return this.onWrite(msg, cb);
    if (cb) cb();
    return true;
  }

  end(cb) {
    if (this.silentEnd) return this;
    process.nextTick(() => {
      this.emit('close', false);
      if (cb) cb();
    });
    return this;
  }

  destroy() {
    if (this.destroyed) return this;
    this.destroyed = true;
    process.nextTick(() => this.emit('close', false));
    return this;
  }

  reset() {
    const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    this.emit('error', err);
    this.emit('close', true);
    return err;
  }
}

const captureLogger = () => {
  const calls = [];
  const logger = {};
  ['error', 'warn', 'info', 'debug', 'trace', 'log'].forEach(level => {
    logger[level] = (line, meta) => calls.push({ level, line, meta });
  });
  return { logger, calls };
};

const linesAt = (calls, level, pattern) => calls.filter(c => c.level === level && pattern.test(c.line));

describe('ZKLibTCP realtime liveness probe', () => {
  let socket;
  let zk;
  let calls;
  let cbError;
  let cbClose;
  let events;

  // Opens a TCP instance on a fake socket through the real createSocket(), so the
  // caller's error/close callbacks are wired exactly as in use.
  const open = async () => {
    socket = new FakeSocket();
    sinon.stub(net, 'Socket').returns(socket);
    zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const captured = captureLogger();
    calls = captured.calls;
    zk.setLogger(captured.logger).setLogLevel('debug');
    cbError = sinon.spy();
    cbClose = sinon.spy();
    await zk.createSocket(cbError, cbClose);
    zk.sessionId = 12;
  };

  const register = async (options) => {
    events = [];
    await zk.getRealTimeLogs(event => events.push(event), options);
    return socket.writes[socket.writes.length - 1];
  };

  afterEach(() => {
    sinon.restore();
  });

  describe('acknowledgement', () => {
    beforeEach(open);

    it('resolves on the matching ACK and logs it at debug, not warn', async () => {
      await register();
      const pending = zk.probeRealTime({ timeoutMs: 1000 });
      const probeFrame = socket.writes[socket.writes.length - 1];

      socket.emit('data', ackFrame(replyIdOf(probeFrame)));

      expect(await pending).to.equal(true);
      expect(linesAt(calls, 'debug', /realtime probe acknowledged/)).to.have.length(1);
      expect(linesAt(calls, 'warn', /realtime frame filtered/)).to.have.length(0);
      expect(zk._realtimeProbe).to.equal(null);
    });

    it('still delivers realtime events that share a chunk with the ACK', async () => {
      await register();
      const pending = zk.probeRealTime({ timeoutMs: 1000 });
      const probeFrame = socket.writes[socket.writes.length - 1];

      socket.emit('data', Buffer.concat([
        realtimeEventFrame(),
        ackFrame(replyIdOf(probeFrame)),
        realtimeEventFrame(),
      ]));

      expect(await pending).to.equal(true);
      expect(events).to.have.length(2);
      events.forEach(event => {
        expect(event.event_type).to.equal(COMMANDS.EF_ATTLOG);
        expect(event.user_sn).to.equal(1);
      });
    });

    it('logs the ACK of the initial registration at debug, not warn', async () => {
      const registerFrame = await register();

      socket.emit('data', ackFrame(replyIdOf(registerFrame)));

      expect(linesAt(calls, 'debug', /realtime registration acknowledged/)).to.have.length(1);
      expect(linesAt(calls, 'warn', /realtime frame filtered/)).to.have.length(0);
    });

    it('settles a pending probe on the registration ACK as well', async () => {
      const registerFrame = await register();
      const pending = zk.probeRealTime({ timeoutMs: 1000 });

      socket.emit('data', ackFrame(replyIdOf(registerFrame)));

      expect(await pending).to.equal(true);
    });

    it('keeps the warning for an unrelated non-realtime frame', async () => {
      await register();

      socket.emit('data', deviceFrame(COMMANDS.CMD_ACK_ERROR, 12, 999));

      expect(linesAt(calls, 'warn', /realtime frame filtered/)).to.have.length(1);
    });
  });

  describe('which frames answer a probe', () => {
    beforeEach(open);

    const probeAndSend = async (frameFor) => {
      const registerFrame = await register();
      const pending = zk.probeRealTime({ timeoutMs: 1000 });
      const probeFrame = socket.writes[socket.writes.length - 1];
      socket.emit('data', frameFor({ registerFrame, probeFrame }));
      return pending;
    };

    it('a realtime event received after the write answers it, and is still delivered', async () => {
      expect(await probeAndSend(() => realtimeEventFrame())).to.equal(true);
      expect(events).to.have.length(1);
      expect(events[0].user_sn).to.equal(1);
    });

    it('a CMD_ACK_OK with the probe reply id answers it, logged at debug', async () => {
      expect(await probeAndSend(({ probeFrame }) => ackFrame(replyIdOf(probeFrame)))).to.equal(true);
      expect(linesAt(calls, 'debug', /realtime probe acknowledged/)).to.have.length(1);
      expect(linesAt(calls, 'warn', /realtime frame filtered/)).to.have.length(0);
    });

    // -1 would be the registration's own reply id, which is logged at debug.
    [1, -2, 1000].forEach(offset => {
      it(`a CMD_ACK_OK with another reply id (probe ${offset > 0 ? '+' : ''}${offset}) answers it, logged at warn`, async () => {
        const other = ({ probeFrame }) => ackFrame((replyIdOf(probeFrame) + offset + 65535) % 65535);
        expect(await probeAndSend(other)).to.equal(true);
        const warns = linesAt(calls, 'warn', /realtime frame filtered/);
        expect(warns).to.have.length(1);
        expect(warns[0].meta.replyId).to.equal((replyIdOf(socket.writes[1]) + offset + 65535) % 65535);
        expect(linesAt(calls, 'debug', /acknowledged/)).to.have.length(0);
      });
    });

    it('a CMD_ACK_ERROR answers it, logged at warn even with the probe reply id', async () => {
      const ackError = ({ probeFrame }) => deviceFrame(COMMANDS.CMD_ACK_ERROR, 12, replyIdOf(probeFrame));
      expect(await probeAndSend(ackError)).to.equal(true);
      expect(linesAt(calls, 'warn', /realtime frame filtered/)).to.have.length(1);
      expect(linesAt(calls, 'debug', /acknowledged/)).to.have.length(0);
    });

    it('a frame received before the write does not answer it', async () => {
      await register();
      const event = realtimeEventFrame();
      // The first half of an event is already buffered when the probe is written.
      socket.emit('data', event.subarray(0, 12));
      const pending = zk.probeRealTime({ timeoutMs: 1000 });
      const probeFrame = socket.writes[socket.writes.length - 1];

      socket.emit('data', event.subarray(12));

      expect(events).to.have.length(1);
      expect(zk._realtimeProbe).to.not.equal(null);

      socket.emit('data', ackFrame(replyIdOf(probeFrame)));
      expect(await pending).to.equal(true);
    });

    const expectTimeout = async (pending) => {
      let error = null;
      try { await pending; } catch (err) { error = err; }
      expect(error && error.code).to.equal('ERR_REALTIME_PROBE_TIMEOUT');
    };

    it('bytes after the write that never complete a frame do not answer it', async () => {
      await register();
      const pending = zk.probeRealTime({ timeoutMs: 30 });

      // A frame header that declares far more payload than ever arrives: the stream
      // keeps receiving bytes but is wedged behind a frame that never completes.
      const header = Buffer.from([...TCP_PREFIX, 0xff, 0xff, 0x00, 0x00]);
      socket.emit('data', Buffer.concat([header, Buffer.alloc(32)]));
      socket.emit('data', Buffer.alloc(64));

      await expectTimeout(pending);
      expect(events).to.have.length(0);
    });

    it('bytes after the write that are discarded as lost sync do not answer it', async () => {
      await register();
      const pending = zk.probeRealTime({ timeoutMs: 30 });

      socket.emit('data', Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex'));
      socket.emit('data', Buffer.alloc(24, 0xaa));

      expect(linesAt(calls, 'warn', /realtime stream lost sync/)).to.have.length(2);
      await expectTimeout(pending);
      expect(events).to.have.length(0);
    });

    it('a frame received and handled before the probe does not answer it', async () => {
      await register();
      socket.emit('data', realtimeEventFrame());
      zk.probeRealTime({ timeoutMs: 1000 }).catch(() => {});

      expect(zk._realtimeProbe).to.not.equal(null);
      await zk.closeSocket();
    });

    it('still logs the probe ACK at debug when an earlier frame already answered the probe', async () => {
      await register();
      const pending = zk.probeRealTime({ timeoutMs: 1000 });
      const probeFrame = socket.writes[socket.writes.length - 1];

      socket.emit('data', Buffer.concat([realtimeEventFrame(), ackFrame(replyIdOf(probeFrame))]));

      expect(await pending).to.equal(true);
      expect(linesAt(calls, 'debug', /realtime probe acknowledged/)).to.have.length(1);
      expect(linesAt(calls, 'warn', /realtime frame filtered/)).to.have.length(0);
    });
  });

  describe('frame', () => {
    beforeEach(open);

    it('repeats the registration with the same flags on the same socket', async () => {
      const registerFrame = await register({ flags: COMMANDS.EF_ATTLOG | COMMANDS.EF_ALARM });
      const pending = zk.probeRealTime({ timeoutMs: 1000 });
      const probeFrame = socket.writes[socket.writes.length - 1];

      expect(socket.writes).to.have.length(2);
      expect(commandOf(probeFrame)).to.equal(COMMANDS.CMD_REG_EVENT);
      expect(probeFrame.subarray(16)).to.deep.equal(registerFrame.subarray(16));
      expect(replyIdOf(probeFrame)).to.not.equal(replyIdOf(registerFrame));

      socket.emit('data', ackFrame(replyIdOf(probeFrame)));
      await pending;
    });

    it('does not add a data listener of its own', async () => {
      await register();
      const before = socket.listenerCount('data');
      const pending = zk.probeRealTime({ timeoutMs: 1000 });

      expect(socket.listenerCount('data')).to.equal(before);

      socket.emit('data', ackFrame(replyIdOf(socket.writes[socket.writes.length - 1])));
      await pending;
    });

    it('keeps the reply id within 16 bits on a long-lived socket', async () => {
      await register();
      // createTCPHeader() writes the reply id as a u16 and throws past 65535.
      zk.replyId = 65535;

      const pending = zk.probeRealTime({ timeoutMs: 1000 });
      const probeFrame = socket.writes[socket.writes.length - 1];
      socket.emit('data', ackFrame(replyIdOf(probeFrame)));

      expect(await pending).to.equal(true);
      expect(zk.replyId).to.be.below(65536);
    });

    it('shares one in-flight probe between concurrent calls and writes one frame', async () => {
      await register();
      const first = zk.probeRealTime({ timeoutMs: 1000 });
      const second = zk.probeRealTime({ timeoutMs: 1000 });

      expect(second).to.equal(first);
      expect(socket.writes).to.have.length(2);

      socket.emit('data', ackFrame(replyIdOf(socket.writes[1])));
      expect(await first).to.equal(true);
      expect(await second).to.equal(true);
    });
  });

  describe('timeout', () => {
    let clock;

    beforeEach(async () => {
      await open();
      await register();
      clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    it('rejects with ERR_REALTIME_PROBE_TIMEOUT when no ACK arrives, and clears its timer', async () => {
      const pending = zk.probeRealTime({ timeoutMs: 10000 });
      expect(clock.countTimers()).to.equal(1);

      clock.tick(9999);
      expect(zk._realtimeProbe).to.not.equal(null);
      clock.tick(1);

      let error = null;
      try { await pending; } catch (err) { error = err; }
      expect(error).to.be.instanceOf(Error);
      expect(error.code).to.equal('ERR_REALTIME_PROBE_TIMEOUT');
      expect(error.timeoutMs).to.equal(10000);
      expect(clock.countTimers()).to.equal(0);
      expect(zk._realtimeProbe).to.equal(null);
    });

    it('defaults to a 10 s timeout', async () => {
      const pending = zk.probeRealTime();
      clock.tick(9999);
      expect(zk._realtimeProbe).to.not.equal(null);
      clock.tick(1);

      let error = null;
      try { await pending; } catch (err) { error = err; }
      expect(error && error.code).to.equal('ERR_REALTIME_PROBE_TIMEOUT');
    });

    it('clears its timer when the ACK settles it', async () => {
      const pending = zk.probeRealTime({ timeoutMs: 10000 });
      socket.emit('data', ackFrame(replyIdOf(socket.writes[socket.writes.length - 1])));

      expect(await pending).to.equal(true);
      expect(clock.countTimers()).to.equal(0);
    });

    it('allows a new probe once the previous one has settled', async () => {
      const first = zk.probeRealTime({ timeoutMs: 100 });
      clock.tick(100);
      try { await first; } catch (err) { /* timed out */ }

      const second = zk.probeRealTime({ timeoutMs: 100 });
      expect(second).to.not.equal(first);
      expect(socket.writes).to.have.length(3);
      socket.emit('data', ackFrame(replyIdOf(socket.writes[2])));
      expect(await second).to.equal(true);
    });
  });

  describe('socket failure', () => {
    beforeEach(async () => {
      await open();
      await register();
    });

    it('rejects promptly with the error when the socket resets, and the caller callbacks still fire', async () => {
      const started = Date.now();
      const pending = zk.probeRealTime({ timeoutMs: 10000 });

      const resetError = socket.reset();

      let error = null;
      try { await pending; } catch (err) { error = err; }
      expect(error).to.equal(resetError);
      expect(Date.now() - started).to.be.below(500);
      expect(cbError.calledOnceWithExactly(resetError)).to.equal(true);
      expect(cbClose.calledOnceWithExactly('tcp')).to.equal(true);
      expect(zk.socket).to.equal(null);
      expect(socket.listenerCount('error')).to.equal(0);
      expect(socket.listenerCount('close')).to.equal(0);
    });

    it('rejects promptly with ERR_REALTIME_PROBE_SOCKET_CLOSED when the socket closes', async () => {
      const pending = zk.probeRealTime({ timeoutMs: 10000 });

      socket.emit('close', false);

      let error = null;
      try { await pending; } catch (err) { error = err; }
      expect(error).to.be.instanceOf(Error);
      expect(error.code).to.equal('ERR_REALTIME_PROBE_SOCKET_CLOSED');
      expect(cbClose.calledOnceWithExactly('tcp')).to.equal(true);
      expect(cbError.called).to.equal(false);
    });

    it('rejects when the write fails', async () => {
      const writeError = new Error('write EPIPE');
      socket.onWrite = (msg, cb) => { cb(writeError); return false; };

      let error = null;
      try { await zk.probeRealTime({ timeoutMs: 10000 }); } catch (err) { error = err; }
      expect(error).to.equal(writeError);
      expect(zk._realtimeProbe).to.equal(null);
    });

    it('rejects a pending probe with ERR_REALTIME_PROBE_SOCKET_CLOSED when the socket is torn down', async () => {
      const pending = zk.probeRealTime({ timeoutMs: 10000 });

      await zk.closeSocket();

      let error = null;
      try { await pending; } catch (err) { error = err; }
      expect(error && error.code).to.equal('ERR_REALTIME_PROBE_SOCKET_CLOSED');
    });

    it('settles a pending probe on teardown even when end() never emits close', async () => {
      socket.silentEnd = true;
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const pending = zk.probeRealTime({ timeoutMs: 10000 });
      const started = Date.now();

      const closing = zk.closeSocket();

      let error = null;
      try { await pending; } catch (err) { error = err; }
      expect(error && error.code).to.equal('ERR_REALTIME_PROBE_SOCKET_CLOSED');
      expect(Date.now() - started).to.be.below(500);
      clock.tick(2000);
      await closing;
    });

    it('forgets the registration on teardown, so a later probe on that socket is refused unwritten', async () => {
      socket.silentEnd = true;
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const writesBefore = socket.writes.length;
      const closing = zk.closeSocket();

      let error = null;
      try { await zk.probeRealTime({ timeoutMs: 1000 }); } catch (err) { error = err; }
      expect(zk.socket).to.equal(socket);
      expect(error && error.code).to.equal('ERR_REALTIME_NOT_REGISTERED');
      expect(socket.writes).to.have.length(writesBefore);
      clock.tick(2000);
      await closing;
    });

    it('does not close or reconnect the socket itself when a probe fails', async () => {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const end = sinon.spy(socket, 'end');
      const pending = zk.probeRealTime({ timeoutMs: 100 });
      clock.tick(100);
      try { await pending; } catch (err) { /* timed out */ }

      expect(end.called).to.equal(false);
      expect(zk.socket).to.equal(socket);
      expect(socket.writes).to.have.length(2);
    });
  });

  describe('listener hygiene', () => {
    it('leaves the socket error/close listener counts at their baseline after many probes', async () => {
      await open();
      await register();
      const baseline = { error: socket.listenerCount('error'), close: socket.listenerCount('close') };
      const lastWrite = () => socket.writes[socket.writes.length - 1];

      for (let i = 0; i < 20; i += 1) {
        const pending = zk.probeRealTime({ timeoutMs: 1000 });
        socket.emit('data', ackFrame(replyIdOf(lastWrite())));
        await pending;
      }
      for (let i = 0; i < 5; i += 1) {
        const pending = zk.probeRealTime({ timeoutMs: 1000 });
        socket.emit('data', realtimeEventFrame());
        await pending;
      }
      for (let i = 0; i < 5; i += 1) {
        try { await zk.probeRealTime({ timeoutMs: 1 }); } catch (err) { /* timed out */ }
      }
      socket.onWrite = (msg, cb) => { cb(new Error('write EPIPE')); return false; };
      for (let i = 0; i < 5; i += 1) {
        try { await zk.probeRealTime({ timeoutMs: 1000 }); } catch (err) { /* write failed */ }
      }

      expect(socket.listenerCount('error')).to.equal(baseline.error);
      expect(socket.listenerCount('close')).to.equal(baseline.close);
    });
  });

  describe('preconditions', () => {
    it('rejects with ERR_REALTIME_PROBE_SOCKET_CLOSED without writing when there is no socket', async () => {
      const tcp = new ZKLibTCP('127.0.0.1', 4370, 1000);

      let error = null;
      try { await tcp.probeRealTime(); } catch (err) { error = err; }
      expect(error).to.be.instanceOf(Error);
      expect(error.code).to.equal('ERR_REALTIME_PROBE_SOCKET_CLOSED');
    });

    it('rejects with ERR_REALTIME_NOT_REGISTERED without writing before getRealTimeLogs()', async () => {
      await open();

      let error = null;
      try { await zk.probeRealTime(); } catch (err) { error = err; }
      expect(error && error.code).to.equal('ERR_REALTIME_NOT_REGISTERED');
      expect(socket.writes).to.have.length(0);
    });

    it('rejects with ERR_REALTIME_NOT_REGISTERED on a new socket that has not registered', async () => {
      await open();
      await register();
      const replacement = new FakeSocket();
      zk.socket = replacement;

      let error = null;
      try { await zk.probeRealTime(); } catch (err) { error = err; }
      expect(error && error.code).to.equal('ERR_REALTIME_NOT_REGISTERED');
      expect(replacement.writes).to.have.length(0);
    });
  });
});

describe('ZKLibTCP teardown of a connection that is already gone', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('closeSocket() resolves without throwing when the socket is already null', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    zk._rtBuffer = Buffer.from([1, 2, 3]);
    zk._realtimeDataHandler = () => {};
    zk.socket = null;

    expect(await zk.closeSocket()).to.equal(true);
    expect(zk._rtBuffer.length).to.equal(0);
    expect(zk._realtimeDataHandler).to.equal(null);
  });

  it('disconnect() returns well under 2 s when the socket resets during CMD_EXIT', async () => {
    const socket = new FakeSocket();
    sinon.stub(net, 'Socket').returns(socket);
    const zk = new ZKLibTCP('127.0.0.1', 4370, 10000);
    const cbError = sinon.spy();
    const cbClose = sinon.spy();
    await zk.createSocket(cbError, cbClose);
    await zk.getRealTimeLogs(() => {});

    socket.onWrite = (msg, cb) => {
      if (cb) cb();
      if (commandOf(msg) === COMMANDS.CMD_EXIT) setImmediate(() => socket.reset());
      return true;
    };

    const started = Date.now();
    expect(await zk.disconnect()).to.equal(true);
    const elapsed = Date.now() - started;

    expect(elapsed).to.be.below(500);
    expect(socket.writes.some(frame => commandOf(frame) === COMMANDS.CMD_EXIT)).to.equal(true);
    expect(cbError.calledOnce).to.equal(true);
    expect(cbClose.calledOnceWithExactly('tcp')).to.equal(true);
    expect(socket.listenerCount('error')).to.equal(0);
    expect(socket.listenerCount('close')).to.equal(0);
  });

  it('closeSocket() destroys a socket whose end() never completes, after its 2 s fallback', async () => {
    const socket = new FakeSocket();
    sinon.stub(net, 'Socket').returns(socket);
    const zk = new ZKLibTCP('127.0.0.1', 4370, 10000);
    const cbClose = sinon.spy();
    await zk.createSocket(undefined, cbClose);
    socket.silentEnd = true;
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const closing = zk.closeSocket();
    clock.tick(1999);
    expect(socket.destroyed).to.equal(false);
    clock.tick(1);

    expect(await closing).to.equal(true);
    expect(socket.destroyed).to.equal(true);
    clock.restore();
    await new Promise(resolve => setImmediate(resolve));
    expect(cbClose.calledOnceWithExactly('tcp')).to.equal(true);
    expect(zk.socket).to.equal(null);
  });

  it('closeSocket() destroys only the socket it was called on, even if the socket is replaced meanwhile', async () => {
    const socket = new FakeSocket();
    sinon.stub(net, 'Socket').returns(socket);
    const zk = new ZKLibTCP('127.0.0.1', 4370, 10000);
    await zk.createSocket();
    socket.silentEnd = true;
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const closing = zk.closeSocket();
    const replacement = new FakeSocket();
    zk.socket = replacement;
    clock.tick(2000);

    expect(await closing).to.equal(true);
    expect(socket.destroyed).to.equal(true);
    expect(replacement.destroyed).to.equal(false);
    clock.restore();
  });

  it('closeSocket() does not destroy a socket whose end() completes', async () => {
    const socket = new FakeSocket();
    sinon.stub(net, 'Socket').returns(socket);
    const zk = new ZKLibTCP('127.0.0.1', 4370, 10000);
    await zk.createSocket();

    expect(await zk.closeSocket()).to.equal(true);
    expect(socket.destroyed).to.equal(false);
  });

  it('disconnect() still waits for the ACK of CMD_EXIT on a live socket', async () => {
    const socket = new FakeSocket();
    sinon.stub(net, 'Socket').returns(socket);
    const zk = new ZKLibTCP('127.0.0.1', 4370, 10000);
    await zk.createSocket();
    zk.sessionId = 12;

    socket.onWrite = (msg, cb) => {
      if (cb) cb();
      if (commandOf(msg) === COMMANDS.CMD_EXIT) {
        setImmediate(() => socket.emit('data', ackFrame(replyIdOf(msg))));
      }
      return true;
    };

    expect(await zk.disconnect()).to.equal(true);
    expect(socket.writes.map(commandOf)).to.deep.equal([COMMANDS.CMD_EXIT]);
  });
});

describe('ZKLib facade probeRealTime', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('delegates to the TCP transport with the caller options', async () => {
    const zk = new ZKLib('127.0.0.1', 4370, 1000, 'tcp');
    zk.zklibTcp.socket = new EventEmitter();
    const probe = sinon.stub(zk.zklibTcp, 'probeRealTime').resolves(true);

    expect(await zk.probeRealTime({ timeoutMs: 5000 })).to.equal(true);
    expect(probe.calledOnceWithExactly({ timeoutMs: 5000 })).to.equal(true);
  });

  it('wraps a TCP probe failure in a ZKError that names the command', async () => {
    const zk = new ZKLib('127.0.0.1', 4370, 1000, 'tcp');
    zk.zklibTcp.socket = new EventEmitter();
    sinon.stub(zk.zklibTcp, 'probeRealTime').rejects(Object.assign(new Error('realtime probe not acknowledged within 10000 ms'), { code: 'ERR_REALTIME_PROBE_TIMEOUT' }));

    let error = null;
    try { await zk.probeRealTime(); } catch (err) { error = err; }
    expect(error.command).to.equal('[TCP] probeRealTime');
    expect(error.err.code).to.equal('ERR_REALTIME_PROBE_TIMEOUT');
  });

  it('rejects when the TCP socket is not connected', async () => {
    const zk = new ZKLib('127.0.0.1', 4370, 1000, 'tcp');

    let error = null;
    try { await zk.probeRealTime(); } catch (err) { error = err; }
    expect(error.err.message).to.match(/Socket isn't connected/);
  });

  it('rejects as not supported on UDP', async () => {
    const zk = new ZKLib('127.0.0.1', 4370, 1000, 'udp');
    zk.zklibUdp.socket = new EventEmitter();
    const udpWrite = sinon.spy();
    zk.zklibUdp.socket.send = udpWrite;

    let error = null;
    try { await zk.probeRealTime(); } catch (err) { error = err; }
    expect(error.command).to.equal('[UDP] probeRealTime');
    expect(error.err.code).to.equal('ERR_REALTIME_PROBE_UNSUPPORTED');
    expect(udpWrite.called).to.equal(false);
  });
});
