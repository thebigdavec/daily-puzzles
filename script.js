import {
    DEFAULT_RESET_TIME,
    DEVICE_TIME_ZONE,
    getDeviceTimeZone,
    getNextResetInstant,
    getPuzzleDay,
    normalizeResetSettings,
    resolveTimeZone
} from './reset-schedule.js';

const DEFAULT_GAMES = [
    { id: 'strands', name: 'Strands', url: 'https://www.nytimes.com/games/strands' },
    { id: 'categories', name: 'Categories', url: 'https://categories.clevergoat.com/' },
    { id: 'wordlinx', name: 'WordLinx', url: 'https://sacsgames.com/wordlinx/' },
    { id: 'onewordsearch', name: 'OneWordSearch', url: 'https://puzzlist.com/onewordsearch/' },
    { id: 'wordle', name: 'Wordle', url: 'https://www.nytimes.com/games/wordle' },
    { id: 'wordly', name: 'Wordly', url: 'https://wordly.org/uk' },
    { id: 'tightrope', name: 'Tightrope', url: 'https://www.britannica.com/quiz/tightrope' },
    { id: 'waffle', name: 'Waffle', url: 'https://wafflegame.net/daily' }
];

const STORAGE_KEY = 'puzzle_dashboard_v3';
const REMOVE_CONFIRM_TIMEOUT_MS = 3500;
const REMOVED_GAME_RETENTION_DAYS = 7;
const REMOVED_GAME_RETENTION_MS = REMOVED_GAME_RETENTION_DAYS * 24 * 60 * 60 * 1000;

let state = {
    games: [],
    playedIds: [],
    removedGames: [],
    lastResetDate: '',
    resetTime: DEFAULT_RESET_TIME,
    timeZone: DEVICE_TIME_ZONE
};

let isDragging = false;
let pendingRemoveId = null;
let removeConfirmTimer = null;
let resetTimer = null;
let removedGamesTimer = null;

function restoreDefaultGamesIfEmpty() {
    if (state.games.length) {
        return false;
    }

    state.games = DEFAULT_GAMES.map((game) => ({ ...game }));
    state.playedIds = [];
    return true;
}

function init() {
    loadData();
    checkDailyReset();
    render();
    updateDateDisplay();
    updateResetSummary();
    scheduleResetCheck();
    scheduleRemovedGamesCleanup();

    const list = document.getElementById('game-list');
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

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            checkDailyReset();
            scheduleResetCheck();
            if (removeExpiredRemovedGames()) {
                saveData();
            }
            render();
            scheduleRemovedGamesCleanup();
        }
    });
}

function loadData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
        restoreDefaultGamesIfEmpty();
        state.removedGames = [];
        state.lastResetDate = getPuzzleDay(undefined, state);
        saveData();
        return;
    }

    try {
        const parsed = JSON.parse(saved);
        const savedGames = Array.isArray(parsed.games) ? parsed.games : [];
        const savedPlayedIds = Array.isArray(parsed.playedIds) ? parsed.playedIds : [];
        const savedRemovedGames = Array.isArray(parsed.removedGames) ? parsed.removedGames : [];
        const resetSettings = normalizeResetSettings(parsed);
        state.resetTime = resetSettings.resetTime;
        state.timeZone = resetSettings.timeZone;
        const savedDate = typeof parsed.lastResetDate === 'string' ? parsed.lastResetDate : '';

        state.games = savedGames.map(normalizeGame).filter(Boolean);
        const restoredDefaultGames = restoreDefaultGamesIfEmpty();
        state.playedIds = restoredDefaultGames
            ? []
            : savedPlayedIds.filter((id) => state.games.some((game) => game.id === id));
        const now = Date.now();
        state.removedGames = savedRemovedGames
            .map((game) => normalizeRemovedGame(game, now))
            .filter(Boolean)
            .filter((game) => !state.games.some((activeGame) => activeGame.id === game.id))
            .filter((game) => !isRemovedGameExpired(game, now));
        state.lastResetDate = migrateLastResetDate(savedDate);
        saveData();
    } catch (error) {
        console.error('Failed to parse saved data. Resetting to defaults.', error);
        state.games = [];
        restoreDefaultGamesIfEmpty();
        state.removedGames = [];
        state.lastResetDate = getPuzzleDay(undefined, state);
        saveData();
    }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeGame(game) {
    if (!game || typeof game.id !== 'string' || !game.id || typeof game.name !== 'string' || !game.name.trim()) {
        return null;
    }

    const url = getSafeHttpUrl(game.url);
    return url ? { id: game.id, name: game.name.trim(), url } : null;
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

    removedGamesTimer = setTimeout(() => {
        if (removeExpiredRemovedGames()) {
            saveData();
        }
        render();
        scheduleRemovedGamesCleanup();
    }, Math.max(0, nextRefreshAt - Date.now()) + 50);
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

function checkDailyReset() {
    const puzzleDay = getPuzzleDay(undefined, state);
    if (state.lastResetDate !== puzzleDay) {
        state.playedIds = [];
        state.lastResetDate = puzzleDay;
        saveData();
        render();
    }
    updateDateDisplay();
}

function scheduleResetCheck() {
    if (resetTimer) {
        clearTimeout(resetTimer);
    }

    const now = Temporal.Now.instant();
    const nextReset = getNextResetInstant(now, state);
    const delay = Number(nextReset.epochMilliseconds - now.epochMilliseconds) + 250;
    resetTimer = setTimeout(() => {
        checkDailyReset();
        scheduleResetCheck();
    }, delay);
}

function updateResetSummary() {
    const timeZone = state.timeZone === DEVICE_TIME_ZONE
        ? `your device timezone (${getDeviceTimeZone()})`
        : state.timeZone;
    document.getElementById('reset-summary').innerText =
        `Click any card to play • Drag anywhere to reorder • Resets daily at ${state.resetTime} (${timeZone})`;
}

function populateSettings() {
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
    menu.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false');
}

function closeSettings() {
    const menu = document.getElementById('settings-menu');
    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true');
}

function saveSettings() {
    const settings = normalizeResetSettings({
        resetTime: document.getElementById('reset-time').value,
        timeZone: document.getElementById('reset-time-zone').value
    });
    state.resetTime = settings.resetTime;
    state.timeZone = settings.timeZone;
    checkDailyReset();
    saveData();
    closeSettings();
    updateDateDisplay();
    updateResetSummary();
    scheduleResetCheck();
}

function openAddMenu() {
    const menu = document.getElementById('add-menu');
    if (menu.classList.contains('is-open')) {
        return;
    }
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

function addNewGame() {
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

    nameInput.value = '';
    urlInput.value = '';
    clearRemoveConfirmation();
    closeAddMenu();
    saveData();
    render();
}

function removeGame(event, id) {
    event.stopPropagation();
    if (pendingRemoveId !== id) {
        startRemoveConfirmation(id);
        render();
        return;
    }

    removeGameById(id);
}

function startRemoveConfirmation(id) {
    pendingRemoveId = id;
    if (removeConfirmTimer) {
        clearTimeout(removeConfirmTimer);
    }
    removeConfirmTimer = setTimeout(() => {
        pendingRemoveId = null;
        removeConfirmTimer = null;
        render();
    }, REMOVE_CONFIRM_TIMEOUT_MS);
}

function clearRemoveConfirmation() {
    pendingRemoveId = null;
    if (removeConfirmTimer) {
        clearTimeout(removeConfirmTimer);
        removeConfirmTimer = null;
    }
}

function cancelRemoveConfirmation(event) {
    event.stopPropagation();
    clearRemoveConfirmation();
    render();
}

function removeGameById(id) {
    const gameToRemove = state.games.find((game) => game.id === id);
    if (!gameToRemove) {
        clearRemoveConfirmation();
        return;
    }

    state.games = state.games.filter((game) => game.id !== id);
    state.playedIds = state.playedIds.filter((playedId) => playedId !== id);
    state.removedGames = [{ ...gameToRemove, removedAt: Date.now() }, ...state.removedGames.filter((game) => game.id !== id)];
    restoreDefaultGamesIfEmpty();

    clearRemoveConfirmation();
    saveData();
    render();
    scheduleRemovedGamesCleanup();
}

function restoreRemovedGame(event, id) {
    event.stopPropagation();
    const gameToRestore = state.removedGames.find((game) => game.id === id);
    if (!gameToRestore) {
        return;
    }

    state.removedGames = state.removedGames.filter((game) => game.id !== id);
    state.games.push(gameToRestore);
    clearRemoveConfirmation();
    saveData();
    render();
    scheduleRemovedGamesCleanup();
}

function permanentlyRemoveGame(event, id) {
    event.stopPropagation();
    state.removedGames = state.removedGames.filter((game) => game.id !== id);
    saveData();
    render();
    scheduleRemovedGamesCleanup();
}

function handleCardClick(event, id, url) {
    // The whole card is a play target, but its controls must never fall
    // through to it. This extra guard is important on touch devices, where a
    // tap can be delivered after a pointer or drag event has already run.
    if (isDragging || event.target.closest('button, a, input, select, textarea, label')) {
        return;
    }

    clearRemoveConfirmation();

    if (!state.playedIds.includes(id)) {
        state.playedIds.push(id);
        saveData();
        render();
    }

    window.open(url, '_blank', 'noopener,noreferrer');
}

function resetManual() {
    state.playedIds = [];
    state.lastResetDate = getPuzzleDay(undefined, state);
    clearRemoveConfirmation();
    saveData();
    render();
}

function reorderGames(idList) {
    const reordered = idList
        .map((id) => state.games.find((game) => game.id === id))
        .filter(Boolean);

    if (reordered.length !== state.games.length) {
        return;
    }

    state.games = reordered;
    saveData();
    updateProgress();
}

function updateProgress() {
    const count = state.playedIds.length;
    const total = state.games.length;
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

function render() {
    const container = document.getElementById('game-list');
    container.innerHTML = '';

    if (pendingRemoveId && !state.games.some((game) => game.id === pendingRemoveId)) {
        clearRemoveConfirmation();
    }

    state.games.forEach((game) => {
        const isPlayed = state.playedIds.includes(game.id);
        const favicon = getFaviconUrl(game.url);
        const isConfirming = pendingRemoveId === game.id;

        const card = document.createElement('div');
        card.className = `game-card game-item ${isPlayed ? 'played' : ''}`;
        card.dataset.id = game.id;
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
                        <span class="game-title"></span>
                    </div>
                </div>
                <div class="game-actions">
                    <div class="remove-confirm-wrap ${isConfirming ? 'is-confirming' : ''}">
                        <button type="button" class="remove-confirm-copy" aria-label="Cancel removing game">Click X again to confirm</button>
                        <button type="button" class="remove-btn ${isConfirming ? 'is-confirming' : ''}" title="${isConfirming ? 'Click again to remove' : 'Remove Game'}" aria-label="${isConfirming ? 'Confirm remove game' : 'Remove game'}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;

        card.querySelector('.game-title').textContent = game.name;
        const cancelRemoveButton = card.querySelector('.remove-confirm-copy');
        cancelRemoveButton.setAttribute('aria-label', `Cancel removing ${game.name}`);
        cancelRemoveButton.onclick = cancelRemoveConfirmation;
        const removeButton = card.querySelector('.remove-btn');
        // Keep Sortable's card-wide touch handling away from the remove
        // control. The click handler below still performs the confirmation.
        ['pointerdown', 'touchstart'].forEach((eventName) => {
            removeButton.addEventListener(eventName, (event) => event.stopPropagation());
            cancelRemoveButton.addEventListener(eventName, (event) => event.stopPropagation());
        });
        removeButton.onclick = (event) => removeGame(event, game.id);
        container.appendChild(card);
    });

    renderRecentlyRemoved();
    updateProgress();
}

function renderRecentlyRemoved() {
    const section = document.getElementById('recently-removed-section');
    const list = document.getElementById('recently-removed-list');

    list.innerHTML = '';

    if (removeExpiredRemovedGames()) {
        saveData();
    }

    if (!state.removedGames.length) {
        section.hidden = true;
        return;
    }

    state.removedGames.forEach((game) => {
        const item = document.createElement('li');
        item.className = 'recently-removed-item';

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
        trashButton.textContent = 'Trash';
        trashButton.setAttribute('aria-label', `Permanently remove ${game.name}`);
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
    closeSettings,
    openAddMenu,
    openSettings,
    resetManual,
    saveSettings
});

window.addEventListener('DOMContentLoaded', init);
