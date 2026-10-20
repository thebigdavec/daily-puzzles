import { initLibrary, isInLibrary, openPuzzleSuggestion, puzzleUrlKey } from './library.js?v=2';
import {
    DEFAULT_RESET_TIME,
    DEVICE_TIME_ZONE,
    getDeviceTimeZone,
    getNextResetInstant,
    getPuzzleDay,
    normalizeResetSettings,
    resolveTimeZone
} from './reset-schedule.js?v=3';

const DEFAULT_GAMES = [
    { id: 'wordle', name: 'Wordle', url: 'https://www.nytimes.com/games/wordle' },
    { id: 'strands', name: 'Strands', url: 'https://www.nytimes.com/games/strands' },
    { id: 'categories', name: 'Categories', url: 'https://categories.clevergoat.com/' },
    { id: 'wordlinx', name: 'WordLinx', url: 'https://sacsgames.com/wordlinx/' },
    { id: 'chain', name: 'Chain', url: 'https://playthechaingame.com/' },
    { id: 'the-or-no-the', name: 'The or No The', url: 'https://www.theornothe.com/' },
    { id: 'onewordsearch', name: 'OneWordSearch', url: 'https://puzzlist.com/onewordsearch/' },
    { id: 'wordly', name: 'Wordly', url: 'https://wordly.org/uk' },
    { id: 'tightrope', name: 'Tightrope', url: 'https://www.britannica.com/quiz/tightrope' },
    { id: 'waffle', name: 'Waffle', url: 'https://wafflegame.net/daily' },
];

const STORAGE_KEY = 'puzzle_dashboard_v3';
const REMOVED_GAME_RETENTION_DAYS = 7;
const REMOVED_GAME_RETENTION_MS = REMOVED_GAME_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_IMPORT_FILE_SIZE_BYTES = 1024 * 1024;
const ACTION_MENU_EXIT_TRANSITION_MS = 90;

let state = {
    games: DEFAULT_GAMES.map((game) => ({ ...game })),
    playedIds: [],
    removedGames: [],
    lastResetDate: '',
    resetTime: DEFAULT_RESET_TIME,
    timeZone: DEVICE_TIME_ZONE
};

let isDragging = false;
let resetTimer = null;
let removedGamesTimer = null;
let mutedGamesTimer = null;
let editingGameId = null;
let pendingPauseDays = 0;
let openActionMenuId = null;

let savedData;
let savedState = JSON.stringify(state);
let lastWrite;

async function init() {
    if (!loadData()) {
        render();
        return;
    }
    window.addEventListener('storage', async (event) => {
        if (event.storageArea === localStorage && (event.key === STORAGE_KEY || event.key === null)) {
            if (loadData()) {
                await checkDailyReset();
                refreshDashboard();
            }
        }
    });
    initLibrary({
        getGames: () => state.games,
        async addGame(game) {
            if (
                state.games.some(
                    (saved) =>
                        saved.id === game.id ||
                        puzzleUrlKey(saved.url) === puzzleUrlKey(game.url)
                )
            ) {
                return true;
            }
            state.games.push({ id: game.id, name: game.name, url: game.url });
            if (!(await saveData())) return false;
            render();
            return true;
        }
    });
    await checkDailyReset();
    render();
    updateDateDisplay();
    updateResetSummary();
    scheduleResetCheck();
    scheduleRemovedGamesCleanup();
    scheduleMutedGamesRefresh();

    document.getElementById('import-games-file').addEventListener('change', handleImportFileChange);
    document.querySelectorAll('.pause-option').forEach((button) => {
        button.addEventListener('click', () => selectPauseDays(Number(button.dataset.pauseDays)));
    });
    document.getElementById('edit-game-return-date').addEventListener('change', () => {
        pendingPauseDays = null;
        updatePauseOptions();
    });
    ['edit-puzzle-dialog', 'mute-puzzle-dialog', 'remove-puzzle-dialog'].forEach((dialogId) => {
        const dialog = document.getElementById(dialogId);
        dialog.addEventListener('close', () => {
            editingGameId = null;
        });
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) {
                dialog.close();
            }
        });
    });
    document.addEventListener('click', (event) => {
        if (openActionMenuId && !event.target.closest('.action-menu-wrap')) {
            closePuzzleActionMenu();
        }
    });

    const list = document.getElementById('game-list');
    if (window.Sortable) {
        Sortable.create(list, {
            animation: 250,
            delay: 100,
            delayOnTouchOnly: false,
            touchStartThreshold: 5,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onStart() {
                isDragging = true;
            },
            onEnd() {
                setTimeout(() => {
                    isDragging = false;
                }, 50);
                const newOrder = Array.from(list.children).map((item) => item.dataset.id);
                reorderGames(newOrder);
            }
        });
    }

    document.addEventListener('visibilitychange', async () => {
        if (!document.hidden) {
            await checkDailyReset();
            scheduleResetCheck();
            const removed = removeExpiredRemovedGames();
            const unmuted = clearExpiredGameMutes();
            if (removed || unmuted) {
                if (!(await saveData())) return;
            }
            render();
            scheduleRemovedGamesCleanup();
            scheduleMutedGamesRefresh();
        }
    });
}

function loadData() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        const parsed = saved === null
            ? { games: DEFAULT_GAMES, lastResetDate: getPuzzleDay() }
            : JSON.parse(saved);
        if (!parsed || !Array.isArray(parsed.games)) {
            throw new Error('Invalid saved puzzle list');
        }
        const games = normalizeImportedGames(parsed.games);
        const now = Date.now();
        state = {
            games,
            playedIds: Array.isArray(parsed.playedIds)
                ? parsed.playedIds.filter((id) => games.some((game) => game.id === id))
                : [],
            removedGames: (Array.isArray(parsed.removedGames) ? parsed.removedGames : [])
                .map((game) => normalizeRemovedGame(game, now))
                .filter(Boolean)
                .filter((game) => !games.some((active) => active.id === game.id))
                .filter((game) => !isRemovedGameExpired(game, now)),
            ...normalizeResetSettings(parsed)
        };
        state.lastResetDate = migrateLastResetDate(typeof parsed.lastResetDate === 'string' ? parsed.lastResetDate : '');
        clearExpiredGameMutes();
        savedData = saved;
        savedState = JSON.stringify(state);
        return true;
    } catch (error) {
        console.error('Failed to read saved puzzles.', error);
        showStorageError('Could not read saved puzzles. Existing browser data has been kept. Please reload to try again.');
        return false;
    }
}

async function saveData() {
    const data = JSON.stringify(state);
    const expected = savedData;
    const previousWrite = lastWrite;
    let conflict = false;
    try {
        await navigator.locks.request(STORAGE_KEY, () => {
            const current = localStorage.getItem(STORAGE_KEY);
            // Queued edits from this tab may follow our own write, never another tab's write.
            if (current !== expected && (lastWrite === previousWrite || current !== lastWrite)) {
                conflict = true;
                throw new Error('Another tab changed the saved puzzles');
            }
            localStorage.setItem(STORAGE_KEY, data);
            savedData = data;
            savedState = data;
            lastWrite = data;
        });
        document.getElementById('storage-status').hidden = true;
        return true;
    } catch (error) {
        console.error('Failed to save puzzles.', error);
        state = JSON.parse(savedState);
        loadData();
        refreshDashboard();
        showStorageError(conflict
            ? 'Another tab changed your puzzles. The latest data has been loaded. Please try your change again.'
            : 'Could not save changes on this device. Your last saved data has been kept. Please try again.');
        return false;
    }
}

function showStorageError(message) {
    const status = document.getElementById('storage-status');
    status.textContent = message;
    status.hidden = false;
    document.getElementById('settings-save-status').textContent = message;
}

function refreshDashboard() {
    render();
    updateDateDisplay();
    updateResetSummary();
    scheduleResetCheck();
    scheduleRemovedGamesCleanup();
    scheduleMutedGamesRefresh();
    if (document.getElementById('settings-menu').classList.contains('is-open')) {
        populateSettings();
    }
}

function normalizeGame(game) {
    if (!game || typeof game.id !== 'string' || !game.id || typeof game.name !== 'string' || !game.name.trim()) {
        return null;
    }

    const url = getSafeHttpUrl(game.url);
    const mutedUntil = typeof game.mutedUntil === 'number' && Number.isFinite(game.mutedUntil)
        ? game.mutedUntil
        : null;
    return url ? { id: game.id, name: game.name.trim(), url, mutedUntil } : null;
}

function normalizeImportedGames(games) {
    const ids = new Set();

    return games
        .map(normalizeGame)
        .filter((game) => {
            if (!game || ids.has(game.id)) {
                return false;
            }
            ids.add(game.id);
            return true;
        });
}

function normalizeRemovedGame(game, now = Date.now()) {
    const normalizedGame = normalizeGame(game);
    if (!normalizedGame) {
        return null;
    }

    // Existing recently removed games predate the retention feature, so keep
    // them available for a full seven days from this upgrade.
    const removedAt = typeof game.removedAt === 'number' && Number.isFinite(game.removedAt)
        ? game.removedAt
        : now;

    return { ...normalizedGame, removedAt };
}

function getRemovedGameExpiry(game) {
    return game.removedAt + REMOVED_GAME_RETENTION_MS;
}

function isRemovedGameExpired(game, now = Date.now()) {
    return getRemovedGameExpiry(game) <= now;
}

function getRemainingRemovalDays(game, now = Date.now()) {
    return Math.max(0, Math.ceil((getRemovedGameExpiry(game) - now) / (24 * 60 * 60 * 1000)));
}

function removeExpiredRemovedGames(now = Date.now()) {
    const remainingGames = state.removedGames.filter((game) => !isRemovedGameExpired(game, now));
    const didRemoveGames = remainingGames.length !== state.removedGames.length;
    state.removedGames = remainingGames;
    return didRemoveGames;
}

function scheduleRemovedGamesCleanup() {
    if (removedGamesTimer) {
        clearTimeout(removedGamesTimer);
    }

    const now = Date.now();
    const nextRefreshAt = state.removedGames.reduce((earliest, game) => {
        const daysRemaining = getRemainingRemovalDays(game, now);
        const refreshAt = getRemovedGameExpiry(game) - Math.max(0, daysRemaining - 1) * 24 * 60 * 60 * 1000;
        return Math.min(earliest, refreshAt);
    }, Infinity);

    if (!Number.isFinite(nextRefreshAt)) {
        removedGamesTimer = null;
        return;
    }

    removedGamesTimer = setTimeout(async () => {
        if (removeExpiredRemovedGames()) {
            if (!(await saveData())) return;
        }
        render();
        scheduleRemovedGamesCleanup();
    }, Math.max(0, nextRefreshAt - Date.now()) + 50);
}

function isGameMuted(game, now = Date.now()) {
    return typeof game.mutedUntil === 'number' && game.mutedUntil > now;
}

function clearExpiredGameMutes(now = Date.now()) {
    let didClearMute = false;
    state.games.forEach((game) => {
        if (game.mutedUntil && game.mutedUntil <= now) {
            game.mutedUntil = null;
            didClearMute = true;
        }
    });
    return didClearMute;
}

function scheduleMutedGamesRefresh() {
    if (mutedGamesTimer) {
        clearTimeout(mutedGamesTimer);
    }

    const nextReturnAt = state.games.reduce((earliest, game) => {
        return isGameMuted(game) ? Math.min(earliest, game.mutedUntil) : earliest;
    }, Infinity);

    if (!Number.isFinite(nextReturnAt)) {
        mutedGamesTimer = null;
        return;
    }

    mutedGamesTimer = setTimeout(async () => {
        if (clearExpiredGameMutes()) {
            if (!(await saveData())) return;
        }
        render();
        scheduleMutedGamesRefresh();
    }, Math.min(24 * 60 * 60 * 1000, Math.max(0, nextReturnAt - Date.now()) + 50));
}

function getSafeHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch {
        return null;
    }
}

function migrateLastResetDate(savedDate) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(savedDate)) {
        return savedDate;
    }

    // v3 stored Date#toDateString() in the device's timezone with a midnight reset.
    return savedDate === new Date().toDateString() ? getPuzzleDay(undefined, state) : '';
}

function updateDateDisplay() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    options.timeZone = resolveTimeZone(state.timeZone);
    document.getElementById('current-date').innerText = new Intl.DateTimeFormat(undefined, options).format();
}

async function checkDailyReset() {
    const puzzleDay = getPuzzleDay(undefined, state);
    if (state.lastResetDate !== puzzleDay) {
        state.playedIds = [];
        state.lastResetDate = puzzleDay;
        if (!(await saveData())) return;
        render();
    }
    updateDateDisplay();
}

function scheduleResetCheck() {
    if (resetTimer) {
        clearTimeout(resetTimer);
    }

    const now = new Date();
    const nextReset = getNextResetInstant(now, state);
    const delay = nextReset.getTime() - now.getTime() + 250;
    resetTimer = setTimeout(async () => {
        await checkDailyReset();
        scheduleResetCheck();
    }, delay);
}

function updateResetSummary() {
    const timeZone = state.timeZone === DEVICE_TIME_ZONE
        ? `your device timezone (${getDeviceTimeZone()})`
        : state.timeZone;
    document.getElementById('reset-summary').innerText =
        `Open any puzzle • Drag anywhere to reorder • Resets daily at ${state.resetTime} (${timeZone})`;
}

function populateSettings() {
    document.getElementById('settings-save-status').textContent = 'Changes save automatically on this device.';
    const timeInput = document.getElementById('reset-time');
    const timeZoneSelect = document.getElementById('reset-time-zone');
    timeInput.value = state.resetTime;
    timeZoneSelect.replaceChildren();

    const deviceOption = new Option(`Use device timezone (${getDeviceTimeZone()})`, DEVICE_TIME_ZONE);
    timeZoneSelect.add(deviceOption);
    const timeZones = typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : ['UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland'];
    timeZones.forEach((timeZone) => timeZoneSelect.add(new Option(timeZone, timeZone)));
    timeZoneSelect.value = state.timeZone;
}

function openSettings() {
    if (document.getElementById('settings-menu').classList.contains('is-open')) {
        closeSettings();
        return;
    }
    populateSettings();
    const menu = document.getElementById('settings-menu');
    closeAddMenu();
    menu.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false');
}

function closeSettings() {
    const menu = document.getElementById('settings-menu');
    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true');
}

async function saveSettings() {
    const timeInput = document.getElementById('reset-time');
    const status = document.getElementById('settings-save-status');
    if (!timeInput.reportValidity()) {
        status.textContent = 'Choose a valid reset time. Changes have not been saved.';
        return;
    }
    const settings = normalizeResetSettings({
        resetTime: timeInput.value,
        timeZone: document.getElementById('reset-time-zone').value
    });
    const puzzleDay = getPuzzleDay(undefined, settings);
    state = {
        ...state,
        ...settings,
        lastResetDate: puzzleDay,
        playedIds: state.lastResetDate === puzzleDay ? state.playedIds : []
    };
    status.textContent = 'Saving settings…';
    if (!(await saveData())) return;
    status.textContent = `Settings saved on this device. Daily reset: ${settings.resetTime} (${settings.timeZone === DEVICE_TIME_ZONE ? 'device time zone' : settings.timeZone}).`;
    render();
    updateDateDisplay();
    updateResetSummary();
    scheduleResetCheck();
}

async function restoreDefaultGames() {
    if (!window.confirm('Use the default puzzle list? This replaces your list and clears today\'s progress and the Bin.')) {
        return;
    }

    state.games = DEFAULT_GAMES.map((game) => ({ ...game }));
    state.playedIds = [];
    state.removedGames = [];
    state.lastResetDate = getPuzzleDay(undefined, state);
    if (!(await saveData())) return;
    closeSettings();
    render();
    scheduleRemovedGamesCleanup();
    scheduleMutedGamesRefresh();
}

function openAddMenu() {
    const menu = document.getElementById('add-menu');
    if (menu.classList.contains('is-open')) {
        closeAddMenu();
        return;
    }
    closeSettings();
    menu.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false');
}

function closeAddMenu() {
    const menu = document.getElementById('add-menu');
    if (!menu.classList.contains('is-open')) {
        return;
    }
    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true');
}

function getGameById(id) {
    return state.games.find((game) => game.id === id);
}

function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function canUseViewTransitions() {
    return typeof document.startViewTransition === 'function' && !prefersReducedMotion();
}

function togglePuzzleActionMenu(event, id) {
    event.stopPropagation();
    if (openActionMenuId === id) {
        closePuzzleActionMenu();
        return;
    }

    if (openActionMenuId) {
        closePuzzleActionMenu(() => {
            openActionMenuId = id;
            render();
        });
        return;
    }

    openActionMenuId = id;
    render();
}

function openPuzzleAction(event, id, action) {
    event.stopPropagation();
    if (action === 'copy') {
        copyPuzzleLink(id);
        return;
    }
    if (action === 'share') {
        sharePuzzleLink(id);
        return;
    }

    if (action === 'suggest') {
        const game = getGameById(id);
        if (game) closePuzzleActionMenu(() => openPuzzleSuggestion(game));
        return;
    }

    if (action !== 'reset' && canUseViewTransitions()) {
        openActionMenuDialog(action, id);
        return;
    }

    closePuzzleActionMenu(() => {
        if (action === 'reset') {
            resetPuzzle(id);
        } else if (action === 'edit') {
            openPuzzleEditDialog(id);
        } else if (action === 'mute') {
            openPuzzleMuteDialog(id);
        } else {
            openPuzzleRemoveDialog(id);
        }
    });
}

async function sharePuzzleLink(id) {
    const game = getGameById(id);
    if (!game) {
        return;
    }

    if (typeof navigator.share !== 'function') {
        closePuzzleActionMenu();
        window.prompt('Sharing is not available in this browser. Copy this puzzle link to share it:', game.url);
        return;
    }

    try {
        await navigator.share({ title: game.name, url: game.url });
        closePuzzleActionMenu();
    } catch (error) {
        closePuzzleActionMenu();
        if (error.name !== 'AbortError') {
            window.prompt('Could not open sharing. Copy this puzzle link to share it:', game.url);
        }
    }
}

async function copyPuzzleLink(id) {
    const game = getGameById(id);
    if (!game) {
        return;
    }

    try {
        await navigator.clipboard.writeText(game.url);
        closePuzzleActionMenu();
        alert('Puzzle link copied. You can now paste it into a message or anywhere else.');
    } catch (error) {
        closePuzzleActionMenu();
        window.prompt('Copy this puzzle link:', game.url);
    }
}

function openActionMenuDialog(action, id) {
    openActionMenuId = null;
    document.documentElement.classList.add('is-action-dialog-transition');
    const transition = document.startViewTransition(() => {
        render();
        if (action === 'edit') {
            openPuzzleEditDialog(id);
        } else if (action === 'mute') {
            openPuzzleMuteDialog(id);
        } else {
            openPuzzleRemoveDialog(id);
        }
    });
    transition.finished.finally(() => {
        document.documentElement.classList.remove('is-action-dialog-transition');
        document.querySelector('.puzzle-dialog:open')?.classList.add('is-backdrop-visible');
    });
}

function closePuzzleActionMenu(afterClose) {
    const openMenu = document.querySelector('.puzzle-action-menu.is-open');
    openActionMenuId = null;

    if (!openMenu) {
        render();
        afterClose?.();
        return;
    }

    openMenu.classList.remove('is-open');
    openMenu.classList.add('is-closing');

    let finished = false;
    let fallbackTimer = null;
    const onTransitionEnd = (event) => {
        if (event.target === openMenu && event.propertyName === 'opacity') {
            finish();
        }
    };
    const finish = () => {
        if (finished) {
            return;
        }
        finished = true;
        clearTimeout(fallbackTimer);
        openMenu.removeEventListener('transitionend', onTransitionEnd);
        render();
        afterClose?.();
    };

    if (prefersReducedMotion()) {
        finish();
        return;
    }

    openMenu.addEventListener('transitionend', onTransitionEnd);
    fallbackTimer = setTimeout(finish, ACTION_MENU_EXIT_TRANSITION_MS + 60);
}

async function resetPuzzle(id) {
    state.playedIds = state.playedIds.filter((playedId) => playedId !== id);
    if (!(await saveData())) return;
    const card = Array.from(document.querySelectorAll('.game-item')).find((item) => item.dataset.id === id);
    if (card) {
        card.classList.remove('played');
        updateProgress();
        return;
    }
    render();
}

function openPuzzleEditDialog(id) {
    const game = getGameById(id);
    if (!game) {
        return;
    }

    editingGameId = id;
    document.getElementById('edit-game-name').value = game.name;
    document.getElementById('edit-game-url').value = game.url;
    const dialog = document.getElementById('edit-puzzle-dialog');
    showPuzzleDialog(dialog);
    document.getElementById('edit-game-name').focus();
}

function openPuzzleMuteDialog(id) {
    const game = getGameById(id);
    if (!game) {
        return;
    }

    editingGameId = id;
    pendingPauseDays = isGameMuted(game) ? null : 3;
    const returnDateInput = document.getElementById('edit-game-return-date');
    returnDateInput.value = '';
    returnDateInput.min = getLocalDateInputValue();
    document.getElementById('muting-puzzle-description').textContent = isGameMuted(game)
        ? `${game.name} is muted until ${formatReturnDate(game.mutedUntil)}.`
        : `Choose when ${game.name} should return. You can resume it any time.`;
    updatePauseOptions();
    showPuzzleDialog(document.getElementById('mute-puzzle-dialog'));
}

function openPuzzleRemoveDialog(id) {
    const game = getGameById(id);
    if (!game) {
        return;
    }

    editingGameId = id;
    document.getElementById('removing-puzzle-description').textContent = `Remove ${game.name} from Daily Puzzles.`;
    showPuzzleDialog(document.getElementById('remove-puzzle-dialog'));
}

function showPuzzleDialog(dialog) {
    dialog.classList.remove('is-backdrop-visible');
    dialog.showModal();
    if (!document.documentElement.classList.contains('is-action-dialog-transition')) {
        requestAnimationFrame(() => dialog.classList.add('is-backdrop-visible'));
    }
}

function closePuzzleDialog(dialogId) {
    document.getElementById(dialogId).close();
    editingGameId = null;
}

function selectPauseDays(days) {
    pendingPauseDays = days;
    document.getElementById('edit-game-return-date').value = '';
    updatePauseOptions();
}

function updatePauseOptions() {
    document.querySelectorAll('.pause-option').forEach((button) => {
        const isSelected = Number(button.dataset.pauseDays) === pendingPauseDays;
        button.classList.toggle('is-selected', isSelected);
        button.setAttribute('aria-pressed', String(isSelected));
    });
}

function getPauseUntil() {
    const returnDate = document.getElementById('edit-game-return-date').value;
    if (returnDate) {
        return new Date(`${returnDate}T00:00:00`).getTime();
    }
    if (!pendingPauseDays) {
        return null;
    }
    const returnAt = new Date();
    returnAt.setDate(returnAt.getDate() + pendingPauseDays);
    return returnAt.getTime();
}

function getLocalDateInputValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function savePuzzleEdit() {
    const game = getGameById(editingGameId);
    const name = document.getElementById('edit-game-name').value.trim();
    const url = getSafeHttpUrl(document.getElementById('edit-game-url').value.trim());

    if (!game || !name) {
        return;
    }
    if (!url) {
        alert('Please enter a valid http or https URL');
        return;
    }

    game.name = name;
    game.url = url;
    if (!(await saveData())) return;
    closePuzzleDialog('edit-puzzle-dialog');
    render();
}

async function savePuzzleMute() {
    const game = getGameById(editingGameId);
    const returnDate = document.getElementById('edit-game-return-date').value;
    if (!game) {
        return;
    }

    game.mutedUntil = pendingPauseDays === null && !returnDate ? game.mutedUntil : getPauseUntil();
    clearExpiredGameMutes();
    if (!(await saveData())) return;
    closePuzzleDialog('mute-puzzle-dialog');
    renderWithPuzzleTransition();
    scheduleMutedGamesRefresh();
}

async function resumeGame(event, id) {
    event.stopPropagation();
    const game = getGameById(id);
    if (!game) {
        return;
    }
    game.mutedUntil = null;
    if (openActionMenuId) {
        closePuzzleActionMenu();
    }
    if (!(await saveData())) return;
    renderWithPuzzleTransition();
    scheduleMutedGamesRefresh();
}

function formatReturnDate(timestamp) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(timestamp);
}

async function addNewGame() {
    const nameInput = document.getElementById('new-game-name');
    const urlInput = document.getElementById('new-game-url');

    const name = nameInput.value.trim();
    const url = urlInput.value.trim();

    if (!name || !url) {
        return;
    }

    const safeUrl = getSafeHttpUrl(url);
    if (!safeUrl) {
        alert('Please enter a valid http or https URL');
        return;
    }

    state.games.push({
        id: `custom-${Date.now()}`,
        name,
        url: safeUrl
    });

    if (!(await saveData())) return;
    nameInput.value = '';
    urlInput.value = '';
    closeAddMenu();
    renderWithPuzzleTransition();
}

function exportCustomGames() {
    const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        games: state.games.map(({ id, name, url, mutedUntil }) => ({ id, name, url, mutedUntil }))
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = downloadUrl;
    link.download = `daily-puzzles-puzzles-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
}

function importCustomGames() {
    const input = document.getElementById('import-games-file');
    input.value = '';
    input.click();
}

function handleImportFileChange(event) {
    const [file] = event.target.files;
    if (!file) {
        return;
    }

    if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
        alert('That backup file is too large. Please choose a Daily Puzzles backup smaller than 1 MB.');
        return;
    }

    const reader = new FileReader();
    reader.onerror = () => alert('The selected backup file could not be read.');
    reader.onload = async () => {
        try {
            const backup = JSON.parse(reader.result);
            if (!backup || backup.version !== 1 || !Array.isArray(backup.games)) {
                throw new Error('Invalid backup');
            }
            const games = normalizeImportedGames(backup.games);
            if (backup.games.length && !games.length) {
                throw new Error('No valid games');
            }

            if (!window.confirm('Replace your current puzzle list with this backup? Today\'s progress and bin will be cleared.')) {
                return;
            }

            state.games = games;
            state.playedIds = [];
            state.removedGames = [];
            state.lastResetDate = getPuzzleDay(undefined, state);
            if (!(await saveData())) return;
            render();
            scheduleRemovedGamesCleanup();
            scheduleMutedGamesRefresh();
        } catch (error) {
            console.error('Failed to import games backup.', error);
            alert('That file is not a valid Daily Puzzles backup.');
        }
    };
    reader.readAsText(file);
}

async function removeGameById(id) {
    const gameToRemove = state.games.find((game) => game.id === id);
    if (!gameToRemove) {
        return;
    }

    state.games = state.games.filter((game) => game.id !== id);
    state.playedIds = state.playedIds.filter((playedId) => playedId !== id);
    state.removedGames = [{ ...gameToRemove, removedAt: Date.now() }, ...state.removedGames.filter((game) => game.id !== id)];

    if (!(await saveData())) return;
    renderWithPuzzleTransition();
    scheduleRemovedGamesCleanup();
}

function sendPuzzleToBin() {
    const id = editingGameId;
    closePuzzleDialog('remove-puzzle-dialog');
    if (id) {
        removeGameById(id);
    }
}

async function removePuzzleImmediately() {
    const id = editingGameId;
    closePuzzleDialog('remove-puzzle-dialog');
    if (!id) {
        return;
    }

    state.games = state.games.filter((game) => game.id !== id);
    state.playedIds = state.playedIds.filter((playedId) => playedId !== id);
    if (!(await saveData())) return;
    renderWithPuzzleTransition();
    scheduleMutedGamesRefresh();
}

async function restoreRemovedGame(event, id) {
    event.stopPropagation();
    const gameToRestore = state.removedGames.find((game) => game.id === id);
    if (!gameToRestore) {
        return;
    }

    state.removedGames = state.removedGames.filter((game) => game.id !== id);
    if (!state.games.some((game) => game.id === id || puzzleUrlKey(game.url) === puzzleUrlKey(gameToRestore.url))) {
        state.games.push(gameToRestore);
    }
    if (!(await saveData())) return;
    renderWithPuzzleTransition();
    scheduleRemovedGamesCleanup();
}

async function permanentlyRemoveGame(event, id) {
    event.stopPropagation();
    state.removedGames = state.removedGames.filter((game) => game.id !== id);
    if (!(await saveData())) return;
    render();
    scheduleRemovedGamesCleanup();
}

async function handleCardClick(event, id, url) {
    // The whole card is a play target, but its controls must never fall
    // through to it. This extra guard is important on touch devices, where a
    // tap can be delivered after a pointer or drag event has already run.
    if (isDragging) {
        event.preventDefault();
        return;
    }
    if (event.target.closest('button, input, select, textarea, label')) {
        return;
    }

    const card = event.currentTarget;
    if (!event.target.closest('a')) {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
    if (openActionMenuId) {
        closePuzzleActionMenu();
    }

    if (!state.playedIds.includes(id)) {
        state.playedIds.push(id);
        if (!(await saveData())) return;
        card.classList.add('played');
        updateProgress();
    }
}

async function resetManual() {
    state.playedIds = [];
    state.lastResetDate = getPuzzleDay(undefined, state);
    if (!(await saveData())) return;
    render();
}

async function reorderGames(idList) {
    const activeGames = state.games.filter((game) => !isGameMuted(game));
    const reordered = idList
        .map((id) => activeGames.find((game) => game.id === id))
        .filter(Boolean);

    if (reordered.length !== activeGames.length) {
        return;
    }

    let nextActiveGame = 0;
    state.games = state.games.map((game) => isGameMuted(game) ? game : reordered[nextActiveGame++]);
    if (!(await saveData())) return;
    updateProgress();
}

function updateProgress() {
    const activeGames = state.games.filter((game) => !isGameMuted(game));
    const count = state.playedIds.filter((id) => activeGames.some((game) => game.id === id)).length;
    const total = activeGames.length;
    document.getElementById('progress-text').innerText = `${count}/${total}`;
}

function getFaviconUrl(gameUrl) {
    try {
        const url = new URL(gameUrl);
        return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
    } catch (error) {
        return '';
    }
}

function getPuzzleActionMenuItems(game, isPlayed) {
    const actionButton = (action, label, icon, extraClass = '') => `
        <button type="button" role="menuitem" class="${extraClass}" data-action="${action}">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
            <span>${label}</span>
        </button>
    `;

    return [
        isPlayed ? actionButton('reset', 'Reset', '<path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path>') : '',
        actionButton('edit', 'Edit', '<path d="m4 16 8.6-8.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path><path d="m11 9 4 4"></path>'),
        actionButton('copy', 'Copy link', '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V4H4v12h4"></path>'),
        actionButton('share', 'Share link', '<path d="M12 16V3m-4 4 4-4 4 4"></path><path d="M8 11H4v10h16V11h-4"></path>'),
        !isInLibrary(game.url) ? actionButton('suggest', 'Suggest for library', '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 6 9 7 9-7"></path>') : '',
        actionButton('mute', 'Mute', '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-1.4-1.2-2.7-2.2-4"></path><path d="m4 4 16 16"></path><path d="M10 21h4"></path>'),
        actionButton('remove', 'Remove', '<path d="M4 7h16"></path><path d="M10 11v6M14 11v6"></path><path d="M6 7l1 13h10l1-13"></path><path d="M9 7V4h6v3"></path>', 'menu-action-remove')
    ].join('');
}

function getMutedPuzzleActionMenuItems(game) {
    return `
        <button type="button" role="menuitem" data-action="edit" onclick="openPuzzleAction(event, this.dataset.puzzleId, this.dataset.action)">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 16 8.6-8.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path><path d="m11 9 4 4"></path></svg>
            <span>Edit</span>
        </button>
        <button type="button" role="menuitem" data-action="copy" onclick="openPuzzleAction(event, this.dataset.puzzleId, this.dataset.action)">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V4H4v12h4"></path></svg>
            <span>Copy link</span>
        </button>
        <button type="button" role="menuitem" data-action="share" onclick="openPuzzleAction(event, this.dataset.puzzleId, this.dataset.action)">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V3m-4 4 4-4 4 4"></path><path d="M8 11H4v10h16V11h-4"></path></svg>
            <span>Share link</span>
        </button>
        ${!isInLibrary(game.url) ? `<button type="button" role="menuitem" data-action="suggest" onclick="openPuzzleAction(event, this.dataset.puzzleId, this.dataset.action)">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 6 9 7 9-7"></path></svg>
            <span>Suggest for library</span>
        </button>` : ''}
        <button type="button" role="menuitem" data-action="resume" onclick="resumeGame(event, this.dataset.puzzleId)">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="m10 8 6 4-6 4Z"></path></svg>
            <span>Unmute</span>
        </button>
        <button type="button" role="menuitem" class="menu-action-remove" data-action="remove" onclick="openPuzzleAction(event, this.dataset.puzzleId, this.dataset.action)">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M10 11v6M14 11v6"></path><path d="M6 7l1 13h10l1-13"></path><path d="M9 7V4h6v3"></path></svg>
            <span>Remove</span>
        </button>
    `;
}

function getPuzzleViewTransitionName(id) {
    let hash = 5381;
    for (const character of id) {
        hash = (hash * 33) ^ character.charCodeAt(0);
    }
    return `puzzle-${(hash >>> 0).toString(36)}`;
}

function renderWithPuzzleTransition() {
    if (!canUseViewTransitions()) {
        render();
        return;
    }

    document.startViewTransition(() => render());
}

function render() {
    const container = document.getElementById('game-list');
    container.innerHTML = '';

    clearExpiredGameMutes();

    if (!state.games.length) {
        const empty = document.createElement('p');
        empty.className = 'library-copy';
        empty.textContent = 'Your list is empty. Choose puzzles from the Library or use Add.';
        container.appendChild(empty);
        const defaultsButton = document.createElement('button');
        defaultsButton.type = 'button';
        defaultsButton.className = 'btn btn-primary';
        defaultsButton.textContent = 'Use default list';
        defaultsButton.onclick = restoreDefaultGames;
        container.appendChild(defaultsButton);
    }

    state.games.filter((game) => !isGameMuted(game)).forEach((game) => {
        const isPlayed = state.playedIds.includes(game.id);
        const favicon = getFaviconUrl(game.url);
        const isActionMenuOpen = openActionMenuId === game.id;

        const card = document.createElement('div');
        card.className = `game-card game-item ${isPlayed ? 'played' : ''} ${isActionMenuOpen ? 'has-open-action-menu' : ''}`;
        card.dataset.id = game.id;
        card.style.viewTransitionName = getPuzzleViewTransitionName(game.id);
        card.onclick = (event) => handleCardClick(event, game.id, game.url);

        card.innerHTML = `
            <div class="game-main">
                <div class="game-left">
                    <div class="drag-handle">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
                            <circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
                        </svg>
                    </div>
                    <div class="game-content">
                        <img src="${favicon}" class="game-logo" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid'">
                        <div class="game-icon-fallback" style="display:none">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
                            </svg>
                        </div>
                        <a class="game-title" target="_blank" rel="noopener noreferrer"></a>
                    </div>
                </div>
                <div class="game-actions">
                    <div class="action-menu-wrap">
                        <button type="button" class="more-actions-btn" aria-label="More actions for puzzle" aria-haspopup="menu" aria-expanded="${isActionMenuOpen}">•••</button>
                        <div class="puzzle-action-menu ${isActionMenuOpen ? 'is-open' : ''}" role="menu" aria-label="Puzzle actions">
                            ${getPuzzleActionMenuItems(game, isPlayed)}
                        </div>
                    </div>
                </div>
            </div>
        `;

        const puzzleLink = card.querySelector('.game-title');
        puzzleLink.textContent = game.name;
        puzzleLink.href = game.url;
        const moreActionsButton = card.querySelector('.more-actions-btn');
        moreActionsButton.setAttribute('aria-label', `More actions for ${game.name}`);
        const actionMenuItems = card.querySelectorAll('.puzzle-action-menu button');
        // Keep Sortable's card-wide touch handling away from the action menu.
        ['pointerdown', 'touchstart'].forEach((eventName) => {
            moreActionsButton.addEventListener(eventName, (event) => event.stopPropagation());
            actionMenuItems.forEach((item) => item.addEventListener(eventName, (event) => event.stopPropagation()));
        });
        moreActionsButton.onclick = (event) => togglePuzzleActionMenu(event, game.id);
        actionMenuItems.forEach((item) => {
            item.onclick = (event) => openPuzzleAction(event, game.id, item.dataset.action);
        });
        container.appendChild(card);
    });

    renderRecentlyRemoved();
    renderPausedGames();
    updateProgress();
}

function renderPausedGames() {
    const section = document.getElementById('paused-games-section');
    const list = document.getElementById('paused-games-list');
    const pausedGames = state.games.filter((game) => isGameMuted(game));
    list.innerHTML = '';

    if (!pausedGames.length) {
        section.hidden = true;
        return;
    }

    pausedGames.forEach((game) => {
        const item = document.createElement('li');
        item.className = `recently-removed-item paused-game-item ${openActionMenuId === game.id ? 'has-open-action-menu' : ''}`;
        item.style.viewTransitionName = getPuzzleViewTransitionName(game.id);

        const info = document.createElement('div');
        info.className = 'recently-removed-info';
        const title = document.createElement('span');
        title.className = 'recently-removed-game';
        title.textContent = game.name;
        const returnDate = document.createElement('span');
        returnDate.className = 'recently-removed-countdown';
        returnDate.textContent = `Returns ${formatReturnDate(game.mutedUntil)}`;
        info.append(title, returnDate);

        const actions = document.createElement('div');
        actions.className = 'recently-removed-actions';
        actions.innerHTML = `
            <div class="action-menu-wrap">
                <button type="button" class="more-actions-btn" aria-label="More actions for puzzle" aria-haspopup="menu" aria-expanded="${openActionMenuId === game.id}" onclick="togglePuzzleActionMenu(event, this.dataset.puzzleId)">•••</button>
                <div class="puzzle-action-menu ${openActionMenuId === game.id ? 'is-open' : ''}" role="menu" aria-label="Puzzle actions">
                    ${getMutedPuzzleActionMenuItems(game)}
                </div>
            </div>
        `;
        const moreActionsButton = actions.querySelector('.more-actions-btn');
        moreActionsButton.setAttribute('aria-label', `More actions for ${game.name}`);
        moreActionsButton.dataset.puzzleId = game.id;
        actions.querySelectorAll('.puzzle-action-menu button').forEach((action) => {
            action.dataset.puzzleId = game.id;
        });
        item.append(info, actions);
        list.appendChild(item);
    });

    section.hidden = false;
}

function renderRecentlyRemoved() {
    const section = document.getElementById('recently-removed-section');
    const list = document.getElementById('recently-removed-list');

    list.innerHTML = '';

    removeExpiredRemovedGames();

    if (!state.removedGames.length) {
        section.hidden = true;
        return;
    }

    state.removedGames.forEach((game) => {
        const item = document.createElement('li');
        item.className = 'recently-removed-item';
        item.style.viewTransitionName = getPuzzleViewTransitionName(game.id);

        const info = document.createElement('div');
        info.className = 'recently-removed-info';

        const title = document.createElement('span');
        title.className = 'recently-removed-game';
        title.textContent = game.name;

        const link = document.createElement('a');
        link.className = 'recently-removed-link';
        link.href = game.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = game.url;

        info.appendChild(title);
        info.appendChild(link);

        const countdown = document.createElement('span');
        countdown.className = 'recently-removed-countdown';
        const daysRemaining = getRemainingRemovalDays(game);
        countdown.textContent = `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left`;
        info.appendChild(countdown);

        const restoreButton = document.createElement('button');
        restoreButton.className = 'btn btn-pill btn-restore';
        restoreButton.type = 'button';
        restoreButton.textContent = 'Restore';
        restoreButton.onclick = (event) => restoreRemovedGame(event, game.id);

        const trashButton = document.createElement('button');
        trashButton.className = 'btn btn-pill btn-trash';
        trashButton.type = 'button';
        trashButton.textContent = 'Remove now';
        trashButton.setAttribute('aria-label', `Remove ${game.name} immediately`);
        trashButton.onclick = (event) => permanentlyRemoveGame(event, game.id);

        const actions = document.createElement('div');
        actions.className = 'recently-removed-actions';
        actions.appendChild(restoreButton);
        actions.appendChild(trashButton);

        item.appendChild(info);
        item.appendChild(actions);
        list.appendChild(item);
    });

    section.hidden = false;
}

Object.assign(window, {
    addNewGame,
    closeAddMenu,
    closePuzzleDialog,
    closeSettings,
    exportCustomGames,
    importCustomGames,
    openAddMenu,
    openSettings,
    resetManual,
    resumeGame,
    restoreDefaultGames,
    removePuzzleImmediately,
    saveSettings,
    savePuzzleEdit,
    savePuzzleMute,
    selectPauseDays,
    sendPuzzleToBin,
    openPuzzleAction,
    togglePuzzleActionMenu
});

window.addEventListener('DOMContentLoaded', init);
