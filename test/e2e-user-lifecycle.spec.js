'use strict';

const { expect } = require('chai');
const ZKLib = require('../zklib');

const maybeDescribe = process.env.ZKLIB_E2E_IP ? describe : describe.skip;

maybeDescribe('ZKLib user lifecycle (e2e)', function () {
  this.timeout(Number(process.env.ZKLIB_E2E_TIMEOUT || 45000));
  this.slow(5000);

  const ip = process.env.ZKLIB_E2E_IP;
  const port = Number(process.env.ZKLIB_E2E_PORT || 4370);
  const timeoutMs = Number(process.env.ZKLIB_E2E_SOCKET_TIMEOUT || 10000);
  const inport = Number(process.env.ZKLIB_E2E_INPORT || 5500);

  let zk = null;

  before(async () => {
    zk = new ZKLib(ip, port, timeoutMs, inport);
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

  function unwrapUsers(result) {
    if (!result) return [];
    if (Array.isArray(result)) return result;
    if (Array.isArray(result.data)) return result.data;
    return [];
  }

  it('creates, updates and deletes a user on the device', async () => {
    const uidBase = Number(process.env.ZKLIB_E2E_UID_BASE || 60000);
    const uid = uidBase + Math.floor(Math.random() * 1000);
    const userId = `E2E${uid}`;
    const baseUser = {
      uid,
      userId,
      name: 'E2E User',
      password: '4321',
      enabled: true,
      role: 'user'
    };

    let created = false;

    try {
      await zk.setUser(baseUser);
      await zk.refreshData();
      const usersAfterCreate = unwrapUsers(await zk.getUsers());
      const createdUser = usersAfterCreate.find(
        (user) => Number(user.uid ?? user.user_sn ?? user.userSn) === uid
      );
      expect(createdUser, 'user should be present after creation').to.exist;
      created = true;

      await zk.setUser({
        ...baseUser,
        name: 'E2E User Updated'
      });
      await zk.refreshData();

      const usersAfterUpdate = unwrapUsers(await zk.getUsers());
      const updatedUser = usersAfterUpdate.find(
        (user) => Number(user.uid ?? user.user_sn ?? user.userSn) === uid
      );
      expect(updatedUser, 'user should still exist after update').to.exist;
      expect((updatedUser.name || '').replace(/\0+$/, '').trim()).to.equal('E2E User Updated');
    } finally {
      if (created) {
        await zk.deleteUser(uid).catch(() => {});
        await zk.refreshData().catch(() => {});
        const usersAfterDelete = unwrapUsers(await zk.getUsers());
        const stillExists = usersAfterDelete.some(
          (user) => Number(user.uid ?? user.user_sn ?? user.userSn) === uid
        );
        expect(stillExists).to.equal(false);
      }
    }
  });
});
