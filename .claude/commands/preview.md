---
description: Show Wallpaper FX running in a nested shell, mirrored live on the desktop, and describe what it looks like
argument-hint: "[optional: what to show, e.g. 'aurora over the dusk palette']"
allowed-tools: Bash(./scripts/nested.sh:*), Bash(make nested:*), Read
---

Show what the extension currently draws, using the `drive-extension` skill. The
user is watching the mirror window, so narrate with `say` before each step.

Requested: $ARGUMENTS

1. `./scripts/nested.sh start` (reuses one if already running; opens the mirror
   window; the extension is ACTIVE when it returns). Its settings are its own,
   kept from the last run; `start --clean` (after a `stop`, if one is running)
   puts every key back at its default first, for a look that must not depend on
   an earlier run.
2. If the request names particular patterns, a palette or a mode, set them with
   `./scripts/nested.sh run timeout 5 gsettings --schemadir src/schemas set
   org.gnome.shell.extensions.wallpaper-fx …` — the running extension repaints on the
   key change. Through `run` this is the nested shell's own database; the same
   command without `./scripts/nested.sh run` writes the user's real settings,
   which a preview never does.
3. In **one** `./scripts/nested.sh do …` call: `say` what is being shown, `wait`
   a beat, then `shot` into your scratchpad.
4. **Read the PNG** and describe what's actually on screen — which patterns are
   visible, their colour, density and brightness, and anything visibly broken.
5. `./scripts/nested.sh stop` when done, even if a step failed. It closes the mirror.

Check `./scripts/nested.sh logs` if the screenshot looks empty or unchanged: a JS
exception during enable leaves a bare wallpaper, and a layer that throws in its
paint draws nothing from then on, so a broken pattern looks like one that was never
turned on.
