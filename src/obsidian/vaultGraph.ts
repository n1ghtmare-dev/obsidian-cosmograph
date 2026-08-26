import type { App } from "obsidian";
import type { GraphData, GraphNode } from "../types";

function displayGroupName(path: string) {
  const firstFolder = path.includes("/") ? path.split("/")[0] : "Root";
  return firstFolder.replace(/^\d+[.]?\s*/, "") || "Root";
}

export function buildVaultGraph(app: App): GraphData {
  const files = app.vault.getMarkdownFiles();
  const nodes: GraphNode[] = files.map((file) => ({
    id: file.path,
    title: file.basename,
    path: file.path,
    group: displayGroupName(file.path),
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeKeys = new Set<string>();
  const edges: GraphData["edges"] = [];

  for (const source of files) {
    const resolvedTargets = app.metadataCache.resolvedLinks[source.path] ?? {};
    for (const targetPath of Object.keys(resolvedTargets)) {
      if (!nodeIds.has(targetPath) || targetPath === source.path) continue;
      const key = [source.path, targetPath].sort().join("\u0000");
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ source: source.path, target: targetPath });
    }
  }

  return { nodes, edges };
}
