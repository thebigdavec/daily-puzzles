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

        let state = {
            games: [],
            playedIds: [],
            lastResetDate: ''
        };

        let isDragging = false;

        function init () {
            loadData();
            checkMidnightReset();
            render();
            updateDateDisplay();

            const el = document.getElementById('game-list');
            Sortable.create(el, {
                animation: 250,
                delay: 100,
                delayOnTouchOnly: false,
                touchStartThreshold: 5,
                ghostClass: 'sortable-ghost',
                dragClass: 'sortable-drag',
                onStart: function () {
                    isDragging = true;
                },
                onEnd: function () {
                    setTimeout(() => { isDragging = false; }, 50);
                    const newOrder = Array.from(el.children).map(item => item.dataset.id);
                    reorderGames(newOrder);
                }
            });

            setInterval(checkMidnightReset, 60000);
        }

        function loadData () {
            const saved = localStorage.getItem('puzzle_dashboard_v3');
            if (saved) {
                state = JSON.parse(saved);
            } else {
                state.games = [...DEFAULT_GAMES];
                state.playedIds = [];
                state.lastResetDate = getTodayString();
                saveData();
            }
        }

        function saveData () {
            localStorage.setItem('puzzle_dashboard_v3', JSON.stringify(state));
        }

        function getTodayString () {
            return new Date().toDateString();
        }

        function updateDateDisplay () {
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            document.getElementById('current-date').innerText = new Date().toLocaleDateString(undefined, options);
        }

        function checkMidnightReset () {
            const today = getTodayString();
            if (state.lastResetDate !== today) {
                state.playedIds = [];
                state.lastResetDate = today;
                saveData();
                render();
            }
        }

        function openAddMenu () {
            const menu = document.getElementById('add-menu');
            if (menu.classList.contains('is-open')) return;
            menu.classList.add('is-open');
            menu.setAttribute('aria-hidden', 'false');
        }

        function closeAddMenu () {
            const menu = document.getElementById('add-menu');
            if (!menu.classList.contains('is-open')) return;
            menu.classList.remove('is-open');
            menu.setAttribute('aria-hidden', 'true');
        }

        function addNewGame () {
            const nameInput = document.getElementById('new-game-name');
            const urlInput = document.getElementById('new-game-url');

            if (!nameInput.value || !urlInput.value) return;

            const newGame = {
                id: 'custom-' + Date.now(),
                name: nameInput.value,
                url: urlInput.value
            };

            state.games.push(newGame);
            nameInput.value = '';
            urlInput.value = '';

            closeAddMenu();
            saveData();
            render();
        }

        function removeGame (event, id) {
            event.stopPropagation();
            state.games = state.games.filter(g => g.id !== id);
            state.playedIds = state.playedIds.filter(pid => pid !== id);
            saveData();
            render();
        }

        function handleCardClick (id, url) {
            if (isDragging) return;

            if (!state.playedIds.includes(id)) {
                state.playedIds.push(id);
                saveData();
                render();
            }

            window.open(url, '_blank');
        }

        function resetManual () {
            state.playedIds = [];
            saveData();
            render();
        }

        function reorderGames (idList) {
            const newGames = idList.map(id => state.games.find(g => g.id === id));
            state.games = newGames;
            saveData();
            updateProgress();
        }

        function updateProgress () {
            const count = state.playedIds.length;
            const total = state.games.length;
            document.getElementById('progress-text').innerText = `${count}/${total}`;
        }

        function getFaviconUrl (gameUrl) {
            try {
                const url = new URL(gameUrl);
                return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
            } catch (e) {
                return '';
            }
        }

        function render () {
            const container = document.getElementById('game-list');
            container.innerHTML = '';

            state.games.forEach(game => {
                const isPlayed = state.playedIds.includes(game.id);
                const favicon = getFaviconUrl(game.url);

                const card = document.createElement('div');
                card.className = `game-card flex items-center justify-between p-4 rounded-xl ${isPlayed ? 'played' : ''}`;
                card.dataset.id = game.id;
                card.onclick = () => handleCardClick(game.id, game.url);

                card.innerHTML = `
                    <div class="flex items-center gap-4 flex-1 min-w-0 pointer-events-none">
                        <div class="drag-handle opacity-30 p-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
                        </div>
                        <div class="flex items-center gap-3 min-w-0 flex-1">
                            <img src="${favicon}" 
                                 class="game-logo" 
                                 alt="" 
                                 onerror="this.style.display='none'; this.nextElementSibling.style.display='block'">
                            <div class="hidden text-indigo-400" style="display:none">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                            </div>
                            <span class="game-title text-base font-semibold truncate">
                                ${game.name}
                            </span>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="removeGame(event, '${game.id}')" class="p-2 text-rose-500 opacity-20 hover:opacity-100 transition-opacity pointer-events-auto" title="Remove Game">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                `;
                container.appendChild(card);
            });

            updateProgress();
        }

        window.onload = init;
