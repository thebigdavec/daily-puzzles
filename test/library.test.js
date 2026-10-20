import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { LIBRARY_GAMES } from '../library-games.js';
import {
    filterLibrary,
    isInLibrary,
    openPuzzleSuggestion,
    puzzleUrlKey,
    suggestionEmail
} from '../library.js';
import { runResetScheduleTests } from './reset-schedule.test.js';

test('every catalogue category has a filter, including quizzes', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const select = html.match(/<select id="library-category"[\s\S]*?<\/select>/)[0];
    const categories = [...select.matchAll(/<option>([^<]+)<\/option>/g)].map((match) => match[1]);
    for (const category of new Set(LIBRARY_GAMES.map((game) => game.category))) {
        assert.ok(categories.includes(category), `${category} must be offered`);
    }
    assert.equal(filterLibrary('', 'Quiz').length, 2);
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
