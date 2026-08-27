import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { LabelMode, SphereStyle } from "../graph/SphericalGraph";

export type CosmographSettings = {
  sphereStyle: SphereStyle;
  labelMode: LabelMode;
  openNotesInNewTab: boolean;
  refreshAutomatically: boolean;
};

export const DEFAULT_SETTINGS: CosmographSettings = {
  sphereStyle: "radiant",
  labelMode: "important",
  openNotesInNewTab: true,
  refreshAutomatically: true,
};

export type SettingsController = Plugin & {
  preferences: CosmographSettings;
  saveSettings(): Promise<void>;
  applySettingsToViews(): void;
};

export class CosmographSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly controller: SettingsController) {
    super(app, controller);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Sphere style")
      .setDesc("Choose the default visual palette for the knowledge planet.")
      .addDropdown((dropdown) => dropdown
        .addOption("radiant", "Radiant")
        .addOption("calm", "Calm")
        .setValue(this.controller.preferences.sphereStyle)
        .onChange(async (value) => {
          this.controller.preferences.sphereStyle = value as SphereStyle;
          await this.controller.saveSettings();
          this.controller.applySettingsToViews();
        }));

    new Setting(containerEl)
      .setName("Node labels")
      .setDesc("Choose whether to hide labels, show important nodes, or show every node.")
      .addDropdown((dropdown) => dropdown
        .addOption("none", "None")
        .addOption("important", "Important")
        .addOption("all", "All")
        .setValue(this.controller.preferences.labelMode)
        .onChange(async (value) => {
          this.controller.preferences.labelMode = value as LabelMode;
          await this.controller.saveSettings();
          this.controller.applySettingsToViews();
        }));

    new Setting(containerEl)
      .setName("Open notes in a new tab")
      .setDesc("Keep CosmoGraph visible when opening a note from the details panel.")
      .addToggle((toggle) => toggle
        .setValue(this.controller.preferences.openNotesInNewTab)
        .onChange(async (value) => {
          this.controller.preferences.openNotesInNewTab = value;
          await this.controller.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Refresh automatically")
      .setDesc("Rebuild the graph when notes or resolved links change.")
      .addToggle((toggle) => toggle
        .setValue(this.controller.preferences.refreshAutomatically)
        .onChange(async (value) => {
          this.controller.preferences.refreshAutomatically = value;
          await this.controller.saveSettings();
        }));
  }
}
