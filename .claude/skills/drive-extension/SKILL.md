---
name: drive-extension
description: What is particular to driving Wallpaper FX in the nested GNOME Shell - its nested.sh flags (its own settings, --clean, --monitors), the settings that change what is drawn, comparing animated frames, measuring, and the README's screenshots. Read the kit's gnome-ext:nested-shell skill first; use this whenever a pattern's look, colours, palettes, opacity, motion, the overview or prefs layout must be SEEN.
---

# Driving Wallpaper FX in the nested shell

Read **`gnome-ext:nested-shell`** first: the loop, `do` and its steps, `reload` versus
`stop` + `start`, the logs, the preferences and stopping are all there and not repeated
here. This is what differs for Wallpaper FX.

## What it looks like, and where

The patterns cover the whole desktop of every monitor, behind the windows, and appear
again in the overview's workspace previews, its thumbnail strip and the workspace slide
(`overview on`, or `key Super+Page_Down` for a slide). There is no panel button or menu
to click: everything visible is a GSettings key. Crop `shot`s to the part being judged.

## Its own `./scripts/nested.sh`

- **Its settings are always its own.** Every `start` gives the nested session a dconf
  profile whose writable database is `~/.config/dconf/wallpaper_fx_nested`, over
  read-only defaults made at each start: Wallpaper FX the only extension enabled, the
  real session's colour scheme, accent and fonts copied in. The user's
  `~/.config/dconf/user` is never written. That database is kept from one `start` to the
  next; **`start --clean`** deletes it first, so every key is back at its default. Wipe
  it when the result must not depend on an earlier run (screenshots, an enable-path
  check). A shell already running is reused as it is: `stop` before `start --clean`.
- **`start [WxH] --monitors N`** puts N monitors side by side (shots, the mirror and
  pointer coordinates then span all of them). It is the only way to check
  `span-monitors`, the seam between two monitors, or the overview's previews on a
  secondary monitor.
- **No `window` step**: shoot the preferences with a cropped `shot`.
- **Idle stop**: a shell started from a Claude Code session stops itself after
  `WALLPAPER_FX_NESTED_IDLE` seconds without a `nested.sh` command (default 600, `0`
  never), set at `start`. If it hit mid-task, `start` again.
- **No shell at all**: `node scripts/shaders.mjs render PATTERN --out $S/x.png
  --frames 3 [--span 2] [--density D]` draws frames of one pattern straight to a PNG
  (`.claude/rules/shaders.md`). Use it for a pattern's look, and while another session
  has the nested shell; come here for motion, the overview and prefs.

## Changing what is drawn

`app.js` repaints on a key change, without a reload. The schema is not installed
system-wide, so every `gsettings` call names it:

```bash
./scripts/nested.sh run timeout 5 gsettings --schemadir src/schemas \
    set org.gnome.shell.extensions.wallpaper-fx enabled-effects "['aurora']"
```

Through `run` it reads and writes the nested shell's own database (`run` sets
`DCONF_PROFILE`); the same command without `./scripts/nested.sh run` is the user's real
settings, which a test never writes. Useful keys: `enabled-effects` (`as` of catalog ids),
`background-mode` (`desktop`/`accent`/`color`/`image`), `color-palette`, `speed`,
`opacity`, `target-fps`, `pause-when-covered`, `span-monitors`.

- **Two frames of the same animation are not a comparison.** The patterns move, so a
  before/after pair always differs a little. Judge shape, colour, density and
  brightness, and set `speed` very low if a frame must be comparable.
- **Covering the desktop** (for `pause-when-covered`): `key F11` fullscreens most apps;
  `key Alt+F10` maximizes where a tiling extension has taken `Super+Up`.

## When it looks wrong, or measuring

- **A pattern that is missing** while the others draw is usually a shader that did not
  compile: `make check` names the line.
- **Headless without the mirror never paints**: with nothing consuming frames the
  compositor does not draw, so a CPU or GPU reading under `start --headless` measures
  nothing. Measure with the mirror on; it adds a constant screencast cost, so compare
  readings with each other, not with zero.

## The README's screenshots

JPEGs in `docs/screenshots/`: `deep-space.jpg` at 1600×833, `patterns/*.jpg` and
`weather/*.jpg` at 960×500, and `prefs.png` the Patterns page of the preferences. Each
pattern is shown alone over a palette it suits; the particle patterns are cropped close,
and Starfield, Sparkles and Embers are at twice their Amount and 1.5× their Brightness,
which the README says. Take them from a `start --clean` shell, whose `desktop`
base is GNOME's default wallpaper, never the user's; never point `image` at a file of
theirs.
