export const DEFAULT_RESET_TIME = '00:00';
export const DEVICE_TIME_ZONE = 'device';

export function getDeviceTimeZone() {
    return Temporal.Now.timeZoneId();
}

export function isValidTimeZone(timeZone) {
    if (timeZone === DEVICE_TIME_ZONE) {
        return true;
    }

    try {
        Temporal.Now.instant().toZonedDateTimeISO(timeZone);
        return true;
    } catch {
        return false;
    }
}

export function isValidResetTime(resetTime) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(resetTime)) {
        return false;
    }

    try {
        Temporal.PlainTime.from(resetTime);
        return true;
    } catch {
        return false;
    }
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

function toInstant(now) {
    return now instanceof Temporal.Instant ? now : Temporal.Instant.from(now);
}

export function getPuzzleDay(now = Temporal.Now.instant(), settings = {}) {
    const { resetTime, timeZone } = normalizeResetSettings(settings);
    const localDateTime = toInstant(now).toZonedDateTimeISO(resolveTimeZone(timeZone)).toPlainDateTime();
    const reset = Temporal.PlainTime.from(resetTime);
    const date = localDateTime.toPlainDate();

    return (Temporal.PlainTime.compare(localDateTime.toPlainTime(), reset) < 0
        ? date.subtract({ days: 1 })
        : date).toString();
}

export function getNextResetInstant(now = Temporal.Now.instant(), settings = {}) {
    const { resetTime, timeZone } = normalizeResetSettings(settings);
    const resolvedTimeZone = resolveTimeZone(timeZone);
    const localNow = toInstant(now).toZonedDateTimeISO(resolvedTimeZone);
    const reset = Temporal.PlainTime.from(resetTime);
    const nextDate = Temporal.PlainTime.compare(localNow.toPlainTime(), reset) < 0
        ? localNow.toPlainDate()
        : localNow.toPlainDate().add({ days: 1 });

    return nextDate.toPlainDateTime(reset).toZonedDateTime(resolvedTimeZone).toInstant();
}
