const { COMMANDS } = require('../constants');
const { encodeTime, decodeTime } = require('../utils');

// The device clock is plain wall time with no zone (`CMD_GET_TIME` / `CMD_SET_TIME`, one u32 in
// the packed form attendance records use). Both directions go through the local fields of a
// `Date`, so the host's timezone is what gives the value its meaning: write from a host in the
// site's zone, as the realtime decoders already assume when they read event times.

// Seconds of disagreement a read-back may show and still count as the value written: the clock
// keeps running between the write and the read, and the device stores whole seconds.
const DEFAULT_READBACK_TOLERANCE_MS = 5000;

// Wall time as milliseconds of a zone-less calendar. The device stores wall time, and a decoded
// Date in the repeated autumn hour resolves to the first offset, so comparing instants there reads
// a correct clock as an hour off. Comparing wall fields does not depend on the offset.
const wallMs = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());

const replyCommand = (reply) => (
    Buffer.isBuffer(reply) && reply.length >= 8 ? reply.readUInt16LE(0) : null
);

const readTime = async (transport) => {
    const reply = await transport.executeCmd(COMMANDS.CMD_GET_TIME, '');
    const command = replyCommand(reply);
    // Exactly one u32 after the header. A longer or shorter payload is another command's reply
    // (`writeMessage` has no realtime filter), and decoding it would invent a clock reading.
    if (command !== COMMANDS.CMD_ACK_OK || reply.length !== 12) {
        const error = new Error(
            `device time read rejected (reply ${command === null ? 'missing' : command}, ` +
            `${Buffer.isBuffer(reply) ? reply.length : 0} bytes)`
        );
        error.code = 'ERR_GET_TIME_REJECTED';
        error.commandId = command;
        throw error;
    }
    return decodeTime(reply.readUInt32LE(8));
};

const writeTimeRaw = async (transport, date) => {
    const payload = Buffer.alloc(4);
    payload.writeUInt32LE(encodeTime(date), 0);
    const reply = await transport.executeCmd(COMMANDS.CMD_SET_TIME, payload);
    const command = replyCommand(reply);
    if (command !== COMMANDS.CMD_ACK_OK) {
        const error = new Error(
            `device time write rejected (reply ${command === null ? 'missing' : command})`
        );
        error.code = 'ERR_SET_TIME_REJECTED';
        error.commandId = command;
        throw error;
    }
};

// Verified, as the other writes here are: an ACK alone has been seen to mean nothing on these
// panels. Returns the clock as read back.
const writeTime = async (transport, date, options = {}) => {
    const toleranceMs = Number.isFinite(options.toleranceMs)
        ? options.toleranceMs
        : DEFAULT_READBACK_TOLERANCE_MS;
    const startedAt = Date.now();
    await writeTimeRaw(transport, date);
    const readback = await readTime(transport);
    // The device clock has run on since the write; expect it ahead by about the elapsed time.
    const expected = wallMs(date) + (Date.now() - startedAt);
    const differenceMs = wallMs(readback) - expected;
    if (Math.abs(differenceMs) > toleranceMs) {
        const error = new Error(
            `device time write not persisted — wrote ${date.toISOString()}, ` +
            `read back ${readback.toISOString()}`
        );
        error.code = 'ERR_SET_TIME_NOT_PERSISTED';
        error.readback = readback;
        error.differenceMs = differenceMs;
        throw error;
    }
    return readback;
};

module.exports = {
    DEFAULT_READBACK_TOLERANCE_MS,
    readTime,
    writeTime
};
