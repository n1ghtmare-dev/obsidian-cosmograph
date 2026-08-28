import type { App } from "obsidian";
import type { GraphData, GraphNode } from "../types";

function stripOrderPrefix(segment: string) {
  return segment.replace(/^\d+[.]?\s*/, "");
}

export function groupNameFor(path: string, depth = 1) {
  const folders = path.split("/").slice(0, -1);
  if (folders.length === 0) return "Root";
  const levels = Math.min(Math.max(depth, 1), folders.length);
  return folders.slice(0, levels).map(stripOrderPrefix).join("/") || "Root";
}

export function buildVaultGraph(app: App, groupDepth = 1): GraphData {
  const files = app.vault.getMarkdownFiles();
  const nodes: GraphNode[] = files.map((file) => ({
    id: file.path,
    title: file.basename,
    path: file.path,
    group: groupNameFor(file.path, groupDepth),
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
