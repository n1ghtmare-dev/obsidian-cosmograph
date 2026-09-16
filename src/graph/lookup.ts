import type { GraphData, GraphNode } from "../types";
import { buildNoteAdjacency, type NoteAdjacency } from "./focus";

export type GraphLookup = {
  nodesById: Map<string, GraphNode>;
  nodesByGroup: Map<string, GraphNode[]>;
  adjacency: NoteAdjacency;
  incomingCounts: Map<string, number>;
  outgoingCounts: Map<string, number>;
  incidentEdgesByGroup: Map<string, number>;
};

export function buildGraphLookup(data: GraphData): GraphLookup {
  const nodesById = new Map(data.nodes.map((node) => [node.id, node]));
  const nodesByGroup = new Map<string, GraphNode[]>();
  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();
  const incidentEdgesByGroup = new Map<string, number>();

  data.nodes.forEach((node) => {
    nodesByGroup.set(node.group, [...(nodesByGroup.get(node.group) ?? []), node]);
    incomingCounts.set(node.id, 0);
    outgoingCounts.set(node.id, 0);
  });

  data.edges.forEach((edge) => {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1);
    const sourceGroup = nodesById.get(edge.source)?.group;
    const targetGroup = nodesById.get(edge.target)?.group;
    if (sourceGroup) incidentEdgesByGroup.set(sourceGroup, (incidentEdgesByGroup.get(sourceGroup) ?? 0) + 1);
    if (targetGroup && targetGroup !== sourceGroup) {
      incidentEdgesByGroup.set(targetGroup, (incidentEdgesByGroup.get(targetGroup) ?? 0) + 1);
    }
  });

  return {
    nodesById,
    nodesByGroup,
    adjacency: buildNoteAdjacency(data),
    incomingCounts,
    outgoingCounts,
    incidentEdgesByGroup,
  };
}
