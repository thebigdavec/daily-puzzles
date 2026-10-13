import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIBRARY_GAMES } from '../library-games.js';
import { filterLibrary, puzzleUrlKey, suggestionEmail } from '../library.js';
import { runResetScheduleTests } from './reset-schedule.test.js';

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
