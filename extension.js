import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
const TextDecoder = globalThis.TextDecoder;

const TEMP_PATH = "/sys/class/thermal/thermal_zone0/temp";
const UPDATE_SECONDS = 2;

const TempIndicator = GObject.registerClass(
class TempIndicator extends PanelMenu.Button {
  _init() {
    super._init(0.0, "KhadasTempIndicator", false);
    this._label = new St.Label({ text: "--°C", y_align: Clutter.ActorAlign.CENTER });
    this.add_child(this._label);

    this._update();
    this._timeoutId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      UPDATE_SECONDS,
      () => {
        this._update();
        return GLib.SOURCE_CONTINUE;
      }
    );
  }

  _readTempC() {
    try {
      const [ok, contents] = GLib.file_get_contents(TEMP_PATH);
      if (!ok) {
        return null;
      }
      const raw = parseInt(new TextDecoder("utf-8").decode(contents).trim(), 10);
      if (Number.isNaN(raw)) {
        return null;
      }
      return raw / 1000.0;
    } catch (e) {
      return null;
    }
  }

  _update() {
    const tempC = this._readTempC();
    if (tempC === null) {
      this._label.text = "--°C";
      return;
    }
    this._label.text = `${tempC.toFixed(1)}°C`;
  }

  destroy() {
    if (this._timeoutId) {
      GLib.source_remove(this._timeoutId);
      this._timeoutId = 0;
    }
    super.destroy();
  }
});

export default class KhadasTempExtension {
  constructor() {
    this._indicator = null;
  }

  enable() {
    if (this._indicator) {
      return;
    }
    this._indicator = new TempIndicator();
    Main.panel.addToStatusArea("khadas-temp", this._indicator);
  }

  disable() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
  }
}
