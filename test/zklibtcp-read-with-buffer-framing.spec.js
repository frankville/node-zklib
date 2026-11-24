'use strict';

const { EventEmitter } = require('events');
const { expect } = require('chai');

const ZKLibTCP = require('../zklibtcp');
const { COMMANDS, MAX_CHUNK } = require('../constants');

// After CMD_DATA_RDY the device sends CMD_PREPARE_DATA, CMD_DATA and CMD_ACK_OK back to back,
// without waiting for the client. How those frames are split into socket reads is up to the
// network and the host, so readWithBuffer has to give the same answer for every grouping.

const frame = (command, payload = Buffer.alloc(0)) => {
  const body = Buffer.alloc(8 + payload.length);
  body.writeUInt16LE(command, 0);
  body.writeUInt16LE(0, 2);
  body.writeUInt16LE(1234, 4);
  body.writeUInt16LE(3, 6);
  payload.copy(body, 8);
  const prefix = Buffer.from([0x50, 0x50, 0x82, 0x7d, 0, 0, 0, 0]);
  prefix.writeUInt32LE(body.length, 4);
  return Buffer.concat([prefix, body]);
};

// The reply to CMD_DATA_WRRQ: a 13-byte "data stat" carrying the dataset size.
const dataStat = (size) => {
  const stat = Buffer.alloc(13);
  stat.writeUInt32LE(size, 1);
  stat.writeUInt32LE(size, 5);
  return frame(COMMANDS.CMD_ACK_OK, stat);
};

// The frames one CMD_DATA_RDY is answered with.
const chunkFrames = (data) => {
  const prep = Buffer.alloc(8);
  prep.writeUInt32LE(data.length, 0);
  return [frame(COMMANDS.CMD_PREPARE_DATA, prep), frame(COMMANDS.CMD_DATA, data), frame(COMMANDS.CMD_ACK_OK)];
};

const dataset = (size) => {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 7 + 3) & 0xff;
  return buf;
};

// A socket that answers the chunk requests with `reads`, each emitted as one 'data' event,
// once every chunk request has been written.
const fakeSocket = (reads, expectedChunkRequests) => {
  const socket = new EventEmitter();
  let chunkRequests = 0;
  socket.write = (buf, encoding, cb) => {
    if (cb) cb();
    const command = buf.readUInt16LE(8);
    if (command === COMMANDS.CMD_DATA_RDY && ++chunkRequests === expectedChunkRequests) {
      setImmediate(() => reads.forEach(read => socket.emit('data', read)));
    }
    return true;
  };
  return socket;
};

const read = async (size, group) => {
  const data = dataset(size);
  const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
  const remain = size % MAX_CHUNK;
  const numberChunks = (size - remain) / MAX_CHUNK;
  const pieces = [];
  for (let i = 0; i < numberChunks; i++) pieces.push(data.subarray(i * MAX_CHUNK, (i + 1) * MAX_CHUNK));
  if (remain > 0) pieces.push(data.subarray(numberChunks * MAX_CHUNK));
  const frames = pieces.flatMap(chunkFrames);
  // readWithBuffer writes one chunk request per full chunk plus one for the remainder.
  zk.socket = fakeSocket(group(Buffer.concat(frames), frames), numberChunks + 1);
  zk.requestData = async () => dataStat(size);
  const progress = [];
  const result = await zk.readWithBuffer(Buffer.alloc(11), (received, total) => progress.push([received, total]));
  return { data, result, progress, zk };
};

const SMALL = 1400;

describe('ZKLibTCP.readWithBuffer frame grouping', function () {
  // A stalled read waits 10 s before giving up; failing well before that is the point.
  this.timeout(2000);

  const cases = {
    'each frame in its own read': (all, frames) => frames,
    'prepare and data together, then the ack': (all, [p, d, a]) => [Buffer.concat([p, d]), a],
    'prepare, then data and ack together': (all, [p, d, a]) => [p, Buffer.concat([d, a])],
    'all three frames in one read': (all) => [all],
    'prepare and data in one read, no ack': (all, [p, d]) => [Buffer.concat([p, d])],
    'one byte per read': (all) => [...all].map(b => Buffer.from([b])),
    'reads split inside the frame headers': (all) => [all.subarray(0, 3), all.subarray(3, 29), all.subarray(29)],
  };

  for (const [name, group] of Object.entries(cases)) {
    it(`returns the whole dataset with ${name}`, async () => {
      const { data, result } = await read(SMALL, group);
      expect(result.err).to.equal(null);
      expect(Buffer.compare(result.data, data)).to.equal(0);
    });
  }

  it('returns a two-chunk dataset when every frame of both chunks arrives in one read', async () => {
    const size = MAX_CHUNK + 100;
    const { data, result, progress } = await read(size, (all) => [all]);
    expect(result.err).to.equal(null);
    expect(Buffer.compare(result.data, data)).to.equal(0);
    expect(progress).to.deep.equal([[MAX_CHUNK, size], [size, size]]);
  });

  it('returns a two-chunk dataset when the next chunk starts in the read that ends the first', async () => {
    const size = MAX_CHUNK + 100;
    const firstChunkEnd = 24 + 16 + MAX_CHUNK + 16;
    const { data, result } = await read(size, (all) => [all.subarray(0, firstChunkEnd + 10), all.subarray(firstChunkEnd + 10)]);
    expect(result.err).to.equal(null);
    expect(Buffer.compare(result.data, data)).to.equal(0);
  });

  it('returns a two-chunk dataset when reads split inside the first chunk\'s ack and the next chunk\'s header', async () => {
    const size = MAX_CHUNK + 100;
    const firstAckStart = 24 + 16 + MAX_CHUNK;
    const secondHeaderStart = firstAckStart + 16;
    const { data, result } = await read(size, (all) => [
      all.subarray(0, firstAckStart + 5),
      all.subarray(firstAckStart + 5, secondHeaderStart + 11),
      all.subarray(secondHeaderStart + 11),
    ]);
    expect(result.err).to.equal(null);
    expect(Buffer.compare(result.data, data)).to.equal(0);
  });

  it('fails at once, with no data, when a foreign payload frame comes ahead of the data', async () => {
    const stray = frame(COMMANDS.CMD_ACK_OK, Buffer.alloc(8, 0xee));
    const started = Date.now();
    const { result } = await read(SMALL, (all) => [Buffer.concat([stray, all])]);
    expect(result.err).to.be.an('error');
    expect(result.err.message).to.match(/MALFORMED CHUNK/);
    expect(result.data.length).to.equal(0);
    expect(Date.now() - started).to.be.below(500);
  });

  it('stops at the first overshoot instead of buffering a flood of small frames', async () => {
    const tiny = frame(COMMANDS.CMD_DATA, Buffer.alloc(1000, 0x55));
    const flood = Buffer.concat(Array.from({ length: 2000 }, () => tiny));
    const started = Date.now();
    const { result, zk } = await read(SMALL, () => [flood, flood]);
    expect(result.err).to.be.an('error');
    expect(result.err.message).to.match(/MALFORMED CHUNK/);
    expect(zk.socket.listenerCount('data')).to.equal(0);
    expect(Date.now() - started).to.be.below(500);
  });

  it('stops listening once the dataset is complete', async () => {
    const { result, zk } = await read(SMALL, (all) => [all]);
    expect(result.err).to.equal(null);
    expect(zk.socket.listenerCount('data')).to.equal(0);
    expect(zk.socket.listenerCount('close')).to.equal(0);
  });
});
