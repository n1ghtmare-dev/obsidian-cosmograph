import type { GraphData, GraphNode } from "../types";

export type FocusDepth = 1 | 2 | 3;

export function normalizeFocusDepth(depth: number): FocusDepth {
  return Math.min(3, Math.max(1, Math.trunc(depth) || 1)) as FocusDepth;
}

export type NoteAdjacency = Map<string, Set<string>>;

export function buildNoteAdjacency(data: GraphData): NoteAdjacency {
  const adjacency = new Map<string, Set<string>>();
  data.nodes.forEach((node) => adjacency.set(node.id, new Set()));
  data.edges.forEach((edge) => {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });
  return adjacency;
}

export function focusDistances(
  data: GraphData,
  focusedNode: GraphNode,
  depth: number,
  adjacency: NoteAdjacency = buildNoteAdjacency(data),
) {
  const maxDepth = normalizeFocusDepth(depth);
  const distances = new Map<string, number>([[focusedNode.id, 0]]);
  let frontier: string[] = [];
  let firstNoteDistance = 0;

  if (focusedNode.kind === "cluster") {
    frontier = data.nodes
      .filter((node) => node.group === focusedNode.group)
      .map((node) => node.id);
    frontier.forEach((id) => distances.set(id, 1));
    firstNoteDistance = 1;
  } else {
    frontier = [focusedNode.id];
    const clusterId = `@cluster/${focusedNode.group}`;
    distances.set(clusterId, 1);
  }

  for (let distance = firstNoteDistance + 1; distance <= maxDepth; distance += 1) {
    const next: string[] = [];
    frontier.forEach((id) => {
      adjacency.get(id)?.forEach((neighbor) => {
        if (distances.has(neighbor)) return;
        distances.set(neighbor, distance);
        next.push(neighbor);
      });
    });
    frontier = next;
    if (frontier.length === 0) break;
  }

  return distances;
}

export function focusedNoteCount(data: GraphData, distances: ReadonlyMap<string, number>) {
  return data.nodes.reduce((count, node) => count + (distances.has(node.id) ? 1 : 0), 0);
}
