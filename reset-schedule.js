export const DEFAULT_RESET_TIME = '00:00';
export const DEVICE_TIME_ZONE = 'device';

function getDateParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);

    return Object.fromEntries(parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]));
}

function getTimeZoneOffsetMilliseconds(date, timeZone) {
    const parts = getDateParts(date, timeZone);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
}

function toDate(now) {
    if (now === undefined) {
        return new Date();
    }

    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) {
        throw new RangeError('Invalid date');
    }
    return date;
}

function getResetTimeParts(resetTime) {
    const [hour, minute] = resetTime.split(':').map(Number);
    return { hour, minute };
}

function getZonedDateTime(year, month, day, hour, minute, timeZone) {
    // Convert a civil time in the chosen zone to an instant. Checking the
    // offsets on either side of the target handles daylight-saving changes:
    // during the autumn fallback, choose the first matching local time.
    const localTimestamp = Date.UTC(year, month - 1, day, hour, minute);
    const offsets = [...new Set([
        -36 * 60 * 60 * 1000,
        0,
        36 * 60 * 60 * 1000
    ].map((offset) => getTimeZoneOffsetMilliseconds(new Date(localTimestamp + offset), timeZone)))];
    const candidates = offsets.map((offset) => new Date(localTimestamp - offset));
    const matchingCandidates = candidates.filter((candidate) => {
        const parts = getDateParts(candidate, timeZone);
        return parts.year === year
            && parts.month === month
            && parts.day === day
            && parts.hour === hour
            && parts.minute === minute;
    });

    if (matchingCandidates.length) {
        return new Date(Math.min(...matchingCandidates.map((candidate) => candidate.getTime())));
    }

    // A skipped spring-forward time has no exact match. Use the first local
    // time after it, which matches the browser's compatible disambiguation.
    return candidates
        .filter((candidate) => {
            const parts = getDateParts(candidate, timeZone);
            return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) >= localTimestamp;
        })
        .sort((first, second) => first.getTime() - second.getTime())[0];
}

export function getDeviceTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function isValidTimeZone(timeZone) {
    if (timeZone === DEVICE_TIME_ZONE) {
        return true;
    }

    try {
        new Intl.DateTimeFormat(undefined, { timeZone }).format();
        return true;
    } catch {
        return false;
    }
}

export function isValidResetTime(resetTime) {
    return typeof resetTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(resetTime);
}

export function normalizeResetSettings(settings = {}) {
    return {
        resetTime: isValidResetTime(settings.resetTime) ? settings.resetTime : DEFAULT_RESET_TIME,
        timeZone: isValidTimeZone(settings.timeZone) ? settings.timeZone : DEVICE_TIME_ZONE
    };
}

export function resolveTimeZone(timeZone) {
    return timeZone === DEVICE_TIME_ZONE ? getDeviceTimeZone() : timeZone;
}

export function getPuzzleDay(now, settings = {}) {
    const { resetTime, timeZone } = normalizeResetSettings(settings);
    const local = getDateParts(toDate(now), resolveTimeZone(timeZone));
    const reset = getResetTimeParts(resetTime);
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day));

    if (local.hour < reset.hour || (local.hour === reset.hour && local.minute < reset.minute)) {
        date.setUTCDate(date.getUTCDate() - 1);
    }

    return date.toISOString().slice(0, 10);
}

export function getNextResetInstant(now, settings = {}) {
    const { resetTime, timeZone } = normalizeResetSettings(settings);
    const resolvedTimeZone = resolveTimeZone(timeZone);
    const local = getDateParts(toDate(now), resolvedTimeZone);
    const reset = getResetTimeParts(resetTime);
    const nextDate = new Date(Date.UTC(local.year, local.month - 1, local.day));

    if (local.hour > reset.hour || (local.hour === reset.hour && local.minute >= reset.minute)) {
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    }

    return getZonedDateTime(
        nextDate.getUTCFullYear(),
        nextDate.getUTCMonth() + 1,
        nextDate.getUTCDate(),
        reset.hour,
        reset.minute,
        resolvedTimeZone
    );
}
