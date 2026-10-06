import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { WINDOW_ANIMATION_TIME } from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';

export const PATTERN_PARALLAX_FACTOR = 2.5;

export class ParallaxManager {
    constructor(getRenderers) {
        this._getRenderers = getRenderers;
        this._state = null;
        this._bgManagers = [];
        this._activeStrips = new Set();
        this._imageSize = null;
        this._imagePath = null;
        this._cancellable = null;

        this._bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
        this._ifaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._bgSettings.connectObject(
            'changed::picture-uri', () => this._reloadDesktopImage(),
            'changed::picture-uri-dark', () => this._reloadDesktopImage(),
            this);
        this._ifaceSettings.connectObject('changed::color-scheme',
            () => this._reloadDesktopImage(), this);
    }

    enable(state) {
        const wm = global.workspace_manager;
        wm.connectObject(
            'active-workspace-changed', () => this._onActiveWorkspaceChanged(),
            'workspace-added', () => this._onWorkspacesCountChanged(),
            'workspace-removed', () => this._onWorkspacesCountChanged(),
            this);
        Main.layoutManager.connectObject('monitors-changed', () => this._onMonitorsChanged(), this);
        this._watchBackgroundManagers();
        this.update(state);
    }

    destroy() {
        global.workspace_manager.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._bgSettings.disconnectObject(this);
        this._ifaceSettings.disconnectObject(this);

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        for (const strip of this._activeStrips)
            strip.disconnectObject(this);
        this._activeStrips.clear();

        this._unwatchBackgroundManagers();
        this._resetDesktopPositions();
        this._state = null;
    }

    update(state) {
        this._state = state;
        if (!state.parallax) {
            this._resetDesktopPositions();
            return;
        }

        if (state.mode === 'color' || state.mode === 'accent') {
            this._imagePath = null;
            this._imageSize = state.baseSize;
            this._applyDesktopPositions(false);
            return;
        }

        const path = this._resolveImagePath(state);
        if (path === this._imagePath) {
            this._applyDesktopPositions(false);
            return;
        }

        this._imagePath = path;
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (!path) {
            this._imageSize = null;
            this._applyDesktopPositions(false);
            return;
        }

        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        GdkPixbuf.Pixbuf.get_file_info_async(path, cancellable, (_source, res) => {
            if (cancellable.is_cancelled()) return;
            try {
                const [, w, h] = GdkPixbuf.Pixbuf.get_file_info_finish(res);
                if (w > 0 && h > 0) {
                    this._imageSize = [w, h];
                    if (this._state.parallax) this._applyDesktopPositions(false);
                }
            } catch {
                // Unreadable or missing image file.
            }
        });
    }

    joinSlide(switchData) {
        if (!this._state.parallax) return false;

        const wm = global.workspace_manager;
        const nWorkspaces = wm.get_n_workspaces();
        const vertical = wm.layout_rows === -1;
        const rtl = !vertical && Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
        const onlyPrimary = Meta.prefs_get_workspaces_only_on_primary();

        for (const strip of switchData.monitors) {
            const monitor = strip._monitor;
            if (!monitor) continue;
            if (onlyPrimary && monitor.index !== Main.layoutManager.primaryIndex)
                continue;

            const groups = strip._workspaceGroups;
            if (!groups || groups.length === 0) continue;

            const imgSize = this._imageSize ?? [monitor.width, monitor.height];
            const geom = imageGeometry(monitor, imgSize, this._state.parallaxAmount, vertical);

            const firstBg = groups[0]._background;
            if (firstBg) {
                groups[0].remove_child(firstBg);
                strip.insert_child_at_index(firstBg, 0);
                firstBg.clip_to_allocation = false;
                firstBg.request_mode = Clutter.RequestMode.NONE;
                firstBg.set_size(geom.renderW, geom.renderH);
                const bgActor = firstBg._bgManager?.backgroundActor;
                if (bgActor) {
                    bgActor.request_mode = Clutter.RequestMode.NONE;
                    bgActor.set_size(geom.renderW, geom.renderH);
                }
            }

            for (let i = 1; i < groups.length; i++)
                groups[i]._background.visible = false;

            let patternClone = null;
            const renderer = this._getRenderers().get(monitor.index);
            if (renderer) {
                patternClone = new Clutter.Clone({
                    source: renderer.canvas,
                    reactive: false,
                    width: renderer.canvas.width,
                    height: renderer.canvas.height,
                });
                if (firstBg)
                    strip.insert_child_above(patternClone, firstBg);
                else
                    strip.insert_child_at_index(patternClone, 0);
            }

            const workspaceIndices = groups.map(g => g.workspace.index());
            const prop = vertical ? 'translation_y' : 'translation_x';

            const update = () => {
                const p = strip.progress;
                const pWs = actualWorkspaceProgress(p, workspaceIndices);
                const { wallOffset, patOffset } = offsetsForProgress(pWs, geom, nWorkspaces, rtl);
                if (firstBg) firstBg[prop] = wallOffset;
                if (patternClone) patternClone[prop] = patOffset;
            };

            this._activeStrips.add(strip);
            strip.connectObject(
                'notify::progress', update,
                'destroy', () => {
                    this._activeStrips.delete(strip);
                    this._applyDesktopPositions(false);
                },
                this);
            update();
        }

        return true;
    }

    _reloadDesktopImage() {
        if (this._state?.parallax && this._state.mode === 'desktop')
            this.update(this._state);
    }

    _resolveImagePath(state) {
        if (state.mode === 'image')
            return state.customImage;
        if (state.mode === 'desktop') {
            const dark = this._ifaceSettings.get_enum('color-scheme') === 1;
            const uri = this._bgSettings.get_string(dark ? 'picture-uri-dark' : 'picture-uri');
            return uri ? Gio.File.new_for_commandline_arg(uri).get_path() : null;
        }
        return null;
    }

    _watchBackgroundManagers() {
        this._unwatchBackgroundManagers();
        for (const manager of Main.layoutManager._bgManagers) {
            manager.connectObject('changed', () => {
                if (this._state.parallax) this._applyDesktopPositions(false);
            }, this);
            this._bgManagers.push(manager);
        }
    }

    _unwatchBackgroundManagers() {
        for (const manager of this._bgManagers)
            manager.disconnectObject(this);
        this._bgManagers = [];
    }

    _onMonitorsChanged() {
        this._watchBackgroundManagers();
        if (this._state.parallax) this._applyDesktopPositions(false);
    }

    _onActiveWorkspaceChanged() {
        this._applyDesktopPositions(false);
    }

    _onWorkspacesCountChanged() {
        this._applyDesktopPositions(true);
    }

    _applyDesktopPositions(animate = false) {
        if (!this._state.parallax) return;
        const wm = global.workspace_manager;
        const activeIndex = wm.get_active_workspace_index();
        const nWorkspaces = wm.get_n_workspaces();
        const vertical = wm.layout_rows === -1;
        const rtl = !vertical && Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
        const duration = (animate && this._state.animations) ? WINDOW_ANIMATION_TIME : 0;
        const onlyPrimary = Meta.prefs_get_workspaces_only_on_primary();
        const prop = vertical ? 'translation_y' : 'translation_x';

        for (const monitor of Main.layoutManager.monitors) {
            if (onlyPrimary && monitor.index !== Main.layoutManager.primaryIndex)
                continue;

            const bgActor = Main.layoutManager._bgManagers[monitor.index]?.backgroundActor;
            const renderer = this._getRenderers().get(monitor.index);
            const imgSize = this._imageSize ?? [monitor.width, monitor.height];
            const geom = imageGeometry(monitor, imgSize, this._state.parallaxAmount, vertical);

            if (bgActor) {
                bgActor.request_mode = Clutter.RequestMode.NONE;
                bgActor.set_size(geom.renderW, geom.renderH);
            }

            const { wallOffset, patOffset } = offsetsForProgress(activeIndex, geom, nWorkspaces, rtl);
            setActorOffset(bgActor, prop, wallOffset, duration);
            if (renderer) setActorOffset(renderer.canvas, prop, patOffset, duration);
        }
    }

    _resetDesktopPositions() {
        for (const monitor of Main.layoutManager.monitors) {
            const bgActor = Main.layoutManager._bgManagers[monitor.index]?.backgroundActor;
            const renderer = this._getRenderers().get(monitor.index);
            if (bgActor) {
                bgActor.request_mode = Clutter.RequestMode.CONTENT_SIZE;
                bgActor.set_size(monitor.width, monitor.height);
                bgActor.translation_x = 0;
                bgActor.translation_y = 0;
            }
            if (renderer) {
                renderer.canvas.translation_x = 0;
                renderer.canvas.translation_y = 0;
            }
        }
    }
}

function setActorOffset(actor, prop, offset, duration) {
    if (!actor) return;
    actor.remove_transition(prop);
    if (duration > 0)
        actor.ease({ [prop]: offset, duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    else
        actor[prop] = offset;
}

function imageGeometry(monitor, imgSize, amount, vertical = false) {
    const [w, h] = imgSize;
    const coverScale = Math.max(monitor.width / w, monitor.height / h);
    const mSize = vertical ? monitor.height : monitor.width;
    const coverSize = (vertical ? h : w) * coverScale;
    const spare = coverSize - mSize;
    const travel = amount * mSize;
    const zoom = spare < travel ? (mSize + travel) / coverSize : 1.0;
    const renderW = Math.round(w * coverScale * (vertical ? 1.0 : zoom));
    const renderH = Math.round(h * coverScale * (vertical ? zoom : 1.0));
    const renderSize = vertical ? renderH : renderW;
    const extra = renderSize - mSize;
    return { zoom, travel, extra, renderW, renderH };
}

function offsetsForProgress(pWs, geom, nWorkspaces, rtl = false) {
    if (nWorkspaces <= 1)
        return { wallOffset: Math.round(-geom.extra / 2), patOffset: 0 };

    const step = geom.travel / (nWorkspaces - 1);
    const patternStep = PATTERN_PARALLAX_FACTOR * step;
    let wallOffset;
    let patOffset;
    if (rtl) {
        wallOffset = -(geom.extra + geom.travel) / 2 + pWs * step;
        patOffset = pWs * patternStep;
    } else {
        wallOffset = -(geom.extra - geom.travel) / 2 - pWs * step;
        patOffset = -pWs * patternStep;
    }
    return { wallOffset: Math.round(wallOffset), patOffset: Math.round(patOffset) };
}

function actualWorkspaceProgress(p, workspaceIndices) {
    if (!workspaceIndices || workspaceIndices.length === 0) return p;
    const lower = Math.max(0, Math.min(workspaceIndices.length - 1, Math.floor(p)));
    const upper = Math.max(0, Math.min(workspaceIndices.length - 1, Math.ceil(p)));
    const fraction = p - Math.floor(p);
    return workspaceIndices[lower] + (workspaceIndices[upper] - workspaceIndices[lower]) * fraction;
}
