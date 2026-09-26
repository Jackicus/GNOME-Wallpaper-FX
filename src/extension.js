import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { WallpaperFxApp } from './lib/app.js';

export default class WallpaperFxExtension extends Extension {
    enable() {
        this._app = new WallpaperFxApp(this);
        this._app.enable();
    }

    disable() {
        this._app.disable();
        this._app = null;
    }
}
