'use strict';

const { COMMANDS } = require('../constants');
const { encodeUnlockGroupInfo, encodeUnlockGroupsInfo } = require('../utils');
const { isAckOk } = require('./groupTimezones');

const COMBINATION_KEYS = ['combination', 'combinationNumber', 'combNo', 'index'];

const activeGroups = (groups = []) =>
    (Array.isArray(groups) ? groups : []).map(Number).filter(group => Number.isFinite(group) && group > 0);

const targetCombination = (info) =>
    Number(info.combination ?? info.combinationNumber ?? info.combNo ?? info.index);

const groupsFromInfo = (info) => activeGroups(
    info.groups !== undefined
        ? info.groups
        : [info.group1, info.group2, info.group3, info.group4, info.group5]
);

const hasCombinationKey = (info) =>
    COMBINATION_KEYS.some(key => Object.prototype.hasOwnProperty.call(info, key));

// Raw single-combination write. On compact/ASCII firmware the device only
// accepts the full ten-slot configuration, so the current config is fetched
// and rewritten with the target slot replaced.
const writeUnlockGroupRaw = async (transport, info) => {
    if (!Buffer.isBuffer(info) && transport.unlockGroupsFormat === 'ascii') {
        const current = await transport.getUnlockGroups();
        const combinations = current.combinations.map((combination) => ({
            combination: combination.combination,
            groups: activeGroups(combination.groups)
        }));
        const target = targetCombination(info);
        if (!Number.isInteger(target) || target < 1 || target > 10) {
            throw new Error('setUnlockGroup: combination must be between 1 and 10');
        }
        combinations[target - 1] = {
            combination: target,
            groups: info.groups !== undefined
                ? info.groups
                : [info.group1, info.group2, info.group3, info.group4, info.group5]
        };
        return await writeUnlockGroupsRaw(transport, { combinations });
    }
    const payload = Buffer.isBuffer(info) ? info : encodeUnlockGroupInfo(info);
    return await transport.executeCmd(COMMANDS.CMD_ULG_WRQ, payload);
};

const writeUnlockGroupsRaw = async (transport, info) => {
    if (!Buffer.isBuffer(info) && typeof info !== 'string' && hasCombinationKey(info)) {
        return await writeUnlockGroupRaw(transport, info);
    }
    const payload = Buffer.isBuffer(info) ? info : encodeUnlockGroupsInfo(info);
    return await transport.executeCmd(COMMANDS.CMD_ULG_WRQ, payload);
};

const rejectedError = (ackOk) => {
    if (ackOk) return null;
    const error = new Error('unlock groups write rejected by the device (no ACK_OK)');
    error.code = 'ERR_UNLOCK_GROUPS_WRITE_REJECTED';
    return error;
};

const notPersistedError = (mismatches, readback, ackOk) => {
    const ackSummary = ackOk
        ? 'the device acknowledged the write (ACK_OK)'
        : 'the device did not acknowledge the write';
    const error = new Error(
        `unlock groups write not persisted — ${ackSummary} but readback does not match: ` +
        `${JSON.stringify(mismatches)}${readback.raw !== undefined ? ` (raw="${readback.raw}")` : ''}`
    );
    error.code = 'ERR_UNLOCK_GROUPS_NOT_PERSISTED';
    error.mismatches = mismatches;
    error.readback = { format: readback.format, raw: readback.raw };
    return error;
};

const compareCombinations = (expected, readback) => expected
    .map(entry => {
        const actual = activeGroups(readback.combinations?.[entry.combination - 1]?.groups);
        return { combination: entry.combination, expected: entry.groups, actual };
    })
    .filter(entry => JSON.stringify(entry.expected) !== JSON.stringify(entry.actual));

// Verified single-combination write. The firmware replies ACK_OK even to
// writes it ignores, so success is only reported after a readback shows the
// target combination holding the requested groups. options.verify=false
// restores fire-and-forget behaviour; options.refresh=false skips
// CMD_REFRESHDATA after the write.
const setUnlockGroup = async (transport, info = {}, options = {}) => {
    if (Buffer.isBuffer(info)) {
        // Raw escape hatch: caller controls the exact bytes, no verification possible.
        return await transport.executeCmd(COMMANDS.CMD_ULG_WRQ, info);
    }

    const verify = options.verify !== false;
    const refresh = options.refresh !== false;

    const reply = await writeUnlockGroupRaw(transport, info);
    const ackOk = isAckOk(reply);
    if (refresh) {
        await transport.refreshData();
    }

    if (!verify) {
        const rejected = rejectedError(ackOk);
        if (rejected) throw rejected;
        return reply;
    }

    const target = targetCombination(info);
    const expected = [{ combination: target, groups: groupsFromInfo(info) }];
    const readback = await transport.getUnlockGroups();
    const mismatches = compareCombinations(expected, readback);
    if (mismatches.length) {
        throw notPersistedError(mismatches, readback, ackOk);
    }
    return {
        verified: true,
        combination: target,
        groups: expected[0].groups,
        raw: readback.raw,
        readback
    };
};

// Verified full-configuration write. encodeUnlockGroupsInfo always writes all
// ten slots — combinations not listed are cleared — so verification expects
// the unlisted combinations to read back empty as well.
const setUnlockGroups = async (transport, info = {}, options = {}) => {
    if (Buffer.isBuffer(info) || typeof info === 'string') {
        // Raw escape hatch, e.g. restoring a previously captured ASCII config.
        return await writeUnlockGroupsRaw(transport, info);
    }

    if (hasCombinationKey(info)) {
        return await setUnlockGroup(transport, info, options);
    }

    const verify = options.verify !== false;
    const refresh = options.refresh !== false;

    const reply = await writeUnlockGroupsRaw(transport, info);
    const ackOk = isAckOk(reply);
    if (refresh) {
        await transport.refreshData();
    }

    if (!verify) {
        const rejected = rejectedError(ackOk);
        if (rejected) throw rejected;
        return reply;
    }

    const source = Array.isArray(info) ? info : (info.combinations ?? info.unlockGroups);
    const expected = Array.from({ length: 10 }, (_, index) => ({ combination: index + 1, groups: [] }));
    source.forEach((entry, index) => {
        const combination = Number(
            entry.combination ?? entry.combinationNumber ?? entry.combNo ?? entry.index ?? (index + 1)
        );
        expected[combination - 1] = { combination, groups: groupsFromInfo(entry) };
    });

    const readback = await transport.getUnlockGroups();
    const mismatches = compareCombinations(expected, readback);
    if (mismatches.length) {
        throw notPersistedError(mismatches, readback, ackOk);
    }
    return {
        verified: true,
        raw: readback.raw,
        combinations: readback.combinations,
        readback
    };
};

module.exports = { setUnlockGroup, setUnlockGroups };
