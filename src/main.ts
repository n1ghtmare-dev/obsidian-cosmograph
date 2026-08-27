import "./style.css";
import { sampleGraph } from "./data/sample";
import { SphericalGraph, type LabelMode, type SphereStyle } from "./graph/SphericalGraph";
import type { GraphData, GraphNode } from "./types";
import { parseVaultFiles } from "./vault";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root is missing");

app.innerHTML = `
  <main class="app-shell">
    <div class="scene-settings" id="scene-settings">
      <button
        class="scene-settings__trigger"
        id="scene-settings-trigger"
        type="button"
        aria-label="Настройки сцены"
        aria-controls="scene-settings-menu"
        aria-expanded="false"
        title="Настройки сцены"
      ><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></button>
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
        </div>
      </div>
    </div>

    <header class="topbar">
      <div class="brand" aria-label="CosmoGraph">
        <span class="brand-mark" aria-hidden="true"><span></span></span>
        <span class="brand-copy"><strong>CosmoGraph</strong><small>ваши мысли, связанные.</small></span>
      </div>
      <div class="top-actions">
        <label class="vault-button" for="vault-input">Открыть vault</label>
        <input id="vault-input" type="file" webkitdirectory multiple accept=".md,text/markdown" />
      </div>
    </header>

    <aside class="library-sidebar" aria-label="Разделы хранилища">
      <nav id="group-list"></nav>
      <label class="search-field">
        <span class="sr-only">Поиск заметки</span>
        <input id="search-input" type="search" placeholder="Поиск заметок" autocomplete="off" />
        <span class="search-shortcut" aria-hidden="true">⌘K</span>
      </label>
    </aside>

    <section class="viewport" aria-label="Трёхмерный граф заметок">
      <canvas id="graph-canvas"></canvas>
      <div class="node-tooltip" id="node-tooltip" role="tooltip" hidden></div>
    </section>

    <aside class="note-panel" id="note-panel" aria-live="polite" hidden>
      <div class="panel-heading">
        <span class="panel-swatch" aria-hidden="true"></span>
        <p class="panel-group" id="panel-group"></p>
        <button class="panel-close" id="panel-close" type="button" aria-label="Закрыть">Закрыть</button>
      </div>
      <h1 id="panel-title"></h1>
      <p class="panel-path" id="panel-path"></p>
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
        <button type="button" data-sphere-style="radiant" aria-pressed="true" class="is-active">Сияние</button>
      </div>
      <button type="button" id="focus-button">Фокус</button>
      <span id="dock-status">Демо</span>
    </footer>

    <div class="loading-state" id="loading-state" hidden>
      <div class="loading-orbit" aria-hidden="true"></div>
      <p>Строим карту связей</p>
    </div>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#graph-canvas")!;
const shell = document.querySelector<HTMLElement>(".app-shell")!;
const immersiveToggle = document.querySelector<HTMLButtonElement>("#immersive-toggle")!;
const immersiveState = document.querySelector<HTMLElement>("#immersive-state")!;
const sceneSettings = document.querySelector<HTMLElement>("#scene-settings")!;
const sceneSettingsTrigger = document.querySelector<HTMLButtonElement>("#scene-settings-trigger")!;
const sceneSettingsMenu = document.querySelector<HTMLElement>("#scene-settings-menu")!;
const labelModeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-label-mode]")];
const fileInput = document.querySelector<HTMLInputElement>("#vault-input")!;
const searchInput = document.querySelector<HTMLInputElement>("#search-input")!;
const groupList = document.querySelector<HTMLElement>("#group-list")!;
const dockStatus = document.querySelector<HTMLElement>("#dock-status")!;
const notePanel = document.querySelector<HTMLElement>("#note-panel")!;
const panelTitle = document.querySelector<HTMLElement>("#panel-title")!;
const panelPath = document.querySelector<HTMLElement>("#panel-path")!;
const panelGroup = document.querySelector<HTMLElement>("#panel-group")!;
const metricLabelA = document.querySelector<HTMLElement>("#metric-label-a")!;
const metricLabelB = document.querySelector<HTMLElement>("#metric-label-b")!;
const metricValueA = document.querySelector<HTMLElement>("#metric-value-a")!;
const metricValueB = document.querySelector<HTMLElement>("#metric-value-b")!;
const recentNotes = document.querySelector<HTMLUListElement>("#recent-notes")!;
const panelClose = document.querySelector<HTMLButtonElement>("#panel-close")!;
const focusButton = document.querySelector<HTMLButtonElement>("#focus-button")!;
const tooltip = document.querySelector<HTMLElement>("#node-tooltip")!;
const loadingState = document.querySelector<HTMLElement>("#loading-state")!;
const sphereStyleButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-sphere-style]")];

let currentGraph = sampleGraph;
let currentNode: GraphNode | null = null;
let isImmersive = false;
const graph = new SphericalGraph(canvas);
const SPHERE_STYLE_KEY = "cosmograph-sphere-style";
const LABEL_MODE_KEY = "cosmograph-node-label-mode";
const LEGACY_LABELS_VISIBLE_KEY = "cosmograph-node-labels-visible";

function setSettingsOpen(open: boolean) {
  sceneSettingsMenu.hidden = !open;
  sceneSettingsTrigger.classList.toggle("is-active", open);
  sceneSettingsTrigger.setAttribute("aria-expanded", String(open));
}

function setLabelMode(mode: LabelMode, persist = true) {
  graph.setLabelMode(mode);
  labelModeButtons.forEach((button) => {
    const active = button.dataset.labelMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (!persist) return;
  try {
    window.localStorage.setItem(LABEL_MODE_KEY, mode);
  } catch {
    // The visual preference remains active for the current session.
  }
}

function setImmersive(next: boolean) {
  isImmersive = next;
  shell.classList.toggle("is-immersive", next);
  immersiveToggle.classList.toggle("is-active", next);
  immersiveToggle.setAttribute("aria-pressed", String(next));
  immersiveToggle.setAttribute("aria-label", next ? "Показать интерфейс" : "Скрыть интерфейс");
  immersiveToggle.title = next ? "Показать интерфейс" : "Скрыть интерфейс";
  immersiveState.textContent = next ? "Показать интерфейс" : "Скрыть интерфейс";
  immersiveToggle.querySelector<HTMLElement>(".scene-menu-action__value")!.textContent = next ? "Выключить" : "Включить";
  if (next) {
    tooltip.hidden = true;
    setSettingsOpen(false);
  }
}

function setSphereStyle(style: SphereStyle) {
  graph.setSphereStyle(style);
  shell.dataset.sphereStyle = style;
  sphereStyleButtons.forEach((button) => {
    const active = button.dataset.sphereStyle === style;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  try {
    window.localStorage.setItem(SPHERE_STYLE_KEY, style);
  } catch {
    // The visual preference remains active for the current session.
  }
}

let initialSphereStyle: SphereStyle = "radiant";
try {
  const storedStyle = window.localStorage.getItem(SPHERE_STYLE_KEY);
  if (storedStyle === "calm" || storedStyle === "radiant") initialSphereStyle = storedStyle;
} catch {
  // Storage can be unavailable in privacy-restricted browser contexts.
}
setSphereStyle(initialSphereStyle);

let initialLabelMode: LabelMode = "important";
try {
  const storedMode = window.localStorage.getItem(LABEL_MODE_KEY);
  if (storedMode === "none" || storedMode === "important" || storedMode === "all") {
    initialLabelMode = storedMode;
  } else if (window.localStorage.getItem(LEGACY_LABELS_VISIBLE_KEY) === "false") {
    initialLabelMode = "none";
  }
} catch {
  // Storage can be unavailable in privacy-restricted browser contexts.
}
setLabelMode(initialLabelMode, false);

function renderGroupList(data: GraphData) {
  const counts = new Map<string, number>();
  data.nodes.forEach((node) => counts.set(node.group, (counts.get(node.group) ?? 0) + 1));
  groupList.replaceChildren();

  const items: Array<[string, string, number]> = [["Все заметки", "", data.nodes.length]];
  [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([group, count]) => {
    items.push([group.replace(/^\d+[.]?\s*/, ""), group, count]);
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
      graph.setSearch(search);
    });
    groupList.appendChild(button);
  });
}

function linkedNotes(node: GraphNode) {
  if (node.kind === "cluster") return currentGraph.nodes.filter((candidate) => candidate.group === node.group).slice(0, 3);
  const ids = new Set<string>();
  currentGraph.edges.forEach((edge) => {
    if (edge.source === node.id) ids.add(edge.target);
    if (edge.target === node.id) ids.add(edge.source);
  });
  return currentGraph.nodes.filter((candidate) => ids.has(candidate.id)).slice(0, 3);
}

function showNode(node: GraphNode | null, focus = true) {
  currentNode = node;
  if (!node) {
    notePanel.hidden = true;
    return;
  }
  panelTitle.textContent = node.title;
  panelPath.textContent = node.path;
  panelGroup.textContent = node.kind === "cluster" ? "Кластер" : node.group.replace(/^\d+[.]?\s*/, "");

  if (node.kind === "cluster") {
    metricLabelA.textContent = "Заметок";
    metricValueA.textContent = String(node.noteCount ?? 0);
    metricLabelB.textContent = "Связей";
    metricValueB.textContent = String(currentGraph.edges.filter((edge) => {
      const source = currentGraph.nodes.find((candidate) => candidate.id === edge.source);
      const target = currentGraph.nodes.find((candidate) => candidate.id === edge.target);
      return source?.group === node.group || target?.group === node.group;
    }).length);
  } else {
    metricLabelA.textContent = "Входящие связи";
    metricValueA.textContent = String(currentGraph.edges.filter((edge) => edge.target === node.id).length);
    metricLabelB.textContent = "Исходящие связи";
    metricValueB.textContent = String(currentGraph.edges.filter((edge) => edge.source === node.id).length);
  }

  recentNotes.replaceChildren(...linkedNotes(node).map((linkedNode) => {
    const item = document.createElement("li");
    item.textContent = linkedNode.title;
    return item;
  }));
  notePanel.hidden = false;
  if (focus) graph.focusNode(node.id);
}

function setGraphData(data: GraphData, status: string) {
  currentGraph = data;
  graph.setData(data);
  renderGroupList(data);
  dockStatus.textContent = status;
  showNode(window.innerWidth < 760 ? null : graph.getPrimaryNode(), false);
}

graph.setHandlers((node) => showNode(node, false), (node, x, y) => {
  if (!node) {
    tooltip.hidden = true;
    return;
  }
  tooltip.textContent = node.title;
  tooltip.style.transform = `translate3d(${x + 14}px, ${y + 14}px, 0)`;
  tooltip.hidden = false;
});

async function openSelectedVault() {
  if (!fileInput.files?.length) return;
  loadingState.hidden = false;
  dockStatus.textContent = "Читаем заметки";
  try {
    const data = await parseVaultFiles(fileInput.files);
    setGraphData(data, "Локальный vault");
  } catch (error) {
    dockStatus.textContent = error instanceof Error ? error.message : "Не удалось открыть vault";
  } finally {
    loadingState.hidden = true;
    fileInput.value = "";
  }
}

fileInput.addEventListener("change", () => void openSelectedVault());

searchInput.addEventListener("input", () => graph.setSearch(searchInput.value));
panelClose.addEventListener("click", () => showNode(null));
focusButton.addEventListener("click", () => {
  const target = currentNode ?? graph.getPrimaryNode();
  if (target) graph.focusNode(target.id);
});
sphereStyleButtons.forEach((button) => {
  button.addEventListener("click", () => setSphereStyle(button.dataset.sphereStyle as SphereStyle));
});
immersiveToggle.addEventListener("click", () => setImmersive(!isImmersive));
sceneSettingsTrigger.addEventListener("click", () => setSettingsOpen(sceneSettingsMenu.hidden));
labelModeButtons.forEach((button) => button.addEventListener("click", () => {
  setLabelMode(button.dataset.labelMode as LabelMode);
}));
document.addEventListener("pointerdown", (event) => {
  if (!sceneSettingsMenu.hidden && event.target instanceof Node && !sceneSettings.contains(event.target)) {
    setSettingsOpen(false);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!sceneSettingsMenu.hidden) {
    setSettingsOpen(false);
    sceneSettingsTrigger.focus();
  } else if (isImmersive) {
    setImmersive(false);
  }
});

setGraphData(sampleGraph, "Демо");

window.addEventListener("pagehide", () => graph.destroy(), { once: true });
