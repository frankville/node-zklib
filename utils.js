const { USHRT_MAX , COMMANDS, AUTH } = require('./constants')
const { log } = require('./helpers/errorLog')


const parseTimeToDate = (time)=>{
    const second = time % 60;
    time = (time - second) / 60;
    const minute = time % 60;
    time = (time - minute) / 60;
    const hour = time % 24;
    time = (time - hour) / 24;
    const day = time % 31 + 1;
    time = (time - (day - 1)) / 31;
    const month = time % 12;
    time = (time - month) / 12;
    const year = time + 2000;
    
    return new Date(year, month, day, hour, minute, second);
}

const parseHexToTime = (hex)=>{
    const time =  {
        year: hex.readUIntLE(0,1),
        month:hex.readUIntLE(1,1),
        date: hex.readUIntLE(2,1),
        hour: hex.readUIntLE(3,1),
        minute: hex.readUIntLE(4,1),
        second: hex.readUIntLE(5,1)
      }
    
      return new Date(2000+ time.year, time.month - 1 , time.date, time.hour, time.minute, time.second)
}

const createChkSum = (buf)=>{
    let chksum = 0;
    for (let i = 0; i < buf.length; i += 2) {
      if (i == buf.length - 1) {
        chksum += buf[i];
      } else {
        chksum += buf.readUInt16LE(i);
      }
      chksum %= USHRT_MAX;
    }
    chksum = USHRT_MAX - chksum - 1;
  
    return chksum;
}

module.exports.createUDPHeader = (command , sessionId, replyId, data)=>{
    const dataBuffer = Buffer.from(data);
    const buf = Buffer.alloc(8 + dataBuffer.length);
  
    buf.writeUInt16LE(command, 0);
    buf.writeUInt16LE(0, 2);
  
    buf.writeUInt16LE(sessionId, 4);
    buf.writeUInt16LE(replyId, 6);
    dataBuffer.copy(buf, 8);
    
    const chksum2 = createChkSum(buf);
    buf.writeUInt16LE(chksum2, 2);
      
    replyId = (replyId + 1) % USHRT_MAX;
    buf.writeUInt16LE(replyId, 6);
    
    return buf
}

module.exports.createTCPHeader = (command , sessionId, replyId, data)=>{
    const dataBuffer = Buffer.from(data);
    const buf = Buffer.alloc(8 + dataBuffer.length);
  
    buf.writeUInt16LE(command, 0);
    buf.writeUInt16LE(0, 2);
  
    buf.writeUInt16LE(sessionId, 4);
    buf.writeUInt16LE(replyId, 6);
    dataBuffer.copy(buf, 8);
    
    const chksum2 = createChkSum(buf);
    buf.writeUInt16LE(chksum2, 2);
      
    replyId = (replyId + 1) % USHRT_MAX;
    buf.writeUInt16LE(replyId, 6);
    
  
    const prefixBuf = Buffer.from([0x50, 0x50, 0x82, 0x7d, 0x13, 0x00, 0x00, 0x00])
  
    prefixBuf.writeUInt16LE(buf.length, 4)
  
    return Buffer.concat([prefixBuf, buf]);
}

const removeTcpHeader  = (buf)=>{
  if (buf.length < 8) {
      return buf;
    }
  
    if (buf.compare(Buffer.from([0x50, 0x50, 0x82, 0x7d]), 0, 4, 0, 4) !== 0) {
      return buf;
    }
  
    return buf.slice(8);
}

module.exports.removeTcpHeader = removeTcpHeader

const ROLE_VALUE_TO_NAME = {
    0: 'user',
    1: 'enroller',
    3: 'admin',
    7: 'superadmin'
};

const decodePermissionToken = (permissionToken) => {
    const token = permissionToken & 0xFF;
    const roleValue = ((token & 0x02) ? 0x01 : 0) |
        ((token & 0x04) ? 0x02 : 0) |
        ((token & 0x08) ? 0x04 : 0);

    return {
        permissionToken: token,
        enabled: (token & 0x01) === 0,
        roleValue,
        roleName: ROLE_VALUE_TO_NAME[roleValue] || 'unknown'
    };
};

module.exports.decodeUserData28 = (userData)=>{
    const permissionToken = userData.readUIntLE(2, 1);
    const user = {
      uid: userData.readUIntLE(0, 2),
      role: permissionToken,
      ...decodePermissionToken(permissionToken),
      password: userData
        .subarray(3, 3+5)
        .toString('ascii')
        .split('\0')
        .shift(),
	      name: userData
	        .slice(8,8+8)
	        .toString('ascii')
	        .split('\0')
	        .shift(),
	      compactData: Buffer.from(userData.subarray(16, 24)),
	      userId: userData.readUIntLE(24,4)
	    };
    return user;
}

module.exports.decodeUserData72 = (userData)=>{
    const permissionToken = userData.readUIntLE(2, 1);
    const userTimezoneFlag = userData.readUIntLE(40, 2);
    const timezones = [
        userData.readUIntLE(42, 2),
        userData.readUIntLE(44, 2),
        userData.readUIntLE(46, 2)
    ].map(normalizeTimezoneSlot);
    const useUserTimezones = userTimezoneFlag === 1;
    const user = {
        uid: userData.readUIntLE(0, 2),
        role: permissionToken,
        ...decodePermissionToken(permissionToken),
        password: userData
          .subarray(3, 3+8)
          .toString('ascii')
          .split('\0')
          .shift(),
        name: userData
          .subarray(11, 11+24)
          .toString('ascii')
          .split('\0')
          .shift(),
        cardno: userData.readUIntLE(35,4),
        cardNumber: userData.readUIntLE(35,4),
        groupNumber: userData.readUIntLE(39,1),
        userTimezoneFlag,
        useUserTimezones,
        useGroupTimezones: !useUserTimezones,
        timezones,
        userId: userData
          .slice(48, 48+9)
          .toString('ascii')
          .split('\0')
          .shift(),
      };
      return user;
}

const sanitizeAscii = (value) => {
    if (value === undefined || value === null) {
        return '';
    }
    const str = value.toString();
    return str.replace(/[^\x00-\x7F]/g, '');
};

const writeAsciiField = (buf, value, offset, length) => {
    const clean = sanitizeAscii(value);
    const fieldBuf = Buffer.alloc(length);
    fieldBuf.fill(0);
    if (!clean.length) {
        fieldBuf.copy(buf, offset);
        return;
    }
    const asciiBuf = Buffer.from(clean, 'ascii');
    const sliceLength = Math.min(asciiBuf.length, Math.max(length, 0));
    if (sliceLength > 0) {
        asciiBuf.copy(fieldBuf, 0, 0, sliceLength);
    }
    fieldBuf.copy(buf, offset);
};

const buildPermissionToken = (roleValue, enabled) => {
    let token = 0;
    const normalized = Number.isFinite(roleValue) ? roleValue : 0;
    if (normalized & 0x1) {
        token |= 0x02;
    }
    if (normalized & 0x2) {
        token |= 0x04;
    }
    if (normalized & 0x4) {
        token |= 0x08;
    }
    if (enabled === false) {
        token |= 0x01;
    }
    return token & 0xFF;
};

const ROLE_NAME_TO_VALUE = {
    user: 0,
    enroller: 1,
    admin: 3,
    superadmin: 7
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const resolveRoleValue = (options = {}) => {
    if (typeof options.role === 'string') {
        return ROLE_NAME_TO_VALUE[options.role.toLowerCase().trim()] ?? 0;
    }
    if (typeof options.roleName === 'string') {
        return ROLE_NAME_TO_VALUE[options.roleName.toLowerCase().trim()] ?? 0;
    }
    if (options.role !== undefined && options.role !== null) {
        const numericRole = Number(options.role);
        if (
            Number.isFinite(numericRole) &&
            (
                options.permissionToken === undefined ||
                options.permissionToken === null ||
                numericRole !== (options.permissionToken & 0xFF)
            )
        ) {
            return numericRole;
        }
    }
    if (options.roleValue !== undefined && options.roleValue !== null) {
        return Number(options.roleValue) || 0;
    }
    if (options.permissionToken !== undefined && options.permissionToken !== null) {
        return decodePermissionToken(options.permissionToken).roleValue;
    }
    return 0;
};

const resolvePermissionToken = (options = {}) => {
    const hasSemanticPermission = ['role', 'roleName', 'roleValue', 'enabled']
        .some(key => hasOwn(options, key));
    if (
        options.permissionToken !== undefined &&
        options.permissionToken !== null &&
        !hasSemanticPermission
    ) {
        return options.permissionToken & 0xFF;
    }

    const roleValue = resolveRoleValue(options);
    const enabled = options.enabled !== undefined && options.enabled !== null
        ? options.enabled !== false
        : options.permissionToken !== undefined && options.permissionToken !== null
            ? decodePermissionToken(options.permissionToken).enabled
            : true;

    return buildPermissionToken(roleValue, enabled);
};

const toUInt16 = (value, fallback = 0) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) {
        return fallback;
    }
    const num = Number(value);
    if (num < 0) {
        return 0;
    }
    if (num > 0xFFFF) {
        return 0xFFFF;
    }
    return num;
};

const toUInt32 = (value, fallback = 0) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) {
        return fallback >>> 0;
    }
    const num = Number(value);
    if (num < 0) {
        return 0;
    }
    if (num > 0xFFFFFFFF) {
        return 0xFFFFFFFF;
    }
    return num >>> 0;
};

module.exports.encodeUserInfo72 = (options = {}) => {
    const payload = Buffer.alloc(72);
    payload.fill(0);

    if (options.uid === undefined || options.uid === null) {
        throw new Error('encodeUserInfo72: uid is required');
    }

    payload.writeUInt16LE(toUInt16(options.uid), 0);

    payload.writeUInt8(resolvePermissionToken(options), 2);

    writeAsciiField(payload, options.password || '', 3, 8);
    writeAsciiField(payload, options.name || '', 11, 24);

    payload.writeUInt32LE(toUInt32(options.cardNumber, options.cardno || 0), 35);
    payload.writeUInt8(toUInt16(options.groupNumber ?? options.group ?? 1) & 0xFF, 39);

    const explicitTzFlag = options.userTimezoneFlag;
    const timezones = Array.isArray(options.timezones) ? options.timezones : [];
    const hasTimezoneMode = hasOwn(options, 'useUserTimezones') ||
        hasOwn(options, 'useGroupTimezones');
    const useUserTimezones = hasOwn(options, 'useGroupTimezones')
        ? !options.useGroupTimezones
        : hasOwn(options, 'useUserTimezones')
            ? !!options.useUserTimezones
            : timezones.some(timezone => Number(timezone) > 0);
    const tzFlag = explicitTzFlag !== undefined && explicitTzFlag !== null && !hasTimezoneMode
        ? toUInt16(explicitTzFlag)
        : (useUserTimezones ? 1 : 0);
    payload.writeUInt16LE(tzFlag, 40);

    payload.writeUInt16LE(toUInt16(timezones[0] ?? 0), 42);
    payload.writeUInt16LE(toUInt16(timezones[1] ?? 0), 44);
    payload.writeUInt16LE(toUInt16(timezones[2] ?? 0), 46);

    writeAsciiField(payload, options.userId ?? options.userid ?? '', 48, 9);

    return payload;
};

module.exports.encodeUserInfo28 = (options = {}) => {
    const payload = Buffer.alloc(28);
    payload.fill(0);

    if (options.uid === undefined || options.uid === null) {
        throw new Error('encodeUserInfo28: uid is required');
    }

    payload.writeUInt16LE(toUInt16(options.uid), 0);

    payload.writeUInt8(resolvePermissionToken(options), 2);

    writeAsciiField(payload, options.password || '', 3, 5);
    writeAsciiField(payload, options.name || '', 8, 8);

    const compactData = options.compactData || options.rawAccessData || options.reserved;
    if (Buffer.isBuffer(compactData)) {
        compactData.copy(payload, 16, 0, Math.min(compactData.length, 8));
    }

    const userIdValue = toUInt32(
        options.userId ?? options.userid ?? options.uid,
        toUInt32(options.uid)
    );
    payload.writeUInt32LE(userIdValue, 24);

    return payload;
};

module.exports.toUInt16 = toUInt16;
module.exports.toUInt32 = toUInt32;

const clamp = (value, min, max) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) {
        return min;
    }
    return Math.min(Math.max(Number(value), min), max);
};

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const emptyTimezoneDays = () => DAYS.reduce((days, day) => {
    days[day] = { startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 };
    return days;
}, {});

const normalizeTimezoneSlot = (value) => {
    if (value === 0xFFFF || value === 0xFFFFFFFE || value === 0xFFFFFFFF) {
        return 0;
    }
    if (value > 0 && value % 256 === 0 && value / 256 <= 50) {
        return value / 256;
    }
    return value;
};

const isPlausibleCompactTimezoneValue = (value) => (
    value <= 100 ||
    value === 0xFFFF ||
    value === 0xFFFFFFFE ||
    value === 0xFFFFFFFF
);

const fixedNumberArray = (values, length, byteSized = false) => {
    const normalized = [];
    const list = Array.isArray(values) ? values : [];
    for (let i = 0; i < length; i++) {
        const value = toUInt16(list[i] ?? 0);
        normalized.push(byteSized ? value & 0xFF : value);
    }
    return normalized;
};

const normaliseDayKey = (key) => {
    if (!key) return null;
    const lower = key.toString().toLowerCase();
    if (lower.startsWith('sun')) return 'sunday';
    if (lower.startsWith('mon')) return 'monday';
    if (lower.startsWith('tue')) return 'tuesday';
    if (lower.startsWith('wed')) return 'wednesday';
    if (lower.startsWith('thu')) return 'thursday';
    if (lower.startsWith('fri')) return 'friday';
    if (lower.startsWith('sat')) return 'saturday';
    return null;
};

const encodeDaySegment = (segment = {}) => {
    const buffer = Buffer.alloc(4);
    const startHour = clamp(segment.startHour ?? segment.start_hour ?? 0, 0, 23);
    const startMinute = clamp(segment.startMinute ?? segment.start_minute ?? 0, 0, 59);
    const endHour = clamp(segment.endHour ?? segment.end_hour ?? 0, 0, 23);
    const endMinute = clamp(segment.endMinute ?? segment.end_minute ?? 0, 0, 59);
    buffer.writeUInt8(startHour, 0);
    buffer.writeUInt8(startMinute, 1);
    buffer.writeUInt8(endHour, 2);
    buffer.writeUInt8(endMinute, 3);
    return buffer;
};

module.exports.encodeTimezoneInfo = (options = {}) => {
    const buffer = Buffer.alloc(32);
    buffer.fill(0);

    if (options.index === undefined || options.index === null) {
        throw new Error('encodeTimezoneInfo: index is required');
    }

    buffer.writeUInt32LE(toUInt32(options.index), 0);

    const schedule = options.days || options.schedule || {};
    const defaultSegment = options.defaultSegment || options.default || null;

    DAYS.forEach((day, idx) => {
        let segment = null;
        if (Array.isArray(schedule)) {
            segment = schedule[idx] ?? defaultSegment;
        } else {
            const normalisedKey = normaliseDayKey(day);
            segment = schedule[normalisedKey] ??
                schedule[day] ??
                schedule[idx] ??
                defaultSegment;
        }
        const dayBuffer = encodeDaySegment(segment || {});
        dayBuffer.copy(buffer, 4 + (idx * 4));
    });

    return buffer;
};

module.exports.decodeTimezoneInfo = (data, fallbackIndex = 0) => {
    if (!Buffer.isBuffer(data) || data.length === 0) {
        return {
            index: fallbackIndex,
            days: emptyTimezoneDays()
        };
    }

    const payload = (
        data.length >= 8 &&
        (data.readUInt16LE(0) === 2000 || data.readUInt16LE(0) === 2002)
    ) ? data.subarray(8) : data;

    const hasReadTrailer = payload.length >= 32 &&
        payload.readUInt8(30) === 0xA7 &&
        payload.readUInt8(31) === 0x1C;
    const hasShortReadSchedule = payload.length === 28;
    const index = hasShortReadSchedule
        ? fallbackIndex
        : hasReadTrailer
        ? payload.readUInt16LE(0)
        : payload.length >= 4
            ? payload.readUInt32LE(0)
            : payload.length >= 2
                ? payload.readUInt16LE(0)
                : fallbackIndex;
    const dayOffset = hasShortReadSchedule ? 0 : hasReadTrailer ? 2 : 4;
    const days = {};

    DAYS.forEach((day, idx) => {
        const offset = dayOffset + (idx * 4);
        if (payload.length >= offset + 4) {
            days[day] = {
                startHour: payload.readUInt8(offset),
                startMinute: payload.readUInt8(offset + 1),
                endHour: payload.readUInt8(offset + 2),
                endMinute: payload.readUInt8(offset + 3)
            };
        } else {
            days[day] = { startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 };
        }
    });

    return { index: index || fallbackIndex, days };
};

module.exports.encodeUserGroupInfo = (options = {}) => {
    const buffer = Buffer.alloc(5);
    buffer.fill(0);

    if (options.uid === undefined || options.uid === null) {
        throw new Error('encodeUserGroupInfo: uid is required');
    }

    // Full u32 uid: a ZKAccess capture (ZEM760 fw 6.60) shows CMD_USERGRP_WRQ
    // carrying uid 1234 as a little-endian u32 — truncating to one byte would
    // silently target the wrong user for uids above 255.
    buffer.writeUInt32LE(toUInt32(options.uid), 0);
    buffer.writeUInt8(toUInt16(options.group ?? options.groupNumber ?? 1) & 0xFF, 4);

    return buffer;
};

module.exports.decodeUserGroupInfo = (data) => {
    if (!Buffer.isBuffer(data) || data.length === 0) {
        return { group: 0 };
    }

    const group = data.length >= 1 ? data.readUInt8(0) : 1;
    return { group };
};

module.exports.encodeUserTimezoneInfo = (options = {}) => {
    const buffer = Buffer.alloc(20);
    buffer.fill(0);

    if (options.uid === undefined || options.uid === null) {
        throw new Error('encodeUserTimezoneInfo: uid is required');
    }

    buffer.writeUInt32LE(toUInt32(options.uid), 0);

    const useUserTimezones = options.useUserTimezones !== undefined
        ? !!options.useUserTimezones
        : !(options.useGroupTimezones === true);

    buffer.writeUInt32LE(useUserTimezones ? 1 : 0, 4);

    const tzList = (useUserTimezones && Array.isArray(options.timezones)) ? options.timezones : [];
    for (let i = 0; i < 3; i++) {
        buffer.writeUInt32LE(toUInt32(tzList[i] ?? 0), 8 + (i * 4));
    }

    return buffer;
};

module.exports.decodeUserTimezoneInfo = (data) => {
    if (!Buffer.isBuffer(data) || data.length < 8) {
        throw new Error('decodeUserTimezoneInfo: invalid buffer');
    }

    const compactFlag = data.readUInt32LE(0);
    const maybeCompact32Bit = compactFlag === 0 ||
        compactFlag === 1 ||
        compactFlag === 0xFFFFFFFE ||
        compactFlag === 0xFFFFFFFF;
    const compactSlots = [];
    if (maybeCompact32Bit) {
        for (let offset = 4; offset + 4 <= data.length && compactSlots.length < 3; offset += 4) {
            compactSlots.push(data.readUInt32LE(offset));
        }
    }
    const isCompact32Bit = maybeCompact32Bit &&
        compactSlots.every(isPlausibleCompactTimezoneValue);

    const flag = isCompact32Bit ? compactFlag : data.readUInt16LE(0);
    const timezones = [];

    if (isCompact32Bit) {
        timezones.push(...compactSlots);
    } else {
        for (let offset = 2; offset + 2 <= data.length && timezones.length < 3; offset += 2) {
            timezones.push(data.readUInt16LE(offset));
        }
    }

    while (timezones.length < 3) {
        timezones.push(0);
    }

    const useUserTimezones = flag === 1;

    return {
        timezoneFlag: flag,
        useUserTimezones,
        useGroupTimezones: !useUserTimezones,
        timezones: timezones.map(normalizeTimezoneSlot)
    };
};

// Group timezone packet formats:
// - 'legacy8'   (documented zk-protocol layout): group(u8) tz1(u16) tz2(u16) tz3(u16) verify+holiday(u8) = 8 bytes
// - 'uint16'    (aligned-word variant):          group(u16) tz1(u16) tz2(u16) tz3(u16) = 8 bytes, no verify byte
// - 'compact8'  (compact firmware variant):      write group(u32) tz1(u8) tz2(u8) tz3(u8) verify+holiday(u8) = 8 bytes;
//                                                replies carry found(u32) instead of the group, then the same 4 record bytes,
//                                                and shrink to 4 zero bytes when the group has no record
// - 'compact32' (32-bit firmware variant):       group(u32) tz1(u32) tz2(u32) tz3(u32) = 16 bytes, no verify byte
// - 'compact20' (ZEM760 fw 6.60, captured from a real ZKAccess sync):
//                write group(u32) holiday(u32) tz1(u32) tz2(u32) tz3(u32) = 20 bytes;
//                replies carry found(u32) + tz slots (u32 each, zero-truncated), the
//                group/holiday words are not echoed; verify style lives in the
//                GVS<group> device option, not in this record
const GROUP_TZ_FORMATS = ['legacy8', 'uint16', 'compact8', 'compact32', 'compact20'];

const normalizeGroupTimezoneFormat = (format) => {
    if (format === undefined || format === null || format === '' || format === 'auto') {
        return null;
    }
    const value = String(format).toLowerCase();
    if (value === 'legacy8' || value === 'legacy' || value === 'documented') return 'legacy8';
    if (value === 'uint16' || value === 'u16') return 'uint16';
    if (value === 'compact8' || value === 'u8') return 'compact8';
    if (value === 'compact32' || value === 'compact' || value === 'u32') return 'compact32';
    if (value === 'compact20' || value === 'zem760') return 'compact20';
    throw new Error(`unknown group timezone packet format "${format}" (expected one of: ${GROUP_TZ_FORMATS.join(', ')})`);
};

const MAX_PLAUSIBLE_TIMEZONE_INDEX = 50;
const MAX_PLAUSIBLE_GROUP_NUMBER = 100;

const isPlausibleGroupTimezoneDecode = (group, timezones) => (
    group >= 1 &&
    group <= MAX_PLAUSIBLE_GROUP_NUMBER &&
    timezones.every(tz => tz >= 0 && tz <= MAX_PLAUSIBLE_TIMEZONE_INDEX)
);

const groupTimezoneSlots = (options) => ([
    toUInt16(options.tz1 ?? options.timezones?.[0] ?? 0),
    toUInt16(options.tz2 ?? options.timezones?.[1] ?? 0),
    toUInt16(options.tz3 ?? options.timezones?.[2] ?? 0)
]);

module.exports.encodeGroupTimezoneInfo = (options = {}) => {
    if (options.group === undefined || options.group === null) {
        throw new Error('encodeGroupTimezoneInfo: group is required');
    }

    const format = normalizeGroupTimezoneFormat(options.format) || 'legacy8';
    const slots = groupTimezoneSlots(options);

    if (format === 'uint16') {
        const buffer = Buffer.alloc(8);
        buffer.writeUInt16LE(toUInt16(options.group), 0);
        buffer.writeUInt16LE(slots[0], 2);
        buffer.writeUInt16LE(slots[1], 4);
        buffer.writeUInt16LE(slots[2], 6);
        return buffer;
    }

    if (format === 'compact32') {
        const buffer = Buffer.alloc(16);
        buffer.writeUInt32LE(toUInt32(options.group), 0);
        buffer.writeUInt32LE(slots[0], 4);
        buffer.writeUInt32LE(slots[1], 8);
        buffer.writeUInt32LE(slots[2], 12);
        return buffer;
    }

    if (format === 'compact20') {
        // Word 2 is a record valid/enable flag — writing 0 deletes the record
        // (confirmed on ZEM760 fw 6.60). It is NOT the holiday flag; where the
        // holiday bit lives on this firmware is still unknown.
        const buffer = Buffer.alloc(20);
        buffer.writeUInt32LE(toUInt32(options.group), 0);
        buffer.writeUInt32LE(options.valid === false ? 0 : 1, 4);
        buffer.writeUInt32LE(slots[0], 8);
        buffer.writeUInt32LE(slots[1], 12);
        buffer.writeUInt32LE(slots[2], 16);
        return buffer;
    }

    if (format === 'compact8') {
        const buffer = Buffer.alloc(8);
        buffer.writeUInt32LE(toUInt32(options.group), 0);
        buffer.writeUInt8(slots[0] & 0xFF, 4);
        buffer.writeUInt8(slots[1] & 0xFF, 5);
        buffer.writeUInt8(slots[2] & 0xFF, 6);
        const compactVerify = clamp(options.verifyStyle ?? options.verify ?? 0, 0, 0x7F);
        buffer.writeUInt8((compactVerify & 0x7F) | (options.holiday ? 0x80 : 0x00), 7);
        return buffer;
    }

    const buffer = Buffer.alloc(8);
    buffer.writeUInt8(toUInt16(options.group) & 0xFF, 0);
    buffer.writeUInt16LE(slots[0], 1);
    buffer.writeUInt16LE(slots[1], 3);
    buffer.writeUInt16LE(slots[2], 5);

    const verify = clamp(options.verifyStyle ?? options.verify ?? 0, 0, 0x7F);
    const holiday = options.holiday ? 0x80 : 0x00;
    buffer.writeUInt8((verify & 0x7F) | holiday, 7);

    return buffer;
};

module.exports.decodeGroupTimezoneInfo = (data, options = {}) => {
    const fallbackGroup = Number(options.fallbackGroup ?? 0);

    if (!Buffer.isBuffer(data) || data.length === 0) {
        return {
            group: fallbackGroup,
            timezones: [0, 0, 0],
            verifyStyle: 0,
            holiday: false,
            format: 'legacy8',
            raw: '',
            found: false,
            plausible: false
        };
    }

    const safeReadUInt16 = (buf, offset) => (buf.length >= offset + 2 ? buf.readUInt16LE(offset) : 0);
    const safeReadUInt32 = (buf, offset) => (buf.length >= offset + 4 ? buf.readUInt32LE(offset) : 0);
    const safeReadUInt8 = (buf, offset, fallback = 0) => (buf.length > offset ? buf.readUInt8(offset) : fallback);

    const requestedFormat = normalizeGroupTimezoneFormat(options.format);
    const format = requestedFormat || (data.length >= 16 ? 'compact32' : 'legacy8');
    const raw = data.toString('hex');

    if (format === 'compact32') {
        const group = safeReadUInt32(data, 0);
        const timezones = [
            safeReadUInt32(data, 4),
            safeReadUInt32(data, 8),
            safeReadUInt32(data, 12)
        ].map(normalizeTimezoneSlot);
        return {
            group,
            timezones,
            verifyStyle: 0,
            holiday: false,
            format,
            raw,
            found: true,
            plausible: isPlausibleGroupTimezoneDecode(group, timezones)
        };
    }

    if (format === 'compact20') {
        // Replies do not echo the group or holiday words: first u32 is a
        // found/valid flag, then the timezone slots as u32 words with trailing
        // zero slots omitted. Groups without a record answer just 4 zero bytes.
        const found = safeReadUInt32(data, 0) === 1;
        const timezones = [];
        if (found) {
            for (let offset = 4; offset + 4 <= data.length && timezones.length < 3; offset += 4) {
                timezones.push(safeReadUInt32(data, offset));
            }
        }
        while (timezones.length < 3) {
            timezones.push(0);
        }
        const normalized = timezones.map(normalizeTimezoneSlot);
        return {
            group: fallbackGroup,
            timezones: normalized,
            verifyStyle: 0,
            holiday: false,
            format,
            raw,
            found,
            plausible: !found || normalized.every(tz => tz >= 0 && tz <= MAX_PLAUSIBLE_TIMEZONE_INDEX)
        };
    }

    if (format === 'compact8') {
        // Replies do not echo the group: first u32 is a found/valid flag and the
        // record is 4 bytes (tz1, tz2, tz3, verify+holiday). Groups without a
        // record answer with just 4 zero bytes.
        const found = safeReadUInt32(data, 0) === 1 && data.length >= 8;
        const verifyByte = safeReadUInt8(data, 7, 0);
        const timezones = found
            ? [safeReadUInt8(data, 4), safeReadUInt8(data, 5), safeReadUInt8(data, 6)].map(normalizeTimezoneSlot)
            : [0, 0, 0];
        return {
            group: fallbackGroup,
            timezones,
            verifyStyle: found ? verifyByte & 0x7F : 0,
            holiday: found ? (verifyByte & 0x80) === 0x80 : false,
            format,
            raw,
            found,
            plausible: !found || timezones.every(tz => tz >= 0 && tz <= MAX_PLAUSIBLE_TIMEZONE_INDEX)
        };
    }

    if (format === 'uint16') {
        const group = safeReadUInt16(data, 0);
        const timezones = [
            safeReadUInt16(data, 2),
            safeReadUInt16(data, 4),
            safeReadUInt16(data, 6)
        ].map(normalizeTimezoneSlot);
        return {
            group,
            timezones,
            verifyStyle: 0,
            holiday: false,
            format,
            raw,
            found: true,
            plausible: isPlausibleGroupTimezoneDecode(group, timezones)
        };
    }

    const verifyByte = safeReadUInt8(data, 7, 0);
    const group = safeReadUInt8(data, 0, 0);
    const timezones = [
        safeReadUInt16(data, 1),
        safeReadUInt16(data, 3),
        safeReadUInt16(data, 5)
    ].map(normalizeTimezoneSlot);
    return {
        group,
        timezones,
        verifyStyle: verifyByte & 0x7F,
        holiday: (verifyByte & 0x80) === 0x80,
        format,
        raw,
        found: true,
        plausible: isPlausibleGroupTimezoneDecode(group, timezones)
    };
};

// CMD_GET_FREE_SIZES reply: 8-byte header + 20 little-endian u32 words.
// Word layout (verified against a ZEM760 fw 6.60 and matching pyzk's
// read_sizes): 4=users, 6=fingerprints, 8=attendance records, 12=cards,
// 14=fingerprint capacity, 15=user capacity, 16=record capacity,
// 17=fingerprints available, 18=users available, 19=records available.
module.exports.decodeFreeSizes = (reply) => {
    const word = (index) => {
        const offset = 8 + index * 4;
        return Buffer.isBuffer(reply) && reply.length >= offset + 4
            ? reply.readUInt32LE(offset)
            : null;
    };

    return {
        userCounts: word(4),
        logCounts: word(8),
        logCapacity: word(16),
        fingerCounts: word(6),
        cardCounts: word(12),
        userCapacity: word(15),
        fingerCapacity: word(14),
        userAvailable: word(18),
        fingerAvailable: word(17),
        logAvailable: word(19)
    };
};

module.exports.normalizeGroupTimezoneFormat = normalizeGroupTimezoneFormat;
module.exports.GROUP_TZ_FORMATS = GROUP_TZ_FORMATS;
module.exports.groupTimezoneSlots = groupTimezoneSlots;

const normalizeUnlockPayload = (data) => {
    if (!Buffer.isBuffer(data)) return Buffer.alloc(0);
    if (
        data.length >= 8 &&
        (data.readUInt16LE(0) === COMMANDS.CMD_ACK_OK || data.readUInt16LE(0) === COMMANDS.CMD_ACK_DATA)
    ) {
        return data.subarray(8);
    }
    return data;
};

const activeUnlockGroups = (groups) => groups.filter(group => group > 0);

const normalizeUnlockGroupsInput = (groups, context) => {
    if (groups === undefined || groups === null) {
        return [];
    }
    if (Array.isArray(groups)) {
        return fixedNumberArray(groups, 5, true);
    }
    if (typeof groups === 'number') {
        return fixedNumberArray([groups], 5, true);
    }
    throw new Error(`${context}: groups must be an array of group numbers`);
};

const unlockGroupFromValues = (combination, groups, validGroups, format = 'binary', raw = undefined) => {
    const fixedGroups = fixedNumberArray(groups, 5, true);
    const activeGroups = activeUnlockGroups(fixedGroups);
    const resolvedValidGroups = validGroups === undefined || validGroups === null
        ? activeGroups.length
        : toUInt16(validGroups);
    // Multi-user (AND) combinations repeat a group once per required user, so a
    // duplicated group number means "N users from that group". groupCounts makes
    // that legible: { "2": 1, "3": 2 } = 1 user from group 2, 2 from group 3.
    const groupCounts = {};
    for (const group of activeGroups) {
        groupCounts[group] = (groupCounts[group] || 0) + 1;
    }
    const result = {
        combination: toUInt16(combination) & 0xFF,
        groups: fixedGroups,
        groupCounts,
        validGroups: resolvedValidGroups,
        format
    };
    if (raw !== undefined) {
        result.raw = raw;
    }
    return result;
};

const parseUnlockAsciiToken = (token) => {
    if (!token) return [];
    // A combination with more than one group is stored as concatenated single
    // digits ("23" = groups 2 and 3), confirmed on ZEM760 fw 6.60 against a
    // ZKAccess multi-user-verification sync. Commas/spaces are tolerated for
    // backward compatibility. Consequence: unlock-combination groups must be
    // single-digit (1–9) on this ASCII form.
    const groups = [];
    for (const ch of token) {
        if (ch >= '1' && ch <= '9') groups.push(Number(ch));
    }
    return groups.slice(0, 5);
};

const looksLikeUnlockAscii = (payload) => {
    if (!payload.length) return false;
    let end = payload.indexOf(0);
    if (end === -1) end = payload.length;
    if (end === 0) return false;
    const body = payload.subarray(0, end);
    let hasColon = false;
    for (const byte of body) {
        if (byte === 0x3A) hasColon = true;
        const allowed = (byte >= 0x30 && byte <= 0x39) ||
            byte === 0x3A ||
            byte === 0x2C ||
            byte === 0x2B ||
            byte === 0x26 ||
            byte === 0x2D ||
            byte === 0x20 ||
            byte === 0x09 ||
            byte === 0x0A ||
            byte === 0x0D;
        if (!allowed) return false;
    }
    return hasColon;
};

module.exports.encodeUnlockGroupInfo = (options = {}) => {
    const buffer = Buffer.alloc(8);
    buffer.fill(0);

    const combination = options.combination ?? options.combinationNumber ?? options.combNo ?? options.index;
    if (combination === undefined || combination === null) {
        throw new Error('encodeUnlockGroupInfo: combination is required');
    }
    const combinationValue = toUInt16(combination);
    if (combinationValue < 1 || combinationValue > 10) {
        throw new Error('encodeUnlockGroupInfo: combination must be between 1 and 10');
    }

    const groups = options.groups !== undefined ? options.groups : [
        options.group1,
        options.group2,
        options.group3,
        options.group4,
        options.group5
    ];
    const fixedGroups = normalizeUnlockGroupsInput(groups, 'encodeUnlockGroupInfo');
    const validGroups = options.validGroups ?? activeUnlockGroups(fixedGroups).length;

    buffer.writeUInt8(combinationValue & 0xFF, 0);
    fixedGroups.forEach((group, index) => buffer.writeUInt8(group, 1 + index));
    buffer.writeUInt16LE(toUInt16(validGroups), 6);

    return buffer;
};

module.exports.encodeUnlockGroupsInfo = (options = {}) => {
    if (typeof options === 'string') {
        return Buffer.from(options.endsWith('\0') ? options : `${options}\0`, 'ascii');
    }

    const source = Array.isArray(options)
        ? options
        : (options.combinations ?? options.unlockGroups);
    if (!Array.isArray(source) || source.length === 0) {
        throw new Error('encodeUnlockGroupsInfo: combinations must be a non-empty array');
    }
    const slots = Array(10).fill('');

    source.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object' || Buffer.isBuffer(entry)) {
            throw new Error('encodeUnlockGroupsInfo: each combination must be an object');
        }
        const combination = entry.combination ?? entry.combinationNumber ?? entry.combNo ?? entry.index ?? (index + 1);
        const combinationValue = toUInt16(combination);
        if (combinationValue < 1 || combinationValue > 10) {
            throw new Error('encodeUnlockGroupsInfo: combination must be between 1 and 10');
        }
        const slotIndex = combinationValue - 1;
        const groups = normalizeUnlockGroupsInput(entry.groups !== undefined ? entry.groups : [
            entry.group1,
            entry.group2,
            entry.group3,
            entry.group4,
            entry.group5
        ], 'encodeUnlockGroupsInfo');
        // Concatenate single-digit group numbers to match the device format
        // ("23" = groups 2 and 3). Groups must be 1–9 (see parseUnlockAsciiToken).
        const active = activeUnlockGroups(groups);
        const outOfRange = active.find(group => group > 9);
        if (outOfRange !== undefined) {
            throw new Error(`encodeUnlockGroupsInfo: unlock-combination groups must be 1-9 (got ${outOfRange})`);
        }
        slots[slotIndex] = active.join('');
    });

    return Buffer.from(`${slots.join(':')}\0`, 'ascii');
};

module.exports.decodeUnlockGroupsInfo = (data) => {
    const payload = normalizeUnlockPayload(data);

    if (!payload.length) {
        return {
            format: 'empty',
            combinations: Array.from({ length: 10 }, (_, index) =>
                unlockGroupFromValues(index + 1, [], 0, 'empty')
            )
        };
    }

    if (looksLikeUnlockAscii(payload)) {
        const raw = payload.toString('ascii').replace(/\0+$/g, '');
        const tokens = raw.split(':');
        return {
            format: 'ascii',
            raw,
            combinations: Array.from({ length: 10 }, (_, index) =>
                unlockGroupFromValues(index + 1, parseUnlockAsciiToken(tokens[index] || ''), undefined, 'ascii', raw)
            )
        };
    }

    const chunks = [];
    let remaining = payload;
    while (remaining.length >= 8) {
        chunks.push(remaining.subarray(0, 8));
        remaining = remaining.subarray(8);
    }

    if (!chunks.length) {
        chunks.push(payload);
    }

    return {
        format: 'binary',
        combinations: chunks.map((chunk, index) => module.exports.decodeUnlockGroupInfo(chunk, index + 1))
    };
};

module.exports.decodeUnlockGroupInfo = (data, fallbackCombination = 0) => {
    const payload = normalizeUnlockPayload(data);

    if (!payload.length) {
        return unlockGroupFromValues(fallbackCombination, [], 0, 'empty');
    }

    if (looksLikeUnlockAscii(payload)) {
        const decoded = module.exports.decodeUnlockGroupsInfo(payload);
        const index = Math.max(1, Math.min(10, toUInt16(fallbackCombination, 1))) - 1;
        return decoded.combinations[index] || unlockGroupFromValues(fallbackCombination || 1, [], 0, 'ascii', decoded.raw);
    }

    const combination = payload.length >= 1 ? payload.readUInt8(0) : fallbackCombination;
    const groups = [
        payload.length >= 2 ? payload.readUInt8(1) : 0,
        payload.length >= 3 ? payload.readUInt8(2) : 0,
        payload.length >= 4 ? payload.readUInt8(3) : 0,
        payload.length >= 5 ? payload.readUInt8(4) : 0,
        payload.length >= 6 ? payload.readUInt8(5) : 0
    ];
    const validGroups = payload.length >= 8 ? payload.readUInt16LE(6) : activeUnlockGroups(groups).length;

    return unlockGroupFromValues(combination || fallbackCombination, groups, validGroups, 'binary');
};

module.exports.decodeRecordData40 = (recordData)=>{
    const record = {
        userSn: recordData.readUIntLE(0, 2),
        deviceUserId: recordData
        .slice(2, 2+9)
        .toString('ascii')
        .split('\0')
        .shift(),
        recordTime: parseTimeToDate(recordData.readUInt32LE(27)),
      }
      return record
}

module.exports.decodeRecordData16 = (recordData)=>{

    const record = {
        deviceUserId: recordData.readUIntLE(0, 2),
        recordTime: parseTimeToDate(recordData.readUInt32LE(4))
    }

    return record
}

// Stored attendance records come in three firmware-dependent sizes. All decode
// to a normalized shape: { userSn, deviceUserId, recordTime, status, punch }.
// - 40 bytes (SSR): uid(u16)@0, userId(24 ascii)@2, status(u8)@26, time(u32)@27, punch(u8)@31
// - 16 bytes (compact, e.g. ZEM760 fw 6.60): uid(u32)@0, time(u32)@4, status(u8)@8, punch(u8)@9
// - 8 bytes (legacy): uid(u16)@0, status(u8)@2, time(u32)@3, punch(u8)@7
const ATTENDANCE_RECORD_SIZES = [40, 16, 8];

// Access result encoded in attendance events (confirmed on ZEM760 fw 6.60 by
// A/B capture of the same user granted vs denied):
// - realtime frames: verif_state = 0x00 granted, 0x87 denied (bit 0x80 = denied,
//   low 7 bits = reason; 7 observed for unauthorized-group / invalid-group).
// - stored 16-byte records: status byte = 0 granted, 7 denied.
const ATTENDANCE_DENIED_BIT = 0x80;
const isRealtimeAttendanceDenied = (verifState) => (verifState & ATTENDANCE_DENIED_BIT) !== 0;

const decodeAttendanceRecord = (rec, size) => {
    if (size === 40) {
        // SSR: status is the verify method and punch the in/out state — NOT an
        // access-result flag — so `denied` is not inferred here.
        const userSn = rec.readUInt16LE(0);
        const deviceUserId = rec.subarray(2, 26).toString('ascii').split('\0').shift();
        return {
            userSn,
            deviceUserId: deviceUserId || String(userSn),
            recordTime: parseTimeToDate(rec.readUInt32LE(27)),
            status: rec.readUInt8(26),
            punch: rec.readUInt8(31),
            denied: false
        };
    }
    if (size === 8) {
        const userSn = rec.readUInt16LE(0);
        return {
            userSn,
            deviceUserId: String(userSn),
            recordTime: parseTimeToDate(rec.readUInt32LE(3)),
            status: rec.readUInt8(2),
            punch: rec.readUInt8(7),
            denied: false
        };
    }
    // 16-byte compact: status byte 0 = access granted, non-zero (7 observed) =
    // access denied. See ATTENDANCE_DENIED_BIT note above.
    const userSn = rec.readUInt32LE(0);
    const status = rec.readUInt8(8);
    return {
        userSn,
        deviceUserId: String(userSn),
        recordTime: parseTimeToDate(rec.readUInt32LE(4)),
        status,
        punch: rec.readUInt8(9),
        denied: status !== 0
    };
};

const scoreAttendanceRecord = (record) => {
    let score = 0;
    const year = record.recordTime instanceof Date ? record.recordTime.getFullYear() : NaN;
    if (year >= 2000 && year <= 2099) score += 2;
    if (Number.isInteger(record.userSn) && record.userSn > 0 && record.userSn <= 0xFFFFFF) score += 1;
    return score;
};

// Auto-detects the record size (multiple sizes can divide the buffer evenly, so
// candidates are scored by how many records decode to a plausible date/uid) and
// returns { recordSize, records }.
module.exports.decodeAttendanceData = (body) => {
    if (!Buffer.isBuffer(body) || body.length === 0) {
        return { recordSize: 0, records: [] };
    }

    const candidates = ATTENDANCE_RECORD_SIZES
        .filter(size => body.length >= size && body.length % size === 0)
        .map(size => {
            const records = [];
            for (let offset = 0; offset + size <= body.length; offset += size) {
                records.push(decodeAttendanceRecord(body.subarray(offset, offset + size), size));
            }
            const total = records.reduce((sum, record) => sum + scoreAttendanceRecord(record), 0);
            return { recordSize: size, records, score: records.length ? total / records.length : 0 };
        });

    if (!candidates.length) {
        return { recordSize: 0, records: [] };
    }

    candidates.sort((left, right) => (right.score - left.score) || (right.recordSize - left.recordSize));
    return { recordSize: candidates[0].recordSize, records: candidates[0].records };
};

module.exports.decodeRecordRealTimeLog18 = (recordData)=>{
    const userId = recordData.readUIntLE(8,1)
    const attTime = parseHexToTime(recordData.subarray(12,18))
    return {userId , attTime}
}

const processAlarmLog = (buf) => {

  let json = {};

  let bufAsArray = buf.toString("hex").match(/(..?)/g);

  let alarm_type = "";

  switch(bufAsArray[8]){
    case "35": alarm_type = "exit_button";break;
    case "36": alarm_type = "door_state"; break;
    case "37": alarm_type = "tamper";break;
    case "3a": alarm_type = "misoperation";break;
    default: alarm_type = "unknown (0x"+bufAsArray[8]+")";
  }

  json.alarm_type = alarm_type;

  let alarm_event = "";

  if(buf.byteLength === 16){

    switch(bufAsArray[12]){
      case "01": alarm_event = "door_left_open";break;
      case "04": alarm_event = "door_not_closed"; break;
      case "05": alarm_event = "door_closed";break;
      default: alarm_event = "unknown (0x"+bufAsArray[12]+")";
    }

    json.alarm_event = alarm_event;

  }

  

  return json;

}


const processFingerprintVerifyEvent = (buf) => {
  const invalidUserIdBuf = Buffer.from([0xff, 0xff,0xff, 0xff]); //this indicates that the operation failed (wrong user)
  if(!buf.includes(invalidUserIdBuf)) {

    //the verification succeeded...extract the user serial number and return the object
    return {
      user_sn: buf.readUIntLE(8, 4)
    };
  }else{
    //return empty object indicating that this was an invalid attempt
    return {};
  }

}

const processAttendanceLog = (buf) => {

  let json = {};

  json.user_sn = buf.readUIntLE(8, 2);

  json.verif_type = buf.readUIntLE(10, 1);

  json.verif_state = buf.readUIntLE(11, 1);
  json.denied = isRealtimeAttendanceDenied(json.verif_state);

  const att_year = buf.readUIntLE(12, 1);
  const att_month = buf.readUIntLE(13, 1);
  const att_date = buf.readUIntLE(14, 1);
  const att_hour = buf.readUIntLE(15, 1);
  const att_min = buf.readUIntLE(16, 1);
  const att_sec = buf.readUIntLE(17, 1);

  json.att_date = new Date((2000+att_year),(att_month-1),att_date,att_hour,att_min,att_sec);

  return json;

}



module.exports.decodeRealTimeEvent = (evData)=>{
  const eventType = evData.readUIntLE(4,2);
  let json = null;

  switch(eventType){
    case 128: json = processFingerprintVerifyEvent(evData); break;
    case 1: json = processAttendanceLog(evData); break;
    case 512: json = processAlarmLog(evData);  break;
    default : json = {}; json.event_type = eventType; json.full_data = evData;
  }

  json.event_type = eventType;
  //const attTime = parseHexToTime(recordData.subarray(12,18))
  return json;
  //return {userId , attTime}
}

module.exports.decodeRecordRealTimeLog52 =(recordData)=>{
  const payload = removeTcpHeader(recordData)
        
  const recvData = payload.subarray(8)

  const userId = recvData.slice(0 , 9)
  .toString('ascii')
  .split('\0')
  .shift()
  

  const attTime = parseHexToTime(recvData.subarray(26,26+6))

  const event = {
    userId,
    attTime,
    event_type: COMMANDS.EF_ATTLOG,
    att_date: attTime
  }

  if (recvData.length >= 26) {
    event.verif_type = recvData.readUInt16LE(24)
  }

  if (/^\d+$/.test(userId)) {
    event.user_sn = Number(userId)
  }

  return event

}

module.exports.decodeCompactTCPRealTimeAttendance = (recordData) => {
  const payload = removeTcpHeader(recordData)
  const recvData = payload.subarray(8)

  if (recvData.length < 12) {
    throw new Error(`compact realtime attendance frame too short: ${recvData.length}`)
  }

  const attTime = parseHexToTime(recvData.subarray(6, 12))
  const userSn = recvData.readUInt32LE(0)

  const verifState = recvData.readUInt8(5)
  const event = {
    user_sn: userSn,
    userId: String(userSn),
    verif_type: recvData.readUInt8(4),
    verif_state: verifState,
    denied: isRealtimeAttendanceDenied(verifState),
    attTime,
    att_date: attTime,
    event_type: COMMANDS.EF_ATTLOG
  }

  return event
}

const classifyTCPRealTimeEvent = (data) => {
  try {
    const payload = removeTcpHeader(data)
    if (!Buffer.isBuffer(payload) || payload.length < 6) {
      return { isRealtime: false, commandId: null, eventType: null }
    }

    const commandId = payload.readUIntLE(0, 2)
    const eventType = payload.readUIntLE(4, 2)

    return {
      isRealtime: commandId === COMMANDS.CMD_REG_EVENT,
      commandId,
      eventType
    }
  } catch (err) {
    log(`[228] : ${err.toString()} ,${data.toString('hex')} `)
    return { isRealtime: false, commandId: null, eventType: null, error: err }
  }
}

module.exports.classifyTCPRealTimeEvent = classifyTCPRealTimeEvent

module.exports.decodeTCPRealTimeEvent = (recordData) => {
  const classification = classifyTCPRealTimeEvent(recordData)
  const payload = removeTcpHeader(recordData)

  if (!classification.isRealtime) {
    return {
      event_type: classification.eventType,
      full_data: recordData
    }
  }

  try {
    switch (classification.eventType) {
      case COMMANDS.EF_ATTLOG:
        if (payload.length >= 20 && payload.length < 40) {
          return module.exports.decodeCompactTCPRealTimeAttendance(recordData)
        }
        return module.exports.decodeRecordRealTimeLog52(recordData)
      case COMMANDS.EF_VERIFY:
      case COMMANDS.EF_ALARM:
        return module.exports.decodeRealTimeEvent(payload)
      default:
        return {
          event_type: classification.eventType,
          full_data: recordData
        }
    }
  } catch (err) {
    return {
      event_type: classification.eventType,
      full_data: recordData,
      decode_error: err && err.message ? err.message : String(err)
    }
  }
}

module.exports.decodeUDPHeader = (header)=> {
    const commandId = header.readUIntLE(0,2)
    const checkSum = header.readUIntLE(2,2)
    const sessionId = header.readUIntLE(4,2)
    const replyId = header.readUIntLE(6,2)
    return { commandId , checkSum , sessionId , replyId }
}
module.exports.decodeTCPHeader = (header) => {
    const recvData = header.subarray(8)
    const payloadSize = header.readUIntLE(4,2)

    const commandId = recvData.readUIntLE(0,2)
    const checkSum = recvData.readUIntLE(2,2)
    const sessionId = recvData.readUIntLE(4,2)
    const replyId = recvData.readUIntLE(6,2)
    return { commandId , checkSum , sessionId , replyId , payloadSize }

}


module.exports.exportErrorMessage = (commandValue)=>{
    const keys = Object.keys(COMMANDS)
    for(let i =0 ; i< keys.length; i++){
        if (COMMANDS[keys[i]] === commandValue){
            return keys[i].toString()
        }
    }

    return 'AN UNKNOWN ERROR'
}

module.exports.checkNotEventTCP = (data)=> {
  return classifyTCPRealTimeEvent(data).isRealtime
}

module.exports.checkNotEventUDP = (data)=>{
  const commandId = this.decodeUDPHeader(data.subarray(0,8)).commandId
  return commandId === COMMANDS.CMD_REG_EVENT
}

module.exports.makeCommKey = (key, sessionId, ticks = AUTH.COMM_KEY_TICKS) => {
  key = Math.floor(key);
  sessionId = Math.floor(sessionId);

  let k = 0;
  for (let i = 0; i < 32; i++) {
    if (key & (1 << i)) {
      k = (k << 1) | 1;
    } else {
      k = k << 1;
    }
  }
  k += sessionId;

  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, k, true);
  let bytes = new Uint8Array(buffer);

  const xorKey = AUTH.COMM_KEY_XOR.map(c => c.charCodeAt(0));
  bytes = bytes.map((b, i) => b ^ xorKey[i]);

  const swapped = new Uint8Array([bytes[2], bytes[3], bytes[0], bytes[1]]);

  const B = ticks & 0xff;
  return Buffer.from([
    swapped[0] ^ B,
    swapped[1] ^ B,
    B,
    swapped[3] ^ B,
  ]);
}
