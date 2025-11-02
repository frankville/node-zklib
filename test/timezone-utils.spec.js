'use strict';

const { expect } = require('chai');

const {
  encodeTimezoneInfo,
  decodeTimezoneInfo,
  encodeUserTimezoneInfo,
  decodeUserTimezoneInfo,
  encodeGroupTimezoneInfo,
  decodeGroupTimezoneInfo
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

    const decoded = decodeUserTimezoneInfo(Buffer.from([0, 0, 1, 0, 2, 0, 0, 0]));
    expect(decoded.useGroupTimezones).to.equal(false);
    expect(decoded.timezones).to.deep.equal([1, 2, 0]);
  });

  it('encodes user timezone structure for group usage', () => {
    const buffer = encodeUserTimezoneInfo({
      uid: 11,
      useGroupTimezones: true
    });

    expect(buffer.readUInt32LE(4)).to.equal(0);
    expect(buffer.readUInt32LE(8)).to.equal(0);
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
});
