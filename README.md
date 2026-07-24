# daily-puzzles

A draggable list of puzzles to play each day. Progress resets at a user-chosen
time in either the device timezone or a selected IANA timezone. The app uses
the native [Temporal API](https://tc39.es/proposal-temporal/docs/) for the reset
schedule, including daylight-saving transitions.

Open `test/reset-schedule.html` in a current browser to run the focused reset
schedule checks.
