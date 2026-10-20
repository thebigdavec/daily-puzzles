import {
    DEVICE_TIME_ZONE,
    getNextResetInstant,
    getPuzzleDay,
    normalizeResetSettings
} from '../reset-schedule.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, received ${actual}`);
    }
}

function assertDeepEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    }
}

function testUsesPriorDateBeforeResetTime() {
    const settings = { timeZone: 'America/New_York', resetTime: '04:00' };

    assertEqual(getPuzzleDay('2026-07-24T07:59:00Z', settings), '2026-07-23', 'Before reset');
    assertEqual(getPuzzleDay('2026-07-24T08:00:00Z', settings), '2026-07-24', 'At reset');
}

function testUsesDistantTimeZones() {
    const now = '2026-07-24T15:00:00Z';

    assertEqual(getPuzzleDay(now, { timeZone: 'Pacific/Auckland', resetTime: '00:00' }), '2026-07-25', 'Auckland date');
    assertEqual(getPuzzleDay(now, { timeZone: 'America/Los_Angeles', resetTime: '00:00' }), '2026-07-24', 'Los Angeles date');
}

function testUsesCivilTimeAcrossDaylightSaving() {
    const settings = { timeZone: 'Europe/London', resetTime: '04:00' };

    assertEqual(getPuzzleDay('2026-03-29T02:30:00Z', settings), '2026-03-28', 'Before BST reset');
    assertEqual(getPuzzleDay('2026-03-29T03:00:00Z', settings), '2026-03-29', 'At BST reset');
    assertEqual(getNextResetInstant('2026-03-29T00:00:00Z', settings).toISOString(), '2026-03-29T03:00:00.000Z', 'BST reset instant');
}

function testUsesFirstOccurrenceWhenClocksGoBack() {
    const settings = { timeZone: 'Europe/London', resetTime: '01:30' };

    assertEqual(
        getNextResetInstant('2026-10-25T00:00:00Z', settings).toISOString(),
        '2026-10-25T00:30:00.000Z',
        'First reset instant when clocks go back'
    );
}

function testDefaultsInvalidSettings() {
    assertDeepEqual(normalizeResetSettings(), {
        resetTime: '00:00',
        timeZone: DEVICE_TIME_ZONE
    }, 'Missing settings');
    assertDeepEqual(normalizeResetSettings({ resetTime: '25:99', timeZone: 'Not/AZone' }), {
        resetTime: '00:00',
        timeZone: DEVICE_TIME_ZONE
    }, 'Invalid settings');
}

function testRepeatedHourKeepsPuzzleDay() {
    const settings = { timeZone: 'Europe/London', resetTime: '01:30' };
    assertEqual(getPuzzleDay('2026-10-25T00:29:59Z', settings), '2026-10-24', 'Before first reset');
    for (const now of ['2026-10-25T00:30:00Z', '2026-10-25T00:45:00Z', '2026-10-25T01:00:00Z', '2026-10-25T01:10:00Z', '2026-10-25T01:30:00Z']) {
        assertEqual(getPuzzleDay(now, settings), '2026-10-25', 'Puzzle day stays forward through repeated hour');
        assertEqual(getNextResetInstant(now, settings).toISOString(), '2026-10-26T01:30:00.000Z', 'Next reset is tomorrow');
    }
}

function testSkippedHourUsesOneBoundary() {
    const settings = { timeZone: 'Europe/London', resetTime: '01:30' };
    assertEqual(getPuzzleDay('2026-03-29T01:00:00Z', settings), '2026-03-28', 'Before shifted reset');
    assertEqual(getNextResetInstant('2026-03-29T01:00:00Z', settings).toISOString(), '2026-03-29T01:30:00.000Z', 'Missing time shifts forward');
    assertEqual(getPuzzleDay('2026-03-29T01:30:00Z', settings), '2026-03-29', 'At shifted reset');
    assertEqual(getNextResetInstant('2026-03-29T01:30:00Z', settings).toISOString(), '2026-03-30T00:30:00.000Z', 'Next reset is tomorrow');
}

const tests = [
    ['uses the prior calendar date before a configured reset time', testUsesPriorDateBeforeResetTime],
    ['calculates puzzle days independently in distant time zones', testUsesDistantTimeZones],
    ['uses civil time across the UK daylight-saving transition', testUsesCivilTimeAcrossDaylightSaving],
    ['uses the first occurrence when clocks go back', testUsesFirstOccurrenceWhenClocksGoBack],
    ['defaults invalid or legacy settings to midnight in the device timezone', testDefaultsInvalidSettings],
    ['keeps the puzzle day and next reset consistent through the repeated hour', testRepeatedHourKeepsPuzzleDay],
    ['uses the same boundary for a reset in the skipped spring hour', testSkippedHourUsesOneBoundary]
];

export function runResetScheduleTests() {
    tests.forEach(([name, run]) => {
        run();
        console.info(`Passed: ${name}`);
    });
}
