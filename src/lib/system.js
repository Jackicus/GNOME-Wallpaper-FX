import Gio from 'gi://Gio';
import St from 'gi://St';

const UPower = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.UPower">
    <property name="OnBattery" type="b" access="read"/>
  </interface>
</node>`);

const PowerProfiles = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.UPower.PowerProfiles">
    <property name="ActiveProfile" type="s" access="read"/>
  </interface>
</node>`);

export class SystemState {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._proxies = [];
        this._cancellable = new Gio.Cancellable();

        const settings = St.Settings.get();
        this.animations = settings.enable_animations;
        this.onBattery = false;
        this.powerSaver = false;

        settings.connectObject('notify::enable-animations',
            () => this._set('animations', settings.enable_animations), this);

        this._watch(UPower, 'org.freedesktop.UPower', '/org/freedesktop/UPower',
            proxy => this._set('onBattery', !!proxy.OnBattery));
        this._watch(PowerProfiles, 'org.freedesktop.UPower.PowerProfiles', '/org/freedesktop/UPower/PowerProfiles',
            proxy => this._set('powerSaver', proxy.ActiveProfile === 'power-saver'));
    }

    destroy() {
        this._cancellable.cancel();
        St.Settings.get().disconnectObject(this);
        for (const proxy of this._proxies) proxy.disconnectObject(this);
        this._proxies = [];
        this._onChanged = null;
    }

    _watch(Proxy, name, path, read) {
        new Proxy(Gio.DBus.system, name, path, (proxy, error) => {
            if (error) {
                if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn(`[WallpaperFx] ${name} unavailable: ${error.message}`);
                return;
            }
            if (this._cancellable.is_cancelled()) return;
            this._proxies.push(proxy);
            proxy.connectObject('g-properties-changed', () => read(proxy), this);
            read(proxy);
        }, this._cancellable, Gio.DBusProxyFlags.DO_NOT_AUTO_START);
    }

    _set(key, value) {
        if (this[key] === value) return;
        this[key] = value;
        this._onChanged?.();
    }
}
