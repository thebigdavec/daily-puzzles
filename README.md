# Daily Puzzles

Daily Puzzles is a small, browser-based dashboard for keeping a personal list of the puzzles you play each day. Add puzzle links, work through them in any order, and let the dashboard clear your completed state when your chosen puzzle day begins.

It is intentionally a static site: there is no build step, account, server, or database. Your list and progress stay in your browser.

## What it does

- Starts with a curated list of daily puzzle links.
- Offers a searchable **Library** of free browser puzzles, with category filters and an **Add to my list** button. Games already in your list, including muted games, cannot be added twice.
- Includes daily releases and unlimited games that suit a once-a-day routine.
- Includes **Suggest for library** in the action menu for puzzles outside the library, opening the suggestion form with its name and link filled in.
- Lets visitors suggest puzzles by preparing an email to `dave@davecollison.dev`. Visitors send the draft from their email app; suggestions do not publish automatically.
- Lets you add your own HTTP or HTTPS puzzle links.
- Lets you rename a puzzle, change its link, or mute it temporarily; muted puzzles remain available through the three-dot action menu.
- Opens a puzzle in a new tab and marks it as played when you select its card or activate its keyboard-accessible title link.
- Shows a simple played/total progress count.
- Supports drag-and-drop reordering, including on touch devices.
- Resets played puzzles manually or automatically at a configurable time.
- Lets you use either the device time zone or a specific IANA time zone, such as `Europe/London`.
- Lets you restore the original curated puzzle list from **Settings** whenever you want a clean start.
- Lets you export the current puzzle list as a JSON backup and import it on another device. Importing replaces the list and clears today’s progress.
- Sends removed puzzles to a **Bin** for seven days, where they can be restored or removed immediately.
- Keeps an intentionally empty list empty after reload. The empty view has a **Use default list** button, with **Library** and **Add** in the header. Restoring defaults asks before clearing progress and the Bin.
- Refreshes other open tabs when the saved list changes. Conflicting saves load the latest data and ask you to retry, rather than overwrite it.

## Default list

Puzzle details live once, in `library-games.js`. Give a library entry a positive integer `defaultOrder` to include it in the default list: `1` appears first, `2` second, and so on. Each position must be unique. Leave `defaultOrder` out for puzzles available only in the library.

New lists and **Use default list** use those entries in numbered order. Existing personal lists keep their saved names, links and order until the user restores defaults.

The **Add** form still needs only a puzzle name and link. It appends the puzzle to the user's personal list, where it can be dragged into position. User-added puzzles need neither a library entry nor a `defaultOrder` value.

Library category choices also come from the catalogue entries, in their first-seen order. The shared `hasPuzzle()` check recognises an existing puzzle by its ID or equivalent link when displaying the library, adding from it or restoring from the Bin. Muted puzzles count as existing entries.

Active and muted puzzle menus share their markup and event bindings. Their available actions depend on whether the puzzle is played, muted or already in the library. Dashboard updates, including startup, use `refreshDashboard()`.

## Run locally

Serve the project directory with any static file server, then open the local address it prints. For example, with Python 3:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) in a modern browser.

Opening `index.html` directly may work in some browsers, but using a local server is recommended because the app uses JavaScript modules.

## Daily reset behaviour

Changes to the reset time and time zone save automatically on this device. Settings shows a confirmation after saving, or an error if the change could not be saved.

In **Settings**, choose a reset time and time zone. The dashboard treats the period between two reset times as one puzzle day. For example, with a `04:00` reset in `Europe/London`, a puzzle opened at 03:30 belongs to the previous puzzle day; it becomes available again at 04:00.

When the clocks go back, a reset in the repeated hour happens at its first occurrence. When the clocks go forward, a missing reset time moves forward by the clock change: a London `01:30` reset happens at `02:30` that morning. Progress and the next-reset timer use the same boundary. Long mute waits are capped at one day; the app also checks mute dates when the tab becomes visible.

The scheduler uses browser-native `Date` and `Intl` APIs, so it works in Safari on iPhone while reset boundaries continue to follow civil time and daylight-saving changes. The app also checks the schedule whenever the tab becomes visible, so missed timers do not leave stale progress behind.

## Data and privacy

All application state is stored locally in the browser under the `puzzle_dashboard_v3` localStorage key. Clearing site data or local storage resets the dashboard to its default puzzles. Use **Export** in Settings to keep a portable backup of a puzzle list, including an empty list; **Import** accepts that version 1 JSON backup on this or another device. Import accepts files up to 1 MB and asks before replacing your list and clearing progress and the Bin. Backups contain puzzle links and mute dates, not reset settings or played progress.

Loading saved data does not write it back. Read or write failures show an error and preserve the stored data. Saves use browser Web Locks to serialise writes across tabs and check that the saved copy is still current before replacing it.

No puzzle list or progress is sent to an application server. The page loads SortableJS from cdnjs for drag-and-drop, Manrope from Google Fonts, and puzzle favicons through Google's favicon service. Those resources require network access.

## Browser support

Use a current Chrome, Edge, Firefox or Safari with ES modules, `Intl.DateTimeFormat` and Web Locks support. Saving requires a secure context: the published HTTPS site, or a local server on `localhost` / `127.0.0.1`. The reset settings screen also uses `Intl.supportedValuesOf()` when available to offer the full time-zone list; browsers without it receive a useful set of common zones.

## Tests

Run catalogue, search, duplicate-link, email-draft, reset and automatic settings-save checks with Node.js 22 or newer:

```sh
node --test test/dashboard.test.js test/library.test.js test/settings.test.js
```

The checks cover storage failures, stale and simultaneous tab saves, fast settings changes, empty-list removal and restoration, long mute timers, puzzle-link behaviour, shared active/muted menus, duplicate matching, generated category choices, catalogue filters, suggestions, reset boundaries, distant time zones and both daylight-saving transitions. The focused reset-schedule checks can also run in a browser. Serve the project locally, then open:

```text
http://localhost:8000/test/reset-schedule.html
```

The page reports either **All reset schedule tests passed** or the failing assertion.

## Project layout

| Path                          | Purpose                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- |
| `index.html`                  | Application structure and controls.                                       |
| `main.css`                    | Dashboard layout, responsive styling, and interaction states.             |
| `script.js`                   | UI rendering, local persistence, puzzle management, and scheduling.       |
| `library-games.js`            | Curated catalogue, publisher evidence and review dates.                   |
| `library.js`                  | Library search, personal-list additions and suggestion email drafts.      |
| `library.css`                 | Responsive library layout.                                                |
| `reset-schedule.js`           | Time-zone-aware puzzle-day and next-reset calculations.                   |
| `test/dashboard.test.js`      | Storage, concurrency, empty-list, mute-timer and puzzle-link regressions. |
| `test/settings.test.js`       | Automatic settings saves, validation and failure feedback.                |
| `test/helpers/dashboard.js`   | Isolated dashboard harness using fake browser storage and locks.          |
| `test/reset-schedule.html`    | Browser test runner.                                                      |
| `test/reset-schedule.test.js` | Reset-scheduling test cases.                                              |

## Reviewing suggestions

Suggestions arrive by email to **dave@davecollison.dev**. There is no admin approval button; adding an approved suggestion means updating the catalogue and publishing the site.

1. Open the suggested game and check that it is free to play, works in a browser, has a simple HTTP(S) link and suits a daily routine. Optional accounts, paid extras and archives are fine. Unlimited games are also welcome when they suit a once-a-day routine.
2. Add an entry to the `LIBRARY_GAMES` array in `library-games.js`, before the closing `].map(...)`. Include a unique `id`, `name`, `url`, `category`, short `description`, publisher information URL in `source`, and the date you checked it in `checkedOn` (`YYYY-MM-DD`). Reuse a suitable category from the catalogue; the filter options are generated automatically.
3. Format the changed file and run `node --test test/library.test.js`. Check the new entry in the local library view.
4. Publish the updated site to GitHub Pages. The new entry becomes available to visitors after publication; their personal lists stay in local storage.

For help, paste the emailed suggestion into Codex and say **“Add this to the library.”** Codex can check the game and make the catalogue change for you.

Catalogue entries carry their own `checkedOn` dates. Those dates record editorial checks; availability may change.

Games already in the library cannot be suggested through the form; matching uses the puzzle link, even if its name has changed.

There is no server-side suggestion storage. The form prepares an email and provides copyable text if no email handler opens. Preparing a draft does not prove that it was sent or received.

## Publishing

GitHub Pages serves the repository root from `main` at [Daily Puzzles](https://thebigdavec.github.io/daily-puzzles/). There is no build command. Run the checks above, commit the changes and push `main`, then verify the **pages build and deployment** run succeeds for that commit and check the live site.

When changing browser-loaded JavaScript or CSS, update its version query in `index.html` or its importing module so returning browsers load the new files.

This repository has no configured formatter or formatter command. Match the existing source style when editing; do not introduce a formatting dependency just for a change.
