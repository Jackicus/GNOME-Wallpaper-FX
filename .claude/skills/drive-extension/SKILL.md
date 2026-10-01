---
name: drive-extension
description: What is particular to driving Wallpaper FX in the nested GNOME Shell - its nested.sh flags (no --clean, --monitors), the settings that change what is drawn, comparing animated frames, measuring, and the README's screenshots. Read the kit's gnome-ext:nested-shell skill first; use this whenever a pattern's look, colours, palettes, opacity, motion, the overview or prefs layout must be SEEN.
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

- **No `--clean`.** Every `start` shares the user's real dconf: the kit's dconf rule in
  `live-session.md` applies in full, and `start` writes `enabled-extensions` if the UUID
  is not listed there, so the real session loads it at the next login too.
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

Without `--clean` every such write is a write to the user's real settings, under the
kit's dconf rule: through `run` only while this is the only nested shell up (`ls
$XDG_RUNTIME_DIR/*-nested`), otherwise before `start` or after `stop` (the same command
without `./scripts/nested.sh run`, which the real session follows too if the extension
is enabled there). Note each key's value first and put it back. Useful keys: `enabled-effects` (`as` of catalog ids),
`background-mode` (`desktop`/`accent`/`color`/`image`), `color-palette`, `speed`,
`opacity`, `target-fps`, `pause-when-covered`, `span-monitors`.

- **Two frames of the same animation are not a comparison.** The patterns move, so a
  before/after pair always differs a little. Judge shape, colour, density and
  brightness, and set `speed` very low if a frame must be comparable.
- **Covering the desktop** (for `pause-when-covered`): `key F11` fullscreens most apps;
  `key Alt+F10` maximizes where a tiling extension has taken `Super+Up`.

## When it looks wrong, or measuring

- **A `reload` that ends "enabled but not ACTIVE" with nothing in `logs`**, or a key set
  with `run gsettings` that reads back as its old value, is the real session's dconf
  service rewriting the shared file from a stale copy. `stop` + `start` recovers.
- **A pattern that is missing** while the others draw is usually a shader that did not
  compile: `make check` names the line.
- **Headless without the mirror never paints**: with nothing consuming frames the
  compositor does not draw, so a CPU or GPU reading under `start --headless` measures
  nothing. Measure with the mirror on; it adds a constant screencast cost, so compare
  readings with each other, not with zero.
- **Other extensions load too** (no `--clean`), so their log lines and top-bar icons
  appear alongside this one.

## The README's screenshots

JPEGs in `docs/screenshots/`: `deep-space.jpg` at 1600×833, `patterns/*.jpg` and
`weather/*.jpg` at 960×500, and `prefs.png` the Patterns page of the preferences. Each
pattern is shown alone over a palette it suits; the particle patterns are cropped close,
and Starfield, Sparkles and Embers are at twice their Amount and 1.5× their Brightness,
which the README says. With no `--clean`, put the user's values back afterwards, and
never show their own wallpaper picture (`background-mode` `desktop` or `image`).
