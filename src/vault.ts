import type { GraphData, GraphNode } from "./types";

type FileWithPath = File & { webkitRelativePath: string };

const WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

function withoutExtension(path: string) {
  return path.replace(/\.md$/i, "");
}

function basename(path: string) {
  return withoutExtension(path).split("/").at(-1) ?? path;
}

function normalisePath(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : path;
}

function getGroup(path: string) {
  const first = path.split("/")[0] ?? "Notes";
  return first.replace(/^\d+[.]?\s*/, "") || "Notes";
}

export async function parseVaultFiles(files: FileList): Promise<GraphData> {
  const markdownFiles = Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".md")) as FileWithPath[];

  if (markdownFiles.length === 0) {
    throw new Error("В выбранной папке не найдено Markdown-заметок.");
  }

  const nodes: GraphNode[] = markdownFiles.map((file) => {
    const path = normalisePath(file.webkitRelativePath || file.name);
    return {
      id: withoutExtension(path),
      title: basename(path),
      path,
      group: getGroup(path),
    };
  });

  const byId = new Map(nodes.map((node) => [node.id.toLocaleLowerCase(), node]));
  const byTitle = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = node.title.toLocaleLowerCase();
    byTitle.set(key, [...(byTitle.get(key) ?? []), node]);
  }

  const contents = await Promise.all(markdownFiles.map((file) => file.text()));
  const edgeKeys = new Set<string>();
  const edges: GraphData["edges"] = [];

  contents.forEach((content, index) => {
    const source = nodes[index];
    for (const match of content.matchAll(WIKI_LINK)) {
      const rawTarget = match[1].trim().replace(/\\/g, "/");
      const exact = byId.get(withoutExtension(rawTarget).toLocaleLowerCase());
      const titleMatches = byTitle.get(basename(rawTarget).toLocaleLowerCase());
      const target = exact ?? titleMatches?.[0];
      if (!target || target.id === source.id) continue;

      const key = [source.id, target.id].sort().join("\u0000");
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ source: source.id, target: target.id });
    }
  });

  return { nodes, edges };
}
