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
- Opens a puzzle in a new tab and marks it as played when you select its card.
- Shows a simple played/total progress count.
- Supports drag-and-drop reordering, including on touch devices.
- Resets played puzzles manually or automatically at a configurable time.
- Lets you use either the device time zone or a specific IANA time zone, such as `Europe/London`.
- Lets you restore the original curated puzzle list from **Settings** whenever you want a clean start.
- Lets you export the current puzzle list as a JSON backup and import it on another device. Importing replaces the list and clears today’s progress.
- Sends removed puzzles to a **Bin** for seven days, where they can be restored or removed immediately.

## Run locally

Serve the project directory with any static file server, then open the local address it prints. For example, with Python 3:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) in a modern browser.

Opening `index.html` directly may work in some browsers, but using a local server is recommended because the app uses JavaScript modules.

## Daily reset behaviour

In **Settings**, choose a reset time and time zone. The dashboard treats the period between two reset times as one puzzle day. For example, with a `04:00` reset in `Europe/London`, a puzzle opened at 03:30 belongs to the previous puzzle day; it becomes available again at 04:00.

The scheduler uses browser-native `Date` and `Intl` APIs, so it works in Safari on iPhone while reset boundaries continue to follow civil time and daylight-saving changes. The app also checks the schedule whenever the tab becomes visible, so missed timers do not leave stale progress behind.

## Data and privacy

All application state is stored locally in the browser under the `puzzle_dashboard_v3` localStorage key. Clearing site data or local storage resets the dashboard to its default puzzles. Use **Export** in Settings to keep a portable backup of a puzzle list; **Import** accepts that JSON backup on this or another device.

No puzzle list or progress is sent to an application server. The page does load SortableJS from cdnjs for drag-and-drop and requests each puzzle's favicon through Google's favicon service; those resources require network access.

## Browser support

Use a current browser with ES module and `Intl.DateTimeFormat` support. The reset settings screen also uses `Intl.supportedValuesOf()` when available to offer the full time-zone list; browsers without it receive a useful set of common zones.

## Tests

Run catalogue, search, duplicate-link, email-draft and reset checks with Node.js 22 or newer:

```sh
node --test test/library.test.js
```

The focused reset-schedule checks cover reset boundaries, distant time zones, daylight-saving behaviour, and invalid settings. Serve the project locally, then open:

```text
http://localhost:8000/test/reset-schedule.html
```

The page reports either **All reset schedule tests passed** or the failing assertion.

## Project layout

| Path                          | Purpose                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| `index.html`                  | Application structure and controls.                                  |
| `main.css`                    | Dashboard layout, responsive styling, and interaction states.        |
| `script.js`                   | UI rendering, local persistence, puzzle management, and scheduling.  |
| `library-games.js`            | Curated catalogue, publisher evidence and review dates.              |
| `library.js`                  | Library search, personal-list additions and suggestion email drafts. |
| `library.css`                 | Responsive library layout.                                           |
| `reset-schedule.js`           | Time-zone-aware puzzle-day and next-reset calculations.              |
| `test/reset-schedule.html`    | Browser test runner.                                                 |
| `test/reset-schedule.test.js` | Reset-scheduling test cases.                                         |

## Reviewing suggestions

Suggestions arrive by email to **dave@davecollison.dev**. There is no admin approval button; adding an approved suggestion means updating the catalogue and publishing the site.

1. Open the suggested game and check that it is free to play, works in a browser, has a simple HTTP(S) link and suits a daily routine. Optional accounts, paid extras and archives are fine. Unlimited games are also welcome when they suit a once-a-day routine.
2. Add an entry to the `LIBRARY_GAMES` array in `library-games.js`, before the closing `].map(...)`. Include a unique `id`, `name`, `url`, `category`, short `description`, publisher information URL in `source`, and the date you checked it in `checkedOn` (`YYYY-MM-DD`). Use an existing category: `Words`, `Numbers`, `Logic` or `Geography`.
3. Format the changed file and run `node --test test/library.test.js`. Check the new entry in the local library view.
4. Publish the updated site to GitHub Pages. The new entry becomes available to visitors after publication; their personal lists stay in local storage.

For help, paste the emailed suggestion into Codex and say **“Add this to the library.”** Codex can check the game and make the catalogue change for you.

The initial catalogue was checked against publisher pages on 13 October 2026; availability may change.

Games already in the library cannot be suggested through the form; matching uses the puzzle link, even if its name has changed.

There is no server-side suggestion storage. The form prepares an email and provides copyable text if no email handler opens. Preparing a draft does not prove that it was sent or received.

This repository has no configured formatter or formatter command. Match the existing source style when editing; do not introduce a formatting dependency just for a change.
