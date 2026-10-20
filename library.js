import { LIBRARY_GAMES } from './library-games.js?v=4';

export function puzzleUrlKey(value) {
    try {
        const url = new URL(value);
        if (
            !['https:', 'http:'].includes(url.protocol) ||
            url.username ||
            url.password
        )
            return null;
        return `${url.host.replace(/^www\./, '')}${url.pathname.replace(/\/(?:index\.html)?$/, '')}${url.search}`;
    } catch {
        return null;
    }
}

export function hasPuzzle(games, candidate) {
    const key = puzzleUrlKey(candidate.url);
    return games.some((game) => game.id === candidate.id ||
        (key !== null && puzzleUrlKey(game.url) === key));
}

export function isInLibrary(url) {
    const key = puzzleUrlKey(url);
    return LIBRARY_GAMES.some((game) => puzzleUrlKey(game.url) === key);
}

export function filterLibrary(search, category) {
    const query = search.trim().toLowerCase();
    return LIBRARY_GAMES.filter(
        (game) =>
            (!category || game.category === category) &&
            `${game.name} ${game.description} ${game.category}`
                .toLowerCase()
                .includes(query)
    );
}

export function suggestionEmail(name, url, notes) {
    if (!name.trim() || !puzzleUrlKey(url))
        throw new Error('Enter a name and a valid http or https puzzle link.');
    if (isInLibrary(url))
        throw new Error('This puzzle is already in the library.');
    const body = `Puzzle suggestion\n\nName: ${name.trim()}\nLink: ${new URL(url).href}\n\nFree to play in a browser: yes\nSuitable for a daily routine: yes\n\nNotes: ${notes.trim() || 'None'}\n\nPlease review before adding to the puzzle library.`;
    return {
        body,
        href: `mailto:dave@davecollison.dev?subject=${encodeURIComponent(`Puzzle suggestion: ${name.trim()}`)}&body=${encodeURIComponent(body)}`
    };
}

export function openPuzzleSuggestion(game) {
    const form = document.getElementById('suggest-puzzle-form');
    form.reset();
    document.getElementById('suggest-name').value = game.name;
    document.getElementById('suggest-url').value = game.url;
    document.getElementById('suggest-status').textContent = '';
    document.getElementById('suggest-fallback').hidden = true;
    document.getElementById('suggest-email-text').value = '';
    form.closest('details').open = true;
    document.getElementById('open-library').click();
    document.getElementById('suggest-notes').focus();
}

export function initLibrary({ getGames, addGame }) {
    const dialog = document.getElementById('library-dialog');
    const search = document.getElementById('library-search');
    const category = document.getElementById('library-category');
    const status = document.getElementById('library-status');
    for (const name of new Set(LIBRARY_GAMES.map((game) => game.category))) {
        category.append(element('option', '', name));
    }

    function renderLibrary() {
        const savedGames = getGames();
        const matches = filterLibrary(search.value, category.value)
            .map((game) => ({
                game,
                added: hasPuzzle(savedGames, game)
            }))
            .sort((a, b) => Number(a.added) - Number(b.added));
        document.getElementById('library-count').textContent =
            `${matches.length} of ${LIBRARY_GAMES.length} puzzles`;
        const list = document.getElementById('library-games');
        list.replaceChildren();
        if (!matches.length)
            list.append(
                element(
                    'p',
                    'library-copy',
                    'No puzzles match. Try another search or category.'
                )
            );
        for (const { game, added } of matches) {
            const card = element('article', 'library-card');
            card.dataset.gameId = game.id;
            const header = element('div', 'library-card-header');
            header.append(element('p', 'library-meta', game.category));
            if (!added) {
                const link = element('a', 'library-link', 'Try it ↗');
                Object.assign(link, {
                    href: game.url,
                    title: game.url,
                    target: '_blank',
                    rel: 'noopener noreferrer'
                });
                link.setAttribute(
                    'aria-label',
                    `Try ${game.name} in a new tab`
                );
                header.append(link);
            }
            const title = element('h3', 'library-card-title', game.name);
            card.append(
                header,
                title,
                element('p', 'library-copy', game.description)
            );
            const button = element('button', '');
            button.type = 'button';
            setAddButton(button, game.name, added);
            button.addEventListener('click', async () => {
                const restoreFocus = document.activeElement === button;
                button.disabled = true;
                if (!await addGame(game)) {
                    button.disabled = false;
                    status.textContent = 'Could not add this puzzle. Please try again.';
                    return;
                }
                button.textContent = '✓ Added';
                status.textContent = `${game.name} added to your list.`;
                button.setAttribute('aria-label', `${game.name} is in your list`);
                title.tabIndex = -1;
                if (restoreFocus && dialog.open && button.isConnected &&
                    (document.activeElement === button || document.activeElement === document.body)) {
                    title.focus({ preventScroll: true });
                }
            });
            if (added) title.append(button);
            else card.append(button);
            list.append(card);
        }
    }

    document.getElementById('open-library').addEventListener('click', () => {
        renderLibrary();
        status.textContent = '';
        dialog.showModal();
    });
    document
        .getElementById('close-library')
        .addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
    search.addEventListener('input', renderLibrary);
    category.addEventListener('change', renderLibrary);
    document
        .getElementById('suggest-puzzle-form')
        .addEventListener('submit', (event) => {
            event.preventDefault();
            const feedback = document.getElementById('suggest-status');
            try {
                const email = suggestionEmail(
                    document.getElementById('suggest-name').value,
                    document.getElementById('suggest-url').value,
                    document.getElementById('suggest-notes').value
                );
                document.getElementById('suggest-email-text').value =
                    email.body;
                document.getElementById('suggest-fallback').hidden = false;
                feedback.textContent =
                    'Your email draft is ready. Send it from your email app to submit your suggestion.';
                window.location.href = email.href;
            } catch (error) {
                feedback.textContent = error.message;
            }
        });
}

function element(tag, className, text = '') {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

function setAddButton(button, name, added) {
    button.className = added ? 'library-added' : 'btn btn-pill btn-primary';
    button.textContent = added ? '✓' : '+ Add to my list';
    button.disabled = added;
    button.setAttribute(
        'aria-label',
        added ? `${name} is in your list` : `Add ${name} to my list`
    );
    button.title = added ? 'In your list' : 'Add to my list';
}
