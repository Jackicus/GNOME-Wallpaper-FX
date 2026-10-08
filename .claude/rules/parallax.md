---
paths:
  - "src/lib/parallax.js"
  - "src/lib/overview.js"
  - "src/lib/engine.js"
---

# Parallax and the pointer tilt

`Parallax` (`parallax.js`) serves `parallax` and `pointer-tilt`. The private reaches it
makes are in `docs/private-api.md`.

- **The wallpaper is grown, then moved inside itself.** The desktop's wallpaper is grown
  evenly by the travel both need and moved by the workspace position
  (`Main.createWorkspacesAdjustment()`) along the workspaces, and by the pointer's place on
  its monitor either way.
- **One picture across the monitors moves as one.** A spanned gradient, or a desktop
  wallpaper set to span, moves with the primary's workspaces, each part grown where it
  falls in the whole canvas and reaching over the others, so the parts meet. A picture
  zoomed on each monitor moves by that monitor's own workspaces, so one whose workspaces
  stay put holds still.
- **The patterns move further** through `MonitorRenderer.pan()`: each its catalog `depth`
  times the wallpaper, scaled by `parallax-depth`, across a canvas of its own made that
  much longer.
- **A wide picture base** (wider than the monitor's shape) is shown on a panorama actor
  of its own, unzoomed where it has the room, since the shell's wallpaper crops it to the
  monitor. A new picture (`setPicture()`) crossfades its panorama and keeps the
  adjustments.
- **Blur My Shell**: with `parallax-blur-my-shell`, its static-blur wallpapers (`bms-…`
  widgets) are moved as the desktop's is. Off, nothing of it runs.
- **The tilt rests** while the desktop is covered, in a slide, in the overview and with
  animations off.
- **The overview**: `overview.js` puts the moved wallpaper under the slide's strip, and
  has each overview preview zoomed to its own workspace's part (`placePreviews()`).
