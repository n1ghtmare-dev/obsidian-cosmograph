import { Plugin, WorkspaceLeaf } from "obsidian";
import { CosmographView, VIEW_TYPE_COSMOGRAPH } from "./CosmographView";
import { CosmographSettingTab, DEFAULT_SETTINGS, type CosmographSettings, type SettingsController } from "./settings";

export default class CosmographPlugin extends Plugin implements SettingsController {
  preferences: CosmographSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_COSMOGRAPH, (leaf) => new CosmographView(leaf, this));
    this.addRibbonIcon("orbit", "Open CosmoGraph 3D", () => void this.activateView());
    this.addCommand({
      id: "open-3d-knowledge-graph",
      name: "Open 3D knowledge graph",
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "refresh-3d-knowledge-graph",
      name: "Refresh 3D knowledge graph",
      checkCallback: (checking) => {
        const view = this.getOpenViews()[0];
        if (!view) return false;
        if (!checking) view.refreshGraph();
        return true;
      },
    });
    this.addSettingTab(new CosmographSettingTab(this.app, this));
  }

  async activateView() {
    let leaf: WorkspaceLeaf;
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_COSMOGRAPH)[0];
    if (existing) {
      leaf = existing;
    } else {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_COSMOGRAPH, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.preferences = { ...DEFAULT_SETTINGS, ...await this.loadData() as Partial<CosmographSettings> | null };
  }

  async saveSettings() {
    await this.saveData(this.preferences);
  }

  applySettingsToViews() {
    this.getOpenViews().forEach((view) => view.applySettings());
  }

  private getOpenViews() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_COSMOGRAPH)
      .map((leaf) => leaf.view)
      .filter((view): view is CosmographView => view instanceof CosmographView);
  }
}
