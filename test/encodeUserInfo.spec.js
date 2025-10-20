'use strict';

const { expect } = require('chai');

const {
  encodeUserInfo72,
  decodeUserData72
} = require('../utils');

describe('encodeUserInfo72', () => {
  it('builds a 72-byte payload with expected field mapping', () => {
    const buffer = encodeUserInfo72({
      uid: 42,
      userId: 'USR42',
      name: 'Test User',
      password: '1234',
      role: 'admin',
      enabled: false,
      cardNumber: 98765,
      groupNumber: 7,
      timezones: [2, 4, 6],
      userTimezoneFlag: 9
    });

    expect(buffer).to.be.instanceOf(Buffer);
    expect(buffer.length).to.equal(72);
    expect(buffer.readUInt16LE(0)).to.equal(42);
    expect(buffer.readUInt8(2)).to.equal(0x07); // admin + disabled bit
    expect(buffer.toString('ascii', 3, 7)).to.equal('1234');
    expect(buffer.toString('ascii', 11, 20).replace(/\0+$/, '')).to.equal('Test User');
    expect(buffer.readUInt32LE(35)).to.equal(98765);
    expect(buffer.readUInt8(39)).to.equal(7);
    expect(buffer.readUInt16LE(40)).to.equal(9);
    expect(buffer.readUInt16LE(42)).to.equal(2);
    expect(buffer.readUInt16LE(44)).to.equal(4);
    expect(buffer.readUInt16LE(46)).to.equal(6);
    expect(buffer.toString('ascii', 48, 53).replace(/\0+$/, '')).to.equal('USR42');

    const decoded = decodeUserData72(buffer);
    expect(decoded.uid).to.equal(42);
    expect(decoded.name).to.equal('Test User');
    expect(decoded.password).to.equal('1234');
    expect(decoded.cardno).to.equal(98765);
    expect(decoded.role).to.equal(0x07);
    expect(decoded.userId).to.equal('USR42');
  });

  it('sanitises strings, fills missing fields, and honours timezone flags', () => {
    const payload = encodeUserInfo72({
      uid: 1,
      name: 'Ángela 😊',
      userId: 'ID1',
      useGroupTimezones: true,
      timezones: [5]
    });

    expect(payload.length).to.equal(72);
    expect(payload.readUInt16LE(0)).to.equal(1);
    expect(payload.readUInt8(2)).to.equal(0x02); // common user, enabled
    expect(payload.toString('ascii', 11, 20).replace(/\0+$/, '')).to.equal('ngela '); // non-ascii stripped
    expect(payload.readUInt16LE(40)).to.equal(1); // timezones array provided
    expect(payload.readUInt16LE(42)).to.equal(5);
    expect(payload.readUInt16LE(44)).to.equal(0);
    expect(payload.readUInt16LE(46)).to.equal(0);
  });

  it('throws when uid is missing', () => {
    expect(() => encodeUserInfo72({})).to.throw(/uid is required/);
  });
});
