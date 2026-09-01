import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import cosmographStyles from "../style.css";
import { SphericalGraph, type LabelMode, type SphereStyle } from "../graph/SphericalGraph";
import type { GraphData, GraphNode } from "../types";
import { buildVaultGraph } from "./vaultGraph";
import type CosmographPlugin from "./plugin";

export const VIEW_TYPE_COSMOGRAPH = "cosmograph-3d-view";

const PLUGIN_STYLES = `
  :host { display: block; width: 100%; height: 100%; }
  #app { width: 100%; height: 100%; }
  .app-shell--obsidian {
    width: 100%;
    height: 100%;
    min-height: 0;
    color-scheme: dark;
    color: #e9edf4;
    font-family: "Avenir Next", Avenir, "SF Pro Display", system-ui, sans-serif;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
    --accent: #f08bd7;
    --surface: rgba(7, 9, 16, 0.91);
    --line: rgba(171, 184, 214, 0.12);
    --muted: #858b99;
    --radius: 14px;
  }
  .panel-open {
    width: 100%;
    min-height: 34px;
    margin: 0 0 4px;
    border: 1px solid rgba(216, 157, 196, 0.18);
    border-radius: 9px;
    background: rgba(185, 123, 160, 0.1);
    color: #e5c8da;
    cursor: pointer;
    font-size: 9px;
  }
  .panel-open:hover { background: rgba(185, 123, 160, 0.18); color: #fff0f8; }
  .panel-open[hidden] { display: none; }
  .recent-block li { cursor: pointer; }
  .recent-block li:focus-visible { outline: 1px solid rgba(240, 139, 215, 0.62); outline-offset: 1px; }
  .empty-state {
    position: absolute;
    z-index: 3;
    inset: 0;
    display: grid;
    place-content: center;
    padding: 32px;
    color: #959cab;
    text-align: center;
    font-size: 12px;
    pointer-events: none;
  }
  .empty-state[hidden] { display: none; }
  .app-shell--obsidian .scene-settings { right: 22px; }
  @media (max-width: 760px) {
    .app-shell--obsidian .scene-settings { right: 14px; }
  }
`;

function viewMarkup() {
  return `
    <main class="app-shell app-shell--obsidian">
      <div class="scene-settings" id="scene-settings">
        <button class="scene-settings__trigger" id="scene-settings-trigger" type="button" aria-label="Настройки сцены" aria-controls="scene-settings-menu" aria-expanded="false" title="Настройки сцены"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></button>
        <div class="scene-settings__menu" id="scene-settings-menu" role="dialog" aria-label="Настройки сцены" hidden>
          <div class="scene-settings__heading">
            <span>Настройки сцены</span>
            <small>Управление</small>
          </div>
          <div class="scene-settings__row scene-settings__row--labels">
            <span class="scene-settings__copy"><strong>Подписи узлов</strong><small>Какие названия показывать</small></span>
            <div class="label-mode-switch" role="group" aria-label="Режим подписей узлов">
              <button type="button" data-label-mode="none" aria-pressed="false">Нет</button>
              <button type="button" data-label-mode="important" aria-pressed="true" class="is-active">Важные</button>
              <button type="button" data-label-mode="all" aria-pressed="false">Все</button>
            </div>
          </div>
          <div class="scene-settings__actions">
            <button class="scene-menu-action" id="immersive-toggle" type="button" aria-pressed="false">
              <span><strong>Сцена</strong><small id="immersive-state">Скрыть интерфейс</small></span>
              <span class="scene-menu-action__value">Включить</span>
            </button>
            <button class="scene-menu-action" id="refresh-button" type="button">
              <span><strong>Обновить</strong><small>Перестроить граф из vault</small></span>
              <span class="scene-menu-action__value">Запустить</span>
            </button>
          </div>
        </div>
      </div>

      <header class="topbar">
        <div class="brand" aria-label="CosmoGraph">
          <span class="brand-mark" aria-hidden="true"><span></span></span>
          <span class="brand-copy"><strong>CosmoGraph</strong><small>ваш vault, как планета.</small></span>
        </div>
      </header>

      <aside class="library-sidebar" aria-label="Разделы хранилища">
        <nav id="group-list"></nav>
        <label class="search-field">
          <span class="sr-only">Поиск заметки</span>
          <input id="search-input" type="search" placeholder="Поиск заметок" autocomplete="off" />
          <span class="search-shortcut" aria-hidden="true">⌘F</span>
        </label>
      </aside>

      <section class="viewport" aria-label="Трёхмерный граф заметок">
        <canvas id="graph-canvas"></canvas>
        <div class="node-tooltip" id="node-tooltip" role="tooltip" hidden></div>
        <div class="empty-state" id="empty-state" hidden>В этом vault пока нет Markdown-заметок.</div>
      </section>

      <aside class="note-panel" id="note-panel" aria-live="polite" hidden>
        <div class="panel-heading">
          <span class="panel-swatch" aria-hidden="true"></span>
          <p class="panel-group" id="panel-group"></p>
          <button class="panel-close" id="panel-close" type="button" aria-label="Закрыть">Закрыть</button>
        </div>
        <h1 id="panel-title"></h1>
        <p class="panel-path" id="panel-path"></p>
        <button class="panel-open" id="panel-open" type="button">Открыть заметку</button>
        <dl class="panel-meta">
          <div><dt id="metric-label-a">Входящие связи</dt><dd id="metric-value-a">0</dd></div>
          <div><dt id="metric-label-b">Исходящие связи</dt><dd id="metric-value-b">0</dd></div>
        </dl>
        <div class="recent-block">
          <p>Связанные заметки</p>
          <ul id="recent-notes"></ul>
        </div>
      </aside>

      <footer class="view-dock" aria-label="Режим отображения">
        <div class="sphere-style-switch" role="group" aria-label="Стиль сферы">
          <button type="button" data-sphere-style="calm" aria-pressed="false">Мягкая</button>
          <button type="button" data-sphere-style="radiant" aria-pressed="true">Сияние</button>
        </div>
        <button type="button" id="focus-button">Фокус</button>
        <span id="dock-status">Загрузка</span>
      </footer>

      <div class="loading-state" id="loading-state" hidden>
        <div class="loading-orbit" aria-hidden="true"></div>
        <p>Строим карту связей</p>
      </div>
    </main>
  `;
}

export class CosmographView extends ItemView {
  private graph: SphericalGraph | null = null;
  private shadow: ShadowRoot | null = null;
  private shell: HTMLElement | null = null;
  private currentGraph: GraphData = { nodes: [], edges: [] };
  private currentNode: GraphNode | null = null;
  private refreshTimer: number | null = null;
  private isImmersive = false;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: CosmographPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_COSMOGRAPH;
  }

  getDisplayText() {
    return "CosmoGraph 3D";
  }

  getIcon() {
    return "orbit";
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("cosmograph-content");

    const host = this.contentEl.createDiv({ cls: "cosmograph-host" });
    this.shadow = host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`${cosmographStyles}\n${PLUGIN_STYLES}`);
    this.shadow.adoptedStyleSheets = [sheet];
    const mount = createDiv();
    mount.id = "app";
    const parsedMarkup = new DOMParser().parseFromString(viewMarkup(), "text/html");
    const shell = parsedMarkup.body.firstElementChild;
    if (!shell) throw new Error("CosmoGraph UI markup could not be created.");
    mount.append(shell);
    this.shadow.append(mount);
    this.shell = this.find<HTMLElement>(".app-shell");

    const canvas = this.find<HTMLCanvasElement>("#graph-canvas");
    try {
      this.graph = new SphericalGraph(canvas);
    } catch (error) {
      this.find<HTMLElement>("#empty-state").textContent = error instanceof Error
        ? `Не удалось запустить WebGL: ${error.message}`
        : "Не удалось запустить WebGL.";
      this.find<HTMLElement>("#empty-state").hidden = false;
      return;
    }

    this.bindInterface();
    this.graph.setHandlers((node) => this.showNode(node), (node, x, y) => this.showTooltip(node, x, y));
    this.applySettings();
    this.refreshGraph();

    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
  }

  async onClose() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.graph?.destroy();
    this.graph = null;
    this.shadow = null;
    this.shell = null;
    this.contentEl.removeClass("cosmograph-content");
    this.contentEl.empty();
  }

  applySettings() {
    this.setSphereStyle(this.plugin.preferences.sphereStyle, false);
    this.setLabelMode(this.plugin.preferences.labelMode, false);
  }

  refreshGraph() {
    if (!this.graph) return;
    const loadingState = this.find<HTMLElement>("#loading-state");
    loadingState.hidden = false;
    window.requestAnimationFrame(() => {
      try {
        this.currentGraph = buildVaultGraph(this.app, this.plugin.preferences.groupDepth);
        this.graph?.setData(this.currentGraph);
        this.renderGroupList();
        const status = `${this.currentGraph.nodes.length} заметок · ${this.currentGraph.edges.length} связей`;
        this.find<HTMLElement>("#dock-status").textContent = status;
        this.find<HTMLElement>("#empty-state").hidden = this.currentGraph.nodes.length > 0;
        this.showNode(this.graph?.getPrimaryNode() ?? null);
      } finally {
        loadingState.hidden = true;
      }
    });
  }

  private scheduleRefresh() {
    if (!this.plugin.preferences.refreshAutomatically) return;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshGraph();
    }, 450);
  }

  private bindInterface() {
    const searchInput = this.find<HTMLInputElement>("#search-input");
    const immersiveToggle = this.find<HTMLButtonElement>("#immersive-toggle");
    const sceneSettings = this.find<HTMLElement>("#scene-settings");
    const sceneSettingsTrigger = this.find<HTMLButtonElement>("#scene-settings-trigger");
    const sceneSettingsMenu = this.find<HTMLElement>("#scene-settings-menu");
    const labelModeButtons = this.findAll<HTMLButtonElement>("[data-label-mode]");
    const sphereStyleButtons = this.findAll<HTMLButtonElement>("[data-sphere-style]");

    searchInput.addEventListener("input", () => this.graph?.setSearch(searchInput.value));
    this.find<HTMLButtonElement>("#panel-close").addEventListener("click", () => this.showNode(null));
    this.find<HTMLButtonElement>("#panel-open").addEventListener("click", () => void this.openCurrentNote());
    this.find<HTMLButtonElement>("#refresh-button").addEventListener("click", () => {
      this.setSettingsOpen(false);
      this.refreshGraph();
    });
    this.find<HTMLButtonElement>("#focus-button").addEventListener("click", () => {
      const target = this.currentNode ?? this.graph?.getPrimaryNode();
      if (target) this.graph?.focusNode(target.id);
    });
    immersiveToggle.addEventListener("click", () => this.setImmersive(!this.isImmersive));
    sceneSettingsTrigger.addEventListener("click", () => this.setSettingsOpen(sceneSettingsMenu.hidden));
    labelModeButtons.forEach((button) => button.addEventListener("click", () => {
      this.setLabelMode(button.dataset.labelMode as LabelMode, true);
    }));
    this.shadow?.addEventListener("pointerdown", (event) => {
      if (!sceneSettingsMenu.hidden && event.target instanceof Node && !sceneSettings.contains(event.target)) {
        this.setSettingsOpen(false);
      }
    });
    sphereStyleButtons.forEach((button) => button.addEventListener("click", () => {
      this.setSphereStyle(button.dataset.sphereStyle as SphereStyle, true);
    }));
    this.shadow?.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Escape") {
        if (!sceneSettingsMenu.hidden) {
          this.setSettingsOpen(false);
          sceneSettingsTrigger.focus();
        } else if (this.isImmersive) {
          this.setImmersive(false);
        }
      }
      if ((keyboardEvent.metaKey || keyboardEvent.ctrlKey) && keyboardEvent.key.toLowerCase() === "f") {
        keyboardEvent.preventDefault();
        searchInput.focus();
      }
    });
  }

  private renderGroupList() {
    const groupList = this.find<HTMLElement>("#group-list");
    const searchInput = this.find<HTMLInputElement>("#search-input");
    const counts = new Map<string, number>();
    this.currentGraph.nodes.forEach((node) => counts.set(node.group, (counts.get(node.group) ?? 0) + 1));
    groupList.replaceChildren();
    const items: Array<[string, string, number]> = [["Все заметки", "", this.currentGraph.nodes.length]];
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).forEach(([group, count]) => {
      items.push([group, group, count]);
    });

    items.forEach(([label, search, count], index) => {
      const button = document.createElement("button");
      button.type = "button";
      if (index === 0) button.classList.add("is-active");
      const name = document.createElement("span");
      name.textContent = label;
      const amount = document.createElement("small");
      amount.textContent = String(count);
      button.append(name, amount);
      button.addEventListener("click", () => {
        groupList.querySelectorAll("button").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
        searchInput.value = search;
        this.graph?.setSearch(search);
      });
      groupList.appendChild(button);
    });
  }

  private linkedNotes(node: GraphNode) {
    if (node.kind === "cluster") return this.currentGraph.nodes.filter((candidate) => candidate.group === node.group).slice(0, 3);
    const ids = new Set<string>();
    this.currentGraph.edges.forEach((edge) => {
      if (edge.source === node.id) ids.add(edge.target);
      if (edge.target === node.id) ids.add(edge.source);
    });
    return this.currentGraph.nodes.filter((candidate) => ids.has(candidate.id)).slice(0, 3);
  }

  private showNode(node: GraphNode | null) {
    this.currentNode = node;
    const notePanel = this.find<HTMLElement>("#note-panel");
    if (!node) {
      notePanel.hidden = true;
      return;
    }

    this.find<HTMLElement>("#panel-title").textContent = node.title;
    this.find<HTMLElement>("#panel-path").textContent = node.path;
    this.find<HTMLElement>("#panel-group").textContent = node.kind === "cluster" ? "Кластер" : node.group;
    this.find<HTMLButtonElement>("#panel-open").hidden = node.kind === "cluster";

    if (node.kind === "cluster") {
      this.find<HTMLElement>("#metric-label-a").textContent = "Заметок";
      this.find<HTMLElement>("#metric-value-a").textContent = String(node.noteCount ?? 0);
      this.find<HTMLElement>("#metric-label-b").textContent = "Связей";
      this.find<HTMLElement>("#metric-value-b").textContent = String(this.currentGraph.edges.filter((edge) => {
        const source = this.currentGraph.nodes.find((candidate) => candidate.id === edge.source);
        const target = this.currentGraph.nodes.find((candidate) => candidate.id === edge.target);
        return source?.group === node.group || target?.group === node.group;
      }).length);
    } else {
      this.find<HTMLElement>("#metric-label-a").textContent = "Входящие связи";
      this.find<HTMLElement>("#metric-value-a").textContent = String(this.currentGraph.edges.filter((edge) => edge.target === node.id).length);
      this.find<HTMLElement>("#metric-label-b").textContent = "Исходящие связи";
      this.find<HTMLElement>("#metric-value-b").textContent = String(this.currentGraph.edges.filter((edge) => edge.source === node.id).length);
    }

    const recentNotes = this.find<HTMLUListElement>("#recent-notes");
    recentNotes.replaceChildren(...this.linkedNotes(node).map((linkedNode) => {
      const item = document.createElement("li");
      item.textContent = linkedNode.title;
      item.title = "Открыть заметку";
      item.tabIndex = 0;
      item.addEventListener("click", () => void this.openNote(linkedNode));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") void this.openNote(linkedNode);
      });
      return item;
    }));
    notePanel.hidden = false;
  }

  private showTooltip(node: GraphNode | null, x: number, y: number) {
    const tooltip = this.find<HTMLElement>("#node-tooltip");
    if (!node || this.isImmersive) {
      tooltip.hidden = true;
      return;
    }
    tooltip.textContent = node.title;
    tooltip.style.transform = `translate3d(${x + 14}px, ${y + 14}px, 0)`;
    tooltip.hidden = false;
  }

  private async openCurrentNote() {
    if (this.currentNode) await this.openNote(this.currentNode);
  }

  private async openNote(node: GraphNode) {
    if (node.kind === "cluster") return;
    const file = this.app.vault.getAbstractFileByPath(node.path);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(this.plugin.preferences.openNotesInNewTab ? "tab" : false);
    await leaf.openFile(file);
  }

  private setSphereStyle(style: SphereStyle, persist: boolean) {
    this.graph?.setSphereStyle(style);
    if (this.shell) this.shell.dataset.sphereStyle = style;
    this.findAll<HTMLButtonElement>("[data-sphere-style]").forEach((button) => {
      const active = button.dataset.sphereStyle === style;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (persist) {
      this.plugin.preferences.sphereStyle = style;
      void this.plugin.saveSettings();
    }
  }

  private setSettingsOpen(open: boolean) {
    const menu = this.find<HTMLElement>("#scene-settings-menu");
    const trigger = this.find<HTMLButtonElement>("#scene-settings-trigger");
    menu.hidden = !open;
    trigger.classList.toggle("is-active", open);
    trigger.setAttribute("aria-expanded", String(open));
  }

  private setLabelMode(mode: LabelMode, persist: boolean) {
    this.graph?.setLabelMode(mode);
    this.findAll<HTMLButtonElement>("[data-label-mode]").forEach((button) => {
      const active = button.dataset.labelMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (persist) {
      this.plugin.preferences.labelMode = mode;
      void this.plugin.saveSettings();
    }
  }

  private setImmersive(next: boolean) {
    this.isImmersive = next;
    this.shell?.classList.toggle("is-immersive", next);
    const button = this.find<HTMLButtonElement>("#immersive-toggle");
    const state = this.find<HTMLElement>("#immersive-state");
    button.setAttribute("aria-pressed", String(next));
    button.classList.toggle("is-active", next);
    button.setAttribute("aria-label", next ? "Показать интерфейс" : "Скрыть интерфейс");
    button.title = next ? "Показать интерфейс" : "Скрыть интерфейс";
    state.textContent = next ? "Показать интерфейс" : "Скрыть интерфейс";
    button.querySelector<HTMLElement>(".scene-menu-action__value")!.textContent = next ? "Выключить" : "Включить";
    if (next) {
      this.find<HTMLElement>("#node-tooltip").hidden = true;
      this.setSettingsOpen(false);
    }
  }

  private find<T extends Element>(selector: string) {
    const element = this.shadow?.querySelector<T>(selector);
    if (!element) throw new Error(`CosmoGraph UI element is missing: ${selector}`);
    return element;
  }

  private findAll<T extends Element>(selector: string) {
    return [...(this.shadow?.querySelectorAll<T>(selector) ?? [])];
  }
}
