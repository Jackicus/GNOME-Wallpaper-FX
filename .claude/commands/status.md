---
description: Report the nested shell's state and what it draws, then the install mode and the real session's state (read-only)
allowed-tools: Bash(make status), Bash(./scripts/dev.sh status), Bash(./scripts/nested.sh status), Bash(./scripts/nested.sh run timeout 5 gsettings --schemadir src/schemas get:*), Bash(./scripts/nested.sh run timeout 5 gsettings --schemadir src/schemas list-recursively:*), Bash(readlink:*)
---

Run `./scripts/nested.sh status`, `./scripts/dev.sh status` and
`readlink ~/.local/share/gnome-shell/extensions/wallpaper-fx@jackicus/extension.js`.
If a nested shell is running, also read what it draws with
`./scripts/nested.sh run timeout 5 gsettings --schemadir src/schemas get
org.gnome.shell.extensions.wallpaper-fx <key>` (or `list-recursively
org.gnome.shell.extensions.wallpaper-fx` for the lot). Report in two parts.

**Nested shell** (where changes are tried):

- **nested** — running or not, its pid, size and idle timeout. Not running is
  normal between tasks.
- **extension** — `ACTIVE` is healthy; `ERROR` means `enable()` threw
  (`/logs`); anything else after a `reload`, see `/logs` too.
- **settings** — always its own: kept between runs under
  `~/.local/state/gnome-extensions-nested/wallpaper-fx/` (`start --clean` resets
  them), or fresh for the run under `--stand-in`, whose **data** line names its
  scratch home.
- **mirror** — open on the desktop, or closed (`./scripts/nested.sh mirror on`).
- **drawing** — from the nested settings: `enabled-effects`, `background-mode`
  (and the palette or image path it implies), `speed`, `opacity`, `target-fps`,
  and `weather` (while it is on, its look stands in for the patterns and tuning).

**Real session (read-only)**, which these commands only read:

- **install** — `extension.js` linked to `scripts/dev-extension.js` means dev
  mode: the nested shell, and the real one at its next login, run `src/`; a
  real file means a copy that won't pick up edits until `make install` is re-run.
  `made before dev-extension.json` is a link from before the kit's scripts: the
  user's to remake with `make link`.
  The nested shell reads the same install.
- **state** — the extension's state in the user's own shell
  (`./scripts/dev.sh status`). It says nothing about the edits in progress, and
  is never fixed by reloading or enabling there: that is the user's to do.
  `doesn't exist` means that shell never registered the UUID, which needs the
  user to log out and in.

The user's own settings are read only when asked, with the same `gsettings
--schemadir src/schemas get` without `./scripts/nested.sh run`, never `set`.

If anything is off, say which command fixes it.
