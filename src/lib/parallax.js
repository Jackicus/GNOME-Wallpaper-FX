import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import St from 'gi://St';
import { BackgroundManager, FADE_ANIMATION_TIME } from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { WINDOW_ANIMATION_TIME } from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';

import { canvasAround, desktopCovered } from './engine.js';

// Moves each monitor's wallpaper inside an even zoom, and the patterns further, by the
// shell's own workspace position (a switch, a swipe and the overview's scrolling all
// move it) and, with the pointer tilt, by where the pointer is on the desktop.
export class Parallax {
    constructor(renderers) {
        this._renderers = renderers;
        this._options = { amount: 0, tilt: 0, span: false, picture: null, blurMyShell: false };
        this._workspaces = null;
        this._pan = null;
        this._tilts = [];
        this._laterId = 0;
        this._managers = [];
        this._blurs = [];
        this._blurHook = null;
        this._panoramas = []; // { index, actor, file, width, height, retiring }
        this._image = null;
        this._loaded = null;
        this._cancellable = null;
        this._previews = [];
        this._count = 0;
    }

    // `amount` is the wallpaper's travel across the workspaces and `tilt` its reach
    // either side of centre, each a share of the monitor; both 0 is off. `picture` is
    // the base's file, when it is one. `blurMyShell` moves Blur My Shell's wallpapers too.
    update(options) {
        this._release();
        this._options = options;
        if (options.amount <= 0 && options.tilt <= 0) {
            this._load();
            return;
        }

        this._count = global.workspace_manager.n_workspaces;
        this._workspaces = Main.createWorkspacesAdjustment(global.stage);
        this._workspaces.connectObject('notify::value', () => this._follow(), this);
        global.workspace_manager.connectObject('notify::n-workspaces', () => this._follow(), this);

        this._pan = new St.Adjustment({ actor: global.stage, upper: 1, value: this._target() });
        this._pan.connectObject('notify::value', () => this._place(), this);

        // Spanned, the monitors tilt as one so the picture stays whole.
        const tiltOf = () => {
            const pair = ['x', 'y'].map(() => {
                const adjustment = new St.Adjustment({ actor: global.stage, lower: -1, upper: 1 });
                adjustment.connectObject('notify::value', () => this._place(), this);
                return adjustment;
            });
            pair.aim = [0, 0];
            return pair;
        };
        const shared = options.span ? tiltOf() : null;
        this._tilts = options.tilt > 0 ? Main.layoutManager.monitors.map(() => shared ?? tiltOf()) : [];
        if (options.tilt > 0) {
            global.backend.get_cursor_tracker().connectObject('position-invalidated', () => {
                this._laterId ||= global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                    this._laterId = 0;
                    this._aim();
                    return GLib.SOURCE_REMOVE;
                });
            }, this);
        }

        // A new wallpaper is a new actor (private: docs/private-api.md).
        this._managers = [...Main.layoutManager._bgManagers ?? []];
        for (const manager of this._managers)
            manager.connectObject('changed', () => this._place(), this);
        if (options.blurMyShell) this._followBlurMyShell();

        this._load();
        this._place();
    }

    // A new picture keeps the adjustments, so nothing jumps: its panorama crossfades
    // over the old one, as the shell's wallpaper does beneath.
    setPicture(picture) {
        if (picture === this._options.picture) return;
        this._options.picture = picture;
        this._load();
    }

    destroy() {
        this._release();
        this._cancellable?.cancel();
        this._cancellable = null;
        this._image = null;
        this._loaded = null;
        for (const { actor } of [...this._panoramas]) actor.destroy();
    }

    // Everything but the panoramas, which outlive a change of travel where they fit it.
    _release() {
        if (!this._workspaces) return;

        global.workspace_manager.disconnectObject(this);
        global.backend.get_cursor_tracker().disconnectObject(this);
        if (this._laterId) global.compositor.get_laters().remove(this._laterId);
        this._laterId = 0;
        this._workspaces.disconnectObject(this);
        this._workspaces = null;
        this.restorePreviews();
        for (const adjustment of [this._pan, ...this._tilts.flat()]) {
            adjustment.remove_transition('value');
            adjustment.disconnectObject(this);
        }
        this._pan = null;
        this._tilts = [];

        for (const manager of this._managers) {
            manager.disconnectObject(this);
            // Null once the shell has destroyed the manager for a monitor change.
            if (manager.backgroundActor) rest(manager.backgroundActor);
        }
        this._managers = [];

        const { proto, previous, hook } = this._blurHook ?? {};
        if (hook && proto._createBackgroundActor === hook) proto._createBackgroundActor = previous;
        this._blurHook = null;
        for (const actor of this._blurs) {
            actor.disconnectObject(this);
            rest(actor);
        }
        this._blurs = [];

        for (const renderer of this._renderers.values())
            renderer.pan(0, 0);
    }

    // The desktop's wallpaper for the workspace slide, panning there as it does here.
    // Spanned, every monitor's part, since each reaches over the others.
    wallpaperFor(index) {
        if (!this._workspaces) return null;

        const monitor = Main.layoutManager.monitors[index];
        const indices = this._options.span ? this._managers.map((_m, i) => i) : [index];
        const clones = indices
            .map(i => this._panoramaOn(i)?.actor ?? this._managers[i]?.backgroundActor)
            .filter(actor => actor)
            .map(actor => {
                const clone = new Clutter.Clone({
                    source: actor,
                    x: actor.x - monitor.x,
                    y: actor.y - monitor.y,
                    width: actor.width,
                    height: actor.height,
                });
                for (const prop of ['translation-x', 'translation-y'])
                    actor.bind_property(prop, clone, prop, GObject.BindingFlags.SYNC_CREATE);
                return clone;
            });
        if (!clones.length) return null;

        const group = new Clutter.Actor();
        for (const clone of clones) group.add_child(clone);
        return group;
    }

    // Each overview preview shows its own workspace's part of the wallpaper, at the
    // desktop's zoom with the tilt at rest. Its wallpaper is the shell's, sized by the
    // preview, so the zoom is a scale about a pivot, and the rounded clip, in the
    // content's own pixels, is mapped back by it.
    placePreviews(workspaces) {
        this.restorePreviews();
        if (!this._workspaces) return;

        const vertical = global.workspace_manager.layout_rows === -1;
        const { tilt } = this._options;
        for (const workspace of workspaces) {
            const background = workspace._background;
            const index = background?._monitorIndex;
            const manager = background?._bgManager;
            const actor = manager?.backgroundActor;
            const amount = this._amountOn(index);
            const spare = amount + 2 * tilt;
            // A panorama is not the shell's to show: its preview keeps the whole wallpaper.
            if (!actor || spare <= 0 || this._panoramaOn(index)) continue;

            // Spanned, as much of its workspace's view as its own part of the picture holds.
            const monitor = Main.layoutManager.monitors[index];
            const box = this._options.span ? canvasAround(Main.layoutManager.monitors) : monitor;
            const [start, length, boxStart, boxLength] = vertical
                ? [monitor.y, monitor.height, box.y, box.height]
                : [monitor.x, monitor.width, box.x, box.width];
            const view = (tilt + amount * this._fraction(workspace.metaWorkspace.index())) * boxLength / spare;
            const at = Math.min(1, Math.max(0, (view - (start - boxStart)) / length));
            const pivot = vertical ? [0.5, at] : [at, 0.5];
            actor.set_pivot_point(...pivot);
            actor.set_scale(1 + spare, 1 + spare);
            actor.content.set_rounded_clip_bounds(clipBounds(index, pivot, 1 + spare));

            const preview = { actor, index, manager };
            actor.connectObject('destroy', () => drop(this._previews, preview), this);
            // A new wallpaper while the overview is open is a new actor, placed afresh.
            manager.connectObject('changed', () => this.placePreviews(workspaces), this);
            this._previews.push(preview);
        }
    }

    restorePreviews() {
        for (const { actor, index, manager } of this._previews) {
            manager.disconnectObject(this);
            actor.disconnectObject(this);
            actor.set_scale(1, 1);
            actor.content.set_rounded_clip_bounds(clipBounds(index, [0, 0], 1));
        }
        this._previews = [];
    }

    // Blur My Shell's static blur paints the wallpaper again, from a BackgroundManager
    // of its own in a widget named 'bms-…' at the monitor's corner. Those wallpapers,
    // the ones there now and every one made later, are moved as the desktop's is.
    _followBlurMyShell() {
        const adopt = actor => {
            if (!(actor instanceof Meta.BackgroundActor) || !actor.get_parent()?.name?.startsWith('bms-'))
                return false;
            this._blurs.push(actor);
            actor.connectObject('destroy', () => drop(this._blurs, actor), this);
            return true;
        };
        const walk = actor => actor.get_children().forEach(child => adopt(child) || walk(child));
        walk(global.stage);

        // Private: docs/private-api.md.
        const proto = BackgroundManager.prototype;
        const previous = proto._createBackgroundActor;
        const self = this;
        const hook = function (...args) {
            const actor = previous.apply(this, args);
            if (self._blurHook?.hook === hook && adopt(actor)) self._place();
            return actor;
        };
        proto._createBackgroundActor = hook;
        this._blurHook = { proto, previous, hook };
    }

    _panoramaOn(index) {
        return this._panoramas.find(p => p.index === index && !p.retiring) ?? null;
    }

    // The workspace travel this monitor has: none where only the primary switches,
    // unless the monitors span one picture, which moves as one.
    _amountOn(index) {
        const onlyPrimary = !this._options.span && Meta.prefs_get_workspaces_only_on_primary();
        return onlyPrimary && index !== Main.layoutManager.primaryIndex ? 0 : this._options.amount;
    }

    _target() {
        return this._fraction(this._workspaces.value);
    }

    // Where a workspace position sits along the panorama, 0 to 1.
    _fraction(position) {
        const { n_workspaces: count, layout_rows: rows } = global.workspace_manager;
        const at = count > 1 ? position / (count - 1) : 0.5;
        const rtl = rows !== -1 && Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
        return Math.min(1, Math.max(0, rtl ? 1 - at : at));
    }

    // A slide follows frame by frame; a workspace added or removed eases to its new place.
    _follow() {
        const count = global.workspace_manager.n_workspaces;
        const easing = count !== this._count || this._pan.get_transition('value');
        this._count = count;

        this._pan.remove_transition('value');
        if (easing) {
            this._pan.ease(this._target(), {
                duration: WINDOW_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._pan.value = this._target();
        }
    }

    // The pointer's place on its monitor (or across them all, spanned), -1 to 1 each
    // way; the others go back to centre. A monitor whose desktop is covered holds
    // still, and nothing moves during a slide, in the overview or with animations off.
    // A slide is asked for, not read off the position: in a column of workspaces the
    // shell's slide comes to rest short of the index (private: docs/private-api.md).
    _aim() {
        if (!St.Settings.get().enable_animations || Main.overview.visible ||
            Main.wm._workspaceAnimation?._switchData)
            return;

        const [x, y] = global.get_pointer();
        const monitors = Main.layoutManager.monitors;
        const area = this._options.span ? canvasAround(monitors) : null;
        monitors.forEach((monitor, index) => {
            const box = area ?? monitor;
            const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
            const aim = inside
                ? [2 * (x - box.x) / box.width - 1, 2 * (y - box.y) / box.height - 1]
                : [0, 0];
            const pair = this._tilts[index];
            if (aim[0] === pair.aim[0] && aim[1] === pair.aim[1]) return;
            if (inside && desktopCovered(index)) return;

            pair.aim = aim;
            pair.forEach((adjustment, axis) => {
                adjustment.ease(aim[axis], {
                    duration: WINDOW_ANIMATION_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            });
        });
    }

    // How big a monitor's wallpaper is drawn: the shell's grown evenly by the travel and
    // the tilt's reach, or a panorama at the cover size, grown only where that falls short.
    _size(monitor, index, panorama) {
        const vertical = global.workspace_manager.layout_rows === -1;
        const spare = this._amountOn(index) + 2 * this._options.tilt;
        if (!panorama) return [monitor.width * (1 + spare), monitor.height * (1 + spare)];

        const [width, height] = this._image;
        const cover = Math.max(monitor.width / width, monitor.height / height);
        const [needX, needY] = vertical
            ? [2 * this._options.tilt, spare]
            : [spare, 2 * this._options.tilt];
        const zoom = Math.max(1,
            monitor.width * (1 + needX) / (width * cover),
            monitor.height * (1 + needY) / (height * cover));
        return [width * cover * zoom, height * cover * zoom];
    }

    // A picture wider than the monitor's shape (taller, with the workspaces in a
    // column) has room of its own, which the shell's wallpaper crops away.
    _load() {
        const { picture, span, amount, tilt } = this._options;
        const wanted = picture && !span && (amount > 0 || tilt > 0) ? picture : null;
        if (wanted === this._loaded) {
            this._showPanoramas();
            return;
        }

        this._cancellable?.cancel();
        this._cancellable = null;
        this._image = null;
        this._loaded = wanted;
        if (!wanted) {
            this._showPanoramas();
            return;
        }
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        GdkPixbuf.Pixbuf.get_file_info_async(wanted, cancellable, (_source, result) => {
            if (cancellable.is_cancelled()) return;
            this._cancellable = null;
            try {
                const [, width, height] = GdkPixbuf.Pixbuf.get_file_info_finish(result);
                this._image = [width, height];
            } catch {
                // Not a picture: the shell's wallpaper is enough.
            }
            this._showPanoramas();
        });
    }

    // One panorama per monitor that has the room, kept while its size holds and
    // crossfaded with its replacement otherwise.
    _showPanoramas() {
        const vertical = global.workspace_manager.layout_rows === -1;
        const [width, height] = this._image ?? [0, 0];
        const file = this._image ? Gio.File.new_for_path(this._loaded) : null;

        Main.layoutManager.monitors.forEach((monitor, index) => {
            // A monitor with nothing to move keeps the shell's wallpaper.
            const moves = this._amountOn(index) + 2 * this._options.tilt > 0;
            const room = file && moves && (vertical
                ? height / width > 1.01 * monitor.height / monitor.width
                : width / height > 1.01 * monitor.width / monitor.height);
            const under = this._managers[index]?.backgroundActor;
            const old = this._panoramaOn(index);
            if (!room || !under) {
                this._retire(index);
                return;
            }
            const [drawnWidth, drawnHeight] = this._size(monitor, index, true).map(Math.round);
            if (old?.file === file.get_path() && old.actor.x === monitor.x && old.actor.y === monitor.y &&
                old.width === drawnWidth && old.height === drawnHeight)
                return;

            // Loaded off the compositor's thread, at no more than the size it is drawn,
            // in a box of its own so the fade is ours whenever the picture lands.
            const image = St.TextureCache.get_default().load_file_async(
                file, drawnWidth, drawnHeight, 1, under.get_resource_scale());
            image.set_size(drawnWidth, drawnHeight);
            const actor = new Clutter.Actor({ x: monitor.x, y: monitor.y, width: drawnWidth, height: drawnHeight, opacity: 0 });
            actor.add_child(image);
            under.get_parent().insert_child_above(actor, old?.actor ?? under);

            const panorama = { index, actor, file: file.get_path(), width: drawnWidth, height: drawnHeight, retiring: false };
            actor.connect('destroy', () => drop(this._panoramas, panorama));
            this._panoramas.push(panorama);
            if (old) old.retiring = true;

            const reveal = () => actor.ease({
                opacity: 255,
                duration: FADE_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                // Every panorama it covers, including one whose own fade-in was cut short.
                onStopped: finished => finished && this._panoramas
                    .filter(p => p.index === index && p.retiring && p !== panorama)
                    .forEach(p => p.actor.destroy()),
            });
            if (image.content) reveal();
            else image.connect('notify::content', reveal);
        });
        if (this._workspaces) this._place();
    }

    // Fades out every panorama on the monitor, the ones already replaced included.
    _retire(index) {
        for (const panorama of this._panoramas.filter(p => p.index === index)) {
            panorama.retiring = true;
            panorama.actor.ease({
                opacity: 0,
                duration: FADE_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: finished => finished && panorama.actor.destroy(),
            });
        }
    }

    _place() {
        const at = this._pan.value;
        const vertical = global.workspace_manager.layout_rows === -1;
        const { tilt } = this._options;

        Main.layoutManager.monitors.forEach((monitor, index) => {
            const amount = this._amountOn(index);
            const spare = amount + 2 * tilt;
            if (spare <= 0) return;

            // Along the workspaces: whatever room is not needed either side, the tilt's
            // reach, the travel, then the reach again. Across them, centred. Spanned, all
            // of that is a share of the whole canvas, and each monitor's part of the
            // shell's wallpaper is grown where it falls in it, so the parts still meet.
            const box = this._options.span ? canvasAround(Main.layoutManager.monitors) : monitor;
            const [tiltX, tiltY] = this._tilts[index]?.map(a => a.value) ?? [0, 0];
            const [tiltAlong, tiltAcross] = vertical ? [tiltY, tiltX] : [tiltX, tiltY];
            const [sizeAlong, sizeAcross] = vertical ? [box.height, box.width] : [box.width, box.height];
            const offset = ([drawnWidth, drawnHeight]) => {
                const [drawnAlong, drawnAcross] = vertical ? [drawnHeight, drawnWidth] : [drawnWidth, drawnHeight];
                const along = (drawnAlong - sizeAlong * (1 + spare)) / 2 +
                    (tilt + amount * at + tilt * tiltAlong) * sizeAlong;
                const across = (drawnAcross - sizeAcross) / 2 + tilt * tiltAcross * sizeAcross;
                return (vertical ? [across, along] : [along, across]).map(v => -Math.round(v));
            };
            // Clipped to its monitor (spanned, to the canvas): grown past it, it would
            // paint over the next one.
            const move = (actor, size) => {
                const [x, y] = offset(size);
                const [dx, dy] = [monitor.x - box.x, monitor.y - box.y].map(d => Math.round(d * spare));
                actor.set_translation(x + dx, y + dy, 0);
                actor.set_clip(box.x - monitor.x - x - dx, box.y - monitor.y - y - dy, box.width, box.height);
            };

            // Grown evenly, so the picture keeps its shape. The content's own size wins
            // over a set one until the request mode changes.
            const grow = actor => {
                actor.request_mode = Clutter.RequestMode.HEIGHT_FOR_WIDTH;
                actor.set_size(...this._size(monitor, index, false));
                move(actor, [box.width * (1 + spare), box.height * (1 + spare)]);
            };
            const actor = this._managers[index]?.backgroundActor;
            if (actor) grow(actor);
            for (const blur of this._blurs) {
                if (blur.monitor === index) grow(blur);
            }
            for (const panorama of this._panoramas) {
                if (panorama.index === index)
                    move(panorama.actor, panorama.actor.get_size());
            }

            const along = (tilt + amount * at + tilt * tiltAlong) / spare;
            const patterns = vertical
                ? [0.5 + 0.5 * tiltX, along]
                : [along, 0.5 + 0.5 * tiltY];
            this._renderers.get(index)?.pan(...patterns);
        });
    }
}

function rest(actor) {
    actor.request_mode = Clutter.RequestMode.CONTENT_SIZE;
    actor.set_size(-1, -1);
    actor.set_translation(0, 0, 0);
    actor.remove_clip();
}

function drop(list, item) {
    const at = list.indexOf(item);
    if (at >= 0) list.splice(at, 1);
}

// The work area, where the shell rounds a preview's corners, as the content sees it
// under a zoom about `pivot` (a fraction of the monitor).
function clipBounds(index, [px, py], zoom) {
    const monitor = Main.layoutManager.monitors[index];
    const work = Main.layoutManager.getWorkAreaForMonitor(index);
    const cx = px * monitor.width;
    const cy = py * monitor.height;
    const rect = new Graphene.Rect();
    rect.origin.x = cx + (work.x - monitor.x - cx) / zoom;
    rect.origin.y = cy + (work.y - monitor.y - cy) / zoom;
    rect.size.width = work.width / zoom;
    rect.size.height = work.height / zoom;
    return rect;
}
