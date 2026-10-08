---
description: Apply src/ edits to Wallpaper FX in the nested shell and check for errors
allowed-tools: Bash(./scripts/nested.sh status), Bash(./scripts/nested.sh start:*), Bash(./scripts/nested.sh reload), Bash(./scripts/nested.sh logs:*), Bash(./scripts/nested.sh mirror:*), Bash(./scripts/nested.sh stop), Bash(make check)
---

Apply the current `src/` edits to Wallpaper FX in this repository's **nested
shell**, then confirm they took. Never the user's own session: `make reload` and
`./scripts/dev.sh reload` disable and enable the extension on the real desktop,
which is the user's to do.

If the edit touched any GLSL, run `make check` first: a shader that fails to
compile is silent in the shell (the pattern just draws nothing), and `make check`
names the line.

1. `./scripts/nested.sh status`.
   - **Not running:** `./scripts/nested.sh start`. A fresh start loads the
     current `src/`, so Wallpaper FX is ACTIVE with the edits when it returns;
     skip step 2. Its settings are its own and kept from the last run; add
     `--clean` when the result must not depend on them (every key at its default).
   - **Running:** go on.
2. `./scripts/nested.sh reload`. It waits for ACTIVE.
3. `./scripts/nested.sh logs 40` and report whether it came up clean. A healthy
   reload ends with `[WallpaperFx] Enabled from
   /run/user/1000/wallpaper-fx/shell-<pid>/lib-<checksum>` (the development entry
   point's only line, a new checksum after each edit; the shipped code logs
   nothing on a good enable). Anything with `Failed to load`, `Error during disable`, a warning
   from Wallpaper FX, or a JS stack trace under a `[WallpaperFx]` line is a real
   failure: quote it and say which file it points at. A shader that failed to
   compile shows as a Cogl warning at best. Other extensions' errors at startup
   (a stale directory in the extensions folder) are not this one's: the nested
   shell enables only Wallpaper FX, but reads every directory there.

How to see it: the mirror window on the desktop shows the nested shell live
(`./scripts/nested.sh mirror on` if `status` says it is closed); `/preview` (or
the `drive-extension` skill: set the keys, `shot`, read the PNG) shows a pattern
and screenshots it. Leave the nested shell running for that, and stop it
(`./scripts/nested.sh stop`) when the work is done.

A reload re-imports `lib/` only. An edit to `scripts/dev-extension.js`,
`metadata.json` or the schema's keys (`glib-compile-schemas src/schemas` first)
needs `./scripts/nested.sh stop` then `start`, not a reload, and no logout: only
the real session needs one, and that is the user's to do.
