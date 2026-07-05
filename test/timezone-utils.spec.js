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
  decodeUnlockGroupsInfo
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
    const decoded = decodeGroupTimezoneInfo(Buffer.from('0100000001000000', 'hex'));
    expect(decoded.group).to.equal(1);
    expect(decoded.timezones).to.deep.equal([0, 1, 0]);
  });

  it('encodes user group info', () => {
    const buffer = encodeUserGroupInfo({ uid: 266, group: 7 });
    expect(buffer.length).to.equal(5);
    expect(buffer.readUInt8(0)).to.equal(10);
    expect(buffer.readUInt8(1)).to.equal(0);
    expect(buffer.readUInt8(2)).to.equal(0);
    expect(buffer.readUInt8(3)).to.equal(0);
    expect(buffer.readUInt8(4)).to.equal(7);

    const decoded = decodeUserGroupInfo(Buffer.from([7]));
    expect(decoded.group).to.equal(7);
  });

  it('returns group 0 for empty user group replies', () => {
    const decoded = decodeUserGroupInfo(Buffer.alloc(0));
    expect(decoded.group).to.equal(0);
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

    expect(buffer.toString('ascii')).to.equal('1::2,4:::::::\0');
  });

  it('rejects empty or malformed unlock-group collection writes', () => {
    expect(() => encodeUnlockGroupsInfo({})).to.throw(/non-empty array/);
    expect(() => encodeUnlockGroupsInfo({ combinations: [] })).to.throw(/non-empty array/);
    expect(() => encodeUnlockGroupsInfo({ combinations: [{ combination: 1, groups: '1,2' }] }))
      .to.throw(/groups must be an array/);
  });
});
