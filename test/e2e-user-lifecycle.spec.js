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
  const connectionType = process.env.ZKLIB_E2E_CONNECTION_TYPE || 'udp';
  const userPacketSize = Number(process.env.ZKLIB_E2E_USER_PACKET_SIZE || 0);

  let zk = null;

  before(async () => {
    const options = userPacketSize ? { userPacketSize } : {};
    zk = new ZKLib(
      ip,
      port,
      timeoutMs,
      connectionType,
      connectionType === 'udp' ? inport : undefined,
      0,
      options
    );
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
    const userId = uid;
    const baseUser = {
      uid,
      userId,
      name: 'E2EUSR',
      password: '4321',
      enabled: true,
      role: 'user'
    };

    let created = false;
    let completed = false;

    try {
      await zk.setUser(baseUser);
      // Mark for cleanup as soon as the write is accepted, not after the
      // assertions below. Gating it on a later assertion means a readback
      // failure leaves the test user on the device for the next person.
      created = true;
      await zk.refreshData();
      const usersAfterCreate = unwrapUsers(await zk.getUsers());
      const createdUser = usersAfterCreate.find(
        (user) => Number(user.uid ?? user.user_sn ?? user.userSn) === uid
      );
      expect(createdUser, 'user should be present after creation').to.exist;
      expect(createdUser.password, 'password should be readable after creation').to.equal(baseUser.password);
      expect(createdUser.enabled, 'user should be enabled after creation').to.equal(true);

      await zk.setUser({
        ...createdUser,
        name: 'E2EUSR2'
      });
      await zk.refreshData();

      const usersAfterUpdate = unwrapUsers(await zk.getUsers());
      const updatedUser = usersAfterUpdate.find(
        (user) => Number(user.uid ?? user.user_sn ?? user.userSn) === uid
      );
      expect(updatedUser, 'user should still exist after update').to.exist;
      expect((updatedUser.name || '').replace(/\0+$/, '').trim()).to.equal('E2EUSR2');
      expect(updatedUser.password, 'password should survive read-modify-write update').to.equal(baseUser.password);
      expect(updatedUser.enabled, 'enabled flag should survive read-modify-write update').to.equal(true);
      completed = true;
    } finally {
      if (created) {
        // The delete runs whatever happened — that is the whole point of the flag
        // being set as soon as the write is accepted.
        await zk.deleteUser(uid).catch(() => {});
        await zk.refreshData().catch(() => {});
        // The assertion does not. An assertion that throws inside `finally`
        // *replaces* the in-flight exception, so on a contended terminal — where
        // the delete or the re-read is also likely to fail — a readback failure
        // would be reported as `expected true to equal false` instead of as the
        // assertion that actually failed.
        if (completed) {
          const usersAfterDelete = unwrapUsers(await zk.getUsers());
          const stillExists = usersAfterDelete.some(
            (user) => Number(user.uid ?? user.user_sn ?? user.userSn) === uid
          );
          expect(stillExists).to.equal(false);
        }
      }
    }
  });
});
