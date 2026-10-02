# Private and deep GNOME Shell API

Wallpaper FX puts a canvas between the wallpaper and the windows, makes its
base the shell's own wallpaper, and follows both into the overview and the
workspace slide. None of that has a public API. This is everything it reaches
into, for reviewers on extensions.gnome.org and for whoever ports it to the next
GNOME.

Every entry was checked against the GNOME Shell 50.5 JavaScript on the main
desktop (extracted from `/usr/lib/gnome-shell/libshell-18.so`; a bare `50.5` below is that) and against the
`45.0`, `47.0`, `49.0` and `51.0` tags of `GNOME/gnome-shell` and `GNOME/mutter`
on gitlab.gnome.org. Unless an entry says otherwise, the field or method exists
with the same meaning in all of them. Line numbers are left out on purpose,
because `src/` is changing; functions are named instead.

## At a glance

| Expression | File | If it changes in a future GNOME | Checked in code |
|---|---|---|---|
| `Main.layoutManager._backgroundGroup` | app.js | No patterns anywhere; the base still shows | Yes, logs a warning |
| `new Background.BackgroundManager(...)._backgroundSource` | background.js | Base modes show the user's own wallpaper | Yes, logs a warning |
| `source._settings` (read, replaced, restored) | background.js | Same | Yes, logs a warning |
| `source._backgrounds` (also read as "source destroyed" when null), `background._emitChangedSignal()` | background.js | A new base appears only at the shell's next wallpaper reload | Yes, silently |
| `source.destroy` (wrapped), `source._useCount`, `Main.layoutManager._bgManagers`, `manager._backgroundSource`, `manager._updateBackgroundActor()` | background.js | After another extension over-releases the source, base modes show the user's own wallpaper until the next log in | Yes, silently |
| `Main.overview._overview.controls._workspacesDisplay._workspacesViews`, `view._workspaces`, `view._workspacesView`, `inner._workspace` | overview.js | Patterns vanish in the overview only | Yes, silently |
| `workspace._background._backgroundGroup`, `._monitorIndex` | overview.js | Same | Yes, silently |
| `Main.overview._overview.controls._thumbnailsBox._thumbnails`, `thumbnail._contents` | overview.js | Patterns vanish from the thumbnail strip only | Yes, silently |
| `Main.wm._workspaceAnimation`, override of `_prepareWorkspaceSwitch` | overview.js | Patterns vanish during a workspace slide only | Yes, silently |
| `this._switchData.monitors`, `strip._monitor`, `strip._workspaceGroups`, `group._background` | overview.js | Same | Yes, silently |
| `class extends Shell.GLSLEffect` | shader.js | `enable()` throws and the extension shows as errored with the base taken over (below). **Removed in GNOME 51** | No |
| `vfunc_paint_target(node, paintContext)` | shader.js | Patterns freeze on their first frame | No |
| `Cogl.SnippetHook.FRAGMENT` | shader.js | Every pattern fails to build | No |

"Silently" means it degrades without a line in the journal, so the symptom is
the only sign.

## The canvas

### `Main.layoutManager._backgroundGroup`

`app.js`, `_build()`:

```js
const group = Main.layoutManager._backgroundGroup;
if (!group) {
    console.warn('[WallpaperFx] No background group to draw in');
    return;
}
...
group.add_child(renderer.actor);
```

**What for.** The layout manager keeps one `Meta.BackgroundGroup` at the bottom
of `global.window_group` and fills it with a wallpaper actor per monitor.
Parenting each monitor's canvas into it is what puts the patterns over the
wallpaper and under every window, and hides them with the windows when the
overview opens (`layout.js` `_updateVisibility()` hides `global.window_group`
there).

**Why nothing public.** `global.window_group` is public, but it is the windows'
parent; putting an actor at its bottom publicly means
`insert_child_at_index(actor, 1)`, which makes the same assumption (the
background group is child 0) less legibly. `Main.layoutManager.addChrome()` and
its relatives are for panels and sit above the windows.

**If it changes.** No canvas is built, so there are no patterns anywhere,
including in the overview and the slide, which clone the canvas. Everything
else carries on: the base is still the shell's wallpaper, the preferences still
work, and `disable()` still hands the wallpaper back.

**Checked.** Yes, with the warning above, once per build. There is
deliberately no fallback: `global.window_group.add_child()` would append the
canvas above every window, which is worse than no patterns.

## The base (background.js)

Every wallpaper the shell shows comes from a `BackgroundSource`, one per
settings schema, held in a `BackgroundCache` that `ui/background.js` keeps
module-private (`function getBackgroundCache()` is not exported in 45.0, 50.5 or
51.0). The desktop (`layout.js`), each overview workspace (`workspace.js`), each
strip of the workspace slide (`workspaceAnimation.js`) and the unlock dialog all
build a `BackgroundManager` on the default `org.gnome.desktop.background`
schema, so they share one source. So does any other extension that builds one,
which is how the base reaches Blur My Shell's copies. The lock screen still
shows the user's own wallpaper. The extension has no `unlock-dialog` session
mode, so locking disables it, and disabling it hands the wallpaper back.

### `new Background.BackgroundManager({...})._backgroundSource`

`_attach()`:

```js
this._holderContainer = new Clutter.Actor();
this._holder = new Background.BackgroundManager({
    container: this._holderContainer,
    monitorIndex: 0,
    controlPosition: false,
});
...
const source = this._holder._backgroundSource;
```

**What for.** `BackgroundManager` is exported; its `_backgroundSource` field is
the only way to reach the shared source without walking
`Main.layoutManager._bgManagers`. Holding a manager also keeps the source alive:
the cache destroys a source when its use count reaches zero, and the layout
manager destroys and rebuilds all its managers on every `monitors-changed`
(`_updateBackgrounds()`). Without the holder, the swapped settings could be lost
with the source they were put into. The container is a bare `Clutter.Actor`
that is never put on the stage, so the holder's own wallpaper actor is never
painted.

**Why nothing public.** There is no exported way to get a `BackgroundSource`,
or to tell the shell to show a wallpaper other than the one in the user's
settings.

**If it changes.** A missing `_backgroundSource` is caught by the check on
`source?._settings` (next entry): the base modes then show the user's own
wallpaper with the patterns over it. The patterns still draw. Nothing paints a
fallback base; the GPU renderer has no base canvas. The constructor itself is
exported and not wrapped: on 50 it cannot throw.

`release()` destroys the holder and then its container, so nothing built here
outlives `disable()`.

### `source._settings`

`_attach()` and `release()`:

```js
this._shellSettings = source._settings;
this._source = source;
source._settings = this._settings;
reloadBackgrounds(source);
...
source._settings = shellSettings;
reloadBackgrounds(source);
```

**What for.** The source reads `picture-uri` (or `picture-uri-dark`, by the
interface's `color-scheme`) and `picture-options` from `_settings` in
`getBackground()`, and hands the same object to each `Background` it builds,
which reads the colour keys from it and reloads on its `changed` signal. Swapping
in a settings object of our own changes every wallpaper the source serves;
swapping the original back returns the user's wallpaper, including any change
they made meanwhile.

**Why nothing public.** Writing the user's real `org.gnome.desktop.background`
would work through public API, but it would overwrite their wallpaper in dconf,
survive a crash or an uninstall, and fight GNOME Settings. The swap never
touches dconf.

**If it changes.** If the field disappears, the check below fires and the base
modes show the user's wallpaper. If the field stays but stops being read (the
source caching the values at construction, say), the swap succeeds and does
nothing, with no log. The check proves the field exists, not that it is still
used.

**Checked.**

```js
if (!source?._settings) {
    console.warn('[WallpaperFx] No background source to take over; the base will not change');
    return;
}
```

GNOME 51 makes `Background._loadImage()` async and loads images through a new
`BackgroundTextureCache` (gjs.guide, "Port Extensions to GNOME Shell 51"). At
the `51.0` tag `_settings`, `_backgrounds` and `_emitChangedSignal()` are all
still there, but the loading path under them is new.

### `source._backgrounds` and `background._emitChangedSignal()`

`reloadBackgrounds()`:

```js
const backgrounds = source._backgrounds;
if (!backgrounds) return;

for (const key of Object.keys(backgrounds))
    backgrounds[key]._emitChangedSignal?.();
```

**What for.** The `Background` objects the source has already built hold the
settings they were built with, so a swap alone changes nothing on screen until
something rebuilds them. `_emitChangedSignal()` is what the shell calls when the
wallpaper setting changes: on an idle it emits `bg-changed`, the source drops
that background, and every `BackgroundManager` holding it builds a new one from
the current `_settings` and crossfades to it. `_backgrounds` is an array used as
a sparse map by monitor index, hence `Object.keys`.

**Why nothing public.** There is no public "reload the wallpaper". Emitting
`bg-changed` directly would depend on one internal name instead of two, but
would lose the idle debounce that folds several changes into one crossfade.

**If it changes.** Nothing is logged. A new base then appears only when the
shell reloads the wallpaper for its own reasons: a monitor change, the user
changing their wallpaper, a light/dark switch. Until then the desktop keeps
showing the previous one.

### `source.destroy`, `source._useCount`, and the desktop's managers

In `_attach()`, after the swap, and `adoptStranded()`:

```js
const destroy = source.destroy;
this._destroyWrap = (...args) => {
    destroy.apply(source, args);
    if (this._source === source) this._sourceLost();
};
source.destroy = this._destroyWrap;

for (const manager of Main.layoutManager._bgManagers ?? []) {
    const old = manager._backgroundSource;
    if (!old || old === source || old._backgrounds || !manager._updateBackgroundActor)
        continue;
    manager._backgroundSource = source;
    source._useCount++;
    manager._updateBackgroundActor();
}
```

**What for.** The cache counts the managers holding a source and destroys it
when the count reaches zero, and `BackgroundManager.destroy()` releases every
time it is called, by schema rather than by source. An extension that destroys
a manager twice therefore takes one too many off. (Blur My Shell's screenshot
component can do this: each of its window-selector destroy handlers destroys
every manager in its list.) Enough of that and the source
we swapped our settings into is destroyed while we still hold it. The next
manager built gets a fresh source reading the user's real settings, and the
desktop shows their wallpaper under an accent or palette base until they log
out. Wrapping `destroy` on that one instance tells us when it happens. The
holder is then dropped without releasing it, because its claim died with the
source and releasing it would take one from the replacement. On an idle we take
whichever source is live now. `release()` deletes the wrapper only while
`source.destroy` is still it, since another extension may have wrapped it since;
left inside theirs, it does nothing once the source is no longer the one held.
The desktop's own managers are still pointing at
the dead source, so they are moved over and each takes a claim, which puts the
count right again for them. Managers owned by other code (the overview's,
another extension's) stay on the dead source, showing the last base, until
their owners rebuild them.

**Why nothing public.** The count and the cache are both module-private. There
is no signal for a source being dropped.

**If it changes.** Nothing is logged. If `destroy` stops being how the cache
drops a source, the wrap never fires and an over-release leaves the base
showing the user's wallpaper until the next log in. That was the state before
this existed. If `_bgManagers` or `_updateBackgroundActor` goes, the desktop
keeps the last base it had until the next monitor change rebuilds it.

#### Why `source._useCount++`

Checked against `js/ui/background.js` at the `50.5` and `51.0` tags, where this
code is the same. `BackgroundCache.getBackgroundSource(layoutManager, schema)`
creates the source for a schema with `_useCount = 1` or adds one to it;
`releaseBackgroundSource(schema)` takes one off the source *currently cached for
that schema* and destroys it at zero. `BackgroundManager` claims in its
constructor and releases in `destroy()`, by schema, and never asks which source
it holds.

So after an over-release the desktop's managers hold no claim on anything, yet
each will still release one when the layout manager destroys it on the next
`monitors-changed` (`_updateBackgrounds()`), and that release lands on whichever
source is cached by then: the one this extension has just taken over. Without a
matching claim, the first monitor change after a recovery over-releases the new
source too, and the cycle repeats. `adoptStranded()` therefore gives each manager
it moves exactly what `getBackgroundSource()` gives a new manager: one more on
`_useCount`. The count then balances when those managers are destroyed.

**Considered instead.**

- *A public claim.* The only public way to add one is constructing a
  `BackgroundManager` (the cache itself, `getBackgroundCache()`, is not
  exported). One per adopted manager, built on a throwaway container and never
  destroyed, would add the same one to the count. It would be a deliberately
  leaked object standing in for one line, it builds and destroys a background
  actor each time, and it still needs the private `manager._backgroundSource`
  and `manager._updateBackgroundActor()` to move the desktop's managers at all.
  No less invasive, and harder to read.
- *Not moving the managers.* Leave them on the dead source and let the layout
  manager rebuild them at the next monitor change. Their releases then hit the
  taken-over source unbalanced (above), and until that change the desktop shows
  the last base it had and ignores every change of base. That is a behaviour
  change, so it is the owner's call along with the rest of the recovery.
- *Asking the layout manager to rebuild* (`_updateBackgrounds()`, private):
  it destroys every stranded manager first, so it is the same unbalanced release
  at once.

**If the shell changes it.**

- `_useCount` renamed or made a `#private` field: the `++` writes a new
  property the cache never reads (`undefined++` is `NaN`), so the claim is lost.
  The first monitor change after a recovery over-releases the taken-over source;
  the `destroy` wrap catches that and takes the new one back on an idle, so that
  change costs a crossfade to the user's wallpaper and back. The managers the
  layout manager builds then are fresh, so it happens once. Nothing is logged.
- The cache counting by source instead of by schema (a manager releasing the
  source it holds): the stranded managers' releases would go to the dead source,
  and each `++` here would be one claim too many, so the taken-over source would
  never reach zero and would live, swapped back, for the rest of the session.
  Harmless, since the cache keeps one source per schema for the session anyway.
- The cache no longer destroying a source at zero: the wrap never fires, and none
  of this code runs.

### A second `Gio.Settings` for `org.gnome.desktop.background`

The constructor:

```js
this._settings = Gio.Settings.new_with_backend(
    BACKGROUND_SCHEMA, Gio.memory_settings_backend_new());
```

Public GIO, but it only makes sense with the swap above. It is the system's own
schema, not a copy, so every key the shell reads exists with its default, in
this version and the next; only a memory backend is behind it, so nothing is
ever written to dconf and the base is gone the moment the shell restarts. `update()` sets
`picture-uri` and `picture-uri-dark` to the same file (so the colour scheme does
not matter), `picture-options`, `primary-color`, `secondary-color` and
`color-shading-type`, between `delay()` and `apply()` so a mode change costs one
crossfade. The gradient files are PNGs in `~/.cache/wallpaper-fx/`, named by
a digest of the stops and size, and never pruned.

## The overview (overview.js)

The overview does not show `global.window_group`. Each workspace preview builds
a wallpaper of its own and clones that workspace's windows over it, so the
patterns are put back the same way: a `Clutter.Clone` of the monitor's canvas in
each preview's own background group, and one in the matching thumbnail.

### `Main.overview._overview?.controls?._workspacesDisplay?._workspacesViews` and `view._workspaces`

`_workspacePreviews()`:

```js
const views = Main.overview._overview?.controls?._workspacesDisplay?._workspacesViews ?? [];
const out = [];
for (const view of views) {
    const inner = view._workspacesView ?? view;
    out.push(...(inner._workspaces ?? (inner._workspace ? [inner._workspace] : [])));
}
```

**What for.** The list of `Workspace` previews on screen, on every monitor.
`_overview` is the `OverviewActor`; `controls` is a public getter on it; the rest
is private. `_workspacesViews` holds a `WorkspacesView` for the primary monitor
and a `SecondaryMonitorDisplay` for each of the others
(`WorkspacesDisplay._updateWorkspacesViews()` in 50.5; the same since GNOME
40). A `SecondaryMonitorDisplay` wraps a view of its own in `_workspacesView`.
That is a `WorkspacesView` (`_workspaces`) or, with workspaces on the primary
monitor only (GNOME's default), an `ExtraWorkspaceView`, which holds a single
`_workspace`. Hence the three-way read. The secondary monitor's preview was
checked showing the patterns in a two-monitor nested shell on the main desktop's 50.5.

**Why nothing public.** The overview exposes no list of its workspace actors.

**If it changes.** Optional chaining turns any missing link into an empty list:
no clones, so the patterns vanish in the overview only (or on the secondary
monitors only, if only the wrapper changes). The base still shows there, since
it is the shell's own wallpaper.

### `workspace._background`, `._backgroundGroup`, `._monitorIndex`

`_attach()`:

```js
const background = workspace._background;
const group = background?._backgroundGroup;
const index = background?._monitorIndex;
if (!group || index === undefined) continue;
```

**What for.** `workspace._background` is the preview's `WorkspaceBackground`;
its `_backgroundGroup` is the `Meta.BackgroundGroup` its wallpaper is in, which
the overview's own scaling and rounded clipping already apply to. The clone goes
in there, inside a `WallpaperFxPreviewHost` that reads its allocation back as a scale.
`_monitorIndex` picks the canvas to clone.

**If it changes.** Skipped per preview (the `continue` above): no patterns in
that preview.

**An edge.** The workspace's `BackgroundManager` is built with
`controlPosition: false`, so when the base changes while the overview is open, the
new wallpaper actor is appended above the clone (`_createBackgroundActor()` only
moves it to the bottom when `controlPosition` is true). The patterns in that
preview are covered until the overview is next opened.

### `Main.overview._overview?.controls?._thumbnailsBox?._thumbnails` and `thumbnail._contents`

`_attach()`:

```js
const wsIndex = workspace.metaWorkspace?.index();
const thumbnails = Main.overview._overview?.controls?._thumbnailsBox?._thumbnails ?? [];
const contents = thumbnails[wsIndex]?._contents;
if (contents) { ... contents.add_child(clone); }
```

**What for.** The strip of workspace thumbnails at the top of the overview.
`_contents` is the actor holding a thumbnail's window clones, laid out in stage
coordinates and scaled as a whole, so the canvas clone is placed at
`monitor.x, monitor.y` like the windows beside it. (`metaWorkspace` has no
underscore and is public by convention.)

**If it changes.** No thumbnail clone: patterns vanish from the thumbnail strip
only.

## The workspace slide (overview.js)

### `Main.wm._workspaceAnimation` and the `_prepareWorkspaceSwitch` override

`enable()`:

```js
const animation = Main.wm._workspaceAnimation;
if (animation?._prepareWorkspaceSwitch) {
    const proto = Object.getPrototypeOf(animation);
    const previous = proto._prepareWorkspaceSwitch;
    const hook = function (...args) {
        const fresh = !this._switchData;
        const result = previous.apply(this, args);
        if (self._slideHook?.hook === hook && fresh && this._switchData) self._joinSlide(this._switchData);
        return result;
    };
    proto._prepareWorkspaceSwitch = hook;
    this._slideHook = { proto, previous, hook };
}
```

**What for.** For the length of a workspace switch (keyboard or swipe), the
`WorkspaceAnimationController` covers the desktop with a strip per monitor, one
workspace group after another, each over a wallpaper of its own, and destroys the
strip when it lands. `_prepareWorkspaceSwitch()` is where the strip is built,
and the only moment it can be joined before it is shown. The override calls the
original first and changes nothing about what it does.

**Why nothing public.** No signal fires when a switch animation starts, and the
strip is never exposed.

**If it changes.** If the method is gone the override is simply not installed:
the patterns vanish while a slide runs and reappear when it lands. If the method
stays and its meaning changes (it stops building the strip, say), `_switchData`
checks below fail quietly with the same result.

**Checked.** `if (animation?._prepareWorkspaceSwitch)`. `destroy()` puts back
the method it found only while the prototype still holds this hook. If another
extension has wrapped it since, the hook stays inside that wrap, calling through
and joining nothing, so the other extension's wrap survives either order of
enabling and disabling. `InjectionManager.clear()` is not used: it would put back
the method seen at enable over the other wrap.

### `this._switchData.monitors`, `strip._monitor`, `strip._workspaceGroups`, `group._background`

`_joinSlide()`:

```js
for (const strip of switchData.monitors ?? []) {
    const index = strip._monitor?.index;
    ...
    for (const group of strip._workspaceGroups ?? []) {
        const wallpaper = group._background?.get_first_child();
        if (wallpaper)
            group._background.insert_child_above(this._cloneOf(source), wallpaper);
    }
}
```

**What for.** `switchData.monitors` are the per-monitor `MonitorGroup` strips,
each with its `_monitor` and its `_workspaceGroups`. The clone goes above each
group's wallpaper and below that workspace's windows.

**The structure differs by version.** In 45 through 49, `group._background` is a
`Meta.BackgroundGroup` whose first child is the wallpaper actor (49 also puts
desktop-window clones in it, after the wallpaper). In 50 and 51 it is a
`WorkspaceBackground`, a new class whose first child is a `Meta.BackgroundGroup`
holding the wallpaper, followed by desktop-window clones. Either way
`get_first_child()` is the wallpaper and the clone lands just above it, under
desktop icons. Only 50 has been seen working.

**If it changes.** Every step is optional-chained or checked, so a change means
no clones: the patterns vanish during the slide only. The clones belong to the
strip and die with it; they are not tracked.

## The renderer (shader.js, engine.js)

### Subclassing `Shell.GLSLEffect`

`buildEffectClass()`:

```js
const Effect = class extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, declarations, code, true);
    }
    ...
    setUniform(name, components, values) { ... this.get_uniform_location(name) ... this.set_uniform_float(location, components, values) ... }
};
Object.defineProperty(Effect, 'name', { value: `WallpaperFx_${effect.id}` });
return GObject.registerClass(Effect);
```

**What for.** Each pattern is a fragment shader. `Shell.GLSLEffect` is the
shell's own way of running one over an actor (the shell's `RadialShaderEffect`
in `lightbox.js` is one), and its `build_pipeline` vfunc, `add_glsl_snippet()`
and the uniform setters are public, introspected API. The shader replaces the
fragment stage (`is_replace` true).

The design leans on one behaviour of it: the shell compiles the pipeline once
per class, on the first instance, and shares it between instances. So there is
one class per pattern, and every monitor's copy of a pattern shares one
compiled program. `Shell.GLSLEffect` is a `Clutter.OffscreenEffect`, so each
layer on each monitor also redirects its (empty) actor into an offscreen texture
of the actor's size before the shader runs over it.

**If it changes.** GNOME 51 removed it (gjs.guide, "Port Extensions to GNOME
Shell 51"; `src/shell-glsl-effect.c` is gone at the `51.0` tag). The replacement
is `Clutter.ShaderEffect` with the snippet returned from
`vfunc_get_static_snippet()`, which mutter 51's `clutter-shader-effect.c` has
and mutter 50's does not, so one zip for 50 and 51 needs two code paths. On 51
as written, `class extends Shell.GLSLEffect` throws when the first pattern is
built, inside `_build()`. That is inside `enable()`, after
`ShellBackground.update()` has taken the wallpaper over. The throw reaches the
shell, which marks the extension as errored and does not call `disable()`: it
only disables an extension whose state is `ACTIVE` (`extensionSystem.js` in
50.5). The base stays taken over, with no patterns, until the shell restarts.
With no pattern on at enable, `enable()` succeeds, and the first pattern switched
on later throws from the settings handler instead, with the same result. A port
to 51 replaces the effect; nothing in 50 throws there.

**Checked.** No. `metadata.json` does not claim 51.

### Overriding `vfunc_paint_target`

```js
vfunc_paint_target(node, paintContext) {
    this.onPaint();
    super.vfunc_paint_target(node, paintContext);
}
```

**What for.** `paint_target` is the `Clutter.OffscreenEffect` vfunc that draws
the offscreen texture through the pipeline, which makes it the last moment
before the frame. `engine.js` sets the time uniforms there, so a pattern shows
the time it is painted rather than the time it was asked for, and books the
next frame from there. A paint that never happens (Clutter culls an actor
nothing can see) books nothing, which is what makes a covered desktop cost
nothing. The signature `(effect, node, paint_context)` is the same in the
`45.0` and `51.0` headers.

**If it changes.** If the signature changed, or the effect stopped painting
through this vfunc, `onPaint` would never run: each pattern would freeze on its
first frame and no timer would be booked. That is a still desktop, idle CPU and
nothing in the log.

### `Cogl.SnippetHook`

`add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, ...)`: `shell-glsl-effect.h` takes a
`CoglSnippetHook` from `48.0`; at `45.0` and `47.0` it took a `ShellSnippetHook`,
so a port to 47 or earlier passes `Shell.SnippetHook.FRAGMENT` (the same values).

### GType names, one set per load

```js
// Kept across disable and enable: a GType cannot be unregistered, and a class compiles
// its pipeline once.
const classes = new Map();
```

A GType can never be unregistered, and registering a name twice throws
("Type name ... is already registered"). No class here sets a `GTypeName`. The
shell sets `GObject.gtypeNameBasedOnJSPath = true` (`ui/environment.js`), and
gjs 1.88 then names a class `Gjs_<module's directory>_<module>_<class name>`
(`_createGTypeName()` in its `GObject.js` override): installed,
`Gjs_lib_shader_WallpaperFx_aurora` and `Gjs_lib_overview_WallpaperFxPreviewHost`;
staged for development, `Gjs_lib-<checksum>_shader_WallpaperFx_aurora`. The 16
pattern classes come from one definition in `buildEffectClass()`, so each is given
its JS name, with the extension's prefix, before it is registered.

- **Installed from the zip** the module is evaluated once per shell process
  (GJS caches modules by URL), so each pattern's class is registered once, the
  first time that pattern is shown, and `classes` keeps it across every
  disable and enable. That module-scope `Map` is deliberately never cleared in
  `disable()`: a cleared map would make the next enable register the same name
  again and throw. A reviewer applying "dynamically stored memory must be cleared
  in disable()" would ask, and the comment above, where the map is declared,
  answers them.
- **Linked for development** the link's entry point,
  `scripts/dev-extension.js`, copies `lib/` somewhere new after every edit (a
  stage named for a checksum of the files), so each enable after an edit
  registers a fresh set under the new directory's name, and the old ones stay
  for the life of the shell: a small, bounded, development-only leak. An enable
  with no edit between (an unlock) imports the same stage and so the same module,
  whose `classes` it reuses. Checked in the nested shell on 50.5: two edits and
  reloads registered three sets of names, with no "already registered".

### `Clutter.Actor.is_in_clone_paint()`

`_onPaint()`:

```js
if (this._timerId || this._paused(layer.actor.is_in_clone_paint())) return;
```

Public and long-standing, present in the `45.0` and `51.0` headers. A paint
through a clone is the overview or the slide, where the patterns show over the
preview's wallpaper whatever windows cover the real desktop, so
`pause-when-covered` must not stop them there.

### `peek_stage_views()` and `Clutter.StageView.get_refresh_rate()`

`_refreshRate()`:

```js
for (const view of this.actor.peek_stage_views())
    hz = Math.max(hz, view.get_refresh_rate());
return hz >= 20 ? hz : 60;
```

Public Clutter API, present in mutter 45 and 51. `peek_stage_views()` is the
list of stage views (on Wayland, roughly one per monitor) the actor was last laid
out on. It is empty (GJS gives `[]`) until the first layout, hence the 60Hz fallback. This is
what paces a 240Hz monitor and a 60Hz one separately. On an X11 session (45 to
49) mutter draws the whole screen as one stage view, so expect every monitor to
pace at one rate there.

## Public, but worth knowing

- **`St.Settings.get().enable_animations`** (system.js). This is not only the
  user's switch. The shell also turns it off with `inhibit_animations()`
  whenever rendering is not hardware-accelerated, a remote-access session that
  asks for animations off (as remote desktop does) is active, or an X server has
  the VNC extension, unless `global.force_animations` is set
  (`AnimationsSettings._shouldEnableAnimations()` in `ui/main.js`, the same at `45.0` and in 50.5).
  In all of those the patterns hold still.
- **`org.gnome.desktop.interface accent-color`** (app.js). This key exists from
  GNOME 47; `app.js` reads it and follows `changed::accent-color` directly. A port
  to 45 or 46 checks for it first: GJS throws on a missing key.
- **UPower and power-profiles-daemon on the system bus** (system.js). These are
  public D-Bus services, and the version notes are in
  [compatibility.md](compatibility.md).
- **`desktopCovered()`** (engine.js) uses `global.display.get_monitor_in_fullscreen()`,
  `Main.layoutManager.getWorkAreaForMonitor()`, `global.get_window_actors()`,
  `Meta.Window.located_on_workspace()` and `get_frame_rect()`. All of them are
  public.
- **GNOME Weather's place** (weather.js, prefs.js). The weather follows the
  first entry of `org.gnome.shell.weather` `locations`, a serialized
  `GWeather.Location` read back with `GWeather.Location.get_world().deserialize()`.
  The schema is GNOME Shell's own and always installed with it. The shell keeps
  the key in step with GNOME Weather's `Locations` property on its
  `org.gnome.Shell.WeatherIntegration` D-Bus interface whenever GNOME Weather
  is running, flatpak or not (`WeatherClient._onWeatherPropertiesChanged()` in
  `misc/weather.js`, 50.0), and reads its first entry for the calendar's weather
  the same way. The extension only reads it and never asks for a location: when
  GNOME Weather is set to find the user automatically, the shell asks Geoclue
  for the calendar, but the extension still uses the first listed place.
  Not used instead: a `WeatherClient` of its own (the class connects to the
  permission store, settings and the app system and has no `destroy()`, so each
  enable would leak one, and it asks Geoclue), and the shell's own instance
  (`Main.panel.statusArea.dateMenu._weatherItem._weatherClient`, private, and
  updated only when the calendar opens). If the key moves or changes format, the
  place reads as none and the preferences say to choose one in GNOME Weather.
- **GWeather** (weather.js). This is libgweather 4, which the shell
  depends on for its own weather. The extension enables only the METAR and
  MET Norway providers, and names itself to them by `application_id` and
  `contact_info`, as MET Norway's terms ask. The location it sets is GNOME
  Weather's, a city of GWeather's list with its METAR station.
  Through GWeather, MET Norway gives no current conditions, only hourly
  forecasts starting about an hour ahead, so its first slot stands in wherever
  no station has reported.

## Not shell internals: the development entry point

`scripts/dev-extension.js`, the entry point `make link` installs, copies `lib/`
into `$XDG_RUNTIME_DIR/wallpaper-fx/shell-<pid>/` after every edit and imports it
from there, deliberately working around the shell's module cache. It is not in the
zip; the shipped `src/extension.js` imports `./lib/app.js` statically. See
[publishing.md](publishing.md#the-development-path-in-extensionjs).
