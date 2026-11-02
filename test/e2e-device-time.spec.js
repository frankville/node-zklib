'use strict';

const { expect } = require('chai');
const ZKLib = require('../zklib');

// Reading is harmless and runs whenever a device is configured. Writing moves the clock that
// stamps every event and every schedule decision, so it needs its own flag, and it always ends
// by setting the clock to this host's time. Run it from a host whose clock and zone are right:
// the device stores wall time with no zone, and this host's zone is what gives it one.
const maybeDescribe = process.env.ZKLIB_E2E_IP ? describe : describe.skip;
const maybeWrite = process.env.ZKLIB_E2E_TIME_WRITE === '1' ? it : it.skip;

maybeDescribe('ZKLib device time (e2e)', function () {
  this.timeout(Number(process.env.ZKLIB_E2E_TIMEOUT || 45000));
  this.slow(5000);

  const ip = process.env.ZKLIB_E2E_IP;
  const port = Number(process.env.ZKLIB_E2E_PORT || 4370);
  const timeoutMs = Number(process.env.ZKLIB_E2E_SOCKET_TIMEOUT || 10000);
  const inport = Number(process.env.ZKLIB_E2E_INPORT || 5500);
  const connectionType = process.env.ZKLIB_E2E_CONNECTION_TYPE || 'udp';
  // Far enough that a write which did nothing cannot pass for one that worked.
  const OFFSET_MS = 10 * 60 * 1000;
  const TOLERANCE_MS = 5000;

  let zk = null;

  before(async () => {
    zk = new ZKLib(ip, port, timeoutMs, connectionType, connectionType === 'udp' ? inport : undefined);
    // A level alone prints nothing: the logger has no sink until one is set.
    if (process.env.ZKLIB_E2E_LOG_LEVEL) {
      zk.setLogger(console);
      zk.setLogLevel(process.env.ZKLIB_E2E_LOG_LEVEL);
    }
    await zk.createSocket();
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

  it('reads the device clock and reports its skew against this host', async () => {
    const hostBefore = Date.now();
    const device = await zk.getTime();
    const hostAfter = Date.now();

    const skewMs = device.getTime() - Math.round((hostBefore + hostAfter) / 2);
    console.log(`      device ${device.toString()} | host ${new Date(hostAfter).toString()} | skew ${(skewMs / 1000).toFixed(1)} s`);

    expect(Number.isFinite(device.getTime())).to.equal(true);
  });

  maybeWrite('moves the clock, reads the move back, and restores host time', async () => {
    try {
      const target = new Date(Date.now() + OFFSET_MS);
      const readback = await zk.setTime(target, { toleranceMs: TOLERANCE_MS });
      expect(Math.abs(readback.getTime() - (Date.now() + OFFSET_MS))).to.be.below(TOLERANCE_MS + 1000);
    } finally {
      const restored = await zk.setTime(new Date(), { toleranceMs: TOLERANCE_MS });
      console.log(`      restored to ${restored.toString()}`);
    }
  });
});
