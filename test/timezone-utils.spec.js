'use strict';

const { expect } = require('chai');

const {
  encodeTimezoneInfo,
  decodeTimezoneInfo,
  encodeUserTimezoneInfo,
  decodeUserTimezoneInfo,
  encodeGroupTimezoneInfo,
  decodeGroupTimezoneInfo,
  encodeUserGroupInfo,
  decodeUserGroupInfo,
  encodeUnlockGroupInfo,
  decodeUnlockGroupInfo,
  encodeUnlockGroupsInfo,
  decodeUnlockGroupsInfo,
  decodeFreeSizes
} = require('../utils');

describe('Timezone encoding helpers', () => {
  it('encodes and decodes timezone schedule', () => {
    const buffer = encodeTimezoneInfo({
      index: 3,
      days: {
        sunday: { startHour: 8, startMinute: 30, endHour: 17, endMinute: 45 },
        monday: { startHour: 9, startMinute: 0, endHour: 18, endMinute: 0 }
      },
      default: { startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 }
    });

    expect(buffer.length).to.equal(32);
    expect(buffer.readUInt32LE(0)).to.equal(3);
    expect(buffer.readUInt8(4)).to.equal(8);
    expect(buffer.readUInt8(5)).to.equal(30);
    expect(buffer.readUInt8(6)).to.equal(17);
    expect(buffer.readUInt8(7)).to.equal(45);
    expect(buffer.readUInt8(8)).to.equal(9);
    expect(buffer.readUInt8(9)).to.equal(0);
    expect(buffer.readUInt8(10)).to.equal(18);
    expect(buffer.readUInt8(11)).to.equal(0);

    const decoded = decodeTimezoneInfo(buffer);
    expect(decoded.index).to.equal(3);
    expect(decoded.days.sunday).to.deep.equal({ startHour: 8, startMinute: 30, endHour: 17, endMinute: 45 });
    expect(decoded.days.monday).to.deep.equal({ startHour: 9, startMinute: 0, endHour: 18, endMinute: 0 });
    expect(decoded.days.tuesday).to.deep.equal({ startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 });
  });

  it('decodes timezone read replies with 2-byte index and trailer', () => {
    const buffer = Buffer.alloc(32);
    buffer.writeUInt16LE(48, 0);
    buffer.writeUInt8(17, 2);
    buffer.writeUInt8(12, 3);
    buffer.writeUInt8(17, 4);
    buffer.writeUInt8(13, 5);
    buffer.writeUInt8(17, 6);
    buffer.writeUInt8(37, 7);
    buffer.writeUInt8(17, 8);
    buffer.writeUInt8(37, 9);
    buffer.writeUInt8(0xA7, 30);
    buffer.writeUInt8(0x1C, 31);

    const decoded = decodeTimezoneInfo(buffer);
    expect(decoded.index).to.equal(48);
    expect(decoded.days.sunday).to.deep.equal({ startHour: 17, startMinute: 12, endHour: 17, endMinute: 13 });
    expect(decoded.days.monday).to.deep.equal({ startHour: 17, startMinute: 37, endHour: 17, endMinute: 37 });
  });

  it('decodes timezone read replies when the ACK header is still present', () => {
    const reply = Buffer.alloc(40);
    reply.writeUInt16LE(2000, 0);
    reply.writeUInt16LE(9, 8);
    reply.writeUInt8(8, 10);
    reply.writeUInt8(30, 11);
    reply.writeUInt8(18, 12);
    reply.writeUInt8(0, 13);
    reply.writeUInt8(0xA7, 38);
    reply.writeUInt8(0x1C, 39);

    const decoded = decodeTimezoneInfo(reply);
    expect(decoded.index).to.equal(9);
    expect(decoded.days.sunday).to.deep.equal({ startHour: 8, startMinute: 30, endHour: 18, endMinute: 0 });
  });

  it('decodes compact timezone read replies with only day segments', () => {
    const buffer = Buffer.from('080f122d0900111e0a051037072d130a08000c000d00141e00000000', 'hex');

    const decoded = decodeTimezoneInfo(buffer, 49);
    expect(decoded.index).to.equal(49);
    expect(decoded.days.sunday).to.deep.equal({ startHour: 8, startMinute: 15, endHour: 18, endMinute: 45 });
    expect(decoded.days.monday).to.deep.equal({ startHour: 9, startMinute: 0, endHour: 17, endMinute: 30 });
    expect(decoded.days.saturday).to.deep.equal({ startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 });
  });

  it('decodes compact timezone read replies when the ACK header is still present', () => {
    const reply = Buffer.concat([
      Buffer.from('d00722d76b350400', 'hex'),
      Buffer.from('080f122d0900111e0a051037072d130a08000c000d00141e00000000', 'hex')
    ]);

    const decoded = decodeTimezoneInfo(reply, 49);
    expect(decoded.index).to.equal(49);
    expect(decoded.days.sunday).to.deep.equal({ startHour: 8, startMinute: 15, endHour: 18, endMinute: 45 });
  });

  it('returns an empty schedule for blank timezone read replies', () => {
    const decoded = decodeTimezoneInfo(Buffer.alloc(0), 12);
    expect(decoded.index).to.equal(12);
    expect(decoded.days.sunday).to.deep.equal({ startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 });
    expect(decoded.days.saturday).to.deep.equal({ startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 });
  });

  it('encodes user timezone structure', () => {
    const buffer = encodeUserTimezoneInfo({
      uid: 10,
      timezones: [1, 2],
      useUserTimezones: true
    });

    expect(buffer.length).to.equal(20);
    expect(buffer.readUInt32LE(0)).to.equal(10);
    expect(buffer.readUInt32LE(4)).to.equal(1);
    expect(buffer.readUInt32LE(8)).to.equal(1);
    expect(buffer.readUInt32LE(12)).to.equal(2);
    expect(buffer.readUInt32LE(16)).to.equal(0);

    const decoded = decodeUserTimezoneInfo(Buffer.from([1, 0, 1, 0, 2, 0, 0, 0]));
    expect(decoded.timezoneFlag).to.equal(1);
    expect(decoded.useUserTimezones).to.equal(true);
    expect(decoded.useGroupTimezones).to.equal(false);
    expect(decoded.timezones).to.deep.equal([1, 2, 0]);
  });

  it('decodes compact 32-bit user timezone replies from access devices', () => {
    const userMode = decodeUserTimezoneInfo(Buffer.from('0100000001000000', 'hex'));
    expect(userMode.timezoneFlag).to.equal(1);
    expect(userMode.useUserTimezones).to.equal(true);
    expect(userMode.useGroupTimezones).to.equal(false);
    expect(userMode.timezones).to.deep.equal([1, 0, 0]);

    const groupMode = decodeUserTimezoneInfo(Buffer.from('feffffff01000000', 'hex'));
    expect(groupMode.timezoneFlag).to.equal(0xFFFFFFFE);
    expect(groupMode.useUserTimezones).to.equal(false);
    expect(groupMode.useGroupTimezones).to.equal(true);
    expect(groupMode.timezones).to.deep.equal([1, 0, 0]);
  });

  it('does not misclassify legacy 16-bit user timezone replies as compact 32-bit', () => {
    const decoded = decodeUserTimezoneInfo(Buffer.from([1, 0, 0, 0, 2, 0, 3, 0]));
    expect(decoded.timezoneFlag).to.equal(1);
    expect(decoded.useUserTimezones).to.equal(true);
    expect(decoded.useGroupTimezones).to.equal(false);
    expect(decoded.timezones).to.deep.equal([0, 2, 3]);
  });

  it('encodes user timezone structure for group usage', () => {
    const buffer = encodeUserTimezoneInfo({
      uid: 11,
      useGroupTimezones: true
    });

    expect(buffer.readUInt32LE(4)).to.equal(0);
    expect(buffer.readUInt32LE(8)).to.equal(0);
  });

  it('keeps the full uid when encoding user timezone writes', () => {
    const buffer = encodeUserTimezoneInfo({
      uid: 1111,
      timezones: [1],
      useUserTimezones: true
    });

    expect(buffer.readUInt32LE(0)).to.equal(1111);
  });

  it('encodes group timezone info with verify style and holiday flag', () => {
    const buffer = encodeGroupTimezoneInfo({
      group: 5,
      timezones: [3, 4, 0],
      verifyStyle: 6,
      holiday: true
    });

    expect(buffer.length).to.equal(8);
    expect(buffer.readUInt8(0)).to.equal(5);
    expect(buffer.readUInt16LE(1)).to.equal(3);
    expect(buffer.readUInt16LE(3)).to.equal(4);
    expect(buffer.readUInt16LE(5)).to.equal(0);
    expect(buffer.readUInt8(7)).to.equal(0x86);

    const decoded = decodeGroupTimezoneInfo(buffer);
    expect(decoded.group).to.equal(5);
    expect(decoded.timezones).to.deep.equal([3, 4, 0]);
    expect(decoded.verifyStyle).to.equal(6);
    expect(decoded.holiday).to.equal(true);
  });

  it('decodes group timezone info even when buffer is short', () => {
    const decoded = decodeGroupTimezoneInfo(Buffer.from([2]));
    expect(decoded.group).to.equal(2);
    expect(decoded.timezones).to.deep.equal([0, 0, 0]);
    expect(decoded.verifyStyle).to.equal(0);
    expect(decoded.holiday).to.equal(false);
  });

  it('normalizes endian-swapped group timezone slots from compact devices', () => {
    // Real reply captured from a compact TCP panel for group 1.
    const decoded = decodeGroupTimezoneInfo(Buffer.from('0100000001000000', 'hex'));
    expect(decoded.group).to.equal(1);
    expect(decoded.timezones).to.deep.equal([0, 1, 0]);
    expect(decoded.format).to.equal('legacy8');
    expect(decoded.raw).to.equal('0100000001000000');
    expect(decoded.plausible).to.equal(true);
  });

  it('decodes the real compact reply identically under the uint16 format', () => {
    const decoded = decodeGroupTimezoneInfo(Buffer.from('0100000001000000', 'hex'), { format: 'uint16' });
    expect(decoded.group).to.equal(1);
    expect(decoded.timezones).to.deep.equal([0, 1, 0]);
    expect(decoded.format).to.equal('uint16');
    expect(decoded.plausible).to.equal(true);
  });

  it('flags implausible group timezone replies from corrupted records', () => {
    // Real bytes read back from group 1 after a malformed raw write experiment.
    const corrupt = Buffer.from('0100000070876500', 'hex');
    expect(decodeGroupTimezoneInfo(corrupt).plausible).to.equal(false);
    expect(decodeGroupTimezoneInfo(corrupt, { format: 'uint16' }).plausible).to.equal(false);
  });

  it('encodes group timezone info in the uint16 format', () => {
    const buffer = encodeGroupTimezoneInfo({
      group: 1,
      timezones: [0, 1, 2],
      format: 'uint16'
    });

    expect(buffer.length).to.equal(8);
    expect(buffer.toString('hex')).to.equal('0100000001000200');
    expect(buffer.readUInt16LE(0)).to.equal(1);
    expect(buffer.readUInt16LE(2)).to.equal(0);
    expect(buffer.readUInt16LE(4)).to.equal(1);
    expect(buffer.readUInt16LE(6)).to.equal(2);
  });

  it('encodes and auto-decodes group timezone info in the compact32 format', () => {
    const buffer = encodeGroupTimezoneInfo({
      group: 1,
      timezones: [0, 1, 2],
      format: 'compact32'
    });

    expect(buffer.length).to.equal(16);
    expect(buffer.readUInt32LE(0)).to.equal(1);
    expect(buffer.readUInt32LE(4)).to.equal(0);
    expect(buffer.readUInt32LE(8)).to.equal(1);
    expect(buffer.readUInt32LE(12)).to.equal(2);

    // 16-byte replies are detected as compact32 without a format hint.
    const decoded = decodeGroupTimezoneInfo(buffer);
    expect(decoded.format).to.equal('compact32');
    expect(decoded.group).to.equal(1);
    expect(decoded.timezones).to.deep.equal([0, 1, 2]);
    expect(decoded.plausible).to.equal(true);
  });

  it('decodes compact8 replies as a found flag plus byte-sized record', () => {
    // Same real capture: under compact8 the leading u32 is a found flag and the
    // record is tz1=1, tz2=0, tz3=0, verify=0 — i.e. "group 1 uses timezone 1".
    const decoded = decodeGroupTimezoneInfo(Buffer.from('0100000001000000', 'hex'), {
      format: 'compact8',
      fallbackGroup: 1
    });
    expect(decoded.group).to.equal(1);
    expect(decoded.found).to.equal(true);
    expect(decoded.timezones).to.deep.equal([1, 0, 0]);
    expect(decoded.verifyStyle).to.equal(0);
    expect(decoded.plausible).to.equal(true);
  });

  it('decodes 4-byte compact8 replies as missing records', () => {
    // Real capture: groups with no record answer 4 zero bytes.
    const decoded = decodeGroupTimezoneInfo(Buffer.from('00000000', 'hex'), {
      format: 'compact8',
      fallbackGroup: 5
    });
    expect(decoded.group).to.equal(5);
    expect(decoded.found).to.equal(false);
    expect(decoded.timezones).to.deep.equal([0, 0, 0]);
  });

  it('flags corrupted compact8 records as implausible', () => {
    const decoded = decodeGroupTimezoneInfo(Buffer.from('0100000070876500', 'hex'), {
      format: 'compact8',
      fallbackGroup: 1
    });
    expect(decoded.found).to.equal(true);
    expect(decoded.timezones).to.deep.equal([112, 135, 101]);
    expect(decoded.plausible).to.equal(false);
  });

  it('encodes group timezone info in the compact8 format', () => {
    const buffer = encodeGroupTimezoneInfo({
      group: 1,
      timezones: [0, 1, 2],
      format: 'compact8'
    });

    expect(buffer.length).to.equal(8);
    expect(buffer.toString('hex')).to.equal('0100000000010200');
    expect(buffer.readUInt32LE(0)).to.equal(1);
    expect(buffer.readUInt8(4)).to.equal(0);
    expect(buffer.readUInt8(5)).to.equal(1);
    expect(buffer.readUInt8(6)).to.equal(2);
    expect(buffer.readUInt8(7)).to.equal(0);
  });

  it('encodes compact20 writes exactly as ZKAccess does on ZEM760 fw 6.60', () => {
    // Pinned from a Wireshark capture of a real ZKAccess group sync:
    // CMD_GRPTZ_WRQ = group 2, valid record, schedule (timezone) 2 in slot 1.
    const buffer = encodeGroupTimezoneInfo({
      group: 2,
      timezones: [2, 0, 0],
      format: 'compact20'
    });

    expect(buffer.length).to.equal(20);
    expect(buffer.toString('hex')).to.equal('0200000001000000020000000000000000000000');

    // valid:false zeroes the enable word, which deletes the record on-device.
    const invalidated = encodeGroupTimezoneInfo({ group: 2, timezones: [2, 0, 0], valid: false, format: 'compact20' });
    expect(invalidated.readUInt32LE(4)).to.equal(0);

    // holiday must NOT touch the enable word (it is not the holiday flag).
    const withHoliday = encodeGroupTimezoneInfo({ group: 2, timezones: [2, 0, 0], holiday: false, format: 'compact20' });
    expect(withHoliday.readUInt32LE(4)).to.equal(1);
  });

  it('decodes compact20 replies as found flag plus u32 timezone slots', () => {
    // Real readback of the record written by the captured ZKAccess sync.
    const decoded = decodeGroupTimezoneInfo(Buffer.from('0100000002000000', 'hex'), {
      format: 'compact20',
      fallbackGroup: 2
    });
    expect(decoded.group).to.equal(2);
    expect(decoded.found).to.equal(true);
    expect(decoded.timezones).to.deep.equal([2, 0, 0]);
    expect(decoded.plausible).to.equal(true);

    const missing = decodeGroupTimezoneInfo(Buffer.from('00000000', 'hex'), {
      format: 'compact20',
      fallbackGroup: 3
    });
    expect(missing.found).to.equal(false);
    expect(missing.timezones).to.deep.equal([0, 0, 0]);

    const corrupt = decodeGroupTimezoneInfo(Buffer.from('0100000070876500', 'hex'), {
      format: 'compact20',
      fallbackGroup: 1
    });
    expect(corrupt.found).to.equal(true);
    expect(corrupt.plausible).to.equal(false);
  });

  it('rejects unknown group timezone formats', () => {
    expect(() => encodeGroupTimezoneInfo({ group: 1, format: 'bogus' })).to.throw(/unknown group timezone packet format/);
  });

  it('encodes user group info with the full u32 uid', () => {
    // Pinned from a ZKAccess capture (ZEM760 fw 6.60): CMD_USERGRP_WRQ for
    // uid 1234 → group 2 is d2040000 02 — the uid must not be truncated.
    const captured = encodeUserGroupInfo({ uid: 1234, group: 2 });
    expect(captured.toString('hex')).to.equal('d204000002');

    const buffer = encodeUserGroupInfo({ uid: 266, group: 7 });
    expect(buffer.length).to.equal(5);
    expect(buffer.readUInt32LE(0)).to.equal(266);
    expect(buffer.readUInt8(4)).to.equal(7);

    const decoded = decodeUserGroupInfo(Buffer.from([7]));
    expect(decoded.group).to.equal(7);
  });

  it('returns group 0 for empty user group replies', () => {
    const decoded = decodeUserGroupInfo(Buffer.alloc(0));
    expect(decoded.group).to.equal(0);
  });

  it('decodes device free sizes including capacities', () => {
    // Real CMD_GET_FREE_SIZES reply from a ZEM760 fw 6.60 (8-byte header + 80 bytes).
    const reply = Buffer.concat([
      Buffer.alloc(8),
      Buffer.from(
        '00000000000000000000000000000000020000000000000000000000000000000700000000000000' +
        '08000000000000000000000002000000b80b00001027000050c30000b80b00000e27000049c30000',
        'hex'
      )
    ]);

    const sizes = decodeFreeSizes(reply);
    expect(sizes.userCounts).to.equal(2);
    expect(sizes.userCapacity).to.equal(10000);
    expect(sizes.userAvailable).to.equal(9998);
    expect(sizes.fingerCounts).to.equal(0);
    expect(sizes.fingerCapacity).to.equal(3000);
    expect(sizes.fingerAvailable).to.equal(3000);
    expect(sizes.logCounts).to.equal(7);
    expect(sizes.logCapacity).to.equal(50000);
    expect(sizes.logAvailable).to.equal(49993);

    const short = decodeFreeSizes(Buffer.alloc(8));
    expect(short.userCounts).to.equal(null);
    expect(short.userCapacity).to.equal(null);
  });

  it('encodes and decodes binary unlock group combinations', () => {
    const buffer = encodeUnlockGroupInfo({
      combination: 7,
      groups: [1, 2],
    });

    expect(buffer.length).to.equal(8);
    expect(buffer.readUInt8(0)).to.equal(7);
    expect(buffer.readUInt8(1)).to.equal(1);
    expect(buffer.readUInt8(2)).to.equal(2);
    expect(buffer.readUInt16LE(6)).to.equal(2);

    const decoded = decodeUnlockGroupInfo(buffer);
    expect(decoded).to.deep.equal({
      combination: 7,
      groups: [1, 2, 0, 0, 0],
      groupCounts: { 1: 1, 2: 1 },
      validGroups: 2,
      format: 'binary'
    });
  });

  it('accepts a single numeric unlock group but rejects malformed group lists', () => {
    const single = encodeUnlockGroupInfo({ combination: 1, groups: 2 });
    expect(single.readUInt8(1)).to.equal(2);
    expect(single.readUInt16LE(6)).to.equal(1);

    expect(() => encodeUnlockGroupInfo({ combination: 1, groups: '1,2' }))
      .to.throw(/groups must be an array/);
  });

  it('decodes ASCII unlock group strings returned by compact devices', () => {
    const decoded = decodeUnlockGroupsInfo(Buffer.from('1:::::::::\0', 'ascii'));

    expect(decoded.format).to.equal('ascii');
    expect(decoded.raw).to.equal('1:::::::::');
    expect(decoded.combinations[0].groups).to.deep.equal([1, 0, 0, 0, 0]);
    expect(decoded.combinations[0].validGroups).to.equal(1);
    expect(decoded.combinations[1].groups).to.deep.equal([0, 0, 0, 0, 0]);

    const second = decodeUnlockGroupInfo(Buffer.from('1:::::::::\0', 'ascii'), 2);
    expect(second.combination).to.equal(2);
    expect(second.validGroups).to.equal(0);
  });

  it('does not misclassify binary unlock groups as ASCII', () => {
    const binary = Buffer.from([1, 0x31, 0x3A, 0x32, 0, 0, 2, 0]);
    const decoded = decodeUnlockGroupInfo(binary, 1);
    expect(decoded.format).to.equal('binary');
    expect(decoded.groups).to.deep.equal([0x31, 0x3A, 0x32, 0, 0]);
  });

  it('encodes ASCII unlock group strings for compact devices', () => {
    const buffer = encodeUnlockGroupsInfo({
      combinations: [
        { combination: 1, groups: [1] },
        { combination: 3, groups: [2, 4] }
      ]
    });

    // Multiple groups in one combination are concatenated digits (device format).
    expect(buffer.toString('ascii')).to.equal('1::24:::::::\0');
  });

  it('round-trips a multi-user (AND) combination captured from ZKAccess', () => {
    // Real CMD_ULG_WRQ payload from a ZKAccess multi-user-verification sync on
    // ZEM760 fw 6.60: combination 2 requires groups 2 and 3 together, stored as
    // the concatenated token "23" (NOT "2,3").
    const decoded = decodeUnlockGroupsInfo(Buffer.from('1:23::::::::\0', 'ascii'));
    expect(decoded.combinations[0].groups.filter(g => g > 0)).to.deep.equal([1]);
    expect(decoded.combinations[1].groups.filter(g => g > 0)).to.deep.equal([2, 3]);
    expect(decoded.combinations[1].validGroups).to.equal(2);

    const reencoded = encodeUnlockGroupsInfo({
      combinations: [
        { combination: 1, groups: [1] },
        { combination: 2, groups: [2, 3] }
      ]
    });
    expect(reencoded.toString('ascii')).to.equal('1:23::::::::\0');
  });

  it('decodes per-group user counts as repeated group digits (captured)', () => {
    // Real CMD_ULG_WRQ from a ZKAccess multi-user sync (ZEM760 fw 6.60):
    // combination 2 = 1 user from group 2 AND 2 users from group 3 => "233".
    const decoded = decodeUnlockGroupsInfo(Buffer.from('1:233::::::::\0', 'ascii'));
    const comb2 = decoded.combinations[1];
    expect(comb2.groups.filter(g => g > 0)).to.deep.equal([2, 3, 3]);
    expect(comb2.groupCounts).to.deep.equal({ 2: 1, 3: 2 });
    expect(comb2.validGroups).to.equal(3);

    // Repeat a group in the input to require multiple users from it.
    const reencoded = encodeUnlockGroupsInfo({
      combinations: [
        { combination: 1, groups: [1] },
        { combination: 2, groups: [2, 3, 3] }
      ]
    });
    expect(reencoded.toString('ascii')).to.equal('1:233::::::::\0');
  });

  it('tolerates legacy comma-separated multi-group tokens on decode', () => {
    const decoded = decodeUnlockGroupsInfo(Buffer.from('1:2,3::::::::\0', 'ascii'));
    expect(decoded.combinations[1].groups.filter(g => g > 0)).to.deep.equal([2, 3]);
  });

  it('rejects unlock-combination groups above 9 for the ASCII form', () => {
    expect(() => encodeUnlockGroupsInfo({ combinations: [{ combination: 1, groups: [2, 10] }] }))
      .to.throw(/must be 1-9/);
  });

  it('rejects empty or malformed unlock-group collection writes', () => {
    expect(() => encodeUnlockGroupsInfo({})).to.throw(/non-empty array/);
    expect(() => encodeUnlockGroupsInfo({ combinations: [] })).to.throw(/non-empty array/);
    expect(() => encodeUnlockGroupsInfo({ combinations: [{ combination: 1, groups: '1,2' }] }))
      .to.throw(/groups must be an array/);
  });
});
