import { DEFAULT_GAMES } from './library-games.js?v=4';
import { hasPuzzle, initLibrary, isInLibrary, openPuzzleSuggestion } from './library.js?v=6';
import {
    DEFAULT_RESET_TIME,
    DEVICE_TIME_ZONE,
    getDeviceTimeZone,
    getNextResetInstant,
    getPuzzleDay,
    normalizeResetSettings,
    resolveTimeZone
} from './reset-schedule.js?v=3';

const STORAGE_KEY = 'puzzle_dashboard_v3';
const REMOVED_GAME_RETENTION_DAYS = 7;
const REMOVED_GAME_RETENTION_MS = REMOVED_GAME_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_IMPORT_FILE_SIZE_BYTES = 1024 * 1024;

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

let savedData;
let savedState = JSON.stringify(state);
let lastWrite;

async function init() {
    document.getElementById('add-puzzle-form').addEventListener('submit', (event) => {
        event.preventDefault();
        addNewGame();
    });
    ['new-game-name', 'new-game-url'].forEach((id) => {
        const input = document.getElementById(id);
        input.addEventListener('input', () => input.setCustomValidity(''));
    });

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
            if (hasPuzzle(state.games, game)) {
                return true;
            }
            state.games.push({ id: game.id, name: game.name, url: game.url });
            if (!(await saveData())) return false;
            render();
            return true;
        }
    });
    await checkDailyReset();
    refreshDashboard();

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
    window.addEventListener('resize', closePuzzleActionMenu);
    const list = document.getElementById('game-list');
    if (window.Sortable) {
        Sortable.create(list, {
            animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
            forceFallback: true,
            fallbackOnBody: true,
            handle: '.drag-handle',
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
    document.getElementById('reset-time-zone-name').textContent = timeZone;
    document.getElementById('reset-summary').innerText =
        `Open any puzzle • Drag the handle to reorder • Resets daily at ${state.resetTime} (${timeZone})`;
}

function populateSettings() {
    document.getElementById('settings-save-status').textContent = 'Changes save automatically on this device.';
    const timeInput = document.getElementById('reset-time');
    const timeZoneSelect = document.getElementById('reset-time-zone');
    timeInput.value = state.resetTime;
    timeZoneSelect.replaceChildren();

    const deviceOption = new Option(`Device: ${getDeviceTimeZone()}`, DEVICE_TIME_ZONE);
    timeZoneSelect.add(deviceOption);
    const timeZones = typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : ['UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland'];
    if (state.timeZone !== DEVICE_TIME_ZONE && !timeZones.includes(state.timeZone)) {
        timeZones.push(state.timeZone);
    }
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
    closeSettings();
    document.getElementById('add-menu').showModal();
}

function closeAddMenu() {
    document.getElementById('add-menu').close();
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

function openPuzzleAction(event, id, action) {
    event.stopPropagation();
    closePuzzleActionMenu();
    if (action === 'resume') return resumeGame(event, id);
    if (action === 'copy') return copyPuzzleLink(id);
    if (action === 'share') return sharePuzzleLink(id);
    if (action === 'up' || action === 'down') return movePuzzle(id, action === 'up' ? -1 : 1);
    if (action === 'reset') return resetPuzzle(id);
    if (action === 'edit') return openPuzzleEditDialog(id);
    if (action === 'mute') return openPuzzleMuteDialog(id);
    if (action === 'remove') return openPuzzleRemoveDialog(id);
    if (action === 'suggest') {
        const game = getGameById(id);
        if (game) openPuzzleSuggestion(game);
    }
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

function closePuzzleActionMenu() {
    document.querySelector('.puzzle-action-menu:popover-open')?.hidePopover();
}

async function resetPuzzle(id) {
    state.playedIds = state.playedIds.filter((playedId) => playedId !== id);
    if (!(await saveData())) return;
    const card = Array.from(document.querySelectorAll('.game-item')).find((item) => item.dataset.id === id);
    if (card) {
        updatePuzzleOpened(card, false);
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
    dialog.showModal();
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
    focusPuzzleActions(game.id);
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
    renderWithPuzzleTransition(game.id);
    scheduleMutedGamesRefresh();
}

async function resumeGame(event, id) {
    event.stopPropagation();
    const game = getGameById(id);
    if (!game) {
        return;
    }
    game.mutedUntil = null;
    closePuzzleActionMenu();
    if (!(await saveData())) return;
    renderWithPuzzleTransition(game.id);
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

    nameInput.setCustomValidity(name ? '' : 'Enter a puzzle name.');
    if (!nameInput.reportValidity() || !urlInput.reportValidity()) return;

    const safeUrl = getSafeHttpUrl(url);
    if (!safeUrl) {
        urlInput.setCustomValidity('Enter a link starting with https:// or http://.');
        urlInput.reportValidity();
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
    document.getElementById('dashboard-status').textContent = `${name} added to your list.`;
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
            if (games.length !== backup.games.length) {
                throw new Error('Backup contains invalid puzzles or duplicate IDs');
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
    if (!hasPuzzle(state.games, gameToRestore)) {
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
    // A tap after dragging must not open the puzzle.
    if (isDragging) {
        event.preventDefault();
        return;
    }
    if (event.target.closest('button, input, select, textarea, label, .drag-handle')) {
        return;
    }

    const card = event.currentTarget;
    if (!event.target.closest('a')) {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
    closePuzzleActionMenu();

    if (!state.playedIds.includes(id)) {
        state.playedIds.push(id);
        if (!(await saveData())) return;
        updatePuzzleOpened(card, true);
        updateProgress();
    }
}

async function resetManual() {
    state.playedIds = [];
    state.lastResetDate = getPuzzleDay(undefined, state);
    if (!(await saveData())) return;
    document.querySelectorAll('.game-item.played').forEach((card) => updatePuzzleOpened(card, false));
    updateProgress();
}

async function reorderGames(idList) {
    const activeGames = state.games.filter((game) => !isGameMuted(game));
    const reordered = idList
        .map((id) => activeGames.find((game) => game.id === id))
        .filter(Boolean);

    if (reordered.length !== activeGames.length) {
        return false;
    }

    let nextActiveGame = 0;
    state.games = state.games.map((game) => isGameMuted(game) ? game : reordered[nextActiveGame++]);
    if (!(await saveData())) return false;
    updateProgress();
    return true;
}

async function movePuzzle(id, direction) {
    const ids = state.games.filter((game) => !isGameMuted(game)).map((game) => game.id);
    const index = ids.indexOf(id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= ids.length) return;
    const game = getGameById(id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    if (!await reorderGames(ids)) return;
    renderWithPuzzleTransition(id);
    document.getElementById('dashboard-status').textContent = `${game.name} moved ${direction < 0 ? 'up' : 'down'}.`;
}

function focusPuzzleActions(id) {
    document.getElementById(`actions-${getPuzzleViewTransitionName(id)}`)?.previousElementSibling?.focus();
}

function updatePuzzleOpened(card, opened) {
    card.classList.toggle('played', opened);
    const label = card.querySelector('.played-label');
    label.hidden = !opened;
    const link = card.querySelector('.game-title');
    if (opened) link.setAttribute('aria-describedby', label.id);
    else link.removeAttribute('aria-describedby');
}

function updateProgress() {
    const activeGames = state.games.filter((game) => !isGameMuted(game));
    const count = state.playedIds.filter((id) => activeGames.some((game) => game.id === id)).length;
    const total = activeGames.length;
    document.getElementById('progress-text').innerText = `${count} of ${total} opened today`;
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
    const muted = isGameMuted(game);
    const active = state.games.filter((saved) => !isGameMuted(saved));
    const position = active.findIndex((saved) => saved.id === game.id);
    const actionButton = (action, label, icon, extraClass = '') => `
        <button type="button" class="${extraClass}" data-action="${action}">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
            <span>${label}</span>
        </button>
    `;

    return [
        isPlayed && !muted ? actionButton('reset', 'Reset', '<path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path>') : '',
        !muted && position > 0 ? actionButton('up', 'Move up', '<path d="m6 14 6-6 6 6"></path>') : '',
        !muted && position >= 0 && position < active.length - 1 ? actionButton('down', 'Move down', '<path d="m6 10 6 6 6-6"></path>') : '',
        actionButton('edit', 'Edit', '<path d="m4 16 8.6-8.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path><path d="m11 9 4 4"></path>'),
        actionButton('copy', 'Copy link', '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V4H4v12h4"></path>'),
        actionButton('share', 'Share link', '<path d="M12 16V3m-4 4 4-4 4 4"></path><path d="M8 11H4v10h16V11h-4"></path>'),
        !isInLibrary(game.url) ? actionButton('suggest', 'Suggest for library', '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 6 9 7 9-7"></path>') : '',
        muted
            ? actionButton('resume', 'Unmute', '<circle cx="12" cy="12" r="8.5"></circle><path d="m10 8 6 4-6 4Z"></path>')
            : actionButton('mute', 'Mute', '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-1.4-1.2-2.7-2.2-4"></path><path d="m4 4 16 16"></path><path d="M10 21h4"></path>'),
        actionButton('remove', 'Remove', '<path d="M4 7h16"></path><path d="M10 11v6M14 11v6"></path><path d="M6 7l1 13h10l1-13"></path><path d="M9 7V4h6v3"></path>', 'menu-action-remove')
    ].join('');
}

function bindPuzzleActionMenu(container, game) {
    const trigger = container.querySelector('.more-actions-btn');
    const menu = container.querySelector('.puzzle-action-menu');
    menu.id = `actions-${getPuzzleViewTransitionName(game.id)}`;
    trigger.setAttribute('aria-label', `More actions for ${game.name}`);
    trigger.setAttribute('popovertarget', menu.id);
    menu.addEventListener('beforetoggle', (event) => {
        if (event.newState === 'open') menu.innerHTML = getPuzzleActionMenuItems(game, state.playedIds.includes(game.id));
    });
    menu.addEventListener('toggle', (event) => {
        trigger.setAttribute('aria-expanded', String(event.newState === 'open'));
        if (event.newState !== 'open') return;
        const rect = trigger.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8))}px`;
    });
    trigger.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        if (!menu.matches(':popover-open')) trigger.click();
        menu.querySelector('button').focus();
    });
    menu.addEventListener('click', (event) => {
        event.stopPropagation();
        const button = event.target.closest('button[data-action]');
        if (button) openPuzzleAction(event, game.id, button.dataset.action);
    });
}

function getPuzzleViewTransitionName(id) {
    let hash = 5381;
    for (const character of id) {
        hash = (hash * 33) ^ character.charCodeAt(0);
    }
    return `puzzle-${(hash >>> 0).toString(36)}`;
}

function renderWithPuzzleTransition(focusId) {
    const update = () => {
        render();
        if (focusId) focusPuzzleActions(focusId);
    };
    if (!canUseViewTransitions()) {
        update();
        return;
    }

    document.startViewTransition(update);
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

        const card = document.createElement('div');
        card.className = `game-card game-item ${isPlayed ? 'played' : ''}`;
        card.dataset.id = game.id;
        card.style.viewTransitionName = getPuzzleViewTransitionName(game.id);
        card.onclick = (event) => handleCardClick(event, game.id, game.url);

        card.innerHTML = `
            <div class="game-main">
                <div class="game-left">
                    <div class="drag-handle" aria-hidden="true">
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
                        <div class="game-link-group">
                            <a class="game-title" target="_blank" rel="noopener noreferrer"></a>
                            <span class="played-label" id="${getPuzzleViewTransitionName(game.id)}-opened" hidden>Opened today</span>
                        </div>
                    </div>
                </div>
                <div class="game-actions">
                    <div class="action-menu-wrap">
                        <button type="button" class="more-actions-btn" aria-label="More actions for puzzle" aria-expanded="false">•••</button>
                        <div class="puzzle-action-menu" popover role="group" aria-label="Puzzle actions">
                            ${getPuzzleActionMenuItems(game, isPlayed)}
                        </div>
                    </div>
                </div>
            </div>
        `;

        const puzzleLink = card.querySelector('.game-title');
        puzzleLink.textContent = game.name;
        puzzleLink.href = game.url;
        updatePuzzleOpened(card, isPlayed);
        bindPuzzleActionMenu(card, game);
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
        item.className = 'recently-removed-item paused-game-item';
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
                <button type="button" class="more-actions-btn" aria-label="More actions for puzzle" aria-expanded="false">•••</button>
                <div class="puzzle-action-menu" popover role="group" aria-label="Puzzle actions">
                    ${getPuzzleActionMenuItems(game, false)}
                </div>
            </div>
        `;
        bindPuzzleActionMenu(actions, game);
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
});

window.addEventListener('DOMContentLoaded', init);
