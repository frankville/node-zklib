'use strict';

const { COMMANDS } = require('../constants');
const {
    encodeGroupTimezoneInfo,
    normalizeGroupTimezoneFormat,
    groupTimezoneSlots
} = require('../utils');

const isAckOk = (reply) => (
    Buffer.isBuffer(reply) &&
    reply.length >= 2 &&
    reply.readUInt16LE(0) === COMMANDS.CMD_ACK_OK
);

// Some firmwares (notably compact/legacy panels) reply ACK_OK to CMD_GRPTZ_WRQ
// without persisting anything, so a write is only trusted after a readback
// returns the values that were sent. `options.verify === false` opts out and
// restores fire-and-forget behaviour.
//
// Options:
// - verify   (default true): refresh + readback after writing; throw
//   ERR_GROUP_TZ_NOT_PERSISTED if the device did not store the values.
// - refresh  (default true): send CMD_REFRESHDATA after the write.
// - format:  packet format override ('legacy8' | 'uint16' | 'compact32').
// - formats: ordered list of formats to try until one verifies. Requires
//   verify; each failed attempt is reported in the thrown error.
const setGroupTimezones = async (transport, info = {}, options = {}) => {
    if (Buffer.isBuffer(info)) {
        // Raw escape hatch: caller controls the exact bytes, no verification possible.
        return await transport.executeCmd(COMMANDS.CMD_GRPTZ_WRQ, info);
    }

    if (info.group === undefined || info.group === null) {
        throw new Error('setGroupTimezones: group is required');
    }

    const group = Number(info.group);
    const expected = groupTimezoneSlots(info);
    const verify = options.verify !== false;
    const refresh = options.refresh !== false;

    const requestedFormats = Array.isArray(options.formats) && options.formats.length > 0
        ? options.formats
        : [options.format ?? info.format ?? transport.groupTimezoneFormat ?? 'legacy8'];
    const formats = requestedFormats.map(format => normalizeGroupTimezoneFormat(format) || 'legacy8');

    if (!verify && formats.length > 1) {
        throw new Error('setGroupTimezones: trying multiple formats requires verify');
    }

    const attempts = [];
    for (const format of formats) {
        const payload = encodeGroupTimezoneInfo({ ...info, format });
        const reply = await transport.executeCmd(COMMANDS.CMD_GRPTZ_WRQ, payload);
        const ackOk = isAckOk(reply);

        if (refresh) {
            await transport.refreshData();
        }

        if (!verify) {
            if (!ackOk) {
                const error = new Error(
                    `setGroupTimezones: device rejected write for group ${group} (no ACK_OK)`
                );
                error.code = 'ERR_GROUP_TZ_WRITE_REJECTED';
                throw error;
            }
            return reply;
        }

        // Decode the readback with the format that was just written; a persisted
        // compact record read back as legacy8 would fail the comparison.
        const readback = await transport.getGroupTimezones(group, { format });
        const timezonesMatch = Array.isArray(readback.timezones) &&
            expected.every((tz, index) => readback.timezones[index] === tz);
        const groupMatches = readback.group === group || readback.group === (group & 0xFF);

        attempts.push({
            format,
            ackOk,
            payload: payload.toString('hex'),
            readback: {
                group: readback.group,
                timezones: readback.timezones,
                raw: readback.raw
            }
        });

        if (timezonesMatch && groupMatches) {
            // Remember the format the device actually persists so later writes
            // on this connection skip the failed variants.
            transport.groupTimezoneFormat = format;
            return {
                verified: true,
                format,
                group,
                timezones: readback.timezones,
                readback
            };
        }
    }

    const ackSummary = attempts.every(attempt => attempt.ackOk)
        ? 'the device acknowledged the write (ACK_OK)'
        : 'the device did not acknowledge the write';
    const error = new Error(
        `setGroupTimezones: group ${group} write not persisted — ${ackSummary} but readback does not match expected timezones [${expected.join(', ')}]. ` +
        `Attempts: ${JSON.stringify(attempts)}`
    );
    error.code = 'ERR_GROUP_TZ_NOT_PERSISTED';
    error.attempts = attempts;
    error.expected = { group, timezones: expected };
    throw error;
};

module.exports = { setGroupTimezones, isAckOk };
