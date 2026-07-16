'use strict';

// Opt-in hardware test for group timezone persistence.
//
// Required env:
//   ZKLIB_E2E_IP=192.168.1.75  ZKLIB_E2E_GROUP_TZ=1
// Optional env:
//   ZKLIB_E2E_PORT (4370)  ZKLIB_E2E_CONNECTION_TYPE (tcp)
//   ZKLIB_E2E_GROUP_TZ_GROUP (5) — use a spare group with no members; the
//     probe writes to it and restores it, but a firmware that half-persists a
//     malformed layout can leave the group corrupted until rewritten.
//   ZKLIB_E2E_GROUP_TZ_FORMATS (legacy8,compact20,compact32,compact8,uint16) —
//     formats to probe, in order. Restrict this once the working format for a
//     model is known (ZEM760 fw 6.60 → compact20). uint16 is probed last: it
//     corrupted a record on at least one compact firmware.
//   ZKLIB_E2E_GROUP_TZ_VALUES (0,1,2) — temporary timezones to write.
//
// The mutation test fails when the device ACKs the write but the readback
// does not match — that is the bug this suite exists to catch.

const { expect } = require('chai');
const ZKLib = require('../zklib');

const maybeDescribe = (process.env.ZKLIB_E2E_IP && process.env.ZKLIB_E2E_GROUP_TZ === '1')
  ? describe
  : describe.skip;

maybeDescribe('ZKLib group timezones (e2e)', function () {
  this.timeout(Number(process.env.ZKLIB_E2E_TIMEOUT || 60000));
  this.slow(5000);

  const ip = process.env.ZKLIB_E2E_IP;
  const port = Number(process.env.ZKLIB_E2E_PORT || 4370);
  const timeoutMs = Number(process.env.ZKLIB_E2E_SOCKET_TIMEOUT || 10000);
  const inport = Number(process.env.ZKLIB_E2E_INPORT || 5500);
  const connectionType = process.env.ZKLIB_E2E_CONNECTION_TYPE || 'tcp';
  const testGroup = Number(process.env.ZKLIB_E2E_GROUP_TZ_GROUP || 5);
  const probeFormats = (process.env.ZKLIB_E2E_GROUP_TZ_FORMATS || 'legacy8,compact20,compact32,compact8,uint16')
    .split(',').map(format => format.trim()).filter(Boolean);
  const tempTimezones = (process.env.ZKLIB_E2E_GROUP_TZ_VALUES || '0,1,2')
    .split(',').map(Number);

  let zk = null;

  before(async () => {
    zk = new ZKLib(ip, port, timeoutMs, connectionType, connectionType === 'udp' ? inport : undefined);
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

  function logState(label, state) {
    // eslint-disable-next-line no-console
    console.log(`      [group-tz e2e] ${label}: group=${state.group} timezones=[${state.timezones}] ` +
      `verifyStyle=${state.verifyStyle} holiday=${state.holiday} format=${state.format} ` +
      `plausible=${state.plausible} raw=${state.raw}`);
  }

  it('returns a stable raw record across repeated reads', async () => {
    const reads = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const state = await zk.getGroupTimezones(testGroup);
      logState(`read #${attempt}`, state);
      reads.push(state);
    }

    expect(reads[1].raw).to.equal(reads[0].raw);
    expect(reads[2].raw).to.equal(reads[0].raw);
  });

  it('persists a temporary change, verifies the readback, and restores the original', async () => {
    expect(testGroup).to.be.within(1, 100);
    expect(tempTimezones).to.have.length(3);

    const original = await zk.getGroupTimezones(testGroup);
    logState('original', original);

    if (!original.plausible) {
      // eslint-disable-next-line no-console
      console.warn(`      [group-tz e2e] WARNING: group ${testGroup} already holds implausible values ` +
        `(raw=${original.raw}). Prefer a clean group, or restore it from ZKAccess first.`);
    }

    expect(tempTimezones).to.not.deep.equal(original.timezones,
      'choose ZKLIB_E2E_GROUP_TZ_VALUES different from the current group state');

    let writeResult = null;
    let writeError = null;
    try {
      writeResult = await zk.setGroupTimezones(
        { group: testGroup, timezones: tempTimezones },
        { formats: probeFormats }
      );
    } catch (err) {
      // The facade wraps failures in ZKError, which keeps the cause in .err.
      writeError = err && err.err ? err.err : err;
    }

    if (writeError) {
      // No probed format persisted. The group must be untouched; anything else
      // means a write half-landed and the record needs manual restoration.
      const current = await zk.getGroupTimezones(testGroup);
      logState('after failed write', current);

      if (current.raw !== original.raw) {
        let restored = false;
        try {
          await zk.setGroupTimezones(
            {
              group: testGroup,
              timezones: original.timezones,
              verifyStyle: original.verifyStyle,
              holiday: original.holiday
            },
            { formats: probeFormats }
          );
          restored = true;
        } catch (restoreErr) {
          // fall through to the assertion below
        }
        expect.fail(`no format persisted the write but group ${testGroup} changed anyway ` +
          `(before=${original.raw}, after=${current.raw}); ` +
          (restored ? 'original values were restored.' : 'RESTORE FAILED — restore this group from ZKAccess.'));
      }

      expect.fail(`device returned ACK_OK but did not persist group timezones with any of ` +
        `[${probeFormats.join(', ')}]: ${writeError.message}`);
    }

    logState('after verified write', writeResult.readback);
    // eslint-disable-next-line no-console
    console.log(`      [group-tz e2e] persisted format: ${writeResult.format}`);

    try {
      // Independent readback, not just the one performed inside setGroupTimezones.
      const persisted = await zk.getGroupTimezones(testGroup);
      logState('independent readback', persisted);
      expect(persisted.timezones).to.deep.equal(tempTimezones);
    } finally {
      const restoreResult = await zk.setGroupTimezones(
        {
          group: testGroup,
          timezones: original.timezones,
          verifyStyle: original.verifyStyle,
          holiday: original.holiday
        },
        { formats: [writeResult.format] }
      );
      logState('after restore', restoreResult.readback);
    }

    const afterRestore = await zk.getGroupTimezones(testGroup);
    expect(afterRestore.timezones).to.deep.equal(original.timezones);
  });
});
