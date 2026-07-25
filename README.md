# Daily Puzzles

Daily Puzzles is a small, browser-based dashboard for keeping a personal list of the puzzles you play each day. Add game links, work through them in any order, and let the dashboard clear your completed state when your chosen puzzle day begins.

It is intentionally a static site: there is no build step, account, server, or database. Your list and progress stay in your browser.

## What it does

- Starts with a curated list of daily puzzle links.
- Lets you add your own HTTP or HTTPS game links.
- Opens a game in a new tab and marks it as played when you select its card.
- Shows a simple played/total progress count.
- Supports drag-and-drop reordering, including on touch devices.
- Resets played games manually or automatically at a configurable time.
- Lets you use either the device time zone or a specific IANA time zone, such as `Europe/London`.
- Lets you restore the original curated game list from **Settings** whenever you want a clean start.
- Lets you export the current game list as a JSON backup and import it on another device. Importing replaces the list and clears today’s progress.
- Keeps removed games in a **Recently Removed** area for seven days, where they can be restored or permanently trashed.

## Run locally

Serve the project directory with any static file server, then open the local address it prints. For example, with Python 3:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) in a modern browser.

Opening `index.html` directly may work in some browsers, but using a local server is recommended because the app uses JavaScript modules.

## Daily reset behaviour

In **Settings**, choose a reset time and time zone. The dashboard treats the period between two reset times as one puzzle day. For example, with a `04:00` reset in `Europe/London`, a game played at 03:30 belongs to the previous puzzle day; it becomes available again at 04:00.

The scheduler uses browser-native `Date` and `Intl` APIs, so it works in Safari on iPhone while reset boundaries continue to follow civil time and daylight-saving changes. The app also checks the schedule whenever the tab becomes visible, so missed timers do not leave stale progress behind.

## Data and privacy

All application state is stored locally in the browser under the `puzzle_dashboard_v3` localStorage key. Clearing site data or local storage resets the dashboard to its default games. Use **Export** in Settings to keep a portable backup of a game list; **Import** accepts that JSON backup on this or another device.

No game list or progress is sent to an application server. The page does load SortableJS from cdnjs for drag-and-drop and requests each game's favicon through Google's favicon service; those resources require network access.

## Browser support

Use a current browser with ES module and `Intl.DateTimeFormat` support. The reset settings screen also uses `Intl.supportedValuesOf()` when available to offer the full time-zone list; browsers without it receive a useful set of common zones.

## Tests

The focused reset-schedule checks cover reset boundaries, distant time zones, daylight-saving behaviour, and invalid settings. Serve the project locally, then open:

```text
http://localhost:8000/test/reset-schedule.html
```

The page reports either **All reset schedule tests passed** or the failing assertion.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Application structure and controls. |
| `main.css` | Dashboard layout, responsive styling, and interaction states. |
| `script.js` | UI rendering, local persistence, game management, and scheduling. |
| `reset-schedule.js` | Time-zone-aware puzzle-day and next-reset calculations. |
| `test/reset-schedule.html` | Browser test runner. |
| `test/reset-schedule.test.js` | Reset-scheduling test cases. |
