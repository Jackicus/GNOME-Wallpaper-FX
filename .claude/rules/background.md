---
paths:
  - "src/lib/background.js"
  - "src/lib/overview.js"
  - "src/lib/palettes.js"
  - "src/lib/app.js"
  - "docs/private-api.md"
---

# The base and the overview: private shell API

Every reach below is listed in `docs/private-api.md` with what breaks when it moves; a
new one goes there in the same pull request.

## The base (background.js)

- **Handed to the shell, not painted.** Every wallpaper the shell shows comes from one
  `BackgroundSource` reading `org.gnome.desktop.background`. `background.js` gives that
  source a `Gio.Settings` of its own (same schema, memory backend, so the user's dconf is
  untouched) pointed at a palette rendered to a PNG under `~/.cache/wallpaper-fx`, or at
  the chosen picture. The base then appears wherever a wallpaper appears, including the
  copies other extensions blur, and the shell crossfades it when it changes.
- **Reached through private fields**: a `BackgroundSource`'s `_settings` and
  `_backgrounds`, and `Background`'s `_emitChangedSignal`. `background.js` checks for
  them and says so in the log if they are gone; the patterns still draw, over the
  user's own wallpaper.
- **Every write to those settings makes the shell rebuild and crossfade every
  wallpaper**, and so does touching the file it shows: hence `update()` leaving an
  unchanged base alone, and no mtime games in the palette cache.
- When the shell drops and replaces the source it holds, `background.js` takes the new
  one back on an idle (`_retakeId`), removed in `release()`.

## The canvas and the overview (app.js, overview.js)

- **`Main.layoutManager._backgroundGroup`** holds the patterns, over the wallpaper and
  under the windows. If the patterns stop appearing at all, check it first.
- **The overview's clones** walk `controls._workspacesDisplay._workspacesViews`, a
  workspace's `_background` and its `_backgroundGroup`,
  `controls._thumbnailsBox._thumbnails`, and the slide
  (`Main.wm._workspaceAnimation._prepareWorkspaceSwitch`, wrapped). If the patterns only
  vanish in the overview or during a workspace switch, check `overview.js`.
- **`Main.overview.visible` is not to be trusted on its own**: in the nested shell it
  has read true on a plain desktop, so `overview.js` clears its clones before adding
  them, and the engine's pausing asks whether a paint came through a clone instead.
