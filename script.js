const DEFAULT_GAMES = [
    { id: 'strands', name: 'Strands', url: 'https://www.nytimes.com/games/strands' },
    { id: 'connections', name: 'Connections', url: 'https://www.nytimes.com/games/connections' },
    { id: 'categories', name: 'Categories', url: 'https://categories.clevergoat.com/' },
    { id: 'wordlinx', name: 'WordLinx', url: 'https://sacsgames.com/wordlinx/' },
    { id: 'onewordsearch', name: 'OneWordSearch', url: 'https://puzzlist.com/onewordsearch/' },
    { id: 'wordle', name: 'Wordle', url: 'https://www.nytimes.com/games/wordle' },
    { id: 'wordly', name: 'Wordly', url: 'https://wordly.org/uk' },
    { id: 'tightrope', name: 'Tightrope', url: 'https://www.britannica.com/quiz/tightrope' },
    { id: 'waffle', name: 'Waffle', url: 'https://wafflegame.net/daily' }
];

const STORAGE_KEY = 'puzzle_dashboard_v3';
const MAX_RECENTLY_REMOVED = 10;
const REMOVE_CONFIRM_TIMEOUT_MS = 3500;

let state = {
    games: [],
    playedIds: [],
    removedGames: [],
    lastResetDate: ''
};

let isDragging = false;
let pendingRemoveId = null;
let removeConfirmTimer = null;

function init() {
    loadData();
    checkMidnightReset();
    render();
    updateDateDisplay();

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

    setInterval(checkMidnightReset, 60000);
}

function loadData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
        state.games = [...DEFAULT_GAMES];
        state.playedIds = [];
        state.removedGames = [];
        state.lastResetDate = getTodayString();
        saveData();
        return;
    }

    try {
        const parsed = JSON.parse(saved);
        const savedGames = Array.isArray(parsed.games) ? parsed.games : [];
        const savedPlayedIds = Array.isArray(parsed.playedIds) ? parsed.playedIds : [];
        const savedRemovedGames = Array.isArray(parsed.removedGames) ? parsed.removedGames : [];
        const savedDate = typeof parsed.lastResetDate === 'string' ? parsed.lastResetDate : getTodayString();

        state.games = savedGames.length ? savedGames : [...DEFAULT_GAMES];
        state.playedIds = savedPlayedIds.filter((id) => state.games.some((game) => game.id === id));
        state.removedGames = savedRemovedGames
            .filter((game) => game && typeof game.id === 'string' && typeof game.name === 'string' && typeof game.url === 'string')
            .filter((game) => !state.games.some((activeGame) => activeGame.id === game.id))
            .slice(0, MAX_RECENTLY_REMOVED);
        state.lastResetDate = savedDate;
        saveData();
    } catch (error) {
        console.error('Failed to parse saved data. Resetting to defaults.', error);
        state.games = [...DEFAULT_GAMES];
        state.playedIds = [];
        state.removedGames = [];
        state.lastResetDate = getTodayString();
        saveData();
    }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getTodayString() {
    return new Date().toDateString();
}

function updateDateDisplay() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').innerText = new Date().toLocaleDateString(undefined, options);
}

function checkMidnightReset() {
    const today = getTodayString();
    if (state.lastResetDate !== today) {
        state.playedIds = [];
        state.lastResetDate = today;
        saveData();
        render();
    }
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

    try {
        new URL(url);
    } catch (error) {
        alert('Please enter a valid URL');
        return;
    }

    state.games.push({
        id: `custom-${Date.now()}`,
        name,
        url
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

function removeGameById(id) {
    const gameToRemove = state.games.find((game) => game.id === id);
    if (!gameToRemove) {
        clearRemoveConfirmation();
        return;
    }

    state.games = state.games.filter((game) => game.id !== id);
    state.playedIds = state.playedIds.filter((playedId) => playedId !== id);
    state.removedGames = [gameToRemove, ...state.removedGames.filter((game) => game.id !== id)].slice(0, MAX_RECENTLY_REMOVED);

    clearRemoveConfirmation();
    saveData();
    render();
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
}

function handleCardClick(id, url) {
    if (isDragging) {
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
        card.onclick = () => handleCardClick(game.id, game.url);

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
                        <span class="remove-confirm-copy">Click X again to confirm</span>
                        <button onclick="removeGame(event, '${game.id}')" class="remove-btn ${isConfirming ? 'is-confirming' : ''}" title="${isConfirming ? 'Click again to remove' : 'Remove Game'}" aria-label="${isConfirming ? 'Confirm remove game' : 'Remove game'}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;

        card.querySelector('.game-title').textContent = game.name;
        container.appendChild(card);
    });

    renderRecentlyRemoved();
    updateProgress();
}

function renderRecentlyRemoved() {
    const section = document.getElementById('recently-removed-section');
    const list = document.getElementById('recently-removed-list');

    list.innerHTML = '';

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

        const restoreButton = document.createElement('button');
        restoreButton.className = 'btn btn-pill btn-restore';
        restoreButton.type = 'button';
        restoreButton.textContent = 'Restore';
        restoreButton.onclick = (event) => restoreRemovedGame(event, game.id);

        item.appendChild(info);
        item.appendChild(restoreButton);
        list.appendChild(item);
    });

    section.hidden = false;
}

window.onload = init;
