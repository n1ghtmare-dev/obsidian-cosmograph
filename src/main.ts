import "./style.css";
import { sampleGraph } from "./data/sample";
import { SphericalGraph } from "./graph/SphericalGraph";
import type { GraphData, GraphNode } from "./types";
import { parseVaultFiles } from "./vault";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root is missing");

app.innerHTML = `
  <main class="app-shell">
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
      <button type="button" class="is-active">Сфера</button>
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

let currentGraph = sampleGraph;
let currentNode: GraphNode | null = null;
const graph = new SphericalGraph(canvas);

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

fileInput.addEventListener("change", async () => {
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
});

searchInput.addEventListener("input", () => graph.setSearch(searchInput.value));
panelClose.addEventListener("click", () => showNode(null));
focusButton.addEventListener("click", () => {
  const target = currentNode ?? graph.getPrimaryNode();
  if (target) graph.focusNode(target.id);
});

setGraphData(sampleGraph, "Демо");

window.addEventListener("pagehide", () => graph.destroy(), { once: true });
