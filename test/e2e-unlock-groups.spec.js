'use strict';

const { expect } = require('chai');
const ZKLib = require('../zklib');

const maybeDescribe = (process.env.ZKLIB_E2E_IP && process.env.ZKLIB_E2E_UNLOCK_GROUPS === '1')
  ? describe
  : describe.skip;

maybeDescribe('ZKLib unlock groups (e2e)', function () {
  this.timeout(Number(process.env.ZKLIB_E2E_TIMEOUT || 45000));
  this.slow(5000);

  const ip = process.env.ZKLIB_E2E_IP;
  const port = Number(process.env.ZKLIB_E2E_PORT || 4370);
  const timeoutMs = Number(process.env.ZKLIB_E2E_SOCKET_TIMEOUT || 10000);
  const inport = Number(process.env.ZKLIB_E2E_INPORT || 5500);
  const connectionType = process.env.ZKLIB_E2E_CONNECTION_TYPE || 'udp';
  const testCombination = Number(process.env.ZKLIB_E2E_UNLOCK_COMBINATION || 2);
  const testGroup = Number(process.env.ZKLIB_E2E_UNLOCK_GROUP || 1);

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

  function activeGroups(groups = []) {
    return groups.filter(group => Number(group) > 0).map(Number);
  }

  function cloneUnlockGroups(config) {
    return {
      combinations: Array.from({ length: 10 }, (_, index) => {
        const current = config.combinations?.[index] || {};
        return {
          combination: index + 1,
          groups: activeGroups(current.groups)
        };
      })
    };
  }

  async function restoreUnlockGroups(original) {
    if (original && original.raw) {
      await zk.setUnlockGroups(original.raw);
    } else {
      await zk.setUnlockGroups(cloneUnlockGroups(original));
    }
    await zk.refreshData();
  }

  it('writes, reads, and restores an unlock group combination', async () => {
    expect(testCombination).to.be.within(1, 10);
    expect(testGroup).to.be.within(1, 255);

    const original = await zk.getUnlockGroups();
    const nextConfig = cloneUnlockGroups(original);
    nextConfig.combinations[testCombination - 1] = {
      combination: testCombination,
      groups: [testGroup]
    };

    try {
      await zk.setUnlockGroups(nextConfig);
      await zk.refreshData();

      const afterWrite = await zk.getUnlockGroups();
      const written = afterWrite.combinations[testCombination - 1];
      expect(activeGroups(written.groups)).to.deep.equal([testGroup]);
      expect(written.validGroups).to.equal(1);
    } finally {
      await restoreUnlockGroups(original);
    }

    const afterRestore = await zk.getUnlockGroups();
    if (original.raw) {
      expect(afterRestore.raw).to.equal(original.raw);
    } else {
      expect(cloneUnlockGroups(afterRestore)).to.deep.equal(cloneUnlockGroups(original));
    }
  });
});
