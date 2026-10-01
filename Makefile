include scripts/kit.mk

.PHONY: zip bench prefs

# The extensions.gnome.org upload, in dist/: the kit's pack under its old name.
zip: pack

# Every pattern's shader timed on the real GPU: not in check, which CI runs without one.
bench:
	@node scripts/shaders.mjs bench

# The preferences in the running shell: the user's own session and settings, theirs to run.
prefs:
	@$(DEV) prefs
