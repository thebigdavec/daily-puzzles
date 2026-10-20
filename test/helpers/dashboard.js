import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as schedule from '../../reset-schedule.js';
import { hasPuzzle, isInLibrary, puzzleUrlKey } from '../../library.js';
import { DEFAULT_GAMES } from '../../library-games.js';

const source = readFileSync(new URL('../../script.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from '\.\/[^']+';\n/gm, '');

export function makeLocks() {
    let queue = Promise.resolve();
    return { request(name, run) {
        const next = queue.then(run);
        queue = next.catch(() => {});
        return next;
    } };
}

export function makeStorage(value = JSON.stringify({
    games: [{ id: 'wordle', name: 'Wordle', url: 'https://www.nytimes.com/games/wordle' }],
    playedIds: ['wordle'],
    removedGames: [],
    lastResetDate: schedule.getPuzzleDay(),
    resetTime: '00:00',
    timeZone: 'device'
})) {
    return {
        value,
        failRead: false,
        failWrite: false,
        writes: 0,
        getItem() {
            if (this.failRead) throw new Error('Read denied');
            return this.value;
        },
        setItem(key, value) {
            this.writes++;
            if (this.failWrite) throw new Error('Write denied');
            this.value = value;
        }
    };
}

export function dashboard(storage = makeStorage(), locks = makeLocks()) {
    const fields = {};
    const events = {};
    const timers = [];
    const getField = (id) => fields[id] ||= {
        value: '', textContent: '', hidden: false,
        setCustomValidity(message) { this.validationMessage = message; },
        reportValidity() { return !this.validationMessage; },
        close() {},
        classList: { contains: () => false, add() {}, remove() {} },
        addEventListener() {}, setAttribute() {}
    };
    getField('reset-time').value = '04:00';
    getField('reset-time-zone').value = 'Europe/London';
    const context = {
        ...schedule, hasPuzzle, isInLibrary, puzzleUrlKey, DEFAULT_GAMES, URL,
        document: {
            getElementById: getField,
            querySelectorAll: () => [],
            querySelector: () => null,
            addEventListener(name, run) { events[name] = run; }
        },
        window: {
            addEventListener(name, run) { events[name] = run; },
            confirm: () => true,
            open() {},
            matchMedia: () => ({ matches: true })
        },
        navigator: { locks },
        console: { error() {} },
        localStorage: storage,
        setTimeout(run, delay) { timers.push({ run, delay }); return timers.length; },
        clearTimeout() {},
        initLibrary(options) { context.library = options; }
    };
    runInNewContext(`${source}
        render = updateDateDisplay = updateResetSummary = updateProgress = () => {};
        renderWithPuzzleTransition = () => {};
        window.getState = () => state;
        window.selectGame = (id) => { editingGameId = id; };
        window.setDragging = (value) => { isDragging = value; };
    `, context);
    return { context, fields, events, timers, storage, state: context.window.getState };
}
