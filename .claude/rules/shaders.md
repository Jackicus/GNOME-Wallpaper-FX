---
paths:
  - "src/lib/layers/**"
  - "src/lib/shader.js"
  - "src/lib/catalog.js"
  - "src/lib/layer.js"
  - "scripts/shaders.mjs"
  - "scripts/shader-bench.c"
---

# Patterns and their shaders

The contract a pattern keeps (its module, coordinates and `U`, the time helpers, Amount,
`State`, and what makes a shader cheap) is **`docs/patterns.md`**: read it before
touching a layer. A layer module exports `glsl` defining `vec4 <id>(vec2 p)`, a canvas
pixel to a premultiplied colour; `density`, the range of its Amount setting, if it has
one; and, only if the shader needs something worked out on the CPU each frame, a `State`
whose `uniforms(t, density)` is a pure function of time (wave's crest peaks, nebula's
cloud positions, starfield's meteor, lightning's strikes). `shader.js` gives every
pattern the prelude: hashes, value noise, `glow()`, `line()`, and the time helpers.

## The tools

- `node scripts/shaders.mjs check [PATTERNS]` (part of `make check`): compiles each
  pattern with `glslangValidator` in GLSL 1.10, 3.30 and ES 1.00, wrapped the way Cogl
  wraps a snippet, and names the failing line. A pattern not yet in the catalog is
  checked by passing its layer file's path.
- `make bench` / `node scripts/shaders.mjs bench [WxH] [PATTERNS]`: GPU milliseconds per
  frame for each pattern, on the real GPU (a C compiler and EGL/GL headers;
  `scripts/shader-bench.c`). The range across patterns is in `docs/patterns.md`.
- `node scripts/shaders.mjs render PATTERN [--out FILE] [--frames N] [--span N]
  [--density D] [--bg PALETTE]`: frames of one pattern to a PNG over a palette, with no
  shell. The quick loop for a pattern's look, and the one that works while something
  else has the nested shell. Write the PNG into the scratchpad, never the repository.
- `bench` and `render` need the GPU, so they are not in `make check` and do not run in
  CI.

## Rules

- **Measure with `make bench`, one pattern at a time, before and after.** GPU compilers
  do surprising things, and intuition about which line costs has been wrong more often
  than right here (timings on the main desktop's GTX 1080): indexed local arrays
  (constellation, 2.1 ms → 0.8 as straight-line code), loops with runtime counts
  (nebula, 0.42 → 0.32 unrolled behind uniform tests), a second noise octave that was worth its 0.06 ms (aurora's rays).
- **One shader per pattern.** A shader is compiled for the worst case of all its code:
  all eight patterns in one ran at two thirds the speed of the same eight apart. Each
  pattern is its own actor and effect, drawn over the ones before it.
- **Every `State` is a pure function of time.** Spanned monitors each run their own, and
  a monitor that sat paused must pick up exactly where the others are; anything random
  comes from a hash of an index (starfield's meteors are one per eight-second slot).
- **All sixteen together** take about 3.8 ms of GPU time on the main desktop's GTX 1080 at
  1080p, and the compositor thread there does about 4% of a core at 60 FPS in the nested
  shell whichever are on.
- **No `GTypeName`**: GJS names a class after its module's path, so the development
  entry point's fresh stage of `lib/` after every edit registers new names by itself,
  where a fixed `GTypeName` would fail the second time and that pattern would simply not
  appear. `shader.js` gives each pattern's class the JS name `WallpaperFx_<id>`.
- **Look before calling it done.** `render` is the fast loop; the nested shell is where
  motion and the overview are judged, and `start --monitors 2` is the only way to see
  spanning or the seam between two monitors.
