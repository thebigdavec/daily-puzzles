import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_GAMES, LIBRARY_GAMES } from '../library-games.js';
import {
    filterLibrary,
    hasPuzzle,
    initLibrary,
    isInLibrary,
    openPuzzleSuggestion,
    puzzleUrlKey,
    suggestionEmail
} from '../library.js';
import { runResetScheduleTests } from './reset-schedule.test.js';
import { dashboard, makeStorage } from './helpers/dashboard.js';

test('default positions are unique positive integers', () => {
    const positions = LIBRARY_GAMES
        .filter((game) => game.defaultOrder !== undefined)
        .map((game) => game.defaultOrder);
    assert.ok(positions.length > 0);
    assert.ok(positions.every((position) => Number.isInteger(position) && position > 0));
    assert.equal(new Set(positions).size, positions.length);
});

test('fresh lists use library details in default order and leave library-only puzzles out', () => {
    const app = dashboard(makeStorage(null));
    app.context.loadData();
    assert.equal(app.state().games.length, LIBRARY_GAMES.filter((game) => game.defaultOrder !== undefined).length);
    let previousPosition = 0;
    for (const game of app.state().games) {
        const entry = LIBRARY_GAMES.find((entry) => entry.id === game.id);
        assert.ok(entry, `${game.name} must be in the library`);
        assert.equal(game.name, entry.name);
        assert.equal(game.url, entry.url);
        assert.ok(entry.defaultOrder > previousPosition, `${game.name} must follow its default position`);
        previousPosition = entry.defaultOrder;
    }
});

test('restoring defaults uses library order without changing the catalogue or saved personal lists', async () => {
    const app = dashboard();
    app.context.loadData();
    assert.deepEqual(Array.from(app.state().games, (game) => game.id), ['wordle']);
    app.state().games[0].name = 'My renamed puzzle';
    assert.equal(LIBRARY_GAMES.find((game) => game.id === 'wordle').name, 'Wordle');
    await app.context.restoreDefaultGames();
    assert.deepEqual(JSON.parse(app.storage.value).games, DEFAULT_GAMES);
    assert.ok(DEFAULT_GAMES.every((game) => Object.keys(game).sort().join(',') === 'id,name,url'));
});

test('category choices come from the catalogue, with All categories kept first', (t) => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const select = html.match(/<select id="library-category"[\s\S]*?<\/select>/)[0];
    assert.equal([...select.matchAll(/<option/g)].length, 1);
    const options = [{ value: '', textContent: 'All categories' }];
    const fields = {};
    const previousDocument = globalThis.document;
    globalThis.document = {
        createElement(tag) {
            return { tag, get value() { return this.textContent; } };
        },
        getElementById(id) {
            return fields[id] ||= {
                append(option) { options.push(option); },
                addEventListener() {}
            };
        }
    };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });
    initLibrary({ getGames: () => [], addGame: () => true });
    assert.equal(options[0].textContent, 'All categories');
    assert.equal(options[0].value, '');
    assert.deepEqual(options.slice(1).map((option) => option.value),
        [...new Set(LIBRARY_GAMES.map((game) => game.category))]);
    assert.ok(options.slice(1).every((option) => option.tag === 'option'));
    assert.equal(filterLibrary('', 'Quiz').length, 2);
});

test('one membership rule matches IDs and equivalent links, including muted puzzles', () => {
    const saved = [{ id: 'wordle', url: 'https://www.nytimes.com/games/wordle', mutedUntil: Date.now() + 86400000 }];
    assert.equal(hasPuzzle(saved, { id: 'wordle', url: 'https://example.com/renamed' }), true);
    assert.equal(hasPuzzle(saved, { id: 'renamed', url: 'http://nytimes.com/games/wordle/index.html' }), true);
    assert.equal(hasPuzzle(saved, { id: 'other', url: 'https://example.com/other' }), false);
    assert.equal(hasPuzzle([], saved[0]), false);
    assert.equal(hasPuzzle([{ id: 'a', url: 'invalid' }], { id: 'b', url: 'also invalid' }), false);
});

test('catalogue has unique IDs and links and complete editorial details', () => {
    assert.equal(
        new Set(LIBRARY_GAMES.map((game) => game.id)).size,
        LIBRARY_GAMES.length
    );
    assert.equal(
        new Set(LIBRARY_GAMES.map((game) => puzzleUrlKey(game.url))).size,
        LIBRARY_GAMES.length
    );
    for (const game of LIBRARY_GAMES) {
        assert.ok(puzzleUrlKey(game.url));
        assert.ok(puzzleUrlKey(game.source));
        assert.ok(
            game.description && game.category && game.cadence && game.checkedOn
        );
    }
    assert.match(
        LIBRARY_GAMES.find((game) => game.id === 'wordly').cadence,
        /Unlimited/
    );
});

test('search and category combine, including empty results', () => {
    assert.deepEqual(
        filterLibrary('  WORLDLE ', 'Geography').map((game) => game.id),
        ['worldle']
    );
    assert.equal(filterLibrary('worldle', 'Words').length, 0);
    assert.ok(
        filterLibrary('calculation', '').some((game) => game.id === 'nerdle')
    );
    assert.equal(filterLibrary('', '').length, LIBRARY_GAMES.length);
});

test('duplicate links ignore www, trailing slashes and index.html', () => {
    assert.equal(
        puzzleUrlKey('https://www.nytimes.com/games/wordle/index.html'),
        puzzleUrlKey('https://www.nytimes.com/games/wordle')
    );
    assert.equal(
        puzzleUrlKey('https://www.wafflegame.net/daily/'),
        puzzleUrlKey('https://wafflegame.net/daily')
    );
    assert.notEqual(
        puzzleUrlKey('https://example.com/a'),
        puzzleUrlKey('https://example.com/b')
    );
    assert.notEqual(
        puzzleUrlKey('https://example.com:8443/daily'),
        puzzleUrlKey('https://example.com:9443/daily')
    );
    for (const url of [
        'javascript:alert(1)',
        'data:text/html,test',
        'invalid',
        'https://user:password@example.com'
    ])
        assert.equal(puzzleUrlKey(url), null);
});

test('email drafts keep user text inside encoded subject and body', () => {
    const email = suggestionEmail(
        'Puzzle & Bcc: nobody',
        'https://example.com/daily?x=1&y=2',
        'Nice\n&subject=other'
    );
    const parsed = new URL(email.href);
    assert.equal(parsed.pathname, 'dave@davecollison.dev');
    assert.equal(
        parsed.searchParams.get('subject'),
        'Puzzle suggestion: Puzzle & Bcc: nobody'
    );
    assert.equal(parsed.searchParams.get('body'), email.body);
    assert.equal([...parsed.searchParams.keys()].length, 2);
    assert.throws(() => suggestionEmail('Puzzle', 'javascript:alert(1)', ''));
});

test('existing reset schedule checks still pass', runResetScheduleTests);

test('suggesting a saved puzzle prefills the form and clears the previous draft', (t) => {
    const details = { open: false };
    const fields = Object.fromEntries(
        [
            'suggest-name',
            'suggest-url',
            'suggest-notes',
            'suggest-confirm',
            'suggest-status',
            'suggest-fallback',
            'suggest-email-text'
        ].map((id) => [id, {
            value: 'Previous draft',
            textContent: 'Previous status',
            hidden: false
        }])
    );
    fields['suggest-confirm'].checked = true;
    fields['suggest-puzzle-form'] = {
        reset() {
            fields['suggest-notes'].value = '';
            fields['suggest-confirm'].checked = false;
        },
        closest: () => details
    };
    let opened = false;
    fields['open-library'] = {
        click() {
            opened = true;
        }
    };
    let focused = false;
    fields['suggest-notes'].focus = () => {
        focused = true;
    };
    const previousDocument = globalThis.document;
    globalThis.document = { getElementById: (id) => fields[id] };
    t.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    });

    openPuzzleSuggestion({
        name: 'Puzzle & friends',
        url: 'https://example.com/daily?a=1&b=2'
    });

    assert.equal(fields['suggest-name'].value, 'Puzzle & friends');
    assert.equal(fields['suggest-url'].value, 'https://example.com/daily?a=1&b=2');
    assert.equal(fields['suggest-notes'].value, '');
    assert.equal(fields['suggest-confirm'].checked, false);
    assert.equal(fields['suggest-status'].textContent, '');
    assert.equal(fields['suggest-fallback'].hidden, true);
    assert.equal(fields['suggest-email-text'].value, '');
    assert.ok(details.open && opened && focused);
});

test('library matches block duplicate suggestions even under a different name', () => {
    for (const game of LIBRARY_GAMES) {
        assert.ok(isInLibrary(game.url));
        assert.throws(
            () => suggestionEmail('A different name', game.url, ''),
            /already in the library/
        );
    }
    const equivalent = 'http://www.wafflegame.net/daily/index.html';
    assert.ok(isInLibrary(equivalent));
    assert.throws(
        () => suggestionEmail('My Waffle', equivalent, ''),
        /already in the library/
    );
    assert.equal(isInLibrary('https://example.com/new-puzzle'), false);
    assert.equal(isInLibrary('invalid'), false);
    assert.equal(isInLibrary('https://example.com:9443/daily'), false);
});

test('adding keeps a library card in place, confirms success and allows retry after failure', async (t) => {
    const previousDocument = globalThis.document;
    const fields = {};
    function node(tag = 'div') {
        return {
            tag, children: [], listeners: {}, attributes: {}, value: '', textContent: '',
            isConnected: true,
            append(...children) { this.children.push(...children); },
            replaceChildren() { this.children = []; },
            setAttribute(name, value) { this.attributes[name] = value; },
            addEventListener(name, run) { this.listeners[name] = run; },
            focus() { document.activeElement = this; },
            showModal() { this.open = true; },
            dataset: {}
        };
    }
    globalThis.document = {
        body: node('body'),
        createElement: node,
        getElementById(id) { return fields[id] ||= node(); }
    };
    t.after(() => { globalThis.document = previousDocument; });
    const games = [];
    let succeeds = true;
    initLibrary({ getGames: () => games, addGame: async (game) => {
        if (!succeeds) return false;
        games.push(game);
        return true;
    } });
    fields['open-library'].listeners.click();
    const list = fields['library-games'];
    const card = list.children[0];
    const button = card.children.at(-1);
    document.activeElement = button;
    await button.listeners.click();
    assert.equal(list.children[0], card);
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, '✓ Added');
    assert.equal(document.activeElement, card.children[1]);
    assert.equal(fields['library-status'].textContent, `${LIBRARY_GAMES[0].name} added to your list.`);
    succeeds = false;
    const retryButton = list.children[1].children.at(-1);
    await retryButton.listeners.click();
    assert.equal(retryButton.disabled, false);
    assert.equal(games.length, 1);
    assert.match(fields['library-status'].textContent, /Please try again/);
});
