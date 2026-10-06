import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { WINDOW_ANIMATION_TIME } from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';

// Pans each monitor's wallpaper, zoomed by the travel it needs, with the shell's
// own workspace position: a switch, a swipe and the overview's scrolling all move it.
export class WorkspaceParallax {
    constructor(renderers) {
        this._renderers = renderers;
        this._amount = 0;
        this._workspaces = null;
        this._pan = null;
        this._managers = [];
        this._count = 0;
    }

    // `amount` is the wallpaper's whole travel as a share of the monitor; 0 is off.
    update(amount) {
        this.destroy();
        if (amount <= 0) return;

        this._amount = amount;
        this._count = global.workspace_manager.n_workspaces;
        this._workspaces = Main.createWorkspacesAdjustment(global.stage);
        this._workspaces.connectObject('notify::value', () => this._follow(), this);
        global.workspace_manager.connectObject('notify::n-workspaces', () => this._follow(), this);

        this._pan = new St.Adjustment({ actor: global.stage, upper: 1, value: this._target() });
        this._pan.connectObject('notify::value', () => this._place(), this);

        // A new wallpaper is a new actor (private: docs/private-api.md).
        this._managers = [...Main.layoutManager._bgManagers ?? []];
        for (const manager of this._managers)
            manager.connectObject('changed', () => this._place(), this);

        this._place();
    }

    destroy() {
        if (!this._workspaces) return;

        global.workspace_manager.disconnectObject(this);
        this._workspaces.disconnectObject(this);
        this._workspaces = null;
        this._pan.remove_transition('value');
        this._pan.disconnectObject(this);
        this._pan = null;

        for (const manager of this._managers) {
            manager.disconnectObject(this);
            // Null once the shell has destroyed the manager for a monitor change.
            const actor = manager.backgroundActor;
            if (actor) {
                actor.request_mode = Clutter.RequestMode.CONTENT_SIZE;
                actor.set_size(-1, -1);
                actor.set_translation(0, 0, 0);
            }
        }
        this._managers = [];

        for (const renderer of this._renderers.values())
            renderer.pan(0);
    }

    // The desktop's wallpaper for the workspace slide, panning there as it does here.
    wallpaperFor(index) {
        const actor = this._workspaces ? this._managers[index]?.backgroundActor : null;
        if (!actor) return null;

        const clone = new Clutter.Clone({ source: actor, width: actor.width, height: actor.height });
        for (const prop of ['translation-x', 'translation-y'])
            actor.bind_property(prop, clone, prop, GObject.BindingFlags.SYNC_CREATE);
        return clone;
    }

    _target() {
        const { n_workspaces: count, layout_rows: rows } = global.workspace_manager;
        const at = count > 1 ? this._workspaces.value / (count - 1) : 0.5;
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

    _place() {
        const at = this._pan.value;
        const vertical = global.workspace_manager.layout_rows === -1;
        const onlyPrimary = Meta.prefs_get_workspaces_only_on_primary();

        this._managers.forEach((manager, index) => {
            const actor = manager.backgroundActor;
            if (!actor || (onlyPrimary && index !== Main.layoutManager.primaryIndex)) return;

            // Grown evenly, so the picture keeps its shape. The content's own size wins
            // over a set one until the request mode changes.
            const { width, height } = Main.layoutManager.monitors[index];
            const spareX = width * this._amount;
            const spareY = height * this._amount;
            actor.request_mode = Clutter.RequestMode.HEIGHT_FOR_WIDTH;
            actor.set_size(width + spareX, height + spareY);
            actor.set_translation(
                -Math.round(vertical ? spareX / 2 : spareX * at),
                -Math.round(vertical ? spareY * at : spareY / 2),
                0);
        });

        for (const renderer of this._renderers.values())
            renderer.pan(at);
    }
}
