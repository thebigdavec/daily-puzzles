import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dashboard } from './helpers/dashboard.js';
import * as schedule from '../reset-schedule.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function setup() {
    const app = dashboard();
    app.context.loadData();
    return {
        fields: app.fields,
        save: app.context.window.saveSettings,
        getState: app.state,
        getSaved: () => JSON.parse(app.storage.value),
        failStorage: (value = true) => { app.storage.failWrite = value; },
        getWrites: () => app.storage.writes
    };
}

test('both settings save on change and feedback is announced without a save button', async () => {
    for (const id of ['reset-time', 'reset-time-zone']) {
        assert.match(html, new RegExp(`id="${id}"[^>]*onchange="saveSettings\\(\\)"`));
    }
    assert.match(html, /id="settings-save-status"[^>]*role="status"/);
    assert.doesNotMatch(html, />Save settings</);
    const app = setup();
    await app.save();
    assert.equal(app.getSaved().resetTime, '04:00');
    assert.equal(app.getSaved().timeZone, 'Europe/London');
    assert.deepEqual(app.getSaved().playedIds, ['wordle']);
    assert.match(app.fields['settings-save-status'].textContent, /Settings saved.*04:00/);
    app.fields['reset-time-zone'].value = 'America/New_York';
    await app.save();
    assert.equal(app.getSaved().timeZone, 'America/New_York');
    assert.match(app.fields['settings-save-status'].textContent, /Settings saved.*America\/New_York/);
});

test('a changed puzzle day clears progress and persists the new day together', async () => {
    const app = setup();
    app.getState().lastResetDate = '2000-01-01';
    await app.save();
    assert.deepEqual(app.getSaved().playedIds, []);
    assert.equal(app.getSaved().lastResetDate, schedule.getPuzzleDay(undefined, app.getSaved()));
});

test('invalid time keeps the saved settings and progress intact', async () => {
    const app = setup();
    const previous = JSON.stringify(app.getState());
    app.fields['reset-time'].reportValidity = () => false;
    await app.save();
    assert.equal(app.getWrites(), 0);
    assert.equal(JSON.stringify(app.getState()), previous);
    assert.match(app.fields['settings-save-status'].textContent, /have not been saved/);
});

test('storage failure rolls back settings and progress and allows retry', async () => {
    const app = setup();
    await app.save();
    const previous = JSON.stringify(app.getState());
    app.failStorage();
    app.fields['reset-time'].value = '09:00';
    await app.save();
    assert.equal(JSON.stringify(app.getState()), previous);
    assert.equal(app.getSaved().resetTime, '04:00');
    assert.match(app.fields['settings-save-status'].textContent, /Could not save changes/);
    app.failStorage(false);
    await app.save();
    assert.equal(app.getSaved().resetTime, '09:00');
    assert.match(app.fields['settings-save-status'].textContent, /Settings saved/);
});

test('saved zones remain selected and survive time changes with full and fallback zone lists', async () => {
    for (const supportedValuesOf of [() => ['Europe/London'], undefined]) {
        for (const timeZone of ['UTC', 'US/Eastern', 'Europe/London', 'device']) {
            const app = dashboard();
            app.context.loadData();
            app.state().timeZone = timeZone;
            app.context.Intl = { DateTimeFormat: Intl.DateTimeFormat, supportedValuesOf };
            app.context.Option = function(text, value) { return { text, value }; };
            const options = [];
            const select = {
                replaceChildren() { options.length = 0; },
                add(option) { options.push(option); },
                set value(value) { this.selected = options.find(option => option.value === value)?.value || ''; },
                get value() { return this.selected; }
            };
            app.fields['reset-time-zone'] = select;
            app.context.populateSettings();
            assert.equal(select.value, timeZone);
            assert.equal(options.filter(option => option.value === timeZone).length, 1);
            app.fields['reset-time'].value = '09:00';
            await app.context.saveSettings();
            assert.equal(JSON.parse(app.storage.value).timeZone, timeZone);
            assert.equal(JSON.parse(app.storage.value).resetTime, '09:00');
        }
    }
});
