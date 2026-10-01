---
description: Open the Libadwaita preferences dialog inside the nested shell and describe it
argument-hint: "[optional: which page or setting to show, e.g. 'Patterns page']"
allowed-tools: Bash(./scripts/nested.sh:*), Read
---

Open the settings dialog in this repository's **nested shell**, where the user
watches it in the mirror window and whatever it changes goes to the nested
shell's own settings. Never on the user's desktop: `make prefs` and
`./scripts/dev.sh prefs` open it in the real session, where every change writes
their real dconf; that is theirs to run.

Requested: $ARGUMENTS

1. `./scripts/nested.sh start` (reuses one if running; opens the mirror; add
   `--clean` for every key at its default).
2. `./scripts/nested.sh run gnome-extensions prefs wallpaper-fx@jackicus`. It
   returns once the request is sent; give the window a second.
3. In **one** `./scripts/nested.sh do …` call: `say` what is shown, `wait 1`,
   any clicks the request needs, then `shot <scratchpad>/prefs.png` (there is no
   `window` step: crop the `shot` to the dialog).
4. **Read the PNG** and describe what's on screen: the page, its rows, anything
   cut off or broken.
5. `./scripts/nested.sh stop` when done, even if a step failed. It closes the
   dialog and the mirror with the shell.

Changes made there land in the nested settings, and the running extension
repaints on the key change, with no reload. The Extensions app keeps the
`prefs.js` it first imported: after editing it, `stop` and `start` before opening
it again. If the dialog doesn't appear or shows an error, a `prefs.js` exception
shows in the dialog itself and in `./scripts/nested.sh logs 80 --all` (the nested
bus's activations log there), and usually means a schema key the dialog binds to
is missing (`glib-compile-schemas src/schemas` after editing the gschema, then
`stop` + `start`).
