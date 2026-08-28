# Mobile app-style navigation

## Goal

On a phone, management actions should feel like navigating to a new screen rather than opening a floating panel. Selecting **Add**, **Settings**, **Edit**, **Mute**, or **Remove** moves the puzzle list left and brings the selected controls in from the right as a full page.

This is deliberately an Apple-style pattern: one focused task per screen, a clear back affordance, and a horizontal transition that explains where the new screen came from.

## Scope

- Apply the pattern at the phone breakpoint only; keep the current pane/dialog treatment on larger screens.
- Treat these as mobile pages: Add puzzle, Settings, Edit puzzle, Mute puzzle, and Remove puzzle.
- Preserve the existing behaviour and validation for every action.
- Continue to honour `prefers-reduced-motion`.

## Interaction model

1. The puzzle list is the root page.
2. Selecting an action pushes a named management page onto the app’s mobile navigation stack.
3. The root page translates left as the new page enters from the right. The incoming page takes the full viewport, including the safe-area inset where supported.
4. Each management page has a compact navigation bar with a left-facing **Back** control and its title. The destructive Remove page should still use a clear, destructive primary action.
5. Back, Cancel, tapping the browser back button, and iOS edge-swipe navigation all return to the previous page without applying changes.
6. Save, Mute, Remove, Restore, and Unmute apply their change, animate back to the list, and leave focus on the changed puzzle where practical.
7. If the user has changed a form, Back/Cancel should ask whether to discard those changes before leaving.

## Technical approach

- Introduce a small mobile navigation state, for example `activeMobilePage` plus the selected puzzle id.
- Reflect that state in browser history (for example, `?page=edit&id=…`) and handle `popstate`. This makes physical/browser Back work correctly and allows a page to be re-opened reliably.
- Render the root list and management pages inside a single horizontal page track. Use CSS transforms for the slide; avoid animating layout properties.
- Use the View Transitions API only as progressive enhancement. The CSS slide must remain the reliable fallback, and reduced-motion users should see an immediate page swap.
- Keep the existing `dialog` implementation for tablet and desktop. Mobile pages should reuse the same form fields and save/remove functions so that validation and data handling stay in one place.
- Trap focus within the active mobile page while it is visible, restore focus to its invoking control on return, and keep all controls keyboard-accessible.

## Acceptance criteria

- At phone width, every listed action opens as a full-screen page rather than a dialog or floating pane.
- The list visibly slides left and the new page slides in from the right; reverse motion is used when returning.
- Browser Back and the page’s Back control both return to the prior page without saving.
- Form validation, mute defaults, Bin handling, and reset behaviour continue to work unchanged.
- Reduced-motion mode has no sliding or View Transition animation.
- Desktop and tablet retain their current dialog/pane experience.
