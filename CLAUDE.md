# Wallpaper FX

Shared rules for every extension come from the GNOME-EXTENSIONS kit: `../CLAUDE.md` and `../.claude/rules/` (loaded with this file), and the `gnome-ext:*` skills. `.claude/kit.sh` pulls the kit at session start, or, with no kit beside this repository, fetches it and prints its rules into the session.

A GNOME Shell extension (UUID `wallpaper-fx@jackicus`; written for and claiming GNOME
Shell 50) that paints stackable animated patterns over the desktop: GPU shaders
on actors sitting on the wallpaper itself, no window. Settings are a libadwaita prefs
dialog. The log prefix is `[WallpaperFx]`.

## Checking and seeing it

The tooling is the kit's (`./scripts/dev.sh`, `./scripts/nested.sh`, `make help`). What is
this extension's own: `./scripts/ext.conf` (UUID, `[WallpaperFx]`, what ships, its
checks), `./scripts/dev.d/wallpaper-fx.sh` (`shaders`, `prefs`), and the Makefile's
`zip`, `bench` and `prefs` after `include scripts/kit.mk`. It has no `nested.d/`.

- **`make check`** is everything that needs no shell, display or GPU, and what CI runs:
  `make lint`, then `./scripts/dev.sh check`: the schema under `--strict`, and
  `./scripts/dev.sh shaders` (`node scripts/shaders.mjs check`), every pattern's shader
  compiled by `glslangValidator` in each GLSL dialect Cogl may use. CI installs
  `glslang` through `.github/ci-packages`. It ends with `size` against `EXT_BUDGET_LINES`
  (3600: the 3567 lines left after the simplify pass, rounded up to the next hundred,
  so growth is noticed; raising it is the owner's call).
- **Needs the GPU, so stays out of `make check`:** `make bench` (each pattern timed) and
  `node scripts/shaders.mjs render PATTERN` (frames of one pattern to a PNG, with no
  shell at all: the quick loop for a pattern's look).
- **Seen in the nested shell** for motion, the overview, prefs and two monitors: the
  `gnome-ext:nested-shell` skill, then `.claude/skills/drive-extension/SKILL.md` for what
  is particular here. `/reload`, `/logs`, `/status`, `/prefs` and `/preview` use the
  nested shell; `make reload`, `make prefs` and `make logs` are the user's own session,
  theirs to run.
- **`make zip`** is `make pack` (`./scripts/dev.sh pack`): the zip in `dist/`, checked
  to hold exactly what ships. The `Release` workflow runs the same on a pushed `v*` tag
  (`gnome-ext:release`).

`docs/` holds what is not about working on the code day to day:
**`docs/patterns.md`, the contract a pattern keeps: read it before writing or changing
one**; `docs/private-api.md` (every reach into shell internals); `docs/compatibility.md`
(what has been tested where); `docs/publishing.md` (making the extensions.gnome.org zip).
Area detail lives in `.claude/rules/`: `shaders.md` (patterns, the shader wrapper, the
offline tools) and `background.md` (the base and the overview's clones).

## Layout

- `extension.js`: the shipped entry point; it imports `lib/app.js` and enables it, so
  an install compiles the shaders once and reuses them across every lock and unlock.
  The development entry point is the kit's `./scripts/dev-extension.js`: it stages
  `lib/` under `$XDG_RUNTIME_DIR/wallpaper-fx/shell-<pid>/lib-<checksum>/`, a new stage
  only after an edit, so an unlock under the link reuses the compiled shaders as an
  install does. Nothing of it ships.
- `lib/app.js`: reads settings, works out what each monitor draws (its own canvas, or
  its part of one spanning all of them), builds one `MonitorRenderer` per monitor into
  `Main.layoutManager._backgroundGroup` (over the wallpaper, under the windows),
  rebuilds on `monitors-changed` and `span-monitors`, and pushes new state on any other
  settings change.
- `lib/engine.js`: `MonitorRenderer`, a monitor-sized actor with one child per enabled
  pattern, each painted by that pattern's shader effect and faded in and out as it is
  switched; the frame pacing; and `SceneClock`, one clock per pattern (for its own
  speed), shared by every monitor.
- `lib/shader.js`: wraps a pattern's GLSL in a `Shell.GLSLEffect` class (one per
  pattern, compiled on first use and shared by every monitor), plus the GLSL prelude
  every pattern gets.
- `lib/catalog.js`: **the single list of patterns** (id, title, description, layer
  module), in the order they are drawn (sky first, weather last). `prefs.js` builds its
  rows from it and the engine draws in its order, so adding a pattern is a file in
  `lib/layers/`, an entry here, and nothing else.
- `lib/layers/*.js`: one pattern each, keeping the contract in `docs/patterns.md`.
- `lib/background.js`: **the base, handed to the shell instead of painted** (below).
- `lib/overview.js`: the patterns cloned into the overview's workspace previews, its
  thumbnail strip, and the workspace-slide strip. Without it the desktop goes bare the
  moment any of those appear.
- `lib/system.js`: the system's say: UPower's `OnBattery` (for `pause-on-battery`),
  power-profiles-daemon's active profile, and St's `enable-animations`.
- `lib/weather.js`: `WeatherWatcher`, for the weather scene: the place (Geoclue under
  the shell's desktop id, or the one chosen in prefs), a GWeather report for the nearest
  city in GWeather's list (its METAR station now, MET Norway's next hour where there is
  none), read into plain conditions, and the time of day. What it knows goes into
  `weather-status`, for prefs to show and for the next enable (every unlock) to start
  from.
- `lib/looks.js`: the weather's look: conditions and the time of day to the same values
  a scene holds (patterns, tuning, palette). Pure, so `node` can run it. `lib/sun.js`:
  the sun's elevation, and so dawn, day, dusk or night, from a place and a time.
- `lib/scenes.js`: the user's saved scenes (saving, applying, matching), used only by
  prefs; a scene is just the values of `SCENE_KEYS`. `lib/places.js`: searching
  GWeather's city list, for prefs.
- `lib/palettes.js`: the named gradients for `color` mode (the last three are the
  weather's skies) and the accent colours for `accent`. `lib/layer.js`: the seeded PRNG
  for what layers work out on the CPU, and the helpers they generate GLSL with (`num`,
  `vec3`, `slots`).
- `prefs.js`, `schemas/`: the settings dialog (Scenes, with the weather and the user's
  own; Patterns; Background; Performance) and the keys behind it.

## How it fits together

Every pattern is a fragment shader, evaluated at the monitor's full resolution. The CPU's
part of a frame is setting a few uniforms, so what a pattern costs is GPU time; the
compositor thread does the same work whichever patterns are on.

`background-mode` picks the base: `desktop` (the system wallpaper, left alone), `accent`
(a gradient in GNOME's accent colour, which it follows as it changes), `color` (a palette
from `palettes.js`) or `image` (a file the user chose). In all but the first,
`background.js` makes it the shell's own wallpaper, spanned across the monitors when the
patterns are. `enabled-effects` is a list of catalog ids, drawn over
that base in catalog order, each tuned by `pattern-tuning` (brightness, speed, Amount, as
multipliers of its design). `speed` scales every clock and `opacity` is the monitor
actor's opacity, which each shader multiplies in.

With `span-monitors`, every monitor draws its part of one canvas (the box around them
all, sized by the primary monitor, one seed), and because every `State` is a pure
function of time and every clock is shared, the parts agree without talking to each
other. Saved scenes are prefs-only: applying one writes a handful of keys, and the
extension simply follows them.

**The weather is a scene that changes by itself.** With `weather` on, app.js keeps a
`WeatherWatcher`, and while it has a report its look stands in for `enabled-effects`,
`pattern-tuning` and, with `weather-background`, the base, in `_state()`; the user's own
keys are never written, so turning it off brings their look straight back, and prefs
locks the Patterns and Background pages meanwhile. Only the watcher writes
`weather-status`, and app.js ignores changes to it. A report is asked for every half
hour, on moving more than 10 km, or on a new place; a remembered one is shown for up to
six hours.

**Pacing hangs off the paint.** Each pattern's effect calls back from
`vfunc_paint_target`; the first paint of a frame books the next repaint for `divisor`
refreshes later, half a refresh early so it lands on that frame, with the rate read off
the stage view the actor is on, so a 240Hz head and the 60Hz one beside it are each paced
in step with their own refresh. `target-fps` is 0 for every frame, -N for every Nth, or a
positive rate rounded to the nearest whole divisor (a rate that does not divide the
refresh would judder). Time is read at paint, so motion is even however the timer lands.

**A paint that never comes books nothing**, which is how the patterns rest: with nothing
to show, while the power-saver profile is on or animations are off (always: those are
the user's choices for the whole system), on battery with `pause-on-battery`, or, with
`pause-when-covered`, while fullscreen, maximized or tiled windows hide the monitor's
desktop. The next paint of the desktop (a window moving away, the overview opening, a
setting changing) starts the frames again, so none of those cases needs a signal of its
own. Paints through a clone (the overview, the workspace slide) never count as covered.

## Traps of its own

- **A shader mistake is silent in the shell**: a pattern that fails to compile draws
  nothing, with a Cogl warning in the log at best. `make check` names the line; run it
  before reloading after touching any GLSL.
- **The shell's background is reached through private fields**, and every path
  `overview.js` walks to the previews and the slide is private too. If the patterns stop
  appearing at all, check `_backgroundGroup`; if they only vanish in the overview or
  during a workspace switch, check `overview.js`. The full list, with what breaks when
  each moves, is `docs/private-api.md`; the working detail is
  `.claude/rules/background.md`.
- **Do not trust `Main.overview.visible` on its own.** In the nested shell it has read
  true on a plain desktop; that is why pausing asks whether a paint came through a clone
  instead, and why `overview.js` clears its clones before adding them.
- **An actor with a shader effect paints a pixel's margin past its edge.** Two monitors
  side by side then both paint the column at the seam, which shows as a bright line
  through anything drawn there; `MonitorRenderer` clips its actor to its allocation for
  that reason.
- **Clutter only culls the background when windows cover all of it**, and a panel is
  not a window, so behind a maximized window the strip under the top bar keeps the whole
  monitor repainting. That is what `pause-when-covered` is for. It also means a CPU
  reading taken while something covers the desktop is measuring something else.
- **A layer whose `State` throws** throws out of the paint: GJS logs it and the layer
  draws nothing and books no further frame, so a broken pattern looks like one that was
  never enabled. `./scripts/nested.sh logs` before assuming an edit did nothing.
