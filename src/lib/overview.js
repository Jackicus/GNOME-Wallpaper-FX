// The patterns cloned into the overview's previews, its thumbnails and the workspace
// slide, which draw wallpapers of their own (docs/private-api.md, "The overview").

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

// A preview is stretched in x and y as the overview animates, and does not always
// notify its size, so the clone follows the allocation as a scale.
const PreviewHost = GObject.registerClass(
class PreviewHost extends Clutter.Actor {
    constructor(props, monitor) {
        super(props);
        this._monitor = monitor;
    }

    // A size request here would stretch the workspace out of shape.
    vfunc_get_preferred_width() {
        return [0, 0];
    }

    vfunc_get_preferred_height() {
        return [0, 0];
    }

    vfunc_allocate(box) {
        super.vfunc_allocate(box);
        const clone = this.get_first_child();
        if (!clone) return;

        const scaleX = box.get_width() / this._monitor.width;
        const scaleY = box.get_height() / this._monitor.height;
        if (scaleX === this._scaleX && scaleY === this._scaleY) return;
        this._scaleX = scaleX;
        this._scaleY = scaleY;
        clone.set_scale(scaleX, scaleY);
    }
});

export class OverviewCanvas {
    constructor(sourceFor) {
        this._sourceFor = sourceFor;
        this._clones = [];
        this._attached = false;
        this._injections = new InjectionManager();
    }

    enable() {
        // The previews exist by 'showing', so the clones are there for the first frame.
        Main.overview.connectObject(
            'showing', () => this._attach(),
            'hidden', () => this._detach(),
            this);

        if (Main.overview.visible) this._attach();

        const animation = Main.wm._workspaceAnimation;
        if (animation?._prepareWorkspaceSwitch) {
            const self = this;
            this._injections.overrideMethod(
                Object.getPrototypeOf(animation), '_prepareWorkspaceSwitch',
                original => function (...args) {
                    // It returns early when a slide is already under way.
                    const fresh = !this._switchData;
                    original.apply(this, args);
                    if (fresh && this._switchData) self._joinSlide(this._switchData);
                });
        }
    }

    destroy() {
        this._injections.clear();
        Main.overview.disconnectObject(this);
        this._detach();
    }

    invalidate() {
        if (this._attached) this._attach();
    }

    _joinSlide(switchData) {
        for (const strip of switchData.monitors ?? []) {
            const index = strip._monitor?.index;
            const source = index === undefined ? null : this._sourceFor(index);
            if (!source) continue;

            for (const group of strip._workspaceGroups ?? []) {
                // Over the wallpaper and under the workspace's own windows.
                const wallpaper = group._background?.get_first_child();
                if (wallpaper)
                    group._background.insert_child_above(this._cloneOf(source), wallpaper);
            }
        }
    }

    _attach() {
        // 'showing' can follow an attach made at enable; twice would double the light.
        this._detach();
        this._attached = true;

        const monitors = Main.layoutManager.monitors;

        for (const workspace of this._workspacePreviews()) {
            const background = workspace._background;
            const group = background?._backgroundGroup;
            const index = background?._monitorIndex;
            if (!group || index === undefined) continue;

            const source = this._sourceFor(index);
            const monitor = monitors[index];
            if (!source || !monitor) continue;

            const host = new PreviewHost({
                name: `WallpaperFxPreview:${index}`,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
                reactive: false,
            }, monitor);
            host.add_child(this._cloneOf(source));
            group.add_child(host);
            this._track(host);

            // A thumbnail's contents are laid out in stage coordinates.
            const wsIndex = workspace.metaWorkspace?.index();
            const thumbnails = Main.overview._overview?.controls?._thumbnailsBox?._thumbnails ?? [];
            const contents = thumbnails[wsIndex]?._contents;
            if (contents) {
                const clone = this._cloneOf(source);
                clone.set_position(monitor.x, monitor.y);
                contents.add_child(clone);
                this._track(clone);
            }
        }
    }

    _cloneOf(source) {
        return new Clutter.Clone({
            source,
            reactive: false,
            width: source.width,
            height: source.height,
        });
    }

    _detach() {
        this._attached = false;
        for (const actor of [...this._clones]) actor.destroy();
        this._clones = [];
    }

    _track(actor) {
        this._clones.push(actor);
        actor.connect('destroy', () => {
            const at = this._clones.indexOf(actor);
            if (at >= 0) this._clones.splice(at, 1);
        });
    }

    // A secondary monitor's display wraps a view of all the workspaces, or of one.
    _workspacePreviews() {
        const views = Main.overview._overview?.controls?._workspacesDisplay?._workspacesViews ?? [];
        const out = [];
        for (const view of views) {
            const inner = view._workspacesView ?? view;
            out.push(...(inner._workspaces ?? (inner._workspace ? [inner._workspace] : [])));
        }
        return out;
    }
}
