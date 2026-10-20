import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dashboard, makeLocks, makeStorage } from './helpers/dashboard.js';

const custom = { id: 'custom', name: 'My puzzle', url: 'https://example.com/puzzle' };

test('loading valid data never writes it back, even when writes are blocked', () => {
    const storage = makeStorage();
    const saved = JSON.parse(storage.value);
    saved.games = [custom];
    storage.value = JSON.stringify(saved);
    storage.failWrite = true;
    const app = dashboard(storage);
    assert.equal(app.context.loadData(), true);
    assert.equal(app.state().games[0].id, 'custom');
    assert.equal(storage.writes, 0);
    assert.equal(JSON.parse(storage.value).games[0].id, 'custom');
});

test('read failures and corrupt JSON preserve the stored bytes', () => {
    for (const value of ['{broken', 'null']) {
        const storage = makeStorage(value);
        const app = dashboard(storage);
        assert.equal(app.context.loadData(), false);
        assert.equal(storage.value, value);
        assert.equal(storage.writes, 0);
        assert.match(app.fields['storage-status'].textContent, /Existing browser data has been kept/);
    }
    const storage = makeStorage();
    storage.failRead = true;
    assert.equal(dashboard(storage).context.loadData(), false);
    assert.equal(storage.writes, 0);
});

test('failed writes keep saved puzzles and roll back the unsaved change', async () => {
    const app = dashboard();
    app.context.loadData();
    const before = app.storage.value;
    app.storage.failWrite = true;
    app.state().games.push(custom);
    assert.equal(await app.context.saveData(), false);
    assert.equal(app.storage.value, before);
    assert.equal(app.state().games.length, 1);
    assert.match(app.fields['storage-status'].textContent, /last saved data has been kept/);
});

test('stale tabs cannot overwrite a newer list and can retry after refreshing', async () => {
    const storage = makeStorage();
    const locks = makeLocks();
    const a = dashboard(storage, locks);
    const b = dashboard(storage, locks);
    a.context.loadData();
    b.context.loadData();
    a.state().games.push(custom);
    assert.equal(await a.context.saveData(), true);
    b.state().playedIds = [];
    assert.equal(await b.context.saveData(), false);
    assert.equal(JSON.parse(storage.value).games.length, 2);
    assert.equal(b.state().games.length, 2);
    assert.match(b.fields['storage-status'].textContent, /Another tab changed/);
    b.state().playedIds = [];
    assert.equal(await b.context.saveData(), true);
    assert.deepEqual(JSON.parse(storage.value).playedIds, []);
    assert.equal(JSON.parse(storage.value).games.length, 2);
});

test('simultaneous saves are locked: one commits and the stale one is refused', async () => {
    const storage = makeStorage();
    const locks = makeLocks();
    const a = dashboard(storage, locks);
    const b = dashboard(storage, locks);
    a.context.loadData();
    b.context.loadData();
    a.state().games.push(custom);
    b.state().playedIds = [];
    const result = await Promise.all([a.context.saveData(), b.context.saveData()]);
    assert.deepEqual(result, [true, false]);
    assert.equal(JSON.parse(storage.value).games.length, 2);
    assert.deepEqual(JSON.parse(storage.value).playedIds, ['wordle']);
});

test('storage events refresh another tab without writing the list back', async () => {
    const app = dashboard();
    await app.context.init();
    const next = JSON.parse(app.storage.value);
    next.games.push(custom);
    app.storage.value = JSON.stringify(next);
    await app.events.storage({ key: 'puzzle_dashboard_v3', storageArea: app.storage });
    assert.equal(app.state().games.length, 2);
    assert.equal(app.storage.writes, 0);
});

test('quick successive changes in one tab both save without a false conflict', async () => {
    const app = dashboard();
    app.context.loadData();
    app.state().resetTime = '04:00';
    const first = app.context.saveData();
    app.state().timeZone = 'Europe/London';
    const second = app.context.saveData();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    const saved = JSON.parse(app.storage.value);
    assert.equal(saved.resetTime, '04:00');
    assert.equal(saved.timeZone, 'Europe/London');
});

test('a different tab writing between two local saves still causes a conflict', async () => {
    const storage = makeStorage();
    const locks = makeLocks();
    const app = dashboard(storage, locks);
    app.context.loadData();
    app.state().resetTime = '04:00';
    const first = app.context.saveData();
    const external = locks.request('puzzle_dashboard_v3', () => {
        const next = JSON.parse(storage.value);
        next.games.push(custom);
        storage.value = JSON.stringify(next);
    });
    app.state().timeZone = 'Europe/London';
    const second = app.context.saveData();
    const results = await Promise.all([first, external, second]);
    assert.equal(results[0], true);
    assert.equal(results[2], false);
    assert.equal(JSON.parse(storage.value).games.length, 2);
});

test('deleting the final puzzle leaves an empty list after reload and restores once', async () => {
    const app = dashboard();
    app.context.loadData();
    await app.context.removeGameById('wordle');
    assert.equal(app.state().games.length, 0);
    assert.equal(app.state().removedGames.length, 1);
    app.context.loadData();
    assert.equal(app.state().games.length, 0);
    await app.context.restoreRemovedGame({ stopPropagation() {} }, 'wordle');
    await app.context.restoreRemovedGame({ stopPropagation() {} }, 'wordle');
    assert.equal(app.state().games.length, 1);
    assert.equal(app.state().removedGames.length, 0);
});

test('permanent deletion of the final puzzle stays empty; defaults remain explicit', async () => {
    const app = dashboard();
    app.context.loadData();
    app.context.window.selectGame('wordle');
    await app.context.removePuzzleImmediately();
    app.context.loadData();
    assert.equal(app.state().games.length, 0);
    app.context.window.confirm = () => false;
    await app.context.restoreDefaultGames();
    assert.equal(app.state().games.length, 0);
    app.context.window.confirm = () => true;
    await app.context.restoreDefaultGames();
    assert.equal(app.state().games.length, 10);
});

test('restoring a puzzle already active does not create a duplicate ID', async () => {
    const app = dashboard();
    app.context.loadData();
    app.state().removedGames.push({ ...app.state().games[0], removedAt: Date.now() });
    await app.context.restoreRemovedGame({ stopPropagation() {} }, 'wordle');
    assert.equal(app.state().games.length, 1);
    assert.equal(app.state().removedGames.length, 0);
});

test('distant mute dates wait at most one day and return when the date arrives', async () => {
    const app = dashboard();
    app.context.loadData();
    app.state().games[0].mutedUntil = Date.now() + 30 * 86400000;
    app.context.scheduleMutedGamesRefresh();
    assert.equal(app.timers.at(-1).delay, 86400000);
    app.state().games[0].mutedUntil = Date.now() - 1;
    await app.timers.at(-1).run();
    assert.equal(app.state().games[0].mutedUntil, null);
    assert.equal(JSON.parse(app.storage.value).games[0].mutedUntil, null);
});

test('native puzzle links retain navigation and record play; drag clicks do neither', async () => {
    const app = dashboard();
    app.context.loadData();
    app.state().playedIds = [];
    let prevented = false;
    let opened = 0;
    let marked = false;
    app.context.window.open = () => { opened++; };
    const event = {
        target: { closest: (selector) => selector === 'a' ? {} : null },
        currentTarget: { classList: { add: () => { marked = true; } } },
        preventDefault: () => { prevented = true; }
    };
    await app.context.handleCardClick(event, 'wordle', 'https://www.nytimes.com/games/wordle');
    assert.equal(prevented, false);
    assert.equal(opened, 0);
    assert.equal(marked, true);
    assert.deepEqual(JSON.parse(app.storage.value).playedIds, ['wordle']);
    app.context.window.setDragging(true);
    await app.context.handleCardClick(event, 'wordle', 'https://www.nytimes.com/games/wordle');
    assert.equal(prevented, true);
    assert.equal(opened, 0);
});

test('empty-list backups round-trip; invalid backups never replace the saved list', async () => {
    for (const backup of [
        { version: 1, games: [] },
        { version: 99, games: [] },
        { version: 1, games: [{ id: 'invalid' }] },
        null
    ]) {
        const app = dashboard();
        app.context.loadData();
        const previous = app.storage.value;
        let finished;
        let errors = 0;
        app.context.alert = () => { errors++; };
        app.context.FileReader = class {
            readAsText() {
                this.result = JSON.stringify(backup);
                finished = this.onload();
            }
        };
        app.context.handleImportFileChange({ target: { files: [{ size: 100 }] } });
        await finished;
        if (backup?.version === 1 && backup.games.length === 0) {
            assert.equal(app.state().games.length, 0);
            app.context.loadData();
            assert.equal(app.state().games.length, 0);
            assert.equal(errors, 0);
        } else {
            assert.equal(app.storage.value, previous);
            assert.equal(errors, 1);
        }
    }
});
