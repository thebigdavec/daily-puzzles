# Change log

## 2026-08-28

### Puzzle management

- Reframed the product throughout as **Daily Puzzles**: puzzles rather than games, including labels, dialogs, backup filenames, and the Bin.
- Renamed the primary add action to **Add**.
- Replaced per-card edit/remove controls with a prominent three-dot actions menu.
- Added **Edit**, **Mute**, **Remove**, and conditional **Reset** actions for active puzzles. Reset is shown only after a puzzle has been played.
- Added a muted-puzzles section with its own actions menu: **Edit**, **Unmute**, and **Remove**.
- Added labelled Edit and Mute dialogs. Mute defaults to three days for an active puzzle and also supports a specific return date.
- Added a removal choice: send a puzzle to the Bin for seven days or remove it immediately.

### Interaction and motion

- Added soft escape for dialogs: clicking the backdrop cancels the open dialog.
- Added consistent open/close motion for action menus and dialogs, plus visual transitions when puzzles are played, muted, unmuted, removed, restored, or moved between sections.
- Positioned the action menu to the left of its trigger, centred vertically, with anchor positioning where supported and a fallback for other browsers.
- Ensured menus appear above neighbouring puzzle cards and close before opening a puzzle card’s link.
- Respected `prefers-reduced-motion` by avoiding View Transitions and unnecessary exit delays.

### Visual consistency and accessibility

- Introduced a shared, rounded close control for dialogs and panels.
- Standardised button, border, padding, and radius treatment across the interface.
- Added Apple-style symbolic icons to puzzle actions and Settings actions.
- Added visible, compact labels above every form input.

### Settings and documentation

- Restyled Restore defaults, Import, and Export to match the rest of the interface.
- Made the Add and Settings panels mutually exclusive when opened.
- Updated the README to describe puzzle management, muting, the Bin, and import/export behaviour.
