import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { SphereStyle } from "../graph/SphericalGraph";

export type CosmographSettings = {
  sphereStyle: SphereStyle;
  showNodeLabels: boolean;
  openNotesInNewTab: boolean;
  refreshAutomatically: boolean;
};

export const DEFAULT_SETTINGS: CosmographSettings = {
  sphereStyle: "radiant",
  showNodeLabels: true,
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
      .setName("Show node labels")
      .setDesc("Display note and cluster names directly on the sphere.")
      .addToggle((toggle) => toggle
        .setValue(this.controller.preferences.showNodeLabels)
        .onChange(async (value) => {
          this.controller.preferences.showNodeLabels = value;
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
