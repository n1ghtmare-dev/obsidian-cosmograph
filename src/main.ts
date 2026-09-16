import "./style.css";
import { sampleGraph } from "./data/sample";
import { SphericalGraph, type LabelMode, type SphereStyle } from "./graph/SphericalGraph";
import { buildGraphLookup } from "./graph/lookup";
import { groupNameFor } from "./obsidian/vaultGraph";
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
        <div class="scene-settings__row scene-settings__row--clusters">
          <span class="scene-settings__copy"><strong>Глубина кластеров</strong><small>Насколько дробить папки</small></span>
          <div class="cluster-depth-switch" role="group" aria-label="Глубина папок для кластеров">
            <button type="button" data-group-depth="1" aria-label="Один уровень папок" aria-pressed="true" class="is-active">1</button>
            <button type="button" data-group-depth="2" aria-label="Два уровня папок" aria-pressed="false">2</button>
            <button type="button" data-group-depth="3" aria-label="Три уровня папок" aria-pressed="false">3</button>
          </div>
        </div>
        <div class="scene-settings__actions">
          <button class="scene-menu-action" id="cosmic-background-toggle" type="button" aria-pressed="false">
            <span><strong>Космический фон</strong><small>Туманности и дальние галактики</small></span>
            <span class="scene-menu-action__value">Включить</span>
          </button>
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
      <div class="focus-controls" id="focus-controls">
        <span class="focus-controls__copy"><strong>Окружение</strong><small id="focus-summary">Ближайшие связи заметки</small></span>
        <div class="focus-depth-switch" role="group" aria-label="Глубина связей в фокусе">
          <button type="button" data-focus-depth="1" aria-label="Один шаг связей" aria-pressed="true" class="is-active">1</button>
          <button type="button" data-focus-depth="2" aria-label="Два шага связей" aria-pressed="false">2</button>
          <button type="button" data-focus-depth="3" aria-label="Три шага связей" aria-pressed="false">3</button>
        </div>
      </div>
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
      <button type="button" id="focus-button" aria-pressed="false">Фокус</button>
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
const cosmicBackgroundToggle = document.querySelector<HTMLButtonElement>("#cosmic-background-toggle")!;
const sceneSettings = document.querySelector<HTMLElement>("#scene-settings")!;
const sceneSettingsTrigger = document.querySelector<HTMLButtonElement>("#scene-settings-trigger")!;
const sceneSettingsMenu = document.querySelector<HTMLElement>("#scene-settings-menu")!;
const labelModeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-label-mode]")];
const groupDepthButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-group-depth]")];
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
const focusSummary = document.querySelector<HTMLElement>("#focus-summary")!;
const focusDepthButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-focus-depth]")];
const tooltip = document.querySelector<HTMLElement>("#node-tooltip")!;
const loadingState = document.querySelector<HTMLElement>("#loading-state")!;
const sphereStyleButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-sphere-style]")];

let sourceGraph = sampleGraph;
let currentLookup = buildGraphLookup(sampleGraph);
let currentGraphStatus = "Демо";
let currentNode: GraphNode | null = null;
let isImmersive = false;
let isFocusMode = false;
let currentFocusDepth = 1;
let currentGroupDepth = 1;
const graph = new SphericalGraph(canvas);
const SPHERE_STYLE_KEY = "cosmograph-sphere-style";
const COSMIC_BACKGROUND_KEY = "cosmograph-cosmic-background";
const LABEL_MODE_KEY = "cosmograph-node-label-mode";
const GROUP_DEPTH_KEY = "cosmograph-cluster-folder-depth";
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

function graphAtDepth(data: GraphData, depth: number): GraphData {
  return {
    ...data,
    nodes: data.nodes.map((node) => node.kind === "cluster" ? node : {
      ...node,
      group: groupNameFor(node.path, depth),
    }),
  };
}

function setGroupDepth(depth: number, persist = true, rebuild = true) {
  currentGroupDepth = Math.min(3, Math.max(1, Math.trunc(depth) || 1));
  groupDepthButtons.forEach((button) => {
    const active = Number(button.dataset.groupDepth) === currentGroupDepth;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (persist) {
    try {
      window.localStorage.setItem(GROUP_DEPTH_KEY, String(currentGroupDepth));
    } catch {
      // The visual preference remains active for the current session.
    }
  }
  if (rebuild) setGraphData(graphAtDepth(sourceGraph, currentGroupDepth), currentGraphStatus);
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

function setCosmicBackground(enabled: boolean, persist = true) {
  graph.setCosmicBackground(enabled);
  cosmicBackgroundToggle.classList.toggle("is-active", enabled);
  cosmicBackgroundToggle.setAttribute("aria-pressed", String(enabled));
  cosmicBackgroundToggle.querySelector<HTMLElement>(".scene-menu-action__value")!.textContent = enabled ? "Выключить" : "Включить";
  if (!persist) return;
  try {
    window.localStorage.setItem(COSMIC_BACKGROUND_KEY, String(enabled));
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

let initialCosmicBackground = false;
try {
  initialCosmicBackground = window.localStorage.getItem(COSMIC_BACKGROUND_KEY) === "true";
} catch {
  // Storage can be unavailable in privacy-restricted browser contexts.
}
setCosmicBackground(initialCosmicBackground, false);

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

let initialGroupDepth = 1;
try {
  const storedDepth = Number(window.localStorage.getItem(GROUP_DEPTH_KEY));
  if (storedDepth >= 1 && storedDepth <= 3) initialGroupDepth = storedDepth;
} catch {
  // Storage can be unavailable in privacy-restricted browser contexts.
}
setGroupDepth(initialGroupDepth, false, false);

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
  if (node.kind === "cluster") return (currentLookup.nodesByGroup.get(node.group) ?? []).slice(0, 3);
  return [...(currentLookup.adjacency.get(node.id) ?? [])]
    .map((id) => currentLookup.nodesById.get(id))
    .filter((candidate): candidate is GraphNode => Boolean(candidate))
    .slice(0, 3);
}

function updateFocusDepthButtons() {
  focusDepthButtons.forEach((button) => {
    const active = Number(button.dataset.focusDepth) === currentFocusDepth;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setFocusMode(active: boolean, node: GraphNode | null = currentNode) {
  if (!active || !node) {
    isFocusMode = false;
    graph.clearFocus();
    shell.classList.remove("is-focus-mode");
    focusButton.classList.remove("is-active");
    focusButton.setAttribute("aria-pressed", "false");
    focusButton.textContent = "Фокус";
    focusSummary.textContent = "Ближайшие связи заметки";
    return;
  }

  isFocusMode = true;
  const noteCount = graph.setFocus(node.id, currentFocusDepth);
  shell.classList.add("is-focus-mode");
  focusButton.classList.add("is-active");
  focusButton.setAttribute("aria-pressed", "true");
  focusButton.textContent = "Выйти";
  focusSummary.textContent = `${noteCount} ${noteCount === 1 ? "заметка" : noteCount < 5 ? "заметки" : "заметок"} в фокусе`;
}

function setFocusDepth(depth: number) {
  currentFocusDepth = Math.min(3, Math.max(1, Math.trunc(depth) || 1));
  updateFocusDepthButtons();
  if (isFocusMode && currentNode) setFocusMode(true, currentNode);
}

function showNode(node: GraphNode | null, focus = true) {
  currentNode = node;
  if (!node) {
    if (isFocusMode) setFocusMode(false);
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
    metricValueB.textContent = String(currentLookup.incidentEdgesByGroup.get(node.group) ?? 0);
  } else {
    metricLabelA.textContent = "Входящие связи";
    metricValueA.textContent = String(currentLookup.incomingCounts.get(node.id) ?? 0);
    metricLabelB.textContent = "Исходящие связи";
    metricValueB.textContent = String(currentLookup.outgoingCounts.get(node.id) ?? 0);
  }

  recentNotes.replaceChildren(...linkedNotes(node).map((linkedNode) => {
    const item = document.createElement("li");
    item.textContent = linkedNode.title;
    item.title = "Показать на сфере";
    item.tabIndex = 0;
    item.addEventListener("click", () => showNode(linkedNode));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") showNode(linkedNode);
    });
    return item;
  }));
  notePanel.hidden = false;
  if (isFocusMode) setFocusMode(true, node);
  else if (focus) graph.focusNode(node.id);
}

function setGraphData(data: GraphData, status: string) {
  if (isFocusMode) setFocusMode(false);
  currentLookup = buildGraphLookup(data);
  graph.setData(data);
  renderGroupList(data);
  dockStatus.textContent = status;
  showNode(window.innerWidth < 760 ? null : graph.getPrimaryNode(), false);
}

function setSourceGraph(data: GraphData, status: string) {
  sourceGraph = data;
  currentGraphStatus = status;
  setGraphData(graphAtDepth(data, currentGroupDepth), status);
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
    setSourceGraph(data, "Локальный vault");
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
  if (target) setFocusMode(!isFocusMode, target);
});
focusDepthButtons.forEach((button) => button.addEventListener("click", () => {
  setFocusDepth(Number(button.dataset.focusDepth));
  if (!isFocusMode && currentNode) setFocusMode(true, currentNode);
}));
sphereStyleButtons.forEach((button) => {
  button.addEventListener("click", () => setSphereStyle(button.dataset.sphereStyle as SphereStyle));
});
cosmicBackgroundToggle.addEventListener("click", () => {
  setCosmicBackground(cosmicBackgroundToggle.getAttribute("aria-pressed") !== "true");
});
immersiveToggle.addEventListener("click", () => setImmersive(!isImmersive));
sceneSettingsTrigger.addEventListener("click", () => setSettingsOpen(sceneSettingsMenu.hidden));
labelModeButtons.forEach((button) => button.addEventListener("click", () => {
  setLabelMode(button.dataset.labelMode as LabelMode);
}));
groupDepthButtons.forEach((button) => button.addEventListener("click", () => {
  setGroupDepth(Number(button.dataset.groupDepth));
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
  } else if (isFocusMode) {
    setFocusMode(false);
  } else if (isImmersive) {
    setImmersive(false);
  }
});

setSourceGraph(sampleGraph, "Демо");
updateFocusDepthButtons();

window.addEventListener("pagehide", () => graph.destroy(), { once: true });
