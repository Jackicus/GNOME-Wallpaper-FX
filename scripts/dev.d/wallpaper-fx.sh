# Wallpaper FX's own dev.sh commands, sourced by the kit's scripts/dev.sh.
#
#   ./scripts/dev.sh shaders    compile every pattern's shader with glslangValidator in
#                               each GLSL dialect Cogl may hand it to (part of 'check')
#   ./scripts/dev.sh prefs      open the preferences in the running shell (the user's
#                               own session, whose settings they write: theirs to run)
#

# A shader mistake is silent in the shell (the pattern draws nothing); here it
# names the line. Needs no shell, display or GPU, so CI runs it.
cmd_shaders() {
    require node
    node "$REPO_DIR/scripts/shaders.mjs" check
}

cmd_prefs() {
    require gnome-extensions
    info "Opening preferences for $EXT_UUID..."
    gnome-extensions prefs "$EXT_UUID" &
}
