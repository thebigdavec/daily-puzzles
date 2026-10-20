import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_GAMES } from '../library-games.js';
import { dashboard, makeLocks, makeStorage } from './helpers/dashboard.js';

const custom = { id: 'custom', name: 'My puzzle', url: 'https://example.com/puzzle' };

test('drag reordering shares mouse/touch animation and respects reduced motion', async () => {
    for (const reducedMotion of [false, true]) {
        const app = dashboard();
        let options;
        app.context.window.matchMedia = () => ({ matches: reducedMotion });
        app.context.Sortable = app.context.window.Sortable = {
            create(list, settings) {
                assert.equal(list, app.fields['game-list']);
                options = settings;
            }
        };
        await app.context.init();
        assert.equal(options.animation, reducedMotion ? 0 : 250);
        assert.equal(options.easing, 'cubic-bezier(0.2, 0.8, 0.2, 1)');
        assert.equal(options.forceFallback, true);
        assert.equal(options.fallbackOnBody, true);
        assert.equal(options.handle, '.drag-handle');
    }
});

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
    assert.equal(app.state().games.length, DEFAULT_GAMES.length);
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
        currentTarget: {
            classList: { toggle: (name, value) => { marked = value; } },
            querySelector: () => ({ setAttribute() {}, removeAttribute() {} })
        },
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
    app.context.window.setDragging(false);
    app.state().playedIds = [];
    event.target.closest = selector => selector.includes('.drag-handle') ? {} : null;
    await app.context.handleCardClick(event, 'wordle', 'https://www.nytimes.com/games/wordle');
    assert.equal(app.state().playedIds.length, 0);
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

test('a user adds a puzzle with only a name and link, without a library entry or default position', async () => {
    const app = dashboard();
    app.context.loadData();
    app.context.document.getElementById('new-game-name').value = 'My local puzzle';
    app.context.document.getElementById('new-game-url').value = 'https://example.com/my-puzzle';
    await app.context.addNewGame();
    app.context.loadData();
    assert.equal(app.state().games.length, 2);
    const added = app.state().games[1];
    assert.equal(added.name, 'My local puzzle');
    assert.equal(added.url, 'https://example.com/my-puzzle');
    assert.match(added.id, /^custom-/);
    assert.equal(added.defaultOrder, undefined);
});

test('active and muted menus share actions while keeping reset, mute and unmute distinct', () => {
    const app = dashboard();
    const custom = { id: 'custom', name: 'Custom puzzle', url: 'https://example.com/custom' };
    const actions = (game, played) => [...app.context.getPuzzleActionMenuItems(game, played)
        .matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(actions(custom, false), ['edit', 'copy', 'share', 'suggest', 'mute', 'remove']);
    assert.deepEqual(actions(custom, true), ['reset', 'edit', 'copy', 'share', 'suggest', 'mute', 'remove']);
    assert.deepEqual(actions({ ...custom, mutedUntil: Date.now() + 86400000 }, true),
        ['edit', 'copy', 'share', 'suggest', 'resume', 'remove']);
    const wordle = { id: 'wordle', url: 'https://www.nytimes.com/games/wordle' };
    assert.ok(!actions(wordle, false).includes('suggest'));
    assert.ok(!actions({ ...wordle, mutedUntil: Date.now() + 86400000 }, false).includes('suggest'));
});

test('native popover bindings keep their invoker and dispatch actions without rendering', () => {
    const app = dashboard();
    const trigger = { attributes: {}, listeners: {}, addEventListener(name, run) { this.listeners[name] = run; }, setAttribute(name, value) { this.attributes[name] = value; } };
    const menu = { listeners: {}, addEventListener(name, run) { this.listeners[name] = run; } };
    const container = { querySelector: (selector) => selector === '.more-actions-btn' ? trigger : menu };
    const calls = [];
    app.context.openPuzzleAction = (event, id, action) => calls.push({ id, action });
    app.context.render = () => { throw new Error('Opening or closing a popover must not rebuild the dashboard'); };
    app.context.bindPuzzleActionMenu(container, { id: 'muted', name: 'Muted puzzle' });
    assert.equal(trigger.attributes.popovertarget, menu.id);
    menu.listeners.toggle({ newState: 'closed' });
    assert.equal(trigger.attributes['aria-expanded'], 'false');
    menu.listeners.click({ stopPropagation() {}, target: { closest: () => ({ dataset: { action: 'resume' } }) } });
    assert.deepEqual(calls, [{ id: 'muted', action: 'resume' }]);
});

test('the shared action dispatcher routes Unmute to resume rather than a dialog', () => {
    const app = dashboard();
    let resumed;
    app.context.resumeGame = (event, id) => { resumed = id; };
    app.context.window.openPuzzleAction({ stopPropagation() {} }, 'muted', 'resume');
    assert.equal(resumed, 'muted');
});

test('keyboard moves persist only active order, keep muted slots and refuse moves past the ends', async () => {
    const app = dashboard();
    app.context.loadData();
    app.state().games.push({ id: 'muted', name: 'Muted', url: 'https://example.com/muted', mutedUntil: Date.now() + 86400000 },
        { id: 'other', name: 'Other', url: 'https://example.com/other' });
    await app.context.saveData();
    await app.context.movePuzzle('wordle', 1);
    assert.deepEqual(JSON.parse(app.storage.value).games.map(game => game.id), ['other', 'muted', 'wordle']);
    const writes = app.storage.writes;
    await app.context.movePuzzle('wordle', 1);
    await app.context.movePuzzle('muted', -1);
    assert.equal(app.storage.writes, writes);
    app.storage.failWrite = true;
    await app.context.movePuzzle('wordle', -1);
    assert.deepEqual(JSON.parse(app.storage.value).games.map(game => game.id), ['other', 'muted', 'wordle']);
});

test('menu moves animate the reordered cards and return focus, with a reduced-motion fallback', async () => {
    for (const reducedMotion of [false, true]) {
        const app = dashboard();
        app.context.loadData();
        app.state().games.push(custom);
        await app.context.saveData();
        const calls = [];
        app.context.window.matchMedia = () => ({ matches: reducedMotion });
        app.context.document.startViewTransition = update => {
            calls.push('transition');
            update();
        };
        app.context.render = () => calls.push('render');
        app.context.focusPuzzleActions = id => calls.push(id);
        await app.context.movePuzzle('wordle', 1);
        assert.deepEqual(calls, reducedMotion ? ['render', 'wordle'] : ['transition', 'render', 'wordle']);
        assert.deepEqual(JSON.parse(app.storage.value).games.map(game => game.id), ['custom', 'wordle']);
    }
});

test('blank names and unsafe links get field validation without writing a puzzle', async () => {
    const app = dashboard();
    app.context.loadData();
    const name = app.context.document.getElementById('new-game-name');
    const url = app.context.document.getElementById('new-game-url');
    name.value = '   ';
    url.value = 'https://example.com';
    await app.context.addNewGame();
    assert.equal(name.validationMessage, 'Enter a puzzle name.');
    name.value = 'Unsafe';
    url.value = 'javascript:alert(1)';
    await app.context.addNewGame();
    assert.match(url.validationMessage, /https/);
    assert.equal(app.storage.writes, 0);
});

test('opened state remains connected to its link for assistive technology', () => {
    const app = dashboard();
    const label = { id: 'opened-label', hidden: true };
    const link = { setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; } };
    const card = { classList: { toggle() {} }, querySelector: selector => selector === '.played-label' ? label : link };
    app.context.updatePuzzleOpened(card, true);
    assert.equal(label.hidden, false);
    assert.equal(link['aria-describedby'], label.id);
    app.context.updatePuzzleOpened(card, false);
    assert.equal(label.hidden, true);
    assert.equal(link['aria-describedby'], undefined);
});

test('saving an edit returns focus to the renamed puzzle after rendering', async () => {
    const app = dashboard();
    app.context.loadData();
    app.context.window.selectGame('wordle');
    app.context.document.getElementById('edit-game-name').value = 'My Wordle';
    app.context.document.getElementById('edit-game-url').value = 'https://www.nytimes.com/games/wordle';
    const calls = [];
    app.context.render = () => calls.push('render');
    app.context.focusPuzzleActions = id => calls.push(id);
    await app.context.savePuzzleEdit();
    assert.deepEqual(calls, ['render', 'wordle']);
    assert.equal(JSON.parse(app.storage.value).games[0].name, 'My Wordle');
});
