---
description: Show what Wallpaper FX logged in the nested shell (or, read-only, the real session's journal)
argument-hint: "[N lines of the nested shell's log, default 80; or a systemd time spec such as '5 min ago' for the real session's journal]"
allowed-tools: Bash(./scripts/nested.sh status), Bash(./scripts/nested.sh logs:*), Bash(./scripts/dev.sh logs:*)
---

Show what the extension has logged recently.

Requested: $ARGUMENTS

**The nested shell** is where changes are tried, so its log is the one to read.
If the request above is empty or a number, run `./scripts/nested.sh status`; if a
nested shell is running, `./scripts/nested.sh logs <N>` (80 when none was given;
add `--all` for the D-Bus and portal chatter the default filters out). If none is
running, say so: its log goes with it at `stop`, and a fresh one starts at
`start`.

**The real session's journal**, read-only, only when the request is a time spec
(`5 min ago`, `today`, `09:00`) or asks for the user's own desktop:
`./scripts/dev.sh logs "<window>"`, always with a window (without one it follows
the journal and never returns). Head the answer "real session (read-only)": it is
what Wallpaper FX did on the user's desktop, not in the nested shell.

Summarise rather than dump: how many enable cycles (under a development link
each logs `[WallpaperFx] Enabled from …`; the shipped code logs nothing on
success), any warnings, and any errors or stack traces in full with the file they
point at. Only `[WallpaperFx]` lines, and Cogl or GJS errors from its shaders and
layers, are this extension's. A pattern that draws nothing but logs nothing is
usually a shader that did not compile: say so, and suggest `make check`. A layer
that throws in its paint logs once and then draws nothing. Exceptions inside a
GNOME extension only ever surface in these logs, never in a terminal, so this is
the place to look when something silently does nothing.
