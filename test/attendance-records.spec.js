'use strict';

const { expect } = require('chai');
const { decodeAttendanceData, decodeTCPRealTimeEvent } = require('../utils');

// First 12 records of a real attendance body captured from the ZEM760 (fw 6.60)
// test panel. Full body was 26 records x 16 bytes = 416 bytes.
// Layout: uid(u32)@0, time(u32)@4, status(u8)@8.
const COMPACT_RECORDS = [
  'd2040000ba9fce320000000000000000',
  '0100000053acce320000000000000000',
  '01000000d9adce320700000000000000',
  '0100000051aece320700000000000000',
  '01000000d1aece320000000000000000',
  '010000000cafce320000000000000000',
  '0100000049afce320700000000000000',
  '010000002df3cf320700000000000000',
  '010000006cf3cf320700000000000000',
  '01000000d4f3cf320700000000000000',
  '0100000093f5cf320700000000000000',
  '01000000b0f5cf320000000000000000',
];

describe('decodeAttendanceData', () => {
  it('auto-detects 16-byte compact records and decodes real captured bytes', () => {
    // Two representative records from the capture.
    const body = Buffer.from('d2040000ba9fce3200000000000000000100000053acce320000000000000000', 'hex');
    const { recordSize, records } = decodeAttendanceData(body);

    expect(recordSize).to.equal(16);
    expect(records).to.have.length(2);

    expect(records[0].userSn).to.equal(1234);
    expect(records[0].deviceUserId).to.equal('1234');
    expect(records[0].recordTime.getFullYear()).to.equal(2026);
    expect(records[0].recordTime.getMonth()).to.equal(6); // July (0-indexed)
    expect(records[0].status).to.equal(0);

    expect(records[1].userSn).to.equal(1);
    expect(records[1].status).to.equal(0);
  });

  it('surfaces the status byte that distinguishes records', () => {
    // Record with status byte 7 (offset 8 = 0x07).
    const body = Buffer.from('01000000d9adce320700000000000000', 'hex');
    const { records } = decodeAttendanceData(body);
    expect(records[0].userSn).to.equal(1);
    expect(records[0].status).to.equal(7);
    expect(records[0].recordTime.getFullYear()).to.equal(2026);
  });

  it('decodes the full 26-record capture with plausible dates and uids', () => {
    // Reconstruct enough of the capture (13 records) to exercise batch decoding.
    const body = Buffer.from(COMPACT_RECORDS.join(''), 'hex');
    const { recordSize, records } = decodeAttendanceData(body);

    expect(recordSize).to.equal(16);
    expect(records).to.have.length(COMPACT_RECORDS.length);
    records.forEach(record => {
      expect(record.recordTime.getFullYear()).to.equal(2026);
      expect(record.userSn).to.be.within(1, 65535);
      expect([0, 7]).to.include(record.status);
    });
  });

  it('decodes 40-byte SSR records with an ASCII user id', () => {
    const rec = Buffer.alloc(40);
    rec.writeUInt16LE(12, 0);
    rec.write('EMP0007', 2, 'ascii');
    rec.writeUInt8(1, 26); // status
    // 2026-07-09 18:30:00 encoded as ZK packed seconds.
    const packed = ((((((2026 - 2000) * 12 + 6) * 31) + (9 - 1)) * 24 + 18) * 60 + 30) * 60 + 0;
    rec.writeUInt32LE(packed, 27);
    rec.writeUInt8(0, 31); // punch

    const { recordSize, records } = decodeAttendanceData(rec);
    expect(recordSize).to.equal(40);
    expect(records[0].userSn).to.equal(12);
    expect(records[0].deviceUserId).to.equal('EMP0007');
    expect(records[0].status).to.equal(1);
    expect(records[0].recordTime.getFullYear()).to.equal(2026);
  });

  it('returns an empty result for empty buffers', () => {
    expect(decodeAttendanceData(Buffer.alloc(0))).to.deep.equal({ recordSize: 0, records: [] });
  });

  it('flags access-denied compact records via the status byte', () => {
    // Real captured punches: 2026-07-14 17:40:01 denied (status 7),
    // 17:42:16 granted (status 0). Timestamp packed the ZK way (month 0-indexed).
    const packTime = (y, mo, d, h, mi, s) =>
      ((((((y - 2000) * 12 + mo) * 31 + (d - 1)) * 24 + h) * 60 + mi) * 60 + s);
    const rec16 = (uid, packed, status) => {
      const b = Buffer.alloc(16);
      b.writeUInt32LE(uid, 0);
      b.writeUInt32LE(packed, 4);
      b.writeUInt8(status, 8);
      return b;
    };

    const denied = decodeAttendanceData(rec16(1, packTime(2026, 6, 14, 17, 40, 1), 7));
    const granted = decodeAttendanceData(rec16(1, packTime(2026, 6, 14, 17, 42, 16), 0));

    expect(denied.recordSize).to.equal(16);
    expect(denied.records[0].status).to.equal(7);
    expect(denied.records[0].denied).to.equal(true);
    expect(granted.records[0].status).to.equal(0);
    expect(granted.records[0].denied).to.equal(false);
  });
});

describe('realtime attendance events', () => {
  // Real EF_ATTLOG frames captured from the ZEM760: same user (UID 1),
  // access denied vs granted, differing only in the verif_state byte.
  const DENIED_FRAME = '5050827d14000000f401b95d010000000100000000871a070e112801';
  const GRANTED_FRAME = '5050827d14000000f401b7d5010000000100000000001a070e112a10';

  it('marks a denied punch (verif_state 0x87) as denied', () => {
    const ev = decodeTCPRealTimeEvent(Buffer.from(DENIED_FRAME, 'hex'));
    expect(ev.event_type).to.equal(1);
    expect(ev.user_sn).to.equal(1);
    expect(ev.verif_state).to.equal(135);
    expect(ev.denied).to.equal(true);
  });

  it('marks a granted punch (verif_state 0x00) as not denied', () => {
    const ev = decodeTCPRealTimeEvent(Buffer.from(GRANTED_FRAME, 'hex'));
    expect(ev.event_type).to.equal(1);
    expect(ev.verif_state).to.equal(0);
    expect(ev.denied).to.equal(false);
  });
});
