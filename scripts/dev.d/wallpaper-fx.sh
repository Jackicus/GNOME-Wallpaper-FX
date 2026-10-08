# Wallpaper FX's own dev.sh commands, sourced by the kit's scripts/dev.sh.
#
#   ./scripts/dev.sh shaders    compile every pattern's shader with glslangValidator in
#                               each GLSL dialect Cogl may hand it to (part of 'check')
#   ./scripts/dev.sh counts     every "N patterns" in the README, metadata.json and
#                               docs/ matches the catalog's length (part of 'check')
#   ./scripts/dev.sh prefs      open the preferences in the running shell (the user's
#                               own session, whose settings they write: theirs to run)
#

# A shader mistake is silent in the shell (the pattern draws nothing); here it
# names the line. Needs no shell, display or GPU, so CI runs it.
cmd_shaders() {
    require node
    node "$REPO_DIR/scripts/shaders.mjs" check
}

# The count is written out by hand, so it goes stale when a pattern is added.
# Read from the source: importing the catalog would import Gjs's gi modules.
cmd_counts() {
    local words=(zero one two three four five six seven eight nine ten eleven twelve thirteen
        fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two
        twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty)
    local n file count bad=0
    n=$(awk '/^export const EFFECTS/ { on = 1; next } on && /^]/ { exit } on && /\{ id:/ { c++ } END { print c + 0 }' \
        "$SRC_DIR/lib/catalog.js")
    while IFS=: read -r file _ count; do
        count=${count,,}
        count=${count%% *}
        [[ $count == "$n" || $count == "${words[n]}" ]] && continue
        warn "$file says $count patterns; the catalog has $n."
        bad=1
    done < <(cd "$REPO_DIR" && grep -onwiE "([0-9]+|$(IFS='|'; echo "${words[*]}")) patterns" \
        README.md src/metadata.json docs/*.md)
    ((bad)) && die "A pattern count is out of date."
    ok "Every pattern count says $n."
}

cmd_prefs() {
    require gnome-extensions
    info "Opening preferences for $EXT_UUID..."
    gnome-extensions prefs "$EXT_UUID" &
}
