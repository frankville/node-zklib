'use strict';

const { expect } = require('chai');
const ZKLib = require('../zklib');

const maybeDescribe = (process.env.ZKLIB_E2E_IP && process.env.ZKLIB_E2E_USER_ACCESS_GROUPS === '1')
  ? describe
  : describe.skip;

maybeDescribe('ZKLib user access groups (e2e)', function () {
  this.timeout(Number(process.env.ZKLIB_E2E_TIMEOUT || 45000));
  this.slow(5000);

  const ip = process.env.ZKLIB_E2E_IP;
  const port = Number(process.env.ZKLIB_E2E_PORT || 4370);
  const timeoutMs = Number(process.env.ZKLIB_E2E_SOCKET_TIMEOUT || 10000);
  const inport = Number(process.env.ZKLIB_E2E_INPORT || 5500);
  const connectionType = process.env.ZKLIB_E2E_CONNECTION_TYPE || 'udp';
  const userPacketSize = Number(process.env.ZKLIB_E2E_USER_PACKET_SIZE || 0);
  const uid = Number(process.env.ZKLIB_E2E_ACCESS_UID || 242);
  const group = Number(process.env.ZKLIB_E2E_ACCESS_GROUP || 1);
  const timezone = Number(process.env.ZKLIB_E2E_ACCESS_TIMEZONE || 1);

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

  it('assigns a user to a group and toggles group/user timezone mode', async () => {
    expect(uid).to.be.within(1, 255);
    expect(group).to.be.within(1, 100);
    expect(timezone).to.be.within(1, 50);

    const usersBefore = unwrapUsers(await zk.getUsers());
    const existing = usersBefore.find(user => Number(user.uid) === uid);
    expect(existing, 'temporary uid must not already exist on the device').to.equal(undefined);

    let created = false;

    try {
      await zk.setUser({
        uid,
        userId: uid,
        name: 'ACCGROUP',
        password: '1234',
        enabled: true,
        role: 'user'
      });
      created = true;
      await zk.refreshData();

      await zk.setUserGroup({ uid, group });
      await zk.refreshData();
      const userGroup = await zk.getUserGroup(uid);
      expect(userGroup.group).to.equal(group);

      await zk.setUserTimezones({ uid, useGroupTimezones: true });
      await zk.refreshData();
      const groupMode = await zk.getUserTimezones(uid);
      expect(groupMode.useGroupTimezones).to.equal(true);
      expect(groupMode.useUserTimezones).to.equal(false);
      expect(groupMode.timezones).to.include(timezone);

      await zk.setUserTimezones({ uid, useUserTimezones: true, timezones: [timezone, 0, 0] });
      await zk.refreshData();
      const userMode = await zk.getUserTimezones(uid);
      expect(userMode.useUserTimezones).to.equal(true);
      expect(userMode.useGroupTimezones).to.equal(false);
      expect(userMode.timezones).to.include(timezone);
    } finally {
      if (created) {
        await zk.deleteUser(uid).catch(() => {});
        await zk.refreshData().catch(() => {});
        const usersAfterDelete = unwrapUsers(await zk.getUsers());
        const stillExists = usersAfterDelete.some(user => Number(user.uid) === uid);
        expect(stillExists).to.equal(false);
      }
    }
  });
});
