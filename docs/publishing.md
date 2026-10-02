# Publishing to extensions.gnome.org

How to build the upload, what goes in it, and how the extension stands against
the EGO review guidelines. Web sources are named where they are used; the
guidelines are gjs.guide's
[Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
and [Best Practices](https://gjs.guide/extensions/review-guidelines/best-practices.html).

## Building the zip

```sh
make zip
```

This runs `./scripts/dev.sh pack` (the kit's, shared by every extension), which:

1. runs `glib-compile-schemas --strict --dry-run` on `src/schemas`, and stops if
   it fails: an install compiles the schema with `--strict`, so a warning here
   would be a failed install;
2. copies what ships into a scratch directory: the entry points, `metadata.json`,
   the schema XML, every `.js` file under `src/lib` (`EXT_SHIP` in
   `scripts/ext.conf`, `layers/` included) and the `LICENSE` at the top of the
   repo (GPL-2.0), and runs `gnome-extensions pack` on that, naming `lib/` and
   `LICENSE` as `--extra-source`s. `gnome-extensions` adds `extension.js`,
   `metadata.json`, `prefs.js` and every `schemas/*.gschema.xml` by itself
   (`command-pack.c`);
3. deletes `schemas/gschemas.compiled` from the zip if the `gnome-extensions`
   doing the packing put one there. Up to GNOME 45 it compiled the schema into the
   bundle; from 46 it does not (`command-pack.c` at the `45.0` and `46.0` tags);
4. checks that the zip holds exactly what was copied, and nothing else. A
   missing module or a stray file stops the build with the file named; an editor
   backup or a note in `src/lib` is never copied in the first place;
5. prints the listing. The output is `dist/wallpaper-fx@jackicus.shell-extension.zip`.

What it contains today:

```
LICENSE
metadata.json
extension.js
prefs.js
schemas/org.gnome.shell.extensions.wallpaper-fx.gschema.xml
lib/app.js  lib/background.js  lib/catalog.js  lib/engine.js  lib/layer.js
lib/looks.js  lib/overview.js  lib/palettes.js  lib/places.js  lib/scenes.js
lib/shader.js  lib/sun.js  lib/system.js  lib/weather.js
lib/layers/{aurora,bokeh,clouds,constellation,contours,embers,fireflies,fog,
            lightning,nebula,rain,snow,sparkles,starfield,sunbeams,wave}.js
```

What it leaves out: `src/schemas/gschemas.compiled` (a local artefact of
`make link`/`make reload`), `scripts/` (including `scripts/dev-extension.js`, the
development entry point), `docs/`, `README.md`, `CLAUDE.md`, `.claude/` and the
screenshots. A new layer file is picked up without changes
here, because the whole of `lib/` is packed.

### Why the schema ships as XML only

- gjs.guide, [Port Extensions to GNOME Shell 44](https://gjs.guide/extensions/upgrading/gnome-shell-44.html):
  "GNOME Shell 44 can compile the GSettings Schemas file(s) while installing the
  extension package. ... you MUST only include the
  schemas/org.gnome.shell.extensions.<schema-id>.gschema.xml file(s) and avoid
  shipping the gschemas.compiled in the package (if your extension is only
  supporting GNOME Shell 44 and later)."
- gjs.guide, [Preferences](https://gjs.guide/extensions/development/preferences.html):
  "As of GNOME 44, settings schemas are compiled automatically for extensions
  installed with the gnome-extensions tool, GNOME Extensions website, or a
  compatible application like Extension Manager."
- The review guidelines' own GSettings rule asks only that "The Schema XML file
  MUST be included in the extension ZIP file".
- In the shell, `extensionDownloader.js` runs
  `glib-compile-schemas --strict <extension>/schemas` after unzipping an EGO
  download (both at `45.0` and in 50.5). `--strict` means a schema warning is
  an install failure, so run `glib-compile-schemas --strict --dry-run src/schemas`
  before uploading.

GNOME 50 compiles it on install, so the zip carries no compiled schema.

### Testing the zip before uploading

```sh
make uninstall
make zip
gnome-extensions install dist/wallpaper-fx@jackicus.shell-extension.zip
# log out and back in, then enable it
```

Do this over `make uninstall`, not with `install --force` over the development
link. `--force` deletes the existing directory recursively *through* its
symlinks, which empties `src/lib` and `src/schemas` (see
[compatibility.md](compatibility.md), checklist step 4). `make link` restores
the link afterwards. This is also the only way to run the shipped
`src/extension.js`: the link's entry point is `scripts/dev-extension.js`.

## metadata.json

| Key | Now | Verdict |
|---|---|---|
| `uuid` | `wallpaper-fx@jackicus` | Valid characters and not `gnome.org`. It is the extension's identity on EGO and cannot change after the first upload |
| `name` | `Wallpaper FX` | See [the name](#copyrights-and-trademarks-meets) |
| `description` | two paragraphs | Covers the points below |
| `shell-version` | 50 | The one version that has been run, and the one the code is written for |
| `settings-schema` | set | Correct; `getSettings()` is called without arguments, which is what Best Practices asks |
| `url` | GitHub repo | Correct |
| `version` | absent | Correct: "This field SHOULD NOT be set by extension developers" ([Anatomy](https://gjs.guide/extensions/overview/anatomy.html)); EGO assigns it |
| `version-name` | `1.0` | Bump with each upload |
| `session-modes` | absent | Correct ("MUST be dropped if you are only using `user` mode") |
| `donations`, `gettext-domain` | absent | Correct. The schema carries no `gettext-domain` attribute either |

**`version-name`** is the version users see; without it EGO shows its own
counter. From the Anatomy page it "MUST be a string that only contains letters,
numbers, space and period with a length between 1 and 16 characters",
matching `/^(?!^[. ]+$)[a-zA-Z0-9 .]{1,16}$/`. So `"1.0"` or `"1.0 beta"` is
fine, but `"v1.0-beta"` is not, because of the dash. It is `"1.0"`; bump it
with each upload.

**`shell-version`**: the guideline is that it "MUST only contain stable releases
and up to one development release. Extensions must not claim to support future
GNOME Shell versions." It is also a promise: "if an extension is tested and found to be fundamentally broken
it will be rejected". So the first upload claims only what has been run (50).
Add versions as they pass the checklist in [compatibility.md](compatibility.md);
a new upload can widen the list. GNOME 51 needs the renderer ported off
`Shell.GLSLEffect` first.

**`description`** is the only place a user or reviewer learns about behaviour
that could look like a bug. It says:

- in the Accent, Color and Custom Picture modes it replaces the wallpaper
  the shell shows (the desktop, the overview, and extensions that blur it)
  without changing the user's wallpaper setting;
- it stays still when animations are off. GNOME also turns animations off in
  virtual machines without 3D acceleration and during remote-desktop sessions;
- it stays still in power-saver, and optionally on battery;
- gradients are cached as images in `~/.cache/wallpaper-fx`;
- Follow the Weather, off until the user turns it on, is the only thing that
  uses the network. Through GWeather it sends the coordinates of the nearest
  town in GWeather's list to MET Norway, and that town's station code to
  aviationweather.gov. With Find My Location it also asks Location Services
  where the user is, to city accuracy, the way GNOME Shell's own weather does,
  and never while Location Services are off in Settings.

## The review guidelines, item by item

### Only use initialization for static resources: meets

`src/extension.js` has no constructor and imports `./lib/app.js` statically, so
the module scope of everything under `lib/` runs when the extension is loaded,
before `enable()`. All of it is definitions: the `WallpaperFxPreviewHost` class, the
D-Bus interfaces from `makeProxyWrapper()` in `system.js`, the catalog and its
shader strings, an empty `Map` in `shader.js`, a `Set` of
key names in `app.js`, and in `weather.js` the tables from GWeather's enums to
plain words. Nothing is instantiated, connected or scheduled.
That is what the guideline allows ("static data structures and instances of
built-in JavaScript objects"). `WallpaperFxApp` calls `getSettings()` in its
constructor, but it is constructed inside `enable()`.

### Destroy all objects: meets

`disable()` tears down, in order: the layout-manager, settings and interface
signal connections; the overview clones and the slide override
(`InjectionManager.clear()`); the `WeatherWatcher`, if the weather is on (its
`Gio.Cancellable` is cancelled, its timer removed, its GWeather request aborted,
and its GWeather, Geoclue and settings connections dropped); `SystemState` (its
`Gio.Cancellable` is cancelled and its D-Bus proxies and `St.Settings`
connection are dropped); the wallpaper
takeover, including the holder `BackgroundManager` and its container actor; and
every `MonitorRenderer` (its timer, then its actor and every layer and effect
under it).

`shader.js` keeps registered classes in a module-scope `Map` across
`disable()`, on purpose, because GTypes cannot be unregistered. A comment where
the map is declared says so, which answers the reviewer who applies "all
dynamically stored memory must be cleared or freed in disable()".

`enable()` is not wrapped. If it threw, the shell would mark the extension as
errored without calling `disable()` (`extensionSystem.js` in 50.5); on 50 nothing
in it throws (`_backgroundGroup` and the background source are checked), and the
known way to get there is a GNOME without `Shell.GLSLEffect`, which is not
claimed.

### Disconnect all signals: meets

Every connection in the shell uses `connectObject()`/`disconnectObject()` and is
dropped in the owner's `destroy()`/`disable()`, except the clones' `destroy`
handlers. The `destroy` handlers on overview clones
are on the clones themselves. The preferences disconnect their settings handler
and their Location Services handler on `close-request`.

### Remove main loop sources: meets

There is one source per monitor: `GLib.timeout_add()` in
`MonitorRenderer._onPaint()`, guarded by `if (this._timerId || ...) return;` on
the start of the line that books it, and removed in `MonitorRenderer.destroy()`.
The others are the `WeatherWatcher`'s five-minute `GLib.timeout_add_seconds()`,
added in its constructor and removed in its `destroy()`, and `ShellBackground`'s
one-shot `GLib.idle_add()` that takes a replaced background source back
(`_retakeId`), removed in `release()`. Nothing else adds one.

### Do not use deprecated modules: meets

There is no `ByteArray`, `Lang` or `Mainloop`, and no `run_dispose()`.

### No GTK in the shell, no shell libraries in the preferences: meets

The shell side imports Gio, GLib, GObject, GDesktopEnums, Clutter, Cogl, Meta,
Shell, St, GWeather, Geoclue and cairo, and no Gtk, Gdk or Adw. `prefs.js`
imports Adw, Gtk, Gio and GLib, plus `lib/catalog.js` (the layers and
`lib/layer.js`, all pure JS), `lib/palettes.js` (cairo), `lib/scenes.js` (Gio, GLib)
and `lib/places.js` (GWeather), none of which imports Clutter, Meta, St or
Shell. Best Practices suggests keeping modules used only by the preferences in
a `prefs/` directory. `scenes.js` and `places.js` are such modules, so moving
them is optional tidying.

### Avoid interfering with the extension system: meets

The code that works around the shell's module cache is the development entry
point, `scripts/dev-extension.js`, and it is not in the zip. See
[the development path in extension.js](#the-development-path-in-extensionjs).

### Code must not be obfuscated: meets

This is plain ES modules, unminified.

### No excessive logging: meets

The shipped code logs nothing on a good enable, a lock or an unlock. Every
`console.warn`/`console.error` is on a failure path: no background group, no
background source, a gradient that could not be rendered, a D-Bus service that
answered with an error, Location Services refusing a location. The only informational line, `Enabled from ...`, is in
`scripts/dev-extension.js`, which does not ship.

### Scripts and binaries, clipboard, privileged subprocesses, telemetry: meets

None of these are used. `scripts/` is not in the zip. The only network traffic
is GWeather's own weather requests while the user has Follow the Weather on,
which the description discloses (above).

### Extensions must be functional: a risk worth knowing

Reviewers often run a virtual machine. Without 3D acceleration the shell
inhibits animations (`_shouldEnableAnimations()` in `ui/main.js`), and
`system.js` pauses the patterns whenever `St.Settings` `enable-animations` is
false. A reviewer in such a VM sees still patterns, or none, and may report it
as broken. Say so in the description.

### Extensions must not be AI-generated: know the code

The rule is that the developer "should be able to justify and explain the code
they submit", and submissions with "large amounts of unnecessary code,
inconsistent code style, imaginary API usage, comments serving as LLM prompts,
or other indications of AI-generated output will be rejected". Best Practices
lists the patterns reviewers look for. In this code:

- **Optional chaining on guaranteed APIs** ("Avoid Unnecessary Checks"): none
  remain: `error.matches()`, `peek_stage_views()` and the parts `enable()`
  builds are used directly. What optional chaining is left is on private shell paths, where it
  is how they degrade and [private-api.md](private-api.md) explains each; on
  `WallpaperFxApp._weather` and `WeatherWatcher._geoclue`, which are null while
  unused; and `workspace.metaWorkspace?.index()` in `overview.js`, where `metaWorkspace`
  is null for a monitor's extra workspace view.
- **try/catch that only swallows** ("Avoid Unnecessary try-catch Wrappers"):
  gone from the shipped `extension.js`, so a failed load shows as an error in
  the Extensions app. Those that remain handle real failures: rendering a
  gradient (disk I/O), a saved weather report that will not parse, Location
  Services failing, and a dismissed file chooser in the preferences.
- **A lifecycle flag** ("Lifecycle and Destruction State"): `this._enabling`
  exists only in `scripts/dev-extension.js`, whose `enable()` is async. The
  shipped entry point has none.

The comments explain *why* rather than restating the code, which is what the
guidelines want. Their length is unusual, though, and a reviewer may read that
as a sign.

### metadata.json must be well-formed: meets

See [the table above](#metadatajson).

### Session modes: meets

There is no `session-modes`, so the extension runs in `user` only. On lock it is
disabled: the wallpaper is handed back, which is what the lock screen then shows,
and every renderer goes. On unlock it is enabled again and the base crossfades
in. The alternative, `unlock-dialog`, "MUST be necessary for the extension to
operate correctly", and it is not.

### GSettings schemas: meets

The ID `org.gnome.shell.extensions.wallpaper-fx` and the path
`/org/gnome/shell/extensions/wallpaper-fx/` use the required bases, the file
is named `<schema-id>.gschema.xml`, the XML is in the zip, and no compiled schema
ships.

### Licensing: meets

GNOME Shell is GPL-2.0-or-later and "derived works like extensions MUST be
distributed under compatible terms". The extension is GPL-2.0-or-later: the
GPL-2.0 text is `LICENSE` at the top of the repo, and `make zip` puts it in the
zip. The rest is the author's own except two pieces of shader code under the MIT
License, which is GPL-compatible: Dave Hoskins' "Hash without Sine" (`hash12`,
`hash42` in `shader.js`) and webgl-noise's 2D simplex lattice (`contours.js`). Each
carries its upstream copyright and permission notice where it is used, as MIT asks.

### Copyrights and trademarks: meets

Nothing that ships names another product or reuses trademarked branding: the
name "Wallpaper FX" does not collide with an existing product in this field, and
the Wave pattern is described by what it draws, not by the console menu it
resembles.

### Don't include unnecessary files: meets

`make zip` refuses anything but the shipped modules.

### Use a linter: meets

`make lint` runs ESLint with gjs.guide's recommended configuration
([Style Guide](https://gjs.guide/guides/gjs/style-guide.html)), copied unchanged
into `eslint.config.mjs`, over `src/` and `scripts/dev-extension.js`. It is
clean. `package.json` exists only to pin ESLint; nothing from it ships.

## Private API

Everything the extension reaches into, what it is for, and what happens when a
future GNOME changes it is in [private-api.md](private-api.md). Reviewers accept
private API with a reason. What they look for is that it fails safely. Every
private path is checked or optional-chained, and degrades to the user's own
wallpaper or to patterns missing in one place.

## The development path in extension.js

GJS caches a module by URL for the life of the shell, so an edit under `lib/`
is never picked up without logging out, unless `lib/` is imported from a new
URL each time. That staging lives outside what ships:

- `src/extension.js`, the entry point that ships, imports `./lib/app.js`
  statically. Its `enable()` and `disable()` are synchronous and carry no
  try/catch:
  ```js
  enable() {
      this._app = new WallpaperFxApp(this);
      this._app.enable();
  }

  disable() {
      this._app.disable();
      this._app = null;
  }
  ```
- `scripts/dev-extension.js` is the development entry point (the kit's): an
  async `enable()` that copies `lib/` to
  `$XDG_RUNTIME_DIR/wallpaper-fx/shell-<pid>/lib-<checksum>/`, a directory of the
  running shell's own named for a checksum of the files, and imports `app.js`
  from there, with the `_enabling` guard and the logging that belong to it.
- `./scripts/dev.sh link` (`link_tree()`) builds the extension directory as a real
  directory of links, one for each entry in `src/` except `extension.js`, which
  links to `scripts/dev-extension.js`, and writes `dev-extension.json` beside
  them. A reload still picks up edits.

What is in the repository is what ships, apart from `scripts/`, which never
ships. The development link never runs `src/extension.js`, so test the shipped
entry point from an installed zip
([Testing the zip](#testing-the-zip-before-uploading)).

Swapping in a plain `extension.js` at pack time instead would ship a file that
is not in the repository the zip's `url` points at, and give two entry points
that could drift, so packing does not do that.

## Still open

1. **The GNOME 51 port.** `Shell.GLSLEffect` is gone in 51; the replacement is
   `Clutter.ShaderEffect` with `vfunc_get_static_snippet()`, which mutter 50
   lacks, so 50 and 51 need two code paths or two releases
   ([compatibility.md](compatibility.md)). Until then, do not claim 51.
2. **More versions.** Another version is a port (`gnome-ext:port-shell-version`):
   it adds what that version needs, and joins `shell-version` once the zip has
   been through the checklist in [compatibility.md](compatibility.md) on it.
3. **Optional tidying.** Move `lib/scenes.js`, which only the preferences use,
   into a `prefs/` directory, as Best Practices suggests (and add it to the
   `pack` step's sources).

## Uploading

- **Web:** log in at https://extensions.gnome.org/upload/, choose
  `dist/wallpaper-fx@jackicus.shell-extension.zip`, and accept the terms.
- **Command line** (gnome-extensions 49 and later; gjs.guide,
  [Port Extensions to GNOME Shell 49](https://gjs.guide/extensions/upgrading/gnome-shell-49.html)):
  `gnome-extensions upload --accept-tos dist/wallpaper-fx@jackicus.shell-extension.zip`.
  It prompts for the EGO username and password. `--user`, `--password` and
  `--password-file` exist for CI; gjs.guide warns that a password in a command
  line can end up in logs, the environment or the filesystem.

Each upload is reviewed before it is published, and review comments arrive on
the extension's EGO page. EGO numbers each upload in `version`.

Before every upload:

1. Bump `version-name`.
2. Run `make lint` and `make check`.
3. Run `make zip` (it checks the schema with `--strict`), and read the listing.
4. Install that zip (not the link) and go through the checklist in
   [compatibility.md](compatibility.md) on each version you claim.
5. Confirm `make logs` is quiet through enable, use, lock, unlock and disable.
