import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

const DECODER = new TextDecoder("utf-8");
const UPDATE_SECONDS = 2;
const THERMAL_DIR = "/sys/class/thermal";
const DEFAULT_SOC_PATH = `${THERMAL_DIR}/thermal_zone0/temp`;
const DEFAULT_DDR_PATH = `${THERMAL_DIR}/thermal_zone1/temp`;

function readTextFile(path) {
  try {
    const [ok, contents] = GLib.file_get_contents(path);
    if (!ok) {
      return null;
    }
    return DECODER.decode(contents).trim();
  } catch (e) {
    return null;
  }
}

function findThermalPath(typeName, fallbackPath) {
  let dir = null;
  try {
    dir = GLib.dir_open(THERMAL_DIR, 0);
    let name;
    while ((name = GLib.dir_read_name(dir)) !== null) {
      if (!name.startsWith("thermal_zone")) {
        continue;
      }
      const type = readTextFile(`${THERMAL_DIR}/${name}/type`);
      if (type === typeName) {
        return `${THERMAL_DIR}/${name}/temp`;
      }
    }
  } catch (e) {
    return fallbackPath;
  } finally {
    if (dir) {
      GLib.dir_close(dir);
    }
  }
  return fallbackPath;
}

const TempIndicator = GObject.registerClass(
class TempIndicator extends PanelMenu.Button {
  _init(settings, iconDir) {
    super._init(0.0, "KhadasTempIndicator", false);
    this._settings = settings;
    this._iconDir = iconDir;

    this._socPath = findThermalPath("soc_thermal", DEFAULT_SOC_PATH);
    this._ddrPath = findThermalPath("ddr_thermal", DEFAULT_DDR_PATH);

    this._box = new St.BoxLayout({ style_class: "panel-status-menu-box" });
    this.add_child(this._box);

    this._soc = this._createSensor("soc-symbolic.svg");
    this._ddr = this._createSensor("ddr-symbolic.svg");
    this._ddr.box.set_style("margin-left: 6px;");

    this._box.add_child(this._soc.box);
    this._box.add_child(this._ddr.box);

    this._buildMenu();

    this._settingsChangedId = this._settings.connect("changed", () => {
      this._syncFromSettings();
    });

    this._syncFromSettings();
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

  _createSensor(iconName) {
    const box = new St.BoxLayout({ style_class: "panel-status-menu-box" });
    const iconPath = GLib.build_filenamev([this._iconDir, iconName]);
    const icon = new St.Icon({
      gicon: Gio.FileIcon.new(Gio.File.new_for_path(iconPath)),
      style_class: "system-status-icon",
    });
    const label = new St.Label({ text: "--°C", y_align: Clutter.ActorAlign.CENTER });
    box.add_child(icon);
    box.add_child(label);
    return { box, icon, label };
  }

  _buildMenu() {
    this.menu.removeAll();
    this._modeItems = {};
    this._addModeItem("SoC only", "soc");
    this._addModeItem("DDR only", "ddr");
    this._addModeItem("Both", "both");
    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this._iconSwitch = new PopupMenu.PopupSwitchMenuItem(
      "Show icons",
      this._settings.get_boolean("show-icons")
    );
    this._iconSwitch.connect("toggled", (_item, state) => {
      this._settings.set_boolean("show-icons", state);
    });
    this.menu.addMenuItem(this._iconSwitch);
  }

  _addModeItem(label, mode) {
    const item = new PopupMenu.PopupMenuItem(label);
    item.connect("activate", () => {
      this._settings.set_string("show-mode", mode);
    });
    this.menu.addMenuItem(item);
    this._modeItems[mode] = item;
  }

  _readTempC(path) {
    const text = readTextFile(path);
    if (text === null) {
      return null;
    }
    const raw = parseInt(text, 10);
    if (Number.isNaN(raw)) {
      return null;
    }
    return raw / 1000.0;
  }

  _update() {
    const soc = this._readTempC(this._socPath);
    this._soc.label.text = soc === null ? "--°C" : `${soc.toFixed(1)}°C`;

    const ddr = this._readTempC(this._ddrPath);
    this._ddr.label.text = ddr === null ? "--°C" : `${ddr.toFixed(1)}°C`;
  }

  _syncFromSettings() {
    const mode = this._settings.get_string("show-mode");
    const showIcons = this._settings.get_boolean("show-icons");

    this._soc.box.visible = mode === "soc" || mode === "both";
    this._ddr.box.visible = mode === "ddr" || mode === "both";
    this._soc.icon.visible = showIcons;
    this._ddr.icon.visible = showIcons;

    for (const [key, item] of Object.entries(this._modeItems)) {
      const ornament = key === mode ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE;
      item.setOrnament(ornament);
    }

    if (this._iconSwitch) {
      this._iconSwitch.setToggleState(showIcons);
    }
  }

  destroy() {
    if (this._timeoutId) {
      GLib.source_remove(this._timeoutId);
      this._timeoutId = 0;
    }
    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = 0;
    }
    super.destroy();
  }
});

export default class KhadasTempExtension extends Extension {
  enable() {
    if (this._indicator) {
      return;
    }
    this._settings = this.getSettings();
    this._indicator = new TempIndicator(this._settings, `${this.path}/icons`);
    Main.panel.addToStatusArea("khadas-temp", this._indicator);
  }

  disable() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
    this._settings = null;
  }
}
