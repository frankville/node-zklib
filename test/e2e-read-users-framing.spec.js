'use strict';

const { expect } = require('chai');
const ZKLib = require('../zklib');

// Read-only. It reads the user table and the device's counters, and prints counts only, never
// user records.
//
// After CMD_DATA_RDY the device sends CMD_PREPARE_DATA, CMD_DATA and CMD_ACK_OK back to back.
// Whether those reach the host in one socket read or several depends on the network and on
// timing, so a natural read exercises the one-read case only now and then. The first test
// makes it happen every time: it pauses the socket right after the chunk request is written,
// so the device's frames queue up in the kernel and arrive in one 'data' event on resume.
//
// TCP only: UDP delivers each frame as its own datagram.
const maybeDescribe = process.env.ZKLIB_E2E_IP ? describe : describe.skip;

maybeDescribe('ZKLib TCP user read framing (e2e)', function () {
  const ip = process.env.ZKLIB_E2E_IP;
  const port = Number(process.env.ZKLIB_E2E_PORT || 4370);
  const timeoutMs = Number(process.env.ZKLIB_E2E_SOCKET_TIMEOUT || 10000);
  const holdMs = Number(process.env.ZKLIB_E2E_HOLD_MS || 500);
  const repeat = Number(process.env.ZKLIB_E2E_READ_REPEAT || 20);
  // A read that stalls takes about 10 s to give up, so allow for every read stalling.
  this.timeout(Number(process.env.ZKLIB_E2E_TIMEOUT || (45000 + repeat * 15000)));
  this.slow(5000);

  let zk = null;
  let expectedUsers = null;

  before(async () => {
    zk = new ZKLib(ip, port, timeoutMs, 'tcp');
    if (process.env.ZKLIB_E2E_LOG_LEVEL) {
      zk.setLogger(console);
      zk.setLogLevel(process.env.ZKLIB_E2E_LOG_LEVEL);
    }
    await zk.createSocket();
    const info = await zk.getInfo();
    expectedUsers = info && info.userCounts;
    console.log(`      the device reports ${expectedUsers} users`);
    expect(Number.isInteger(expectedUsers), 'the device did not report a user count').to.equal(true);
  });

  after(async () => {
    if (zk) {
      try {
        await zk.disconnect();
      } catch (err) {
        // ignore teardown failures
      }
    }
  });

  it('reads every user when the device\'s closing frames arrive in one socket read', async () => {
    const transport = zk.zklibTcp;
    const originalSendChunkRequest = transport.sendChunkRequest;
    const originalReadWithBuffer = transport.readWithBuffer;
    let reads = 0;
    let bytes = 0;
    let counting = false;
    const countRead = (data) => {
      if (counting) {
        reads += 1;
        bytes += data.length;
      }
    };

    // socket.pause() is not enough: Node keeps reading underneath and replays each chunk as
    // its own 'data' event. Stopping the handle's reads leaves the bytes in the kernel, and the
    // first read after readStart() takes everything queued (up to 64 KiB) as one chunk.
    const handle = transport.socket && transport.socket._handle;
    if (!handle || typeof handle.readStop !== 'function' || typeof handle.readStart !== 'function') {
      this.skip();
    }

    transport.sendChunkRequest = function (...args) {
      const result = originalSendChunkRequest.apply(this, args);
      // Synchronously after the write, so nothing the device sends can be read before it.
      const socketHandle = this.socket && this.socket._handle;
      if (socketHandle) {
        socketHandle.readStop();
        counting = true;
        setTimeout(() => socketHandle.readStart(), holdMs);
      }
      return result;
    };
    transport.readWithBuffer = async function (...args) {
      try {
        return await originalReadWithBuffer.apply(this, args);
      } finally {
        counting = false;
      }
    };
    transport.socket.on('data', countRead);

    let result;
    try {
      result = await zk.getUsers();
    } finally {
      transport.sendChunkRequest = originalSendChunkRequest;
      transport.readWithBuffer = originalReadWithBuffer;
      if (transport.socket) transport.socket.removeListener('data', countRead);
    }

    const users = result && Array.isArray(result.data) ? result.data.length : 0;
    console.log(`      the transfer arrived in ${reads} socket read(s), ${bytes} bytes; read ${users} users; error: ${result && result.err ? result.err.message : 'none'}`);
    // Below Node's 64 KiB read size the whole transfer must have come in one read, or this
    // test did not exercise what it is for. A larger table can need several reads.
    if (bytes > 0 && bytes < 60000) {
      expect(reads, 'the frames were not forced into one read; raise ZKLIB_E2E_HOLD_MS').to.equal(1);
    }
    expect(result.err).to.equal(null);
    expect(users).to.equal(expectedUsers);
  });

  it(`reads every user ${repeat} times in a row with natural timing`, async () => {
    const failures = [];
    const started = Date.now();
    for (let i = 0; i < repeat; i++) {
      const result = await zk.getUsers();
      const users = result && Array.isArray(result.data) ? result.data.length : 0;
      if (result.err || users !== expectedUsers) {
        failures.push(`read ${i + 1}: ${users} users, error: ${result.err ? result.err.message : 'none'}`);
      }
    }
    console.log(`      ${repeat - failures.length} of ${repeat} reads complete in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    failures.forEach(line => console.log(`      ${line}`));
    expect(failures).to.deep.equal([]);
  });
});
